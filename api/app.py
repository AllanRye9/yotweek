import os
import re
import sys
import io
import base64
import math
import secrets
import threading

import time
import uuid
import shutil
import json
import logging
import sqlite3
import hashlib
import socket
import urllib.parse
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    psycopg2 = None
# Tuple of integrity-error types so except clauses work for both backends

try:
    import boto3
    from botocore.exceptions import ClientError as _BotocoreClientError
except ImportError:
    boto3 = None
    _BotocoreClientError = Exception
_IntegrityErrors: tuple = (sqlite3.IntegrityError,)
if psycopg2 is not None:
    _IntegrityErrors = (sqlite3.IntegrityError, psycopg2.IntegrityError)
import smtplib
from email.mime.text import MIMEText
import asyncio
import mimetypes
import certifi

from pathlib import Path
from datetime import datetime, timedelta, timezone
from functools import wraps

import socketio as socketio_pkg
from fastapi import FastAPI, Request, Form, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, FileResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from werkzeug.security import generate_password_hash, check_password_hash

# =========================================================
# PRODUCTION CONFIGURATION
# =========================================================

class Config:
    """Production configuration"""
    SECRET_KEY = os.environ.get("SECRET_KEY", os.urandom(24).hex())
    MAX_CONTENT_LENGTH = 100 * 1024 * 1024  # 100MB max upload
    TEMPLATES_FOLDER = "templates"
    STATIC_FOLDER = "static"
    SESSION_TYPE = 'filesystem'
    PERMANENT_SESSION_LIFETIME = timedelta(hours=1)
    # Admin authentication — set ADMIN_PASSWORD env var in production.
    # If the env var is not provided a cryptographically random secret is
    # generated so that every fresh deployment has a unique, strong password.
    ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or secrets.token_hex(16)

# =========================================================
# PATH SETUP
# =========================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = BASE_DIR  # Assuming app.py is in root

# Handle case where app.py is in api/ subdirectory
if os.path.basename(BASE_DIR) == "api":
    ROOT_DIR = os.path.dirname(BASE_DIR)

TEMPLATES_DIR = os.path.join(ROOT_DIR, Config.TEMPLATES_FOLDER)
STATIC_DIR = os.path.join(ROOT_DIR, Config.STATIC_FOLDER)

DATA_DIR = os.path.join(ROOT_DIR, "data")
# React frontend build output
FRONTEND_DIST = os.path.join(ROOT_DIR, "frontend_dist")

# Avatar upload directory (served as /static/avatars/)
AVATARS_DIR = os.path.join(STATIC_DIR, "avatars")

# Create remaining directories (non-fatal if they fail on restricted systems)
for _d in (TEMPLATES_DIR, STATIC_DIR, DATA_DIR, AVATARS_DIR):
    try:
        os.makedirs(_d, exist_ok=True)
    except OSError:
        pass

# =========================================================
# LOGGING SETUP
# =========================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        *(
            [logging.FileHandler(os.path.join(ROOT_DIR, 'app.log'))]
            if os.access(ROOT_DIR, os.W_OK)
            else []
        ),
    ]
)
logger = logging.getLogger(__name__)

# =========================================================
# FASTAPI APP INITIALIZATION
# =========================================================

_allowed_origins = os.environ.get("ALLOWED_ORIGINS", "*").split(",")

# Event loop reference for thread-safe Socket.IO emits
_loop: asyncio.AbstractEventLoop | None = None

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(application):
    global _loop
    _loop = asyncio.get_running_loop()
    # Ensure all database tables exist before the app starts serving requests.
    init_db()
    yield

fastapi_app = FastAPI(lifespan=lifespan)

# Session middleware (replaces Flask's built-in session)
fastapi_app.add_middleware(SessionMiddleware, secret_key=Config.SECRET_KEY)

# CORS middleware (replaces Flask-CORS)
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# Jinja2 template rendering (still used for legacy /admin/login fallback)
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# Mount static files
from starlette.staticfiles import StaticFiles
if os.path.isdir(STATIC_DIR):
    fastapi_app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Mount React frontend build assets (CSS/JS chunks)
if os.path.isdir(FRONTEND_DIST):
    _frontend_assets = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(_frontend_assets):
        fastapi_app.mount("/assets", StaticFiles(directory=_frontend_assets), name="frontend_assets")

# Socket.IO with ASGI mode
sio = socketio_pkg.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=_allowed_origins,
    logger=True if os.environ.get("FLASK_DEBUG") else False,
    engineio_logger=True if os.environ.get("FLASK_DEBUG") else False,
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=int(1e8),
)

# The top-level ASGI app: Socket.IO wrapping FastAPI
app = socketio_pkg.ASGIApp(sio, other_asgi_app=fastapi_app)


def emit_from_thread(event, data=None, room=None):
    """Thread-safe wrapper to emit Socket.IO events from background threads."""
    if _loop is None:
        return
    try:
        asyncio.run_coroutine_threadsafe(
            sio.emit(event, data, room=room),
            _loop,
        )
    except Exception as e:
        logger.error(f"emit_from_thread error: {e}")

# =========================================================
# GLOBAL STATE WITH THREAD SAFETY
# =========================================================

from threading import Lock

# Paths for persistent storage
DATA_DIR = os.path.join(ROOT_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "admin.db")
os.makedirs(DATA_DIR, exist_ok=True)

# PostgreSQL support: when DATABASE_URL is set, use PostgreSQL instead of SQLite
DATABASE_URL = os.environ.get("DATABASE_URL")
USE_POSTGRES = bool(DATABASE_URL and psycopg2 is not None)

# =========================================================
# S3-COMPATIBLE OBJECT STORAGE
# Set all five BUCKET_* variables to enable cloud storage.
# When configured, completed downloads are uploaded to the
# bucket and served via presigned URLs; files are also deleted
# from the bucket on removal/cleanup.
# =========================================================

BUCKET_NAME             = os.environ.get("BUCKET_NAME", "")
BUCKET_REGION           = os.environ.get("BUCKET_REGION", "")
BUCKET_ENDPOINT         = os.environ.get("BUCKET_ENDPOINT", "")
BUCKET_ACCESS_KEY_ID    = os.environ.get("BUCKET_ACCESS_KEY_ID", "")
BUCKET_SECRET_ACCESS_KEY = os.environ.get("BUCKET_SECRET_ACCESS_KEY", "")

_S3_ENABLED = bool(
    boto3 is not None
    and BUCKET_NAME
    and BUCKET_ACCESS_KEY_ID
    and BUCKET_SECRET_ACCESS_KEY
)

_s3_client_instance = None
_s3_client_lock = threading.Lock()


def _get_s3_client():
    """Return a cached boto3 S3 client, or *None* when S3 is not configured."""
    global _s3_client_instance
    if not _S3_ENABLED:
        return None
    if _s3_client_instance is not None:
        return _s3_client_instance
    with _s3_client_lock:
        if _s3_client_instance is None:
            kwargs = {
                "aws_access_key_id":     BUCKET_ACCESS_KEY_ID,
                "aws_secret_access_key": BUCKET_SECRET_ACCESS_KEY,
            }
            if BUCKET_REGION:
                kwargs["region_name"] = BUCKET_REGION
            if BUCKET_ENDPOINT:
                kwargs["endpoint_url"] = BUCKET_ENDPOINT
            _s3_client_instance = boto3.client("s3", **kwargs)
    return _s3_client_instance


def _s3_upload_file(local_path: str, key: str) -> bool:
    """Upload *local_path* to the configured bucket under *key*.

    Returns ``True`` on success, ``False`` when S3 is not configured or the
    upload fails (errors are logged but never re-raised so callers always get
    a usable result).
    """
    client = _get_s3_client()
    if client is None:
        return False
    try:
        client.upload_file(local_path, BUCKET_NAME, key)
        logger.info("S3 upload: %s → s3://%s/%s", local_path, BUCKET_NAME, key)
        return True
    except Exception as exc:
        logger.error("S3 upload failed for %s: %s", key, exc)
        return False


def _s3_delete_file(key: str) -> bool:
    """Delete *key* from the configured bucket.

    Returns ``True`` on success, ``False`` otherwise.
    """
    client = _get_s3_client()
    if client is None:
        return False
    try:
        client.delete_object(Bucket=BUCKET_NAME, Key=key)
        logger.info("S3 delete: s3://%s/%s", BUCKET_NAME, key)
        return True
    except Exception as exc:
        logger.error("S3 delete failed for %s: %s", key, exc)
        return False


def _s3_presigned_url(key: str, expires_in: int = 3600) -> str | None:
    """Generate a presigned download URL for *key* (default expiry 1 hour).

    Returns the URL string on success, or ``None`` when S3 is not configured or
    URL generation fails.
    """
    client = _get_s3_client()
    if client is None:
        return None
    try:
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET_NAME, "Key": key},
            ExpiresIn=expires_in,
        )
        return url
    except Exception as exc:
        logger.error("S3 presigned URL failed for %s: %s", key, exc)
        return None


def _s3_object_exists(key: str) -> bool:
    """Return *True* when *key* exists in the configured bucket."""
    client = _get_s3_client()
    if client is None:
        return False
    try:
        client.head_object(Bucket=BUCKET_NAME, Key=key)
        return True
    except _BotocoreClientError:
        return False
    except Exception as exc:
        logger.error("S3 head_object failed for %s: %s", key, exc)
        return False


def _s3_upload_bytes(data: bytes, key: str, content_type: str = "application/octet-stream") -> bool:
    """Upload raw *data* bytes to the configured bucket under *key*.

    Returns ``True`` on success, ``False`` when S3 is not configured or the
    upload fails (errors are logged but never re-raised).
    """
    client = _get_s3_client()
    if client is None:
        return False
    try:
        client.put_object(Body=io.BytesIO(data), Bucket=BUCKET_NAME, Key=key, ContentType=content_type)
        logger.info("S3 upload bytes: s3://%s/%s (%d bytes)", BUCKET_NAME, key, len(data))
        return True
    except Exception as exc:
        logger.error("S3 upload bytes failed for %s: %s", key, exc)
        return False


def _bucket_write_json(folder: str, type_prefix: str, record_id: str, data: dict) -> bool:
    """Write *data* as a JSON file to *folder* in the configured bucket.

    The key is ``{folder}/{type_prefix}_{timestamp}_{record_id}.json``.
    This follows the bucket file-naming convention:
        {type}_{timestamp}_{uuid}.json
    Returns ``True`` on success, ``False`` when S3 is not configured or the
    write fails (errors are logged but never re-raised).
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    key = f"{folder.rstrip('/')}/{type_prefix}_{ts}_{record_id}.json"
    payload = json.dumps(data, default=str).encode("utf-8")
    return _s3_upload_bytes(payload, key, "application/json")


# ── Email / SMTP ───────────────────────────────────────────────────────────────

_SMTP_HOST     = os.environ.get("SMTP_HOST", "")
_SMTP_PORT     = int(os.environ.get("SMTP_PORT", "587"))
_SMTP_USER     = os.environ.get("SMTP_USER", "")
_SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
_SMTP_FROM     = os.environ.get("SMTP_FROM", "") or _SMTP_USER
# Public-facing base URL used to build absolute links in emails.
# Falls back to an empty string (relative links) when not configured.
_BASE_URL      = os.environ.get("BASE_URL", "").rstrip("/")


def _is_valid_email(email: str) -> bool:
    """Return True when *email* looks like a valid email address.

    Uses a simple structural check (local@domain.tld) that avoids
    catastrophic-backtracking (ReDoS) risks while still rejecting
    obviously invalid addresses.
    """
    if not email or len(email) > 254:
        return False
    at = email.find("@")
    if at <= 0 or at == len(email) - 1:
        return False
    local, domain = email[:at], email[at + 1:]
    if " " in email or "@" in domain:
        return False
    dot = domain.rfind(".")
    return dot > 0 and dot < len(domain) - 1


def _send_email(to_addr: str, subject: str, body_text: str) -> bool:
    """Send a plain-text email via SMTP.

    Returns True on success, False when SMTP is not configured or sending
    fails (errors are logged but never re-raised).
    """
    if not _SMTP_HOST or not to_addr:
        return False
    try:
        msg = MIMEText(body_text, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"]    = _SMTP_FROM
        msg["To"]      = to_addr
        with smtplib.SMTP(_SMTP_HOST, _SMTP_PORT, timeout=10) as smtp:
            smtp.ehlo()
            if _SMTP_PORT != 465:
                smtp.starttls()
                smtp.ehlo()
            if _SMTP_USER and _SMTP_PASSWORD:
                smtp.login(_SMTP_USER, _SMTP_PASSWORD)
            smtp.send_message(msg)
        logger.info("Email sent to %s: %s", to_addr, subject)
        return True
    except Exception as exc:
        logger.error("Email send failed to %s: %s", to_addr, exc)
        return False


# =========================================================
# ISO 3166-1 ALPHA-2 → COUNTRY NAME LOOKUP
# =========================================================

_ISO2_TO_NAME: dict[str, str] = {
    "AF": "Afghanistan", "AX": "Aland Islands", "AL": "Albania",
    "DZ": "Algeria", "AS": "American Samoa", "AD": "Andorra",
    "AO": "Angola", "AI": "Anguilla", "AQ": "Antarctica",
    "AG": "Antigua and Barbuda", "AR": "Argentina", "AM": "Armenia",
    "AW": "Aruba", "AU": "Australia", "AT": "Austria", "AZ": "Azerbaijan",
    "BS": "Bahamas", "BH": "Bahrain", "BD": "Bangladesh", "BB": "Barbados",
    "BY": "Belarus", "BE": "Belgium", "BZ": "Belize", "BJ": "Benin",
    "BM": "Bermuda", "BT": "Bhutan", "BO": "Bolivia",
    "BQ": "Bonaire, Sint Eustatius and Saba",
    "BA": "Bosnia and Herzegovina", "BW": "Botswana",
    "BV": "Bouvet Island", "BR": "Brazil",
    "IO": "British Indian Ocean Territory", "BN": "Brunei",
    "BG": "Bulgaria", "BF": "Burkina Faso", "BI": "Burundi",
    "CV": "Cabo Verde", "KH": "Cambodia", "CM": "Cameroon", "CA": "Canada",
    "KY": "Cayman Islands", "CF": "Central African Republic", "TD": "Chad",
    "CL": "Chile", "CN": "China", "CX": "Christmas Island",
    "CC": "Cocos (Keeling) Islands", "CO": "Colombia", "KM": "Comoros",
    "CG": "Congo", "CD": "DR Congo", "CK": "Cook Islands",
    "CR": "Costa Rica", "CI": "Ivory Coast", "HR": "Croatia", "CU": "Cuba",
    "CW": "Curacao", "CY": "Cyprus", "CZ": "Czech Republic",
    "DK": "Denmark", "DJ": "Djibouti", "DM": "Dominica",
    "DO": "Dominican Republic", "EC": "Ecuador", "EG": "Egypt",
    "SV": "El Salvador", "GQ": "Equatorial Guinea", "ER": "Eritrea",
    "EE": "Estonia", "SZ": "Eswatini", "ET": "Ethiopia",
    "FK": "Falkland Islands", "FO": "Faroe Islands", "FJ": "Fiji",
    "FI": "Finland", "FR": "France", "GF": "French Guiana",
    "PF": "French Polynesia", "TF": "French Southern Territories",
    "GA": "Gabon", "GM": "Gambia", "GE": "Georgia", "DE": "Germany",
    "GH": "Ghana", "GI": "Gibraltar", "GR": "Greece", "GL": "Greenland",
    "GD": "Grenada", "GP": "Guadeloupe", "GU": "Guam",
    "GT": "Guatemala", "GG": "Guernsey", "GN": "Guinea",
    "GW": "Guinea-Bissau", "GY": "Guyana", "HT": "Haiti",
    "HM": "Heard Island and McDonald Islands",
    "VA": "Holy See", "HN": "Honduras", "HK": "Hong Kong",
    "HU": "Hungary", "IS": "Iceland", "IN": "India", "ID": "Indonesia",
    "IR": "Iran", "IQ": "Iraq", "IE": "Ireland", "IM": "Isle of Man",
    "IL": "Israel", "IT": "Italy", "JM": "Jamaica", "JP": "Japan",
    "JE": "Jersey", "JO": "Jordan", "KZ": "Kazakhstan", "KE": "Kenya",
    "KI": "Kiribati", "KP": "North Korea", "KR": "South Korea",
    "KW": "Kuwait", "KG": "Kyrgyzstan", "LA": "Laos", "LV": "Latvia",
    "LB": "Lebanon", "LS": "Lesotho", "LR": "Liberia", "LY": "Libya",
    "LI": "Liechtenstein", "LT": "Lithuania", "LU": "Luxembourg",
    "MO": "Macao", "MG": "Madagascar", "MW": "Malawi", "MY": "Malaysia",
    "MV": "Maldives", "ML": "Mali", "MT": "Malta", "MH": "Marshall Islands",
    "MQ": "Martinique", "MR": "Mauritania", "MU": "Mauritius",
    "YT": "Mayotte", "MX": "Mexico", "FM": "Micronesia", "MD": "Moldova",
    "MC": "Monaco", "MN": "Mongolia", "ME": "Montenegro",
    "MS": "Montserrat", "MA": "Morocco", "MZ": "Mozambique",
    "MM": "Myanmar", "NA": "Namibia", "NR": "Nauru", "NP": "Nepal",
    "NL": "Netherlands", "NC": "New Caledonia", "NZ": "New Zealand",
    "NI": "Nicaragua", "NE": "Niger", "NG": "Nigeria", "NU": "Niue",
    "NF": "Norfolk Island", "MK": "North Macedonia",
    "MP": "Northern Mariana Islands", "NO": "Norway", "OM": "Oman",
    "PK": "Pakistan", "PW": "Palau", "PS": "Palestine", "PA": "Panama",
    "PG": "Papua New Guinea", "PY": "Paraguay", "PE": "Peru",
    "PH": "Philippines", "PN": "Pitcairn", "PL": "Poland",
    "PT": "Portugal", "PR": "Puerto Rico", "QA": "Qatar",
    "RE": "Reunion", "RO": "Romania", "RU": "Russia", "RW": "Rwanda",
    "BL": "Saint Barthelemy", "SH": "Saint Helena",
    "KN": "Saint Kitts and Nevis", "LC": "Saint Lucia",
    "MF": "Saint Martin", "PM": "Saint Pierre and Miquelon",
    "VC": "Saint Vincent and the Grenadines", "WS": "Samoa",
    "SM": "San Marino", "ST": "Sao Tome and Principe",
    "SA": "Saudi Arabia", "SN": "Senegal", "RS": "Serbia",
    "SC": "Seychelles", "SL": "Sierra Leone", "SG": "Singapore",
    "SX": "Sint Maarten", "SK": "Slovakia", "SI": "Slovenia",
    "SB": "Solomon Islands", "SO": "Somalia", "ZA": "South Africa",
    "GS": "South Georgia and the South Sandwich Islands",
    "SS": "South Sudan", "ES": "Spain", "LK": "Sri Lanka", "SD": "Sudan",
    "SR": "Suriname", "SJ": "Svalbard and Jan Mayen", "SE": "Sweden",
    "CH": "Switzerland", "SY": "Syria", "TW": "Taiwan",
    "TJ": "Tajikistan", "TZ": "Tanzania", "TH": "Thailand",
    "TL": "Timor-Leste", "TG": "Togo", "TK": "Tokelau", "TO": "Tonga",
    "TT": "Trinidad and Tobago", "TN": "Tunisia", "TR": "Turkey",
    "TM": "Turkmenistan", "TC": "Turks and Caicos Islands",
    "TV": "Tuvalu", "UG": "Uganda", "UA": "Ukraine",
    "AE": "United Arab Emirates", "GB": "United Kingdom",
    "US": "United States", "UM": "United States Minor Outlying Islands",
    "UY": "Uruguay", "UZ": "Uzbekistan", "VU": "Vanuatu",
    "VE": "Venezuela", "VN": "Vietnam",
    "VG": "British Virgin Islands", "VI": "U.S. Virgin Islands",
    "WF": "Wallis and Futuna", "EH": "Western Sahara",
    "YE": "Yemen", "ZM": "Zambia", "ZW": "Zimbabwe",
}

# =========================================================
# SSL CERTIFICATE FIX
# =========================================================

os.environ['SSL_CERT_FILE'] = certifi.where()
os.environ['REQUESTS_CA_BUNDLE'] = certifi.where()

# =========================================================
# DATABASE PERSISTENCE  (PostgreSQL when DATABASE_URL is set, else SQLite)
# =========================================================

_db_lock = threading.Lock()


def _get_db():
    """Open a short-lived database connection for the calling thread.

    Callers hold _db_lock and immediately close the connection after use,
    so each connection is used by exactly one thread.
    """
    if USE_POSTGRES:
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn


def _execute(conn, sql, params=None):
    """Execute *sql* on *conn* and return a cursor-like object.

    Handles the dialect differences between SQLite (``?`` placeholders,
    ``conn.execute``) and PostgreSQL (``%s`` placeholders, cursor with
    ``RealDictCursor``).

    Note: The ``?`` → ``%s`` replacement is safe here because all SQL in this
    application uses ``?`` exclusively as parameter placeholders (no question
    marks appear inside string literals or comments).
    """
    if USE_POSTGRES:
        sql = sql.replace("?", "%s")
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        return cur
    else:
        return conn.execute(sql, params or ())


def init_db():
    """Create tables if they don't exist."""
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS admin_users (
                        id SERIAL PRIMARY KEY,
                        username TEXT UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS app_users (
                        id SERIAL PRIMARY KEY,
                        user_id TEXT UNIQUE NOT NULL,
                        name TEXT NOT NULL,
                        email TEXT UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL,
                        role TEXT NOT NULL DEFAULT 'passenger',
                        location_lat REAL,
                        location_lng REAL,
                        location_name TEXT,
                        avatar_url TEXT,
                        bio TEXT,
                        created_at TEXT NOT NULL,
                        username TEXT UNIQUE
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS rides (
                        id SERIAL PRIMARY KEY,
                        ride_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        driver_name TEXT NOT NULL,
                        origin TEXT NOT NULL,
                        destination TEXT NOT NULL,
                        origin_lat REAL,
                        origin_lng REAL,
                        dest_lat REAL,
                        dest_lng REAL,
                        fare REAL,
                        departure TEXT NOT NULL,
                        seats INTEGER NOT NULL DEFAULT 1,
                        notes TEXT,
                        status TEXT NOT NULL DEFAULT 'open',
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS driver_applications (
                        id SERIAL PRIMARY KEY,
                        app_id TEXT UNIQUE NOT NULL,
                        user_id TEXT UNIQUE NOT NULL,
                        vehicle_make TEXT NOT NULL,
                        vehicle_model TEXT NOT NULL,
                        vehicle_year INTEGER NOT NULL,
                        vehicle_color TEXT NOT NULL DEFAULT '',
                        license_plate TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending',
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS notifications (
                        id SERIAL PRIMARY KEY,
                        notif_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        type TEXT NOT NULL,
                        title TEXT NOT NULL,
                        body TEXT NOT NULL,
                        read INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        link TEXT,
                        link_label TEXT
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS ride_chat_messages (
                        id SERIAL PRIMARY KEY,
                        msg_id TEXT UNIQUE NOT NULL,
                        ride_id TEXT NOT NULL,
                        sender_name TEXT NOT NULL,
                        sender_role TEXT NOT NULL DEFAULT 'passenger',
                        text TEXT,
                        media_type TEXT,
                        media_data TEXT,
                        lat REAL,
                        lng REAL,
                        ts REAL NOT NULL,
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS dm_conversations (
                        id SERIAL PRIMARY KEY,
                        conv_id TEXT UNIQUE NOT NULL,
                        user1_id TEXT NOT NULL,
                        user2_id TEXT NOT NULL,
                        unread_u1 INTEGER NOT NULL DEFAULT 0,
                        unread_u2 INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS dm_messages (
                        id SERIAL PRIMARY KEY,
                        msg_id TEXT UNIQUE NOT NULL,
                        conv_id TEXT NOT NULL,
                        sender_id TEXT NOT NULL,
                        content TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'sent',
                        reply_to_id TEXT,
                        ts REAL NOT NULL,
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS broadcasts (
                        id SERIAL PRIMARY KEY,
                        broadcast_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        poster_name TEXT NOT NULL,
                        seats INTEGER NOT NULL DEFAULT 1,
                        waiting_time TEXT NOT NULL,
                        start_destination TEXT NOT NULL,
                        end_destination TEXT NOT NULL,
                        start_lat REAL,
                        start_lng REAL,
                        end_lat REAL,
                        end_lng REAL,
                        fare REAL,
                        status TEXT NOT NULL DEFAULT 'active',
                        created_at TEXT NOT NULL,
                        expires_at TEXT
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS bookings (
                        id SERIAL PRIMARY KEY,
                        booking_id TEXT UNIQUE NOT NULL,
                        broadcast_id TEXT NOT NULL,
                        passenger_id TEXT NOT NULL,
                        passenger_name TEXT NOT NULL,
                        seats INTEGER NOT NULL DEFAULT 1,
                        amount REAL NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending',
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS receipts (
                        id SERIAL PRIMARY KEY,
                        receipt_id TEXT UNIQUE NOT NULL,
                        booking_id TEXT NOT NULL,
                        broadcast_id TEXT NOT NULL,
                        passenger_id TEXT NOT NULL,
                        passenger_name TEXT NOT NULL,
                        driver_id TEXT NOT NULL,
                        driver_name TEXT NOT NULL,
                        amount REAL NOT NULL,
                        transaction_id TEXT NOT NULL,
                        start_destination TEXT NOT NULL,
                        end_destination TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS ride_requests (
                        id SERIAL PRIMARY KEY,
                        request_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        passenger_name TEXT NOT NULL,
                        origin TEXT NOT NULL,
                        destination TEXT NOT NULL,
                        desired_date TEXT NOT NULL,
                        passengers INTEGER NOT NULL DEFAULT 1,
                        price_min REAL,
                        price_max REAL,
                        status TEXT NOT NULL DEFAULT 'open',
                        accepted_by TEXT,
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS ride_journey_confirmations (
                        id SERIAL PRIMARY KEY,
                        confirmation_id TEXT UNIQUE NOT NULL,
                        ride_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        real_name TEXT NOT NULL,
                        contact TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        UNIQUE(ride_id, user_id)
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS travel_companions (
                        id SERIAL PRIMARY KEY,
                        companion_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        poster_name TEXT NOT NULL,
                        origin_country TEXT NOT NULL,
                        destination_country TEXT NOT NULL,
                        origin_city TEXT NOT NULL DEFAULT '',
                        destination_city TEXT NOT NULL DEFAULT '',
                        travel_date TEXT NOT NULL,
                        notes TEXT,
                        status TEXT NOT NULL DEFAULT 'active',
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS properties (
                        id SERIAL PRIMARY KEY,
                        property_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        description TEXT,
                        price REAL,
                        location TEXT,
                        property_type TEXT NOT NULL DEFAULT 'listings',
                        available_date TEXT,
                        occupancy_status TEXT,
                        status TEXT NOT NULL DEFAULT 'active',
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS property_conversations (
                        id SERIAL PRIMARY KEY,
                        conv_id TEXT UNIQUE NOT NULL,
                        property_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        agent_id TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS property_messages (
                        id SERIAL PRIMARY KEY,
                        msg_id TEXT UNIQUE NOT NULL,
                        conv_id TEXT NOT NULL,
                        sender_id TEXT NOT NULL,
                        sender_role TEXT NOT NULL DEFAULT 'user',
                        content TEXT NOT NULL,
                        ts REAL NOT NULL,
                        created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS agent_chat_messages (
                        id SERIAL PRIMARY KEY,
                        msg_id TEXT UNIQUE NOT NULL,
                        agent_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        sender_role TEXT NOT NULL DEFAULT 'user',
                        text TEXT,
                        ts REAL NOT NULL,
                        created_at TEXT NOT NULL
                    )
                """)
                conn.commit()
                # Migrations: add new columns to existing tables if needed
                for col, coldef in [("avatar_url", "TEXT"), ("bio", "TEXT"), ("public_key", "TEXT"), ("can_post_properties", "INTEGER DEFAULT 0"), ("phone", "TEXT DEFAULT ''"), ("username", "TEXT"), ("email_verified", "INTEGER NOT NULL DEFAULT 0"), ("preferred_language", "TEXT DEFAULT ''")]:
                    try:
                        cur.execute(f"ALTER TABLE app_users ADD COLUMN {col} {coldef}")
                        conn.commit()
                    except Exception:
                        conn.rollback()
                        pass  # column already exists
                for col, coldef in [("dest_lat", "REAL"), ("dest_lng", "REAL"), ("fare", "REAL"), ("ride_type", "TEXT DEFAULT 'airport'"),
                                    ("vehicle_color", "TEXT DEFAULT ''"), ("vehicle_type", "TEXT DEFAULT ''"), ("plate_number", "TEXT DEFAULT ''")]:
                    try:
                        cur.execute(f"ALTER TABLE rides ADD COLUMN {col} {coldef}")
                        conn.commit()
                    except Exception:
                        conn.rollback()
                        pass  # column already exists
                for col, coldef in [("subscription_type", "TEXT DEFAULT 'monthly'")]:
                    try:
                        cur.execute(f"ALTER TABLE driver_applications ADD COLUMN {col} {coldef}")
                        conn.commit()
                    except Exception:
                        conn.rollback()
                        pass  # column already exists
                for col, coldef in [("link", "TEXT"), ("link_label", "TEXT")]:
                    try:
                        cur.execute(f"ALTER TABLE notifications ADD COLUMN {col} {coldef}")
                        conn.commit()
                    except Exception:
                        conn.rollback()
                        pass  # column already exists
                for col, coldef in [("property_type", "TEXT NOT NULL DEFAULT 'listings'"), ("available_date", "TEXT"), ("occupancy_status", "TEXT")]:
                    try:
                        cur.execute(f"ALTER TABLE properties ADD COLUMN {col} {coldef}")
                        conn.commit()
                    except Exception:
                        conn.rollback()
                        pass  # column already exists
                for col, coldef in [("subtotal", "REAL NOT NULL DEFAULT 0")]:
                    try:
                        cur.execute(f"ALTER TABLE receipts ADD COLUMN {col} {coldef}")
                        conn.commit()
                    except Exception:
                        conn.rollback()
                        pass  # column already exists
            else:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS admin_users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS app_users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id TEXT UNIQUE NOT NULL,
                        name TEXT NOT NULL,
                        email TEXT UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL,
                        role TEXT NOT NULL DEFAULT 'passenger',
                        location_lat REAL,
                        location_lng REAL,
                        location_name TEXT,
                        avatar_url TEXT,
                        bio TEXT,
                        created_at TEXT NOT NULL,
                        username TEXT UNIQUE
                    );
                    CREATE TABLE IF NOT EXISTS rides (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ride_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        driver_name TEXT NOT NULL,
                        origin TEXT NOT NULL,
                        destination TEXT NOT NULL,
                        origin_lat REAL,
                        origin_lng REAL,
                        dest_lat REAL,
                        dest_lng REAL,
                        fare REAL,
                        departure TEXT NOT NULL,
                        seats INTEGER NOT NULL DEFAULT 1,
                        notes TEXT,
                        status TEXT NOT NULL DEFAULT 'open',
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS driver_applications (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        app_id TEXT UNIQUE NOT NULL,
                        user_id TEXT UNIQUE NOT NULL,
                        vehicle_make TEXT NOT NULL,
                        vehicle_model TEXT NOT NULL,
                        vehicle_year INTEGER NOT NULL,
                        vehicle_color TEXT NOT NULL DEFAULT '',
                        license_plate TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending',
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS notifications (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        notif_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        type TEXT NOT NULL,
                        title TEXT NOT NULL,
                        body TEXT NOT NULL,
                        read INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        link TEXT,
                        link_label TEXT
                    );
                    CREATE TABLE IF NOT EXISTS ride_chat_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        msg_id TEXT UNIQUE NOT NULL,
                        ride_id TEXT NOT NULL,
                        sender_name TEXT NOT NULL,
                        sender_role TEXT NOT NULL DEFAULT 'passenger',
                        text TEXT,
                        media_type TEXT,
                        media_data TEXT,
                        lat REAL,
                        lng REAL,
                        ts REAL NOT NULL,
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS dm_conversations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        conv_id TEXT UNIQUE NOT NULL,
                        user1_id TEXT NOT NULL,
                        user2_id TEXT NOT NULL,
                        unread_u1 INTEGER NOT NULL DEFAULT 0,
                        unread_u2 INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS dm_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        msg_id TEXT UNIQUE NOT NULL,
                        conv_id TEXT NOT NULL,
                        sender_id TEXT NOT NULL,
                        content TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'sent',
                        reply_to_id TEXT,
                        ts REAL NOT NULL,
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS broadcasts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        broadcast_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        poster_name TEXT NOT NULL,
                        seats INTEGER NOT NULL DEFAULT 1,
                        waiting_time TEXT NOT NULL,
                        start_destination TEXT NOT NULL,
                        end_destination TEXT NOT NULL,
                        start_lat REAL,
                        start_lng REAL,
                        end_lat REAL,
                        end_lng REAL,
                        fare REAL,
                        status TEXT NOT NULL DEFAULT 'active',
                        created_at TEXT NOT NULL,
                        expires_at TEXT
                    );
                    CREATE TABLE IF NOT EXISTS bookings (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        booking_id TEXT UNIQUE NOT NULL,
                        broadcast_id TEXT NOT NULL,
                        passenger_id TEXT NOT NULL,
                        passenger_name TEXT NOT NULL,
                        seats INTEGER NOT NULL DEFAULT 1,
                        amount REAL NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending',
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS receipts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        receipt_id TEXT UNIQUE NOT NULL,
                        booking_id TEXT NOT NULL,
                        broadcast_id TEXT NOT NULL,
                        passenger_id TEXT NOT NULL,
                        passenger_name TEXT NOT NULL,
                        driver_id TEXT NOT NULL,
                        driver_name TEXT NOT NULL,
                        amount REAL NOT NULL,
                        transaction_id TEXT NOT NULL,
                        start_destination TEXT NOT NULL,
                        end_destination TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS ride_requests (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        request_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        passenger_name TEXT NOT NULL,
                        origin TEXT NOT NULL,
                        destination TEXT NOT NULL,
                        desired_date TEXT NOT NULL,
                        passengers INTEGER NOT NULL DEFAULT 1,
                        price_min REAL,
                        price_max REAL,
                        status TEXT NOT NULL DEFAULT 'open',
                        accepted_by TEXT,
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS ride_journey_confirmations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        confirmation_id TEXT UNIQUE NOT NULL,
                        ride_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        real_name TEXT NOT NULL,
                        contact TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        UNIQUE(ride_id, user_id)
                    );
                    CREATE TABLE IF NOT EXISTS travel_companions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        companion_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        poster_name TEXT NOT NULL,
                        origin_country TEXT NOT NULL,
                        destination_country TEXT NOT NULL,
                        origin_city TEXT NOT NULL DEFAULT '',
                        destination_city TEXT NOT NULL DEFAULT '',
                        travel_date TEXT NOT NULL,
                        notes TEXT,
                        status TEXT NOT NULL DEFAULT 'active',
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS properties (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        property_id TEXT UNIQUE NOT NULL,
                        user_id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        description TEXT,
                        price REAL,
                        location TEXT,
                        property_type TEXT NOT NULL DEFAULT 'listings',
                        available_date TEXT,
                        occupancy_status TEXT,
                        status TEXT NOT NULL DEFAULT 'active',
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS property_conversations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        conv_id TEXT UNIQUE NOT NULL,
                        property_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        agent_id TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS property_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        msg_id TEXT UNIQUE NOT NULL,
                        conv_id TEXT NOT NULL,
                        sender_id TEXT NOT NULL,
                        sender_role TEXT NOT NULL DEFAULT 'user',
                        content TEXT NOT NULL,
                        ts REAL NOT NULL,
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS agent_chat_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        msg_id TEXT UNIQUE NOT NULL,
                        agent_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        sender_role TEXT NOT NULL DEFAULT 'user',
                        text TEXT,
                        ts REAL NOT NULL,
                        created_at TEXT NOT NULL
                    );
                """)
                # SQLite migrations: add new columns to existing tables if needed
                for col, coldef in [("avatar_url", "TEXT"), ("bio", "TEXT"), ("public_key", "TEXT"), ("can_post_properties", "INTEGER DEFAULT 0"), ("phone", "TEXT DEFAULT ''"), ("username", "TEXT"), ("email_verified", "INTEGER NOT NULL DEFAULT 0"), ("preferred_language", "TEXT DEFAULT ''")]:
                    try:
                        conn.execute(f"ALTER TABLE app_users ADD COLUMN {col} {coldef}")
                    except Exception:
                        pass  # column already exists
                for col, coldef in [("dest_lat", "REAL"), ("dest_lng", "REAL"), ("fare", "REAL"), ("ride_type", "TEXT DEFAULT 'airport'"),
                                    ("vehicle_color", "TEXT DEFAULT ''"), ("vehicle_type", "TEXT DEFAULT ''"), ("plate_number", "TEXT DEFAULT ''")]:
                    try:
                        conn.execute(f"ALTER TABLE rides ADD COLUMN {col} {coldef}")
                    except Exception:
                        pass  # column already exists
                for col, coldef in [("subscription_type", "TEXT DEFAULT 'monthly'")]:
                    try:
                        conn.execute(f"ALTER TABLE driver_applications ADD COLUMN {col} {coldef}")
                    except Exception:
                        pass  # column already exists
                for col, coldef in [("link", "TEXT"), ("link_label", "TEXT")]:
                    try:
                        conn.execute(f"ALTER TABLE notifications ADD COLUMN {col} {coldef}")
                    except Exception:
                        pass  # column already exists
                for col, coldef in [("property_type", "TEXT NOT NULL DEFAULT 'listings'"), ("available_date", "TEXT"), ("occupancy_status", "TEXT")]:
                    try:
                        conn.execute(f"ALTER TABLE properties ADD COLUMN {col} {coldef}")
                    except Exception:
                        pass  # column already exists
                for col, coldef in [("subtotal", "REAL NOT NULL DEFAULT 0")]:
                    try:
                        conn.execute(f"ALTER TABLE receipts ADD COLUMN {col} {coldef}")
                    except Exception:
                        pass  # column already exists
            conn.commit()
        finally:
            conn.close()


def admin_user_exists() -> bool:
    """Return True if at least one admin account is registered."""
    with _db_lock:
        conn = _get_db()
        try:
            cur = _execute(conn, "SELECT COUNT(*) AS cnt FROM admin_users")
            row = cur.fetchone()
            return (row["cnt"] if USE_POSTGRES else row[0]) > 0
        finally:
            conn.close()


def register_admin_user(username: str, password: str) -> tuple[bool, str]:
    """Register admin. Returns (success, error_message).

    Passwords are stored using werkzeug's PBKDF2-HMAC-SHA256 implementation
    which includes a per-user salt and iteration count.
    """
    if admin_user_exists():
        return False, "User already exists"
    ph = generate_password_hash(password)
    with _db_lock:
        conn = _get_db()
        try:
            _execute(
                conn,
                "INSERT INTO admin_users (username, password_hash) VALUES (?, ?)",
                (username, ph),
            )
            conn.commit()
            return True, ""
        except _IntegrityErrors:
            conn.rollback()
            return False, "User already exists"
        finally:
            conn.close()


def verify_admin_user(username: str, password: str) -> bool:
    """Check username+password against the stored hash."""
    with _db_lock:
        conn = _get_db()
        try:
            row = _execute(
                conn,
                "SELECT password_hash FROM admin_users WHERE username=?",
                (username,),
            ).fetchone()
        finally:
            conn.close()
    if row is None:
        return False
    return check_password_hash(row["password_hash"], password)


# ADMIN AUTHENTICATION DECORATOR
# =========================================================

def admin_required(f):
    """Decorator that requires admin login for the wrapped view.

    The decorated function must accept ``request: Request`` so that the
    session and accept headers can be inspected.
    """
    @wraps(f)
    async def wrapped(*args, request: Request, **kwargs):
        if not request.session.get("admin_logged_in"):
            if request.method != "GET":
                return JSONResponse({"error": "Authentication required"}, status_code=401)
            accept = request.headers.get("accept", "text/html")
            if "application/json" in accept and "text/html" not in accept:
                return JSONResponse({"error": "Authentication required"}, status_code=401)
            login_url = "/admin/login?next=" + str(request.url)
            return RedirectResponse(url=login_url, status_code=302)
        return await f(*args, request=request, **kwargs)
    return wrapped


# =========================================================
# REACT SPA HELPERS
# =========================================================

def _react_index():
    """Return the React build index.html, falling back to a basic HTML stub."""
    idx = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.isfile(idx):
        return FileResponse(idx, media_type="text/html")
    # Fallback stub while the React build is absent (dev/CI)
    return Response(
        '<html><body><h1>YotWeek</h1>'
        '<p>React frontend build not found. Run <code>npm run build</code> inside the '
        '<code>frontend/</code> directory.</p></body></html>',
        media_type="text/html",
        status_code=200,
    )


# =========================================================
# ROUTES
# =========================================================

@fastapi_app.get("/")
async def index(request: Request):
    """Serve the React SPA (main page)"""
    return _react_index()

@fastapi_app.get("/ads.txt")
async def ads_txt():
    """Serve ads.txt for Google AdSense verification"""
    ads_txt_path = os.path.join(ROOT_DIR, "ads.txt")
    if os.path.exists(ads_txt_path):
        return FileResponse(ads_txt_path, media_type="text/plain")
    logger.warning("ads.txt file not found at %s", ads_txt_path)
    return JSONResponse({"error": "ads.txt not found"}, status_code=404)

@fastapi_app.get("/yotweek.png")
async def yotweek_icon():
    """Serve the yotweek brand icon."""
    icon_path = os.path.join(ROOT_DIR, "yotweek.png")
    if os.path.exists(icon_path):
        return FileResponse(icon_path, media_type="image/png")
    return JSONResponse({"error": "Icon not found"}, status_code=404)

@fastapi_app.get("/health")
async def health():
    """Health check endpoint.

    Verifies database connectivity and basic network connectivity.
    Returns HTTP 200 when all checks pass, or HTTP 503 when degraded.
    """
    checks: dict[str, object] = {}
    overall_healthy = True

    # --- Database check ---
    try:
        with _db_lock:
            conn = _get_db()
            try:
                _execute(conn, "SELECT 1")
                checks["database"] = {"ok": True}
            finally:
                conn.close()
    except Exception as exc:
        checks["database"] = {"ok": False, "error": str(exc)}
        overall_healthy = False

    # --- Disk space check (warn below 500 MB, fail below 100 MB) ---
    try:
        usage = shutil.disk_usage(DATA_DIR)
        free_mb = usage.free // (1024 * 1024)
        checks["disk"] = {"ok": free_mb >= 100, "free_mb": free_mb}
        if free_mb < 100:
            overall_healthy = False
    except Exception as exc:
        checks["disk"] = {"ok": False, "error": str(exc)}

    # --- Network connectivity check (DNS probe with 2-second timeout) ---
    _DNS_PROBES = [("8.8.8.8", 53), ("1.1.1.1", 53), ("9.9.9.9", 53)]
    network_ok = False
    for _host, _port in _DNS_PROBES:
        try:
            _sock = socket.create_connection((_host, _port), timeout=2)
            _sock.close()
            network_ok = True
            break
        except Exception:
            pass
    checks["network"] = {"ok": network_ok}

    status_code = 200 if overall_healthy else 503
    return JSONResponse(
        {
            "status": "healthy" if overall_healthy else "degraded",
            "timestamp": datetime.now().isoformat(),
            "version": "1.0.0",
            "checks": checks,
        },
        status_code=status_code,
    )

@fastapi_app.get("/const")
async def admin_page(request: Request):
    """Admin dashboard — served via React SPA (authentication checked client-side via /admin/auth_status)"""
    return _react_index()


@fastapi_app.get("/admin/login")
async def admin_login_get(request: Request):
    """Admin login — served via React SPA."""
    return _react_index()


@fastapi_app.post("/admin/login")
async def admin_login_post(request: Request):
    """Admin login (POST with form data) — legacy form-based endpoint kept for compatibility."""
    form = await request.form()
    username = (form.get("username") or "").strip()
    password = form.get("password") or ""
    error = None

    if not admin_user_exists():
        if secrets.compare_digest(password, Config.ADMIN_PASSWORD):
            request.session["admin_logged_in"] = True
            request.session["admin_username"] = username or "admin"
            next_url = request.query_params.get("next") or "/const"
            return RedirectResponse(url=next_url, status_code=302)
        error = "Incorrect password. Please try again."
    else:
        if verify_admin_user(username, password):
            request.session["admin_logged_in"] = True
            request.session["admin_username"] = username
            next_url = request.query_params.get("next") or "/const"
            return RedirectResponse(url=next_url, status_code=302)
        error = "Incorrect username or password. Please try again."

    return templates.TemplateResponse(
        "admin_login.html",
        {"request": request, "error": error, "has_admin": admin_user_exists()},
    )


@fastapi_app.get("/admin/register")
async def admin_register_get(request: Request):
    """Admin registration — served via React SPA."""
    return _react_index()


@fastapi_app.post("/admin/register")
async def admin_register_post(request: Request):
    """Admin registration (POST with form data) — legacy endpoint kept for compatibility."""
    if request.session.get("admin_logged_in"):
        return RedirectResponse(url="/const", status_code=302)
    form = await request.form()
    username = (form.get("username") or "").strip()
    password = form.get("password") or ""
    confirm  = form.get("confirm_password") or ""
    error = None
    success = None
    if not username or not password:
        error = "Username and password are required."
    elif password != confirm:
        error = "Passwords do not match."
    else:
        ok, msg = register_admin_user(username, password)
        if ok:
            success = "Admin account created! You can now log in."
        else:
            error = msg
    return templates.TemplateResponse(
        "admin_login.html",
        {"request": request, "error": error, "success": success,
         "register_mode": True, "has_admin": admin_user_exists()},
    )


@fastapi_app.post("/admin/logout")
async def admin_logout(request: Request):
    """Log out of the admin panel."""
    request.session.pop("admin_logged_in", None)
    request.session.pop("admin_username", None)
    return RedirectResponse(url="/admin/login", status_code=302)


# ─────────────────────────────────────────────────────────────────────────────
# JSON AUTH ENDPOINTS — consumed by the React frontend
# ─────────────────────────────────────────────────────────────────────────────

@fastapi_app.get("/admin/auth_status")
async def admin_auth_status(request: Request):
    """Return current admin session status as JSON (used by React SPA)."""
    logged_in = bool(request.session.get("admin_logged_in"))
    return JSONResponse({
        "logged_in": logged_in,
        "authenticated": logged_in,
        "username": request.session.get("admin_username") if logged_in else None,
    })


@fastapi_app.get("/admin/has_admin")
async def admin_has_admin():
    """Return whether an admin account has been registered (used by React SPA)."""
    return JSONResponse({"has_admin": admin_user_exists()})


@fastapi_app.post("/admin/api/login")
async def admin_api_login(request: Request):
    """JSON admin login endpoint (used by React SPA)."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    if not admin_user_exists():
        if secrets.compare_digest(password, Config.ADMIN_PASSWORD):
            request.session["admin_logged_in"] = True
            request.session["admin_username"] = username or "admin"
            return JSONResponse({"success": True, "username": username or "admin"})
        return JSONResponse({"error": "Incorrect password."}, status_code=401)

    if verify_admin_user(username, password):
        request.session["admin_logged_in"] = True
        request.session["admin_username"] = username
        return JSONResponse({"success": True, "username": username})
    return JSONResponse({"error": "Incorrect username or password."}, status_code=401)


@fastapi_app.post("/admin/api/logout")
async def admin_api_logout(request: Request):
    """JSON admin logout endpoint (used by React SPA)."""
    request.session.pop("admin_logged_in", None)
    request.session.pop("admin_username", None)
    return JSONResponse({"success": True})


@fastapi_app.post("/admin/api/register")
async def admin_api_register(request: Request):
    """JSON admin registration endpoint (used by React SPA)."""
    if request.session.get("admin_logged_in"):
        return JSONResponse({"error": "Already logged in."}, status_code=400)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    username        = (body.get("username") or "").strip()
    password        = body.get("password") or ""
    confirm_password = body.get("confirm_password") or ""

    if not username or not password:
        return JSONResponse({"error": "Username and password are required."}, status_code=400)
    if password != confirm_password:
        return JSONResponse({"error": "Passwords do not match."}, status_code=400)

    ok, msg = register_admin_user(username, password)
    if ok:
        return JSONResponse({"success": True, "message": "Admin account created. You can now log in."})
    return JSONResponse({"error": msg}, status_code=400)

@fastapi_app.get("/admin/db/download")
@admin_required
async def admin_db_download(request: Request):
    """Download a database backup (admin only).

    Returns the raw SQLite file when using SQLite, or a JSON export for PostgreSQL.
    """
    logger.info("Admin downloaded database backup")

    if USE_POSTGRES:
        return JSONResponse({"error": "PostgreSQL backup not supported via this endpoint."}, status_code=501)
    else:
        if not os.path.exists(DB_PATH):
            return JSONResponse({"error": "Database file not found"}, status_code=404)
        return FileResponse(
            DB_PATH,
            filename="admin.db",
            media_type="application/x-sqlite3",
        )


@fastapi_app.post("/admin/db/upload")
@admin_required
async def admin_db_upload(request: Request):
    """Replace the live SQLite database with an uploaded backup (admin only).

    Accepts a SQLite ``.db`` file. The integrity of the uploaded file is
    checked before replacing the live database.
    """
    form = await request.form()
    db_file = form.get("db_file")
    if db_file is None:
        return JSONResponse({"error": "No file uploaded"}, status_code=400)
    if not hasattr(db_file, "read"):
        return JSONResponse({"error": "No file selected"}, status_code=400)

    content = await db_file.read()

    is_sqlite = len(content) >= 16 and content[:16] == b"SQLite format 3\x00"
    if not is_sqlite:
        return JSONResponse({"error": "Uploaded file is not a valid SQLite database."}, status_code=400)

    tmp_path = os.path.join(DATA_DIR, "upload_tmp.db")
    try:
        with open(tmp_path, "wb") as fh:
            fh.write(content)

        check_conn = sqlite3.connect(tmp_path)
        try:
            result = check_conn.execute("PRAGMA integrity_check").fetchone()
            if result[0] != "ok":
                return JSONResponse({"error": "Uploaded database failed integrity check."}, status_code=400)
        finally:
            check_conn.close()

        shutil.copy2(tmp_path, DB_PATH)
        logger.info("Admin replaced database with uploaded backup")
        return JSONResponse({"success": True, "message": "Database replaced successfully."})
    except Exception as exc:
        logger.error(f"DB upload error: {exc}")
        return JSONResponse({"error": f"Upload failed: {exc}"}, status_code=500)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


# =========================================================
# USER AUTHENTICATION MODULE
# =========================================================

_APP_USER_PROXIMITY_KM = float(os.environ.get("APP_USER_PROXIMITY_KM", "6"))
# Base fare per km for airport pickup rides (env-configurable, $1/km as per platform standard)
_FARE_PER_KM = float(os.environ.get("FARE_PER_KM", "1.0"))

# In-memory driver location store: user_id → {lat, lng, ts, name, user_id, empty}
_driver_locations: dict[str, dict] = {}
_driver_loc_lock = Lock()
_DRIVER_LOC_TTL_SECS = 300  # 5 minutes

# In-memory map of socket sid → user_id for authenticated users
_sid_to_user: dict[str, str] = {}
_user_to_sid: dict[str, str] = {}
_socket_user_lock = Lock()


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in kilometres between two lat/lng points."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi  = math.radians(lat2 - lat1)
    dlam  = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _get_app_user(user_id: str) -> dict | None:
    """Fetch a user row from the database by user_id. Returns None if not found."""
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id,name,email,role,location_lat,location_lng,location_name,avatar_url,bio,created_at,public_key,can_post_properties,phone,username,preferred_language FROM app_users WHERE user_id=%s", (user_id,))
                row = cur.fetchone()
            else:
                cur = conn.execute("SELECT user_id,name,email,role,location_lat,location_lng,location_name,avatar_url,bio,created_at,public_key,can_post_properties,phone,username,preferred_language FROM app_users WHERE user_id=?", (user_id,))
                row = cur.fetchone()
            if row is None:
                return None
            keys = ["user_id", "name", "email", "role", "location_lat", "location_lng", "location_name", "avatar_url", "bio", "created_at", "public_key", "can_post_properties", "phone", "username", "preferred_language"]
            return dict(zip(keys, row))
        finally:
            conn.close()


def _get_app_user_by_email(email: str) -> dict | None:
    """Fetch a user row including password_hash by email."""
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id,name,email,password_hash,role,location_lat,location_lng,location_name,created_at,email_verified FROM app_users WHERE email=%s", (email.lower(),))
                row = cur.fetchone()
            else:
                cur = conn.execute("SELECT user_id,name,email,password_hash,role,location_lat,location_lng,location_name,created_at,email_verified FROM app_users WHERE email=?", (email.lower(),))
                row = cur.fetchone()
            if row is None:
                return None
            keys = ["user_id", "name", "email", "password_hash", "role", "location_lat", "location_lng", "location_name", "created_at", "email_verified"]
            return dict(zip(keys, row))
        finally:
            conn.close()


def _get_agent_row(agent_id: str) -> dict | None:
    """Fetch an agent row from app_users by user_id where role is 'agent'. Returns None if not found."""
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id,name,email,role FROM app_users WHERE user_id=%s AND role='agent'", (agent_id,))
                row = cur.fetchone()
            else:
                cur = conn.execute("SELECT user_id,name,email,role FROM app_users WHERE user_id=? AND role='agent'", (agent_id,))
                row = cur.fetchone()
            if row is None:
                return None
            keys = ["user_id", "name", "email", "role"]
            return dict(zip(keys, row))
        finally:
            conn.close()


def _get_property_conversation(conv_id: str) -> dict | None:
    """Fetch a property conversation record by conv_id. Returns None if not found."""
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT conv_id,property_id,user_id,agent_id,created_at FROM property_conversations WHERE conv_id=%s", (conv_id,))
                row = cur.fetchone()
            else:
                cur = conn.execute("SELECT conv_id,property_id,user_id,agent_id,created_at FROM property_conversations WHERE conv_id=?", (conv_id,))
                row = cur.fetchone()
            if row is None:
                return None
            keys = ["conv_id", "property_id", "user_id", "agent_id", "created_at"]
            return dict(zip(keys, row))
        finally:
            conn.close()


class _UserRegisterRequest(BaseModel):
    name:     str
    email:    str
    password: str
    role:     str = "passenger"  # "passenger" | "driver"
    username: str = ""
    phone:    str = ""


class _ForgotPasswordRequest(BaseModel):
    email: str


class _ResetPasswordRequest(BaseModel):
    token:        str
    new_password: str


class _UserLoginRequest(BaseModel):
    email:       str
    password:    str
    remember_me: bool = False


class _MagicLinkRequest(BaseModel):
    email: str


class _DriverApplyRequest(BaseModel):
    vehicle_make:      str
    vehicle_model:     str
    vehicle_year:      int
    vehicle_color:     str
    license_plate:     str
    subscription_type: str = "monthly"  # "monthly" | "yearly"


class _DriverApproveRequest(BaseModel):
    approved: bool


class _AgentApplyRequest(BaseModel):
    full_name:      str
    email:         str
    phone:         str = ""
    agency_name:   str = ""
    license_number: str


class _AgentApproveRequest(BaseModel):
    approved: bool


class _StorePublicKeyRequest(BaseModel):
    public_key: str


class _UserLocationUpdate(BaseModel):
    lat:           float
    lng:           float
    location_name: str = ""


class _UserProfileDetailsUpdate(BaseModel):
    name:               str = ""
    bio:                str = ""
    phone:              str = ""
    home_city:          str = ""
    preferred_language: str = ""


class _ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str


@fastapi_app.post("/api/auth/register")
async def api_user_register(body: _UserRegisterRequest):
    """Register a new platform user (passenger or driver)."""
    name     = body.name.strip()
    email    = body.email.strip().lower()
    password = body.password
    role     = body.role if body.role in ("passenger", "driver") else "passenger"
    phone    = body.phone.strip()

    if not name or not email or not password:
        return JSONResponse({"error": "Name, email and password are required."}, status_code=400)
    if len(password) < 6:
        return JSONResponse({"error": "Password must be at least 6 characters."}, status_code=400)
    if not _is_valid_email(email):
        return JSONResponse({"error": "Invalid email address."}, status_code=400)

    # Derive username from provided value or from email prefix
    raw_username = (body.username or "").strip() or re.sub(r"[^a-z0-9_.-]", "", email.split("@")[0].lower())
    if not raw_username:
        raw_username = "user"

    user_id      = str(uuid.uuid4())
    pw_hash      = generate_password_hash(password)
    created_at   = datetime.now(timezone.utc).isoformat()
    # Auto-verify when SMTP is not configured so that development/tests work
    email_verified = 0 if _SMTP_HOST else 1

    with _db_lock:
        conn = _get_db()
        try:
            # Ensure username uniqueness by appending a numeric suffix if needed
            username = raw_username
            suffix = 0
            max_attempts = 20
            while max_attempts > 0:
                max_attempts -= 1
                try:
                    if USE_POSTGRES:
                        cur = conn.cursor()
                        cur.execute(
                            "INSERT INTO app_users (user_id,name,email,password_hash,role,created_at,username,phone,email_verified) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                            (user_id, name, email, pw_hash, role, created_at, username, phone, email_verified),
                        )
                    else:
                        conn.execute(
                            "INSERT INTO app_users (user_id,name,email,password_hash,role,created_at,username,phone,email_verified) VALUES (?,?,?,?,?,?,?,?,?)",
                            (user_id, name, email, pw_hash, role, created_at, username, phone, email_verified),
                        )
                    break  # success
                except Exception as _exc:
                    conn.rollback()
                    exc_msg = str(_exc).lower()
                    if "unique" in exc_msg and "username" in exc_msg:
                        # username collision — try with numeric suffix
                        suffix += 1
                        username = f"{raw_username}{suffix}"
                        continue
                    # Any other uniqueness error (e.g. email duplicate)
                    return JSONResponse({"error": "Email already registered."}, status_code=409)
            else:
                return JSONResponse({"error": "Could not generate a unique username."}, status_code=409)
            conn.commit()
        finally:
            conn.close()

    # Send verification email if SMTP is configured
    if _SMTP_HOST and email_verified == 0:
        verify_token = secrets.token_urlsafe(32)
        expires_at = time.time() + _EMAIL_VERIFY_TTL_SECONDS
        with _email_verify_lock:
            _email_verify_tokens[verify_token] = {"user_id": user_id, "email": email, "expires_at": expires_at}
        _send_email(
            email,
            "Verify your YotWeek account",
            f"Welcome to YotWeek, {name}!\n\nPlease verify your email address by clicking the link below:\n\n"
            f"{_BASE_URL}/api/auth/verify_email?token={verify_token}\n\n"
            f"This link expires in 24 hours.\n\nIf you did not register, please ignore this email.",
        )

    return JSONResponse({
        "ok":             True,
        "user_id":        user_id,
        "name":           name,
        "email":          email,
        "role":           role,
        "username":       username,
        "phone":          phone,
        "email_verified": bool(email_verified),
        "created_at":     created_at,
    }, status_code=201)


@fastapi_app.post("/api/auth/login")
async def api_user_login(request: Request, body: _UserLoginRequest):
    """Login as a platform user. Sets a session cookie."""
    email    = body.email.strip().lower()
    password = body.password

    user = _get_app_user_by_email(email)
    if user is None or not check_password_hash(user["password_hash"], password):
        return JSONResponse({"error": "Invalid email or password."}, status_code=401)

    # If SMTP is configured, require email verification before login
    if _SMTP_HOST and not user.get("email_verified", 1):
        return JSONResponse(
            {"error": "Please verify your email first. Check your inbox for the verification link."},
            status_code=403,
        )

    request.session["app_user_id"] = user["user_id"]
    if body.remember_me:
        # Extend session lifetime to 30 days for "Remember Me"
        request.session["remember_me"] = True
    return JSONResponse({
        "ok":      True,
        "user_id": user["user_id"],
        "name":    user["name"],
        "email":   user["email"],
        "role":    user["role"],
        "created_at": user.get("created_at", ""),
    })


@fastapi_app.post("/api/auth/logout")
async def api_user_logout(request: Request):
    """Logout the current platform user."""
    request.session.pop("app_user_id", None)
    return JSONResponse({"ok": True})


@fastapi_app.get("/api/auth/verify_email")
async def api_verify_email(request: Request, token: str = ""):
    """Verify a user's email address via a one-time token.

    Sets email_verified=1 on the user row and redirects to /login with a
    success query parameter so the frontend can show a confirmation message.
    """
    token = token.strip()
    if not token:
        return JSONResponse({"error": "Token required."}, status_code=400)

    with _email_verify_lock:
        entry = _email_verify_tokens.get(token)
        if entry is None or time.time() > entry["expires_at"]:
            _email_verify_tokens.pop(token, None)
            return JSONResponse({"error": "Invalid or expired verification link."}, status_code=400)
        del _email_verify_tokens[token]  # single-use

    user_id = entry["user_id"]
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("UPDATE app_users SET email_verified=1 WHERE user_id=%s", (user_id,))
            else:
                conn.execute("UPDATE app_users SET email_verified=1 WHERE user_id=?", (user_id,))
            conn.commit()
        finally:
            conn.close()

    from starlette.responses import RedirectResponse
    return RedirectResponse(url="/login?verified=1", status_code=303)


@fastapi_app.post("/api/auth/forgot_password")
async def api_forgot_password(body: _ForgotPasswordRequest):
    """Send a password-reset link to the given email address.

    Always returns a generic success message to avoid account enumeration.
    The token is also returned in the response for development/testing convenience.
    """
    email = body.email.strip().lower()
    if not _is_valid_email(email):
        return JSONResponse({"error": "Invalid email address."}, status_code=400)

    user = _get_app_user_by_email(email)
    msg = "If that address is registered, a password reset link has been sent."
    if user is None:
        return JSONResponse({"ok": True, "message": msg})

    token = secrets.token_urlsafe(32)
    expires_at = time.time() + _PWD_RESET_TTL_SECONDS
    with _pwd_reset_lock:
        _pwd_reset_tokens[token] = {"user_id": user["user_id"], "expires_at": expires_at}

    _send_email(
        email,
        "Reset your YotWeek password",
        f"Hi {user['name']},\n\nYou requested a password reset.\n\n"
        f"Click the link below to set a new password (valid for 1 hour):\n\n"
        f"{_BASE_URL}/reset-password?token={token}\n\n"
        f"If you did not request this, please ignore this email.",
    )

    return JSONResponse({"ok": True, "token": token, "message": msg})


@fastapi_app.post("/api/auth/reset_password")
async def api_reset_password(body: _ResetPasswordRequest):
    """Reset a user's password using a valid reset token."""
    token        = body.token.strip()
    new_password = body.new_password

    if not token:
        return JSONResponse({"error": "Token required."}, status_code=400)
    if len(new_password) < 6:
        return JSONResponse({"error": "Password must be at least 6 characters."}, status_code=400)

    with _pwd_reset_lock:
        entry = _pwd_reset_tokens.get(token)
        if entry is None or time.time() > entry["expires_at"]:
            _pwd_reset_tokens.pop(token, None)
            return JSONResponse({"error": "Invalid or expired reset token."}, status_code=400)
        del _pwd_reset_tokens[token]  # single-use

    new_hash = generate_password_hash(new_password)
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("UPDATE app_users SET password_hash=%s WHERE user_id=%s", (new_hash, entry["user_id"]))
            else:
                conn.execute("UPDATE app_users SET password_hash=? WHERE user_id=?", (new_hash, entry["user_id"]))
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True, "message": "Password updated successfully. You can now log in with your new password."})


@fastapi_app.get("/api/auth/me")
async def api_user_me(request: Request):
    """Return the currently logged-in user's profile."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Not logged in."}, status_code=401)
    user = _get_app_user(user_id)
    if user is None:
        request.session.pop("app_user_id", None)
        return JSONResponse({"error": "User not found."}, status_code=404)
    return JSONResponse(user)


@fastapi_app.get("/api/user/dashboard")
async def api_user_dashboard(request: Request):
    """Return aggregated dashboard data for the logged-in user.

    Combines profile details, ride statistics, and recent ride history so
    the frontend UserDashboard page can render a personalised summary in a
    single request.
    """
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if user is None:
        request.session.pop("app_user_id", None)
        return JSONResponse({"error": "User not found."}, status_code=404)

    with _db_lock:
        conn = _get_db()
        try:
            cols = ["ride_id", "origin", "destination", "departure",
                    "seats", "status", "created_at"]
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT ride_id,origin,destination,departure,seats,status,created_at "
                    "FROM rides WHERE user_id=%s ORDER BY created_at DESC LIMIT 5",
                    (user_id,),
                )
                rows = cur.fetchall()
                cur.execute(
                    "SELECT COUNT(*) FROM rides WHERE user_id=%s", (user_id,)
                )
                total_rides = (cur.fetchone() or [0])[0]
                cur.execute(
                    "SELECT COUNT(*) FROM rides WHERE user_id=%s AND status='open'",
                    (user_id,),
                )
                open_rides = (cur.fetchone() or [0])[0]
            else:
                cur = conn.execute(
                    "SELECT ride_id,origin,destination,departure,seats,status,created_at "
                    "FROM rides WHERE user_id=? ORDER BY created_at DESC LIMIT 5",
                    (user_id,),
                )
                rows = cur.fetchall()
                cur = conn.execute(
                    "SELECT COUNT(*) FROM rides WHERE user_id=?", (user_id,)
                )
                total_rides = (cur.fetchone() or [0])[0]
                cur = conn.execute(
                    "SELECT COUNT(*) FROM rides WHERE user_id=? AND status='open'",
                    (user_id,),
                )
                open_rides = (cur.fetchone() or [0])[0]
        finally:
            conn.close()

    recent_rides = [dict(zip(cols, r)) for r in rows]
    return JSONResponse({
        "user": user,
        "stats": {
            "total_rides": total_rides,
            "open_rides": open_rides,
        },
        "recent_rides": recent_rides,
    })


@fastapi_app.get("/api/driver/dashboard")
async def api_driver_dashboard(request: Request):
    """Return aggregated dashboard data for the logged-in driver.

    Requires the caller to have role='driver'. Returns posted rides, total
    passenger counts, and recent confirmed bookings.
    """
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if user is None:
        request.session.pop("app_user_id", None)
        return JSONResponse({"error": "User not found."}, status_code=404)

    if user.get("role") != "driver":
        return JSONResponse({"error": "Driver access required."}, status_code=403)

    with _db_lock:
        conn = _get_db()
        try:
            cols = ["ride_id", "origin", "destination", "departure",
                    "seats", "status", "fare", "created_at"]
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT ride_id,origin,destination,departure,seats,status,fare,created_at "
                    "FROM rides WHERE user_id=%s ORDER BY created_at DESC LIMIT 10",
                    (user_id,),
                )
                rows = cur.fetchall()
                cur.execute("SELECT COUNT(*) FROM rides WHERE user_id=%s", (user_id,))
                total_rides = (cur.fetchone() or [0])[0]
                cur.execute("SELECT COUNT(*) FROM rides WHERE user_id=%s AND status='open'", (user_id,))
                open_rides = (cur.fetchone() or [0])[0]
                cur.execute(
                    "SELECT COUNT(*) FROM ride_journey_confirmations rjc "
                    "JOIN rides r ON r.ride_id=rjc.ride_id WHERE r.user_id=%s",
                    (user_id,),
                )
                total_passengers = (cur.fetchone() or [0])[0]
            else:
                cur = conn.execute(
                    "SELECT ride_id,origin,destination,departure,seats,status,fare,created_at "
                    "FROM rides WHERE user_id=? ORDER BY created_at DESC LIMIT 10",
                    (user_id,),
                )
                rows = cur.fetchall()
                cur = conn.execute("SELECT COUNT(*) FROM rides WHERE user_id=?", (user_id,))
                total_rides = (cur.fetchone() or [0])[0]
                cur = conn.execute("SELECT COUNT(*) FROM rides WHERE user_id=? AND status='open'", (user_id,))
                open_rides = (cur.fetchone() or [0])[0]
                try:
                    cur = conn.execute(
                        "SELECT COUNT(*) FROM ride_journey_confirmations rjc "
                        "JOIN rides r ON r.ride_id=rjc.ride_id WHERE r.user_id=?",
                        (user_id,),
                    )
                    total_passengers = (cur.fetchone() or [0])[0]
                except Exception:
                    total_passengers = 0
        finally:
            conn.close()

    posted_rides = [dict(zip(cols, r)) for r in rows]
    return JSONResponse({
        "user": user,
        "stats": {
            "total_rides":     total_rides,
            "open_rides":      open_rides,
            "total_passengers": total_passengers,
        },
        "posted_rides": posted_rides,
    })


@fastapi_app.put("/api/auth/profile")
async def api_user_update_profile(request: Request, body: _UserLocationUpdate):
    """Update the logged-in user's location."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Not logged in."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE app_users SET location_lat=%s, location_lng=%s, location_name=%s WHERE user_id=%s",
                    (body.lat, body.lng, body.location_name.strip(), user_id),
                )
            else:
                conn.execute(
                    "UPDATE app_users SET location_lat=?, location_lng=?, location_name=? WHERE user_id=?",
                    (body.lat, body.lng, body.location_name.strip(), user_id),
                )
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


@fastapi_app.put("/api/auth/profile/details")
async def api_user_update_profile_details(request: Request, body: _UserProfileDetailsUpdate):
    """Update the logged-in user's name, bio, phone, home city and preferred language."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Not logged in."}, status_code=401)

    name               = body.name.strip()
    bio                = body.bio.strip()[:500]  # cap bio at 500 chars
    phone              = body.phone.strip()[:50]
    home_city          = body.home_city.strip()[:100]
    preferred_language = body.preferred_language.strip()[:50]

    # Only allowed column names to prevent SQL injection via dynamic field names
    _ALLOWED_PROFILE_FIELDS = {"name", "bio", "phone", "location_name", "preferred_language"}

    updates = {}
    if name:
        updates["name"] = name
    if bio is not None:
        updates["bio"] = bio
    if phone is not None:
        updates["phone"] = phone
    if home_city is not None:
        updates["location_name"] = home_city
    if preferred_language is not None:
        updates["preferred_language"] = preferred_language

    # Filter to only allowed columns
    updates = {k: v for k, v in updates.items() if k in _ALLOWED_PROFILE_FIELDS}

    if not updates:
        return JSONResponse({"ok": True})

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                for field, value in updates.items():
                    cur.execute(f"UPDATE app_users SET {field}=%s WHERE user_id=%s", (value, user_id))
            else:
                for field, value in updates.items():
                    conn.execute(f"UPDATE app_users SET {field}=? WHERE user_id=?", (value, user_id))
            conn.commit()
        finally:
            conn.close()

    user = _get_app_user(user_id)
    return JSONResponse({"ok": True, "user": user})


@fastapi_app.post("/api/auth/profile/avatar")
async def api_user_upload_avatar(request: Request, file: UploadFile = File(...)):
    """Upload a profile avatar image for the logged-in user."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Not logged in."}, status_code=401)

    # Validate content type
    allowed_types = {"image/jpeg", "image/png", "image/gif", "image/webp"}
    ct = (file.content_type or "").lower()
    if ct not in allowed_types:
        return JSONResponse({"error": "Only JPEG, PNG, GIF and WebP images are allowed."}, status_code=400)

    ext_map = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"}
    ext = ext_map.get(ct, "jpg")

    data = await file.read()
    if len(data) > 5 * 1024 * 1024:  # 5 MB limit
        return JSONResponse({"error": "Avatar image must be under 5 MB."}, status_code=400)

    filename = f"{user_id}.{ext}"
    avatar_path = os.path.join(AVATARS_DIR, filename)
    with open(avatar_path, "wb") as fh:
        fh.write(data)

    # When S3 is configured, upload the avatar to the media bucket and serve
    # via the /api/avatars/ endpoint (which redirects to a presigned URL).
    if _S3_ENABLED:
        s3_key = f"avatars/{filename}"
        _s3_upload_bytes(data, s3_key, ct)
        avatar_url = f"/api/avatars/{filename}"
    else:
        avatar_url = f"/static/avatars/{filename}"

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("UPDATE app_users SET avatar_url=%s WHERE user_id=%s", (avatar_url, user_id))
            else:
                conn.execute("UPDATE app_users SET avatar_url=? WHERE user_id=?", (avatar_url, user_id))
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True, "avatar_url": avatar_url})


@fastapi_app.delete("/api/auth/profile/avatar")
async def api_user_delete_avatar(request: Request):
    """Remove the profile avatar for the logged-in user."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Not logged in."}, status_code=401)

    # Fetch current avatar_url so we can clean up stored files
    user = _get_app_user(user_id)
    current_url = user.get("avatar_url") if user else None

    # Delete from S3 bucket if enabled
    if _S3_ENABLED and current_url:
        filename = current_url.split("/")[-1]
        safe_name = os.path.basename(filename)
        if safe_name:
            try:
                _get_s3_client().delete_object(Bucket=_S3_BUCKET, Key=f"avatars/{safe_name}")
            except Exception:
                pass

    # Delete local cached file if present
    if current_url:
        filename = current_url.split("/")[-1]
        safe_name = os.path.basename(filename)
        local_path = os.path.join(AVATARS_DIR, safe_name)
        if safe_name and os.path.exists(local_path):
            try:
                os.remove(local_path)
            except OSError:
                pass

    # Clear avatar_url in DB
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("UPDATE app_users SET avatar_url=NULL WHERE user_id=%s", (user_id,))
            else:
                conn.execute("UPDATE app_users SET avatar_url=NULL WHERE user_id=?", (user_id,))
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


@fastapi_app.put("/api/auth/change_password")
async def api_change_password(request: Request, body: _ChangePasswordRequest):
    """Change the current user's password after verifying the current password."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Not logged in."}, status_code=401)

    if len(body.new_password) < 6:
        return JSONResponse({"error": "New password must be at least 6 characters."}, status_code=400)

    new_hash = generate_password_hash(body.new_password)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT password_hash FROM app_users WHERE user_id=%s", (user_id,))
                row = cur.fetchone()
                if row is None:
                    return JSONResponse({"error": "User not found."}, status_code=404)
                if not check_password_hash(row[0], body.current_password):
                    return JSONResponse({"error": "Current password is incorrect."}, status_code=401)
                cur.execute("UPDATE app_users SET password_hash=%s WHERE user_id=%s", (new_hash, user_id))
            else:
                cur = conn.execute("SELECT password_hash FROM app_users WHERE user_id=?", (user_id,))
                row = cur.fetchone()
                if row is None:
                    return JSONResponse({"error": "User not found."}, status_code=404)
                if not check_password_hash(row[0], body.current_password):
                    return JSONResponse({"error": "Current password is incorrect."}, status_code=401)
                conn.execute("UPDATE app_users SET password_hash=? WHERE user_id=?", (new_hash, user_id))
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


@fastapi_app.get("/api/avatars/{filename}")
async def api_serve_avatar(filename: str):
    """Serve a user avatar from the media bucket (S3) or the local filesystem.

    When S3 is configured the client is redirected to a presigned URL so the
    image is streamed directly from the bucket.  Falls back to the locally
    cached copy when S3 is unavailable or not configured.
    """
    # Sanitise filename to prevent path-traversal
    safe_name = os.path.basename(filename)
    if not safe_name or safe_name != filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if _S3_ENABLED:
        presigned = _s3_presigned_url(f"avatars/{safe_name}")
        if presigned:
            return RedirectResponse(presigned)

    local_path = os.path.join(AVATARS_DIR, safe_name)
    if os.path.exists(local_path):
        mime = mimetypes.guess_type(safe_name)[0] or "image/jpeg"
        return FileResponse(local_path, media_type=mime)

    raise HTTPException(status_code=404, detail="Avatar not found.")


# ── Notifications ──────────────────────────────────────────────────────────────

def _create_notification(user_id: str, notif_type: str, title: str, body: str,
                          link: str | None = None, link_label: str | None = None) -> str:
    """Insert a notification row for a user and return the notif_id."""
    notif_id  = str(uuid.uuid4())
    created   = datetime.now(timezone.utc).isoformat()
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO notifications (notif_id,user_id,type,title,body,created_at,link,link_label) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                    (notif_id, user_id, notif_type, title, body, created, link, link_label),
                )
            else:
                conn.execute(
                    "INSERT INTO notifications (notif_id,user_id,type,title,body,created_at,link,link_label) VALUES (?,?,?,?,?,?,?,?)",
                    (notif_id, user_id, notif_type, title, body, created, link, link_label),
                )
            conn.commit()
        finally:
            conn.close()
    # Persist notification record to bucket
    _bucket_write_json("notifications", "notification", notif_id, {
        "notif_id": notif_id,
        "user_id": user_id,
        "type": notif_type,
        "title": title,
        "body": body,
        "read_status": False,
        "created_at": created,
        "link": link,
        "link_label": link_label,
    })
    return notif_id


@fastapi_app.get("/api/notifications")
async def api_get_notifications(request: Request):
    """Return notifications for the logged-in user (most recent first, max 50)."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    cols = ["notif_id", "type", "title", "body", "read", "created_at", "link", "link_label"]
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT notif_id,type,title,body,read,created_at,link,link_label FROM notifications WHERE user_id=%s ORDER BY created_at DESC LIMIT 50",
                    (user_id,),
                )
                rows = cur.fetchall()
            else:
                cur = conn.execute(
                    "SELECT notif_id,type,title,body,read,created_at,link,link_label FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
                    (user_id,),
                )
                rows = cur.fetchall()
        finally:
            conn.close()

    notifs = [dict(zip(cols, r)) for r in rows]
    unread = sum(1 for n in notifs if not n["read"])
    return JSONResponse({"notifications": notifs, "unread": unread})


@fastapi_app.post("/api/notifications/{notif_id}/read")
async def api_mark_notification_read(request: Request, notif_id: str):
    """Mark a single notification as read."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE notifications SET read=1 WHERE notif_id=%s AND user_id=%s",
                    (notif_id, user_id),
                )
            else:
                conn.execute(
                    "UPDATE notifications SET read=1 WHERE notif_id=? AND user_id=?",
                    (notif_id, user_id),
                )
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


@fastapi_app.post("/api/notifications/read_all")
async def api_mark_all_notifications_read(request: Request):
    """Mark all notifications for the logged-in user as read."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("UPDATE notifications SET read=1 WHERE user_id=%s", (user_id,))
            else:
                conn.execute("UPDATE notifications SET read=1 WHERE user_id=?", (user_id,))
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


@fastapi_app.delete("/api/notifications/clear_all")
async def api_clear_all_notifications(request: Request):
    """Delete all notifications for the logged-in user."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("DELETE FROM notifications WHERE user_id=%s", (user_id,))
            else:
                conn.execute("DELETE FROM notifications WHERE user_id=?", (user_id,))
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


# ── Platform stats ─────────────────────────────────────────────────────────────

@fastapi_app.get("/api/platform_stats")
async def api_platform_stats():
    """Return aggregated platform-wide statistics."""
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM rides")
                total_rides = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM rides WHERE status='open'")
                open_rides = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM driver_applications WHERE status='approved'")
                registered_drivers = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM driver_applications WHERE status='pending'")
                pending_driver_apps = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM app_users")
                total_users = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM notifications")
                total_notifications = cur.fetchone()[0]
            else:
                total_rides = conn.execute("SELECT COUNT(*) FROM rides").fetchone()[0]
                open_rides = conn.execute("SELECT COUNT(*) FROM rides WHERE status='open'").fetchone()[0]
                registered_drivers = conn.execute("SELECT COUNT(*) FROM driver_applications WHERE status='approved'").fetchone()[0]
                pending_driver_apps = conn.execute("SELECT COUNT(*) FROM driver_applications WHERE status='pending'").fetchone()[0]
                total_users = conn.execute("SELECT COUNT(*) FROM app_users").fetchone()[0]
                total_notifications = conn.execute("SELECT COUNT(*) FROM notifications").fetchone()[0]
        finally:
            conn.close()

    stats = {
        "total_rides": total_rides,
        "open_rides": open_rides,
        "registered_drivers": registered_drivers,
        "pending_driver_applications": pending_driver_apps,
        "total_users": total_users,
        "total_notifications": total_notifications,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    _bucket_write_json("stats", "stats", today, stats)

    return JSONResponse(stats)


# ── Ride chat messages (persistent) ────────────────────────────────────────────

_CHAT_MEDIA_PREFIX = "chat_media/"


def _resolve_chat_media(messages: list[dict]) -> list[dict]:
    """Replace S3 object keys in *messages* ``media_data`` fields with presigned URLs.

    When S3 is not configured or the key cannot be resolved the field is left
    unchanged so callers always receive a usable list.
    """
    if not _S3_ENABLED:
        return messages
    for msg in messages:
        md = msg.get("media_data")
        if md and isinstance(md, str) and md.startswith(_CHAT_MEDIA_PREFIX):
            url = _s3_presigned_url(md)
            if url:
                msg["media_data"] = url
    return messages


@fastapi_app.get("/api/rides/{ride_id}/chat")
async def api_get_ride_chat(request: Request, ride_id: str):
    """Return persisted chat messages for a ride (most recent last, max 200)."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            cols = ["msg_id", "ride_id", "sender_name", "sender_role", "text",
                    "media_type", "media_data", "lat", "lng", "ts", "created_at"]
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT msg_id,ride_id,sender_name,sender_role,text,media_type,media_data,lat,lng,ts,created_at"
                    " FROM ride_chat_messages WHERE ride_id=%s ORDER BY ts ASC LIMIT 200",
                    (ride_id,),
                )
                rows = cur.fetchall()
            else:
                cur = conn.execute(
                    "SELECT msg_id,ride_id,sender_name,sender_role,text,media_type,media_data,lat,lng,ts,created_at"
                    " FROM ride_chat_messages WHERE ride_id=? ORDER BY ts ASC LIMIT 200",
                    (ride_id,),
                )
                rows = cur.fetchall()
        finally:
            conn.close()

    messages = [dict(zip(cols, row)) for row in rows]
    _resolve_chat_media(messages)
    return JSONResponse({"messages": messages})


@fastapi_app.get("/api/rides/chat/inbox")
async def api_ride_chat_inbox(request: Request):
    """Return latest chat message per ride that involves the current user's rides.

    Returns conversations grouped by ride_id, ordered by most-recent message.
    """
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if not user:
        return JSONResponse({"error": "User not found."}, status_code=404)

    sender_name = user["name"]

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                # Rides posted by the user
                cur.execute(
                    "SELECT ride_id, origin, destination FROM rides WHERE user_id=%s",
                    (user_id,),
                )
                poster_rides = {r[0]: {"origin": r[1], "destination": r[2]} for r in cur.fetchall()}
                # Latest message per ride that the user is involved in
                cur.execute(
                    """
                    SELECT DISTINCT ON (ride_id) msg_id, ride_id, sender_name, sender_role,
                           text, media_type, ts
                    FROM ride_chat_messages
                    WHERE ride_id = ANY(
                        SELECT ride_id FROM rides WHERE user_id = %s
                    ) OR sender_name = %s
                    ORDER BY ride_id, ts DESC
                    """,
                    (user_id, sender_name),
                )
                rows = cur.fetchall()
            else:
                # Rides posted by the user
                cur = conn.execute(
                    "SELECT ride_id, origin, destination FROM rides WHERE user_id=?",
                    (user_id,),
                )
                poster_rides = {r[0]: {"origin": r[1], "destination": r[2]} for r in cur.fetchall()}
                cur = conn.execute(
                    """
                    SELECT msg_id, ride_id, sender_name, sender_role, text, media_type, ts
                    FROM ride_chat_messages
                    WHERE ride_id IN (SELECT ride_id FROM rides WHERE user_id=?)
                       OR sender_name=?
                    GROUP BY ride_id
                    HAVING ts = MAX(ts)
                    ORDER BY ts DESC
                    LIMIT 50
                    """,
                    (user_id, sender_name),
                )
                rows = cur.fetchall()
        finally:
            conn.close()

    cols = ["msg_id", "ride_id", "sender_name", "sender_role", "text", "media_type", "ts"]
    conversations = []
    for row in rows:
        d = dict(zip(cols, row))
        d["ride_info"] = poster_rides.get(d["ride_id"], {})
        d["is_mine"] = (d["sender_name"] == sender_name)
        conversations.append(d)

    return JSONResponse({"conversations": conversations})


# ── Magic link (passwordless) ──────────────────────────────────────────────────

# In-memory store: token → {email, expires_at}
_magic_link_tokens: dict = {}
_magic_link_lock = threading.Lock()
_MAGIC_LINK_TTL_SECONDS = 900  # 15 minutes

# In-memory store: token → {email, expires_at}
_email_verify_tokens: dict = {}
_email_verify_lock = threading.Lock()
_EMAIL_VERIFY_TTL_SECONDS = 86400  # 24 hours

# In-memory store: token → {user_id, expires_at}
_pwd_reset_tokens: dict = {}
_pwd_reset_lock = threading.Lock()
_PWD_RESET_TTL_SECONDS = 3600  # 1 hour


@fastapi_app.post("/api/auth/magic_link")
async def api_magic_link_request(body: _MagicLinkRequest):
    """Generate a one-time magic-link token for passwordless login.

    In a production deployment this token would be emailed to the user.
    The endpoint returns the token in the response for demo / testing purposes.
    """
    email = body.email.strip().lower()
    if not _is_valid_email(email):
        return JSONResponse({"error": "Invalid email address."}, status_code=400)

    user = _get_app_user_by_email(email)
    if user is None:
        # Don't reveal whether the address is registered
        return JSONResponse({"ok": True, "message": "If that address is registered, a login link has been sent."})

    token = secrets.token_urlsafe(32)
    expires_at = time.time() + _MAGIC_LINK_TTL_SECONDS
    with _magic_link_lock:
        _magic_link_tokens[token] = {"email": email, "expires_at": expires_at}

    # In a real app: send email here.  For now, return token so the UI can demonstrate the flow.
    return JSONResponse({
        "ok":     True,
        "token":  token,
        "message": "Magic link generated. Check your email (demo: token returned in response).",
    })


@fastapi_app.post("/api/auth/magic_link/verify")
async def api_magic_link_verify(request: Request):
    """Verify a magic-link token and log the user in."""
    data = await request.json()
    token = (data.get("token") or "").strip()
    if not token:
        return JSONResponse({"error": "Token required."}, status_code=400)

    with _magic_link_lock:
        entry = _magic_link_tokens.get(token)
        if entry is None or time.time() > entry["expires_at"]:
            _magic_link_tokens.pop(token, None)
            return JSONResponse({"error": "Invalid or expired token."}, status_code=401)
        del _magic_link_tokens[token]  # single-use

    user = _get_app_user_by_email(entry["email"])
    if user is None:
        return JSONResponse({"error": "User not found."}, status_code=404)

    request.session["app_user_id"] = user["user_id"]
    return JSONResponse({
        "ok":        True,
        "user_id":   user["user_id"],
        "name":      user["name"],
        "email":     user["email"],
        "role":      user["role"],
        "created_at": user.get("created_at", ""),
    })


# ── Driver registration & approval ────────────────────────────────────────────

@fastapi_app.post("/api/auth/driver_apply")
async def api_driver_apply(request: Request, body: _DriverApplyRequest):
    """Submit a driver-role application."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if user is None:
        return JSONResponse({"error": "User not found."}, status_code=404)

    # Basic validation
    if not body.vehicle_make.strip() or not body.vehicle_model.strip():
        return JSONResponse({"error": "Vehicle make and model are required."}, status_code=400)
    if body.vehicle_year < 1900 or body.vehicle_year > datetime.now().year + 1:
        return JSONResponse({"error": "Invalid vehicle year."}, status_code=400)
    if not body.license_plate.strip():
        return JSONResponse({"error": "License plate is required."}, status_code=400)
    subscription_type = body.subscription_type if body.subscription_type in ("monthly", "yearly") else "monthly"

    app_id   = str(uuid.uuid4())
    created  = datetime.now(timezone.utc).isoformat()

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO driver_applications
                       (app_id, user_id, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, subscription_type, status, created_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'pending',%s)
                       ON CONFLICT (user_id) DO UPDATE SET
                         vehicle_make=EXCLUDED.vehicle_make, vehicle_model=EXCLUDED.vehicle_model,
                         vehicle_year=EXCLUDED.vehicle_year, vehicle_color=EXCLUDED.vehicle_color,
                         license_plate=EXCLUDED.license_plate, subscription_type=EXCLUDED.subscription_type,
                         status='pending', created_at=EXCLUDED.created_at""",
                    (app_id, user_id, body.vehicle_make.strip(), body.vehicle_model.strip(),
                     body.vehicle_year, body.vehicle_color.strip(), body.license_plate.strip().upper(),
                     subscription_type, created),
                )
            else:
                conn.execute(
                    """INSERT OR REPLACE INTO driver_applications
                       (app_id, user_id, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, subscription_type, status, created_at)
                       VALUES (?,?,?,?,?,?,?,?,'pending',?)""",
                    (app_id, user_id, body.vehicle_make.strip(), body.vehicle_model.strip(),
                     body.vehicle_year, body.vehicle_color.strip(), body.license_plate.strip().upper(),
                     subscription_type, created),
                )
            conn.commit()
        finally:
            conn.close()

    # Persist driver application to bucket under /driver_reg/pending/
    _bucket_write_json("driver_reg/pending", "driver_reg", app_id, {
        "app_id": app_id,
        "user_id": user_id,
        "vehicle_make": body.vehicle_make.strip(),
        "vehicle_model": body.vehicle_model.strip(),
        "vehicle_year": body.vehicle_year,
        "vehicle_color": body.vehicle_color.strip(),
        "license_plate": body.license_plate.strip().upper(),
        "subscription_type": subscription_type,
        "status": "pending",
        "created_at": created,
    })

    return JSONResponse({"ok": True, "app_id": app_id}, status_code=201)


@fastapi_app.get("/api/auth/driver_application")
async def api_driver_application_status(request: Request):
    """Return the current user's driver application status."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            cols = ["app_id", "user_id", "vehicle_make", "vehicle_model", "vehicle_year",
                    "vehicle_color", "license_plate", "subscription_type", "status", "created_at"]
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT app_id,user_id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,subscription_type,status,created_at FROM driver_applications WHERE user_id=%s",
                    (user_id,),
                )
                row = cur.fetchone()
            else:
                cur = conn.execute(
                    "SELECT app_id,user_id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,subscription_type,status,created_at FROM driver_applications WHERE user_id=?",
                    (user_id,),
                )
                row = cur.fetchone()
        finally:
            conn.close()

    if row is None:
        return JSONResponse({"application": None})
    return JSONResponse({"application": dict(zip(cols, row))})


@fastapi_app.get("/api/admin/driver_applications")
async def api_admin_driver_applications(request: Request):
    """Return all pending driver applications (admin only)."""
    if not request.session.get("admin_logged_in"):
        return JSONResponse({"error": "Admin login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            cols = ["app_id", "user_id", "vehicle_make", "vehicle_model", "vehicle_year",
                    "vehicle_color", "license_plate", "status", "created_at", "name", "email"]
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    """SELECT da.app_id, da.user_id, da.vehicle_make, da.vehicle_model,
                              da.vehicle_year, da.vehicle_color, da.license_plate, da.status,
                              da.created_at, au.name, au.email
                       FROM driver_applications da
                       JOIN app_users au ON da.user_id = au.user_id
                       ORDER BY da.created_at DESC"""
                )
                rows = cur.fetchall()
            else:
                cur = conn.execute(
                    """SELECT da.app_id, da.user_id, da.vehicle_make, da.vehicle_model,
                              da.vehicle_year, da.vehicle_color, da.license_plate, da.status,
                              da.created_at, au.name, au.email
                       FROM driver_applications da
                       JOIN app_users au ON da.user_id = au.user_id
                       ORDER BY da.created_at DESC"""
                )
                rows = cur.fetchall()
        finally:
            conn.close()

    return JSONResponse({"applications": [dict(zip(cols, r)) for r in rows]})


@fastapi_app.post("/api/admin/driver_applications/{app_id}/approve")
async def api_admin_driver_approve(request: Request, app_id: str, body: _DriverApproveRequest):
    """Approve or reject a driver application (admin only)."""
    if not request.session.get("admin_logged_in"):
        return JSONResponse({"error": "Admin login required."}, status_code=401)

    new_status = "approved" if body.approved else "rejected"

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    """SELECT da.user_id, au.name, au.email
                       FROM driver_applications da
                       JOIN app_users au ON da.user_id = au.user_id
                       WHERE da.app_id=%s""",
                    (app_id,),
                )
                row = cur.fetchone()
            else:
                cur = conn.execute(
                    """SELECT da.user_id, au.name, au.email
                       FROM driver_applications da
                       JOIN app_users au ON da.user_id = au.user_id
                       WHERE da.app_id=?""",
                    (app_id,),
                )
                row = cur.fetchone()

            if row is None:
                return JSONResponse({"error": "Application not found."}, status_code=404)

            target_user_id = row[0]
            driver_name    = row[1]
            driver_email   = row[2]

            if USE_POSTGRES:
                cur.execute("UPDATE driver_applications SET status=%s WHERE app_id=%s", (new_status, app_id))
                if body.approved:
                    cur.execute("UPDATE app_users SET role='driver' WHERE user_id=%s", (target_user_id,))
            else:
                conn.execute("UPDATE driver_applications SET status=? WHERE app_id=?", (new_status, app_id))
                if body.approved:
                    conn.execute("UPDATE app_users SET role='driver' WHERE user_id=?", (target_user_id,))
            conn.commit()
        finally:
            conn.close()

    # Send in-app notification to the affected user
    reviewed_at = datetime.now(timezone.utc).isoformat()
    if body.approved:
        _create_notification(
            target_user_id,
            "driver_approved",
            "🎉 Driver Application Approved",
            "Congratulations! Your driver application has been approved. You can now post rides and use Driver Alerts.",
            link="#driver_reg",
            link_label="View Driver Status",
        )
        _send_email(
            driver_email,
            "Your Driver Registration Has Been Approved",
            f"Dear {driver_name},\n\n"
            "Congratulations! Your driver application has been approved. "
            "You can now post rides and use Driver Alerts.\n\n"
            "Best regards,\nThe YotWeek Team",
        )
        # Also emit real-time socket event if the user is connected
        with _socket_user_lock:
            sid = _user_to_sid.get(target_user_id)
        if sid:
            asyncio.ensure_future(sio.emit("notification", {
                "type":  "driver_approved",
                "title": "🎉 Driver Application Approved",
                "body":  "Your driver application has been approved!",
            }, room=sid))
        # Persist approved record to bucket under /driver_reg/verified/
        _bucket_write_json("driver_reg/verified", "driver_reg", app_id, {
            "app_id": app_id,
            "user_id": target_user_id,
            "status": "approved",
            "reviewed_at": reviewed_at,
        })
    else:
        _create_notification(
            target_user_id,
            "driver_rejected",
            "❌ Driver Application Rejected",
            "Unfortunately, your driver application was not approved this time. You may re-apply with updated details.",
            link="#driver_reg",
            link_label="View Driver Registration",
        )
        _send_email(
            driver_email,
            "Your Driver Registration Was Not Approved",
            f"Dear {driver_name},\n\n"
            "Unfortunately, your driver application was not approved this time. "
            "You may re-apply with updated details.\n\n"
            "Best regards,\nThe YotWeek Team",
        )
        # Persist rejected record to bucket under /driver_reg/pending/ (status update)
        _bucket_write_json("driver_reg/pending", "driver_reg", app_id, {
            "app_id": app_id,
            "user_id": target_user_id,
            "status": new_status,
            "reviewed_at": reviewed_at,
        })

    return JSONResponse({"ok": True, "status": new_status})


# ── Public key (E2E encryption) ────────────────────────────────────────────────

@fastapi_app.put("/api/auth/public_key")
async def api_store_public_key(request: Request, body: _StorePublicKeyRequest):
    """Store the authenticated user's public key for E2E encryption."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)
    pk = body.public_key.strip()
    if not pk:
        return JSONResponse({"error": "public_key is required."}, status_code=400)
    with _db_lock:
        conn = _get_db()
        try:
            _execute(
                conn,
                "UPDATE app_users SET public_key=? WHERE user_id=?"
                if not USE_POSTGRES else
                "UPDATE app_users SET public_key=%s WHERE user_id=%s",
                (pk, user_id),
            )
            conn.commit()
        finally:
            conn.close()
    return JSONResponse({"ok": True})


@fastapi_app.get("/api/users/{user_id}/public_key")
async def api_get_user_public_key(request: Request, user_id: str):
    """Return the public key for a given user (requires auth)."""
    caller = request.session.get("app_user_id")
    if not caller:
        return JSONResponse({"error": "Login required."}, status_code=401)
    with _db_lock:
        conn = _get_db()
        try:
            cur = _execute(
                conn,
                "SELECT public_key FROM app_users WHERE user_id=?"
                if not USE_POSTGRES else
                "SELECT public_key FROM app_users WHERE user_id=%s",
                (user_id,),
            )
            row = cur.fetchone()
        finally:
            conn.close()
    if row is None:
        return JSONResponse({"error": "User not found."}, status_code=404)
    pk = row["public_key"] if USE_POSTGRES else row[0]
    return JSONResponse({"user_id": user_id, "public_key": pk})


@fastapi_app.get("/api/users/{user_id}/profile")
async def api_get_user_profile(request: Request, user_id: str):
    """Return the public profile for a given user (name, username, avatar_url). Requires auth."""
    caller = request.session.get("app_user_id")
    if not caller:
        return JSONResponse({"error": "Login required."}, status_code=401)
    user = _get_app_user(user_id)
    if user is None:
        return JSONResponse({"error": "User not found."}, status_code=404)
    return JSONResponse({
        "user_id":    user["user_id"],
        "name":       user["name"],
        "username":   user.get("username") or user["name"],
        "avatar_url": user.get("avatar_url") or "",
        "role":       user.get("role") or "passenger",
    })


# ── Agent registration ─────────────────────────────────────────────────────────

@fastapi_app.get("/api/rides/history")
async def api_ride_history(request: Request):
    """Return all rides associated with the logged-in user."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            cols = ["ride_id", "user_id", "driver_name", "origin", "destination",
                    "departure", "seats", "notes", "status", "created_at"]
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT ride_id,user_id,driver_name,origin,destination,departure,seats,notes,status,created_at FROM rides WHERE user_id=%s ORDER BY created_at DESC",
                    (user_id,),
                )
                rows = cur.fetchall()
            else:
                cur = conn.execute(
                    "SELECT ride_id,user_id,driver_name,origin,destination,departure,seats,notes,status,created_at FROM rides WHERE user_id=? ORDER BY created_at DESC",
                    (user_id,),
                )
                rows = cur.fetchall()
        finally:
            conn.close()

    rides = [dict(zip(cols, r)) for r in rows]
    return JSONResponse({"rides": rides})

# =========================================================
# RIDE SHARING MODULE
# =========================================================

class _RidePostRequest(BaseModel):
    origin:        str
    destination:   str
    departure:     str
    seats:         int = 1
    notes:         str = ""
    origin_lat:    float | None = None
    origin_lng:    float | None = None
    dest_lat:      float | None = None
    dest_lng:      float | None = None
    fare:          float | None = None
    ride_type:     str = "airport"
    vehicle_color: str = ""
    vehicle_type:  str = ""
    plate_number:  str = ""


class _RideJoinRequest(BaseModel):
    ride_id: str


@fastapi_app.post("/api/rides/post")
async def api_ride_post(request: Request, body: _RidePostRequest):
    """Post a new airport pickup ride offer. Only verified drivers may post rides."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required to post a ride."}, status_code=401)

    user = _get_app_user(user_id)
    if user is None:
        return JSONResponse({"error": "User not found."}, status_code=404)

    # Only verified (approved) drivers may post airport pickup rides
    if user.get("role") != "driver":
        return JSONResponse(
            {"error": "Only verified drivers can post airport pickup rides. "
                      "Register as a driver from your profile to gain access."},
            status_code=403,
        )

    origin      = body.origin.strip()
    destination = body.destination.strip()
    departure   = body.departure.strip()

    if not origin or not destination or not departure:
        return JSONResponse({"error": "Origin, destination and departure are required."}, status_code=400)
    if body.seats < 1 or body.seats > 20:
        return JSONResponse({"error": "Seats must be between 1 and 20."}, status_code=400)

    # Auto-calculate fare if coordinates provided and fare not given
    fare = body.fare
    if fare is None and body.origin_lat is not None and body.dest_lat is not None:
        dist_km = _haversine_km(body.origin_lat, body.origin_lng, body.dest_lat, body.dest_lng)
        fare = round(dist_km * _FARE_PER_KM, 2)

    ride_type     = body.ride_type if body.ride_type in ("airport", "standard") else "airport"
    vehicle_color = body.vehicle_color.strip()
    vehicle_type  = body.vehicle_type.strip()
    plate_number  = body.plate_number.strip()

    ride_id    = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    with _db_lock:
        conn = _get_db()
        try:
            # If plate_number not provided, attempt to pull from driver's registration
            if not plate_number:
                try:
                    if USE_POSTGRES:
                        _cur = conn.cursor()
                        _cur.execute("SELECT license_plate FROM driver_applications WHERE user_id=%s AND status='approved'", (user_id,))
                        _row = _cur.fetchone()
                    else:
                        _cur = conn.execute("SELECT license_plate FROM driver_applications WHERE user_id=? AND status='approved'", (user_id,))
                        _row = _cur.fetchone()
                    if _row:
                        plate_number = _row[0]
                except Exception:
                    pass  # plate lookup is best-effort
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO rides (ride_id,user_id,driver_name,origin,destination,origin_lat,origin_lng,dest_lat,dest_lng,fare,departure,seats,notes,status,created_at,ride_type,vehicle_color,vehicle_type,plate_number)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'open',%s,%s,%s,%s,%s)""",
                    (ride_id, user_id, user["name"], origin, destination,
                     body.origin_lat, body.origin_lng, body.dest_lat, body.dest_lng, fare,
                     departure, body.seats, body.notes.strip(), created_at, ride_type,
                     vehicle_color, vehicle_type, plate_number),
                )
            else:
                conn.execute(
                    """INSERT INTO rides (ride_id,user_id,driver_name,origin,destination,origin_lat,origin_lng,dest_lat,dest_lng,fare,departure,seats,notes,status,created_at,ride_type,vehicle_color,vehicle_type,plate_number)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?)""",
                    (ride_id, user_id, user["name"], origin, destination,
                     body.origin_lat, body.origin_lng, body.dest_lat, body.dest_lng, fare,
                     departure, body.seats, body.notes.strip(), created_at, ride_type,
                     vehicle_color, vehicle_type, plate_number),
                )
            conn.commit()
        finally:
            conn.close()

    ride_data = {
        "ride_id":       ride_id,
        "driver_name":   user["name"],
        "origin":        origin,
        "destination":   destination,
        "fare":          fare,
        "departure":     departure,
        "seats":         body.seats,
        "notes":         body.notes.strip(),
        "created_at":    created_at,
        "ride_type":     ride_type,
        "vehicle_color": vehicle_color,
        "vehicle_type":  vehicle_type,
        "plate_number":  plate_number,
    }

    # Notify all connected users via Socket.IO
    asyncio.ensure_future(sio.emit("new_ride", ride_data))

    # Persist ride record to bucket under /rides/
    _bucket_write_json("rides", "ride", ride_id, {
        **ride_data,
        "user_id": user_id,
        "status": "open",
        "origin_lat": body.origin_lat,
        "origin_lng": body.origin_lng,
        "dest_lat": body.dest_lat,
        "dest_lng": body.dest_lng,
    })

    return JSONResponse({"ok": True, "ride_id": ride_id}, status_code=201)


@fastapi_app.get("/api/rides/list")
async def api_rides_list(status: str | None = None):
    """Return rides ordered by departure time.

    Query param ``status`` can be 'open', 'taken', 'cancelled', or omitted to
    return open and taken rides (everything visible to passengers).
    """
    _VALID_RIDE_STATUSES = ("open", "taken", "cancelled")
    # Default: show open and taken rides so passengers can see status tags.
    if status and status in _VALID_RIDE_STATUSES:
        status_filter = [status]
    else:
        status_filter = ["open", "taken"]

    # Build parameterised placeholders from a fixed count — no user data
    # enters the SQL string itself, so this is safe from injection.
    n = len(status_filter)
    pg_placeholders  = ",".join(["%s"] * n)
    sql_placeholders = ",".join(["?"]  * n)

    with _db_lock:
        conn = _get_db()
        try:
            cols = ["ride_id", "user_id", "driver_name", "origin", "destination",
                    "origin_lat", "origin_lng", "dest_lat", "dest_lng", "fare",
                    "departure", "seats", "notes", "status", "created_at", "ride_type",
                    "vehicle_color", "vehicle_type", "plate_number"]
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT ride_id,user_id,driver_name,origin,destination,origin_lat,origin_lng,dest_lat,dest_lng,fare,departure,seats,notes,status,created_at,COALESCE(ride_type,'airport'),"
                    "COALESCE(vehicle_color,''),COALESCE(vehicle_type,''),COALESCE(plate_number,'')"
                    f" FROM rides WHERE status IN ({pg_placeholders}) ORDER BY departure ASC LIMIT 200",
                    status_filter,
                )
                rows = cur.fetchall()
            else:
                cur = conn.execute(
                    "SELECT ride_id,user_id,driver_name,origin,destination,origin_lat,origin_lng,dest_lat,dest_lng,fare,departure,seats,notes,status,created_at,COALESCE(ride_type,'airport'),"
                    "COALESCE(vehicle_color,''),COALESCE(vehicle_type,''),COALESCE(plate_number,'')"
                    f" FROM rides WHERE status IN ({sql_placeholders}) ORDER BY departure ASC LIMIT 200",
                    status_filter,
                )
                rows = cur.fetchall()
        finally:
            conn.close()

    rides = [dict(zip(cols, row)) for row in rows]
    return JSONResponse({"rides": rides})


@fastapi_app.get("/api/rides/calculate_fare")
async def api_calculate_fare(
    origin_lat: float, origin_lng: float,
    dest_lat: float, dest_lng: float,
):
    """Calculate estimated fare for an airport pickup from origin to destination.

    Returns fare in local currency units at the configured rate per km.
    """
    dist_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
    fare    = round(dist_km * _FARE_PER_KM, 2)
    return JSONResponse({"dist_km": round(dist_km, 2), "fare": fare, "rate_per_km": _FARE_PER_KM})


@fastapi_app.get("/api/rides/shared_fare")
async def api_shared_fare(
    total_fare: float,
    total_seats: int,
    booked_seats: int,
):
    """Calculate the cost for a passenger booking *booked_seats* on a ride.

    Rules:
    - Full vehicle (booked_seats == total_seats): passenger pays total_fare.
    - Shared ride (booked_seats < total_seats): cost is proportional to
      booked_seats / total_seats, giving a discount for sharing.
    - Returns per-seat price and total amount owed.
    """
    if total_seats < 1:
        return JSONResponse({"error": "total_seats must be at least 1."}, status_code=400)
    if booked_seats < 1 or booked_seats > total_seats:
        return JSONResponse({"error": "booked_seats must be between 1 and total_seats."}, status_code=400)
    if total_fare < 0:
        return JSONResponse({"error": "total_fare must be non-negative."}, status_code=400)

    per_seat_cost   = round(total_fare / total_seats, 2)
    amount_owed     = round(per_seat_cost * booked_seats, 2)
    is_full_vehicle = booked_seats == total_seats

    return JSONResponse({
        "total_fare":      round(total_fare, 2),
        "total_seats":     total_seats,
        "booked_seats":    booked_seats,
        "per_seat_cost":   per_seat_cost,
        "amount_owed":     amount_owed,
        "is_full_vehicle": is_full_vehicle,
        "rate_per_km":     _FARE_PER_KM,
    })


# Nominatim geocoding base URL (uses OpenStreetMap data, no API key required).
# NOTE: Nominatim usage policy requires a descriptive User-Agent including a
# project name and contact URL/email, and enforces a rate limit of 1 req/second.
# Override _NOMINATIM_URL via the NOMINATIM_URL env var to use a self-hosted
# instance or a commercial provider with higher rate limits.
_NOMINATIM_URL = os.environ.get("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")
_NOMINATIM_TIMEOUT_SECS = 5
# Contact email shown in the User-Agent (configurable via env var)
_NOMINATIM_CONTACT = os.environ.get("NOMINATIM_CONTACT", "contact@yotweek.app")


def _geocode_address(address: str) -> dict | None:
    """Geocode an address string using Nominatim (OpenStreetMap).

    Returns ``{"lat": float, "lng": float, "display_name": str}`` or ``None``
    if the address cannot be resolved.

    Nominatim policy requires 1 request/second and a descriptive User-Agent
    with contact information. For high-volume production use, configure a
    self-hosted Nominatim instance via the NOMINATIM_URL environment variable.
    """
    import urllib.request
    import urllib.parse
    import json as _json

    params = urllib.parse.urlencode({
        "q": address,
        "format": "json",
        "limit": "1",
        "addressdetails": "0",
    })
    url = f"{_NOMINATIM_URL}?{params}"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": f"yotweek-platform/1.0 ({_NOMINATIM_CONTACT})"},
        )
        with urllib.request.urlopen(req, timeout=_NOMINATIM_TIMEOUT_SECS) as resp:
            data = _json.loads(resp.read().decode())
        if not data:
            return None
        first = data[0]
        return {
            "lat":          float(first["lat"]),
            "lng":          float(first["lon"]),
            "display_name": first.get("display_name", address),
        }
    except Exception as exc:
        logger.warning("Geocoding failed for '%s': %s", address, exc)
        return None


@fastapi_app.get("/api/rides/geocode")
async def api_rides_geocode(address: str):
    """Geocode a free-text address to latitude/longitude coordinates.

    Returns ``{"lat", "lng", "display_name"}`` or an error if geocoding fails.
    Uses Nominatim (OpenStreetMap) — no API key required.
    """
    if not address or not address.strip():
        return JSONResponse({"error": "address parameter is required."}, status_code=400)
    result = await asyncio.get_event_loop().run_in_executor(None, _geocode_address, address.strip())
    if result is None:
        return JSONResponse(
            {"error": f"Could not geocode address: '{address}'. Try a more specific address."},
            status_code=422,
        )
    return JSONResponse(result)


@fastapi_app.get("/api/rides/estimate_fare")
async def api_rides_estimate_fare(start: str, destination: str, seats: int = 1):
    """Estimate the fare for a trip between two address strings.

    Geocodes both ``start`` and ``destination``, computes the Haversine
    distance, and returns the estimated fare at the platform rate ($1/km).

    Query params:
      - ``start``       – Origin address
      - ``destination`` – Destination address
      - ``seats``       – Number of seats (default 1); used to compute per-seat cost
    """
    if not start or not start.strip():
        return JSONResponse({"error": "start parameter is required."}, status_code=400)
    if not destination or not destination.strip():
        return JSONResponse({"error": "destination parameter is required."}, status_code=400)
    if seats < 1:
        return JSONResponse({"error": "seats must be at least 1."}, status_code=400)

    loop = asyncio.get_event_loop()
    origin_result, dest_result = await asyncio.gather(
        loop.run_in_executor(None, _geocode_address, start.strip()),
        loop.run_in_executor(None, _geocode_address, destination.strip()),
    )

    if origin_result is None:
        return JSONResponse(
            {"error": f"Could not geocode start address: '{start}'. Try a more specific address."},
            status_code=422,
        )
    if dest_result is None:
        return JSONResponse(
            {"error": f"Could not geocode destination: '{destination}'. Try a more specific address."},
            status_code=422,
        )

    dist_km     = _haversine_km(origin_result["lat"], origin_result["lng"],
                                dest_result["lat"],   dest_result["lng"])
    total_fare  = round(dist_km * _FARE_PER_KM, 2)
    per_seat    = round(total_fare / seats, 2)

    return JSONResponse({
        "start":            start.strip(),
        "destination":      destination.strip(),
        "origin_lat":       origin_result["lat"],
        "origin_lng":       origin_result["lng"],
        "origin_display":   origin_result["display_name"],
        "dest_lat":         dest_result["lat"],
        "dest_lng":         dest_result["lng"],
        "dest_display":     dest_result["display_name"],
        "dist_km":          round(dist_km, 2),
        "total_fare":       total_fare,
        "per_seat_cost":    per_seat,
        "seats":            seats,
        "rate_per_km":      _FARE_PER_KM,
    })


@fastapi_app.get("/api/rides/{ride_id}")
async def api_get_ride(request: Request, ride_id: str):
    """Fetch details for a single ride by ride_id.

    Returns 404 if the ride does not exist and 403 if the requesting user is
    not the driver or a confirmed/taking passenger for the ride.
    """
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    cols = [
        "ride_id", "user_id", "driver_name", "origin", "destination",
        "origin_lat", "origin_lng", "dest_lat", "dest_lng",
        "fare", "departure", "seats", "notes", "status",
        "ride_type", "vehicle_color", "vehicle_type", "plate_number", "created_at",
    ]
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT ride_id,user_id,driver_name,origin,destination,"
                    "origin_lat,origin_lng,dest_lat,dest_lng,fare,departure,seats,"
                    "notes,status,ride_type,vehicle_color,vehicle_type,plate_number,created_at "
                    "FROM rides WHERE ride_id=%s",
                    (ride_id,),
                )
                row = cur.fetchone()
            else:
                cur = conn.execute(
                    "SELECT ride_id,user_id,driver_name,origin,destination,"
                    "origin_lat,origin_lng,dest_lat,dest_lng,fare,departure,seats,"
                    "notes,status,ride_type,vehicle_color,vehicle_type,plate_number,created_at "
                    "FROM rides WHERE ride_id=?",
                    (ride_id,),
                )
                row = cur.fetchone()
        finally:
            conn.close()

    if row is None:
        return JSONResponse({"error": "Ride not found."}, status_code=404)

    ride = dict(zip(cols, row))

    # Allow access to the driver (poster) or any authenticated user viewing
    # a public ride listing.  For confirmed passengers only, restrict further
    # when the ride is completed/cancelled.
    return JSONResponse({"ride": ride})


@fastapi_app.delete("/api/rides/{ride_id}")
async def api_ride_cancel(request: Request, ride_id: str):
    """Cancel a ride (only the poster can cancel it)."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id FROM rides WHERE ride_id=%s", (ride_id,))
                row = cur.fetchone()
            else:
                cur = conn.execute("SELECT user_id FROM rides WHERE ride_id=?", (ride_id,))
                row = cur.fetchone()

            if row is None:
                return JSONResponse({"error": "Ride not found."}, status_code=404)
            if row[0] != user_id:
                return JSONResponse({"error": "Not authorised."}, status_code=403)

            if USE_POSTGRES:
                cur.execute("UPDATE rides SET status='cancelled' WHERE ride_id=%s", (ride_id,))
            else:
                conn.execute("UPDATE rides SET status='cancelled' WHERE ride_id=?", (ride_id,))
            conn.commit()
        finally:
            conn.close()

    asyncio.ensure_future(sio.emit("ride_cancelled", {"ride_id": ride_id}))
    # Persist status update to bucket
    _bucket_write_json("rides", "ride", ride_id, {"ride_id": ride_id, "status": "cancelled"})
    return JSONResponse({"ok": True})


@fastapi_app.post("/api/rides/{ride_id}/take")
async def api_ride_take(request: Request, ride_id: str):
    """Mark a ride as taken (only the poster can confirm this)."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id, status FROM rides WHERE ride_id=%s", (ride_id,))
                row = cur.fetchone()
            else:
                cur = conn.execute("SELECT user_id, status FROM rides WHERE ride_id=?", (ride_id,))
                row = cur.fetchone()

            if row is None:
                return JSONResponse({"error": "Ride not found."}, status_code=404)
            if row[0] != user_id:
                return JSONResponse({"error": "Not authorised."}, status_code=403)
            if row[1] == "cancelled":
                return JSONResponse({"error": "Cannot mark a cancelled ride as taken."}, status_code=409)

            if USE_POSTGRES:
                cur.execute("UPDATE rides SET status='taken' WHERE ride_id=%s", (ride_id,))
            else:
                conn.execute("UPDATE rides SET status='taken' WHERE ride_id=?", (ride_id,))
            conn.commit()
        finally:
            conn.close()

    asyncio.ensure_future(sio.emit("ride_taken", {"ride_id": ride_id}))
    # Persist status update to bucket; a "taken" ride moves into history
    completed_at = datetime.now(timezone.utc).isoformat()
    _bucket_write_json("rides", "ride", ride_id, {"ride_id": ride_id, "status": "taken"})
    _bucket_write_json("history", "history", ride_id, {
        "ride_id": ride_id,
        "user_id": user_id,
        "status": "taken",
        "completed_at": completed_at,
    })
    # Notify the ride poster
    _create_notification(
        user_id,
        "ride_taken",
        "✅ Your Ride Has Been Taken",
        f"Good news! Your ride has been marked as taken.",
        link="/inbox",
        link_label="View in Inbox",
    )
    return JSONResponse({"ok": True})


@fastapi_app.post("/api/rides/{ride_id}/alert_clients")
async def api_ride_alert_clients(request: Request, ride_id: str):
    """Driver alerts all clients who have chatted about their ride that they have arrived.

    - Finds all unique passengers who sent messages in the ride's chat room.
    - Emits a ``driver_arrived`` socket event to each online passenger.
    - Creates an in-app notification for each passenger.
    - If only one passenger is found, alerts only that one; otherwise alerts all.
    """
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if not user:
        return JSONResponse({"error": "User not found."}, status_code=404)
    if user.get("role") != "driver":
        return JSONResponse({"error": "Only drivers can send arrival alerts."}, status_code=403)

    with _db_lock:
        conn = _get_db()
        try:
            # Verify ride belongs to this driver
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id, origin, destination, status FROM rides WHERE ride_id=%s", (ride_id,))
                row = cur.fetchone()
            else:
                cur = conn.execute("SELECT user_id, origin, destination, status FROM rides WHERE ride_id=?", (ride_id,))
                row = cur.fetchone()
            if row is None:
                return JSONResponse({"error": "Ride not found."}, status_code=404)
            if row[0] != user_id:
                return JSONResponse({"error": "Not authorised."}, status_code=403)
            ride_origin = row[1]
            ride_destination = row[2]

            # Collect unique passengers (users who sent messages in this ride chat, excluding the driver)
            driver_name = user["name"]
            if USE_POSTGRES:
                cur.execute(
                    """
                    SELECT DISTINCT sender_name
                    FROM ride_chat_messages
                    WHERE ride_id=%s AND sender_name != %s AND sender_role != 'driver'
                    LIMIT 100
                    """,
                    (ride_id, driver_name),
                )
                passenger_names = [r[0] for r in cur.fetchall()]
                # Map sender names to user_ids
                if passenger_names:
                    cur.execute(
                        "SELECT user_id, name FROM app_users WHERE name = ANY(%s)",
                        (passenger_names,),
                    )
                    passenger_rows = cur.fetchall()
                else:
                    passenger_rows = []
            else:
                cur2 = conn.execute(
                    """
                    SELECT DISTINCT sender_name
                    FROM ride_chat_messages
                    WHERE ride_id=? AND sender_name != ? AND sender_role != 'driver'
                    LIMIT 100
                    """,
                    (ride_id, driver_name),
                )
                passenger_names = [r[0] for r in cur2.fetchall()]
                if passenger_names:
                    placeholders = ",".join("?" * len(passenger_names))
                    cur3 = conn.execute(
                        f"SELECT user_id, name FROM app_users WHERE name IN ({placeholders})",
                        passenger_names,
                    )
                    passenger_rows = cur3.fetchall()
                else:
                    passenger_rows = []
        finally:
            conn.close()

    alerted_count = 0
    payload = {
        "ride_id": ride_id,
        "driver_name": driver_name,
        "origin": ride_origin,
        "destination": ride_destination,
        "message": f"🚗 Your driver {driver_name} has arrived at {ride_origin}!",
    }

    for passenger_id, passenger_name in passenger_rows:
        try:
            _create_notification(
                passenger_id,
                "driver_arrived",
                f"🚗 Driver Arrived — {driver_name}",
                f"Your driver has arrived at {ride_origin}. Check your ride to {ride_destination}.",
                link=f"/rides?chat={ride_id}",
                link_label="Open Ride Chat",
            )
            with _socket_user_lock:
                psid = _user_to_sid.get(passenger_id)
            if psid:
                asyncio.ensure_future(sio.emit("driver_arrived", payload, room=psid))
            alerted_count += 1
        except Exception as exc:
            logger.warning("Failed to alert passenger %s: %s", passenger_id, exc)

    return JSONResponse({"ok": True, "alerted": alerted_count, "total_passengers": len(passenger_rows)})


# =========================================================
# RIDE JOURNEY CONFIRMATION MODULE
# =========================================================

class _JourneyConfirmRequest(BaseModel):
    real_name: str
    contact:   str


@fastapi_app.post("/api/rides/{ride_id}/confirm_journey")
async def api_ride_confirm_journey(request: Request, ride_id: str, body: _JourneyConfirmRequest):
    """Passenger confirms their journey for a specific ride by submitting real name + contact."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    real_name = body.real_name.strip()
    contact   = body.contact.strip()
    if not real_name or not contact:
        return JSONResponse({"error": "Real name and contact are required."}, status_code=400)

    with _db_lock:
        conn = _get_db()
        try:
            # Verify ride exists
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id, driver_name, origin, destination FROM rides WHERE ride_id=%s", (ride_id,))
                ride_row = cur.fetchone()
            else:
                cur = conn.execute("SELECT user_id, driver_name, origin, destination FROM rides WHERE ride_id=?", (ride_id,))
                ride_row = cur.fetchone()
            if not ride_row:
                return JSONResponse({"error": "Ride not found."}, status_code=404)

            driver_user_id = ride_row[0]
            driver_name    = ride_row[1]
            origin         = ride_row[2]
            destination    = ride_row[3]

            confirmation_id = str(uuid.uuid4())
            created_at      = datetime.now(timezone.utc).isoformat()

            if USE_POSTGRES:
                cur.execute(
                    """INSERT INTO ride_journey_confirmations (confirmation_id, ride_id, user_id, real_name, contact, created_at)
                       VALUES (%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (ride_id, user_id) DO UPDATE SET real_name=EXCLUDED.real_name, contact=EXCLUDED.contact""",
                    (confirmation_id, ride_id, user_id, real_name, contact, created_at),
                )
            else:
                conn.execute(
                    """INSERT OR REPLACE INTO ride_journey_confirmations (confirmation_id, ride_id, user_id, real_name, contact, created_at)
                       VALUES (?,?,?,?,?,?)""",
                    (confirmation_id, ride_id, user_id, real_name, contact, created_at),
                )
            conn.commit()
        finally:
            conn.close()

    # Notify the driver about the confirmation
    user = _get_app_user(user_id)
    user_display = user["name"] if user else real_name
    _create_notification(
        driver_user_id,
        "journey_confirmed",
        f"✅ Journey Confirmed — {user_display}",
        f"{real_name} confirmed their journey for your ride {origin} → {destination}.",
        link=f"/rides?chat={ride_id}",
        link_label="View Confirmed Users",
    )
    with _socket_user_lock:
        dsid = _user_to_sid.get(driver_user_id)
    if dsid:
        asyncio.ensure_future(sio.emit("journey_confirmed", {
            "ride_id":   ride_id,
            "real_name": real_name,
            "contact":   contact,
        }, room=dsid))

    return JSONResponse({"ok": True, "message": "Journey confirmed successfully."})


@fastapi_app.get("/api/rides/{ride_id}/confirmed_users")
async def api_ride_confirmed_users(request: Request, ride_id: str):
    """Driver retrieves list of passengers who confirmed their journey for a ride."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if not user:
        return JSONResponse({"error": "User not found."}, status_code=404)

    with _db_lock:
        conn = _get_db()
        try:
            # Verify ride belongs to this driver (or allow admins)
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id FROM rides WHERE ride_id=%s", (ride_id,))
                ride_row = cur.fetchone()
            else:
                cur = conn.execute("SELECT user_id FROM rides WHERE ride_id=?", (ride_id,))
                ride_row = cur.fetchone()
            if not ride_row:
                return JSONResponse({"error": "Ride not found."}, status_code=404)
            if ride_row[0] != user_id and user.get("role") != "admin":
                return JSONResponse({"error": "Not authorised."}, status_code=403)

            cols = ["confirmation_id", "ride_id", "user_id", "real_name", "contact", "created_at"]
            if USE_POSTGRES:
                cur.execute(
                    "SELECT confirmation_id,ride_id,user_id,real_name,contact,created_at FROM ride_journey_confirmations WHERE ride_id=%s ORDER BY created_at ASC",
                    (ride_id,),
                )
                rows = cur.fetchall()
            else:
                cur2 = conn.execute(
                    "SELECT confirmation_id,ride_id,user_id,real_name,contact,created_at FROM ride_journey_confirmations WHERE ride_id=? ORDER BY created_at ASC",
                    (ride_id,),
                )
                rows = cur2.fetchall()
        finally:
            conn.close()

    confirmed = [dict(zip(cols, r)) for r in rows]
    return JSONResponse({"confirmed_users": confirmed})


class _ProximityNotifyRequest(BaseModel):
    distance_km:    float
    distance_miles: float | None = None
    unit:           str = "km"  # "km" or "miles"


@fastapi_app.post("/api/rides/{ride_id}/proximity_notify")
async def api_ride_proximity_notify(request: Request, ride_id: str, body: _ProximityNotifyRequest):
    """Driver sends a proximity notification to all confirmed users of a ride."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if not user or user.get("role") != "driver":
        return JSONResponse({"error": "Only drivers can send proximity notifications."}, status_code=403)

    unit = "miles" if body.unit == "miles" else "km"
    distance_val = body.distance_miles if unit == "miles" and body.distance_miles is not None else body.distance_km

    with _db_lock:
        conn = _get_db()
        try:
            # Verify ride belongs to this driver
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id, origin, destination FROM rides WHERE ride_id=%s", (ride_id,))
                ride_row = cur.fetchone()
            else:
                cur = conn.execute("SELECT user_id, origin, destination FROM rides WHERE ride_id=?", (ride_id,))
                ride_row = cur.fetchone()
            if not ride_row:
                return JSONResponse({"error": "Ride not found."}, status_code=404)
            if ride_row[0] != user_id:
                return JSONResponse({"error": "Not authorised."}, status_code=403)

            origin      = ride_row[1]
            destination = ride_row[2]

            # Get confirmed users
            if USE_POSTGRES:
                cur.execute(
                    "SELECT user_id FROM ride_journey_confirmations WHERE ride_id=%s",
                    (ride_id,),
                )
                confirmed_rows = cur.fetchall()
            else:
                cur2 = conn.execute(
                    "SELECT user_id FROM ride_journey_confirmations WHERE ride_id=?",
                    (ride_id,),
                )
                confirmed_rows = cur2.fetchall()
        finally:
            conn.close()

    driver_name = user["name"]
    distance_str = f"{round(distance_val, 1)} {unit}"
    message = f"🚗 Driver {driver_name} is {distance_str} away from your location."
    payload = {
        "ride_id":      ride_id,
        "driver_name":  driver_name,
        "distance":     round(distance_val, 1),
        "unit":         unit,
        "message":      message,
        "origin":       origin,
        "destination":  destination,
    }

    notified = 0
    for (passenger_id,) in confirmed_rows:
        try:
            _create_notification(
                passenger_id,
                "driver_proximity",
                f"📍 Driver Nearby — {driver_name}",
                message,
                link=f"/rides?chat={ride_id}",
                link_label="Open Ride Chat",
            )
            with _socket_user_lock:
                psid = _user_to_sid.get(passenger_id)
            if psid:
                asyncio.ensure_future(sio.emit("driver_proximity", payload, room=psid))
            notified += 1
        except Exception as exc:
            logger.warning("Failed to notify passenger %s: %s", passenger_id, exc)

    return JSONResponse({"ok": True, "notified": notified, "message": message})


# =========================================================
# RIDE REQUESTS MODULE (Supply & Demand)
# =========================================================

class _RideRequestCreate(BaseModel):
    origin:       str
    destination:  str
    desired_date: str
    passengers:   int = 1
    price_min:    float | None = None
    price_max:    float | None = None


@fastapi_app.post("/api/ride_requests")
async def api_create_ride_request(request: Request, body: _RideRequestCreate):
    """User raises a ride request when no matching ride is found."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if not user:
        return JSONResponse({"error": "User not found."}, status_code=404)

    origin       = body.origin.strip()
    destination  = body.destination.strip()
    desired_date = body.desired_date.strip()

    if not origin or not destination or not desired_date:
        return JSONResponse({"error": "Origin, destination and desired_date are required."}, status_code=400)
    if body.passengers < 1 or body.passengers > 20:
        return JSONResponse({"error": "Passengers must be between 1 and 20."}, status_code=400)

    request_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO ride_requests (request_id,user_id,passenger_name,origin,destination,desired_date,passengers,price_min,price_max,status,created_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'open',%s)""",
                    (request_id, user_id, user["name"], origin, destination,
                     desired_date, body.passengers, body.price_min, body.price_max, created_at),
                )
            else:
                conn.execute(
                    """INSERT INTO ride_requests (request_id,user_id,passenger_name,origin,destination,desired_date,passengers,price_min,price_max,status,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,'open',?)""",
                    (request_id, user_id, user["name"], origin, destination,
                     desired_date, body.passengers, body.price_min, body.price_max, created_at),
                )
            conn.commit()
        finally:
            conn.close()

    request_data = {
        "request_id":     request_id,
        "passenger_name": user["name"],
        "origin":         origin,
        "destination":    destination,
        "desired_date":   desired_date,
        "passengers":     body.passengers,
        "price_min":      body.price_min,
        "price_max":      body.price_max,
        "created_at":     created_at,
    }
    asyncio.ensure_future(sio.emit("new_ride_request", request_data))

    return JSONResponse({"ok": True, "request_id": request_id}, status_code=201)


@fastapi_app.get("/api/ride_requests")
async def api_list_ride_requests(status: str | None = None):
    """List open ride requests so drivers can browse and accept them."""
    status_filter = status if status in ("open", "accepted", "cancelled") else "open"

    with _db_lock:
        conn = _get_db()
        try:
            cols = ["request_id", "user_id", "passenger_name", "origin", "destination",
                    "desired_date", "passengers", "price_min", "price_max", "status", "accepted_by", "created_at"]
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT request_id,user_id,passenger_name,origin,destination,desired_date,passengers,price_min,price_max,status,accepted_by,created_at"
                    " FROM ride_requests WHERE status=%s ORDER BY desired_date ASC LIMIT 200",
                    (status_filter,),
                )
                rows = cur.fetchall()
            else:
                cur = conn.execute(
                    "SELECT request_id,user_id,passenger_name,origin,destination,desired_date,passengers,price_min,price_max,status,accepted_by,created_at"
                    " FROM ride_requests WHERE status=? ORDER BY desired_date ASC LIMIT 200",
                    (status_filter,),
                )
                rows = cur.fetchall()
        finally:
            conn.close()

    return JSONResponse({"requests": [dict(zip(cols, r)) for r in rows]})


@fastapi_app.post("/api/ride_requests/{request_id}/accept")
async def api_accept_ride_request(request: Request, request_id: str):
    """Driver accepts a ride request. Creates a DM conversation between driver and passenger."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if not user or user.get("role") != "driver":
        return JSONResponse({"error": "Only drivers can accept ride requests."}, status_code=403)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT user_id, passenger_name, origin, destination, desired_date, status FROM ride_requests WHERE request_id=%s",
                    (request_id,),
                )
                row = cur.fetchone()
            else:
                cur = conn.execute(
                    "SELECT user_id, passenger_name, origin, destination, desired_date, status FROM ride_requests WHERE request_id=?",
                    (request_id,),
                )
                row = cur.fetchone()
            if not row:
                return JSONResponse({"error": "Ride request not found."}, status_code=404)

            passenger_id     = row[0]
            passenger_name   = row[1]
            origin           = row[2]
            destination      = row[3]
            desired_date     = row[4]
            current_status   = row[5]

            if current_status != "open":
                return JSONResponse({"error": "This request has already been accepted or cancelled."}, status_code=409)

            # Mark request as accepted
            if USE_POSTGRES:
                cur.execute(
                    "UPDATE ride_requests SET status='accepted', accepted_by=%s WHERE request_id=%s",
                    (user_id, request_id),
                )
            else:
                conn.execute(
                    "UPDATE ride_requests SET status='accepted', accepted_by=? WHERE request_id=?",
                    (user_id, request_id),
                )

            # Create or reuse DM conversation between driver and passenger
            conv_id = None
            if USE_POSTGRES:
                cur.execute(
                    "SELECT conv_id FROM dm_conversations WHERE (user1_id=%s AND user2_id=%s) OR (user1_id=%s AND user2_id=%s) LIMIT 1",
                    (user_id, passenger_id, passenger_id, user_id),
                )
                conv_row = cur.fetchone()
            else:
                cur2 = conn.execute(
                    "SELECT conv_id FROM dm_conversations WHERE (user1_id=? AND user2_id=?) OR (user1_id=? AND user2_id=?) LIMIT 1",
                    (user_id, passenger_id, passenger_id, user_id),
                )
                conv_row = cur2.fetchone()

            if conv_row:
                conv_id = conv_row[0]
            else:
                conv_id    = str(uuid.uuid4())
                created_at = datetime.now(timezone.utc).isoformat()
                if USE_POSTGRES:
                    cur.execute(
                        "INSERT INTO dm_conversations (conv_id,user1_id,user2_id,unread_u1,unread_u2,created_at) VALUES (%s,%s,%s,0,1,%s)",
                        (conv_id, user_id, passenger_id, created_at),
                    )
                else:
                    conn.execute(
                        "INSERT INTO dm_conversations (conv_id,user1_id,user2_id,unread_u1,unread_u2,created_at) VALUES (?,?,?,0,1,?)",
                        (conv_id, user_id, passenger_id, created_at),
                    )

            conn.commit()
        finally:
            conn.close()

    # Notify the passenger
    driver_name = user["name"]
    _create_notification(
        passenger_id,
        "request_accepted",
        f"🚗 Ride Request Accepted — {driver_name}",
        f"Driver {driver_name} accepted your request for {origin} → {destination} on {desired_date}.",
        link=f"/inbox?conv={conv_id}",
        link_label="Open Chat",
    )
    with _socket_user_lock:
        psid = _user_to_sid.get(passenger_id)
    if psid:
        asyncio.ensure_future(sio.emit("ride_request_accepted", {
            "request_id":  request_id,
            "driver_name": driver_name,
            "conv_id":     conv_id,
            "origin":      origin,
            "destination": destination,
        }, room=psid))

    return JSONResponse({"ok": True, "conv_id": conv_id})


@fastapi_app.delete("/api/ride_requests/{request_id}")
async def api_cancel_ride_request(request: Request, request_id: str):
    """User cancels their own open ride request."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id, status FROM ride_requests WHERE request_id=%s", (request_id,))
                row = cur.fetchone()
            else:
                cur = conn.execute("SELECT user_id, status FROM ride_requests WHERE request_id=?", (request_id,))
                row = cur.fetchone()
            if not row:
                return JSONResponse({"error": "Ride request not found."}, status_code=404)
            if row[0] != user_id:
                return JSONResponse({"error": "Not authorised."}, status_code=403)
            if row[1] != "open":
                return JSONResponse({"error": "Only open requests can be cancelled."}, status_code=409)

            if USE_POSTGRES:
                cur.execute("UPDATE ride_requests SET status='cancelled' WHERE request_id=%s", (request_id,))
            else:
                conn.execute("UPDATE ride_requests SET status='cancelled' WHERE request_id=?", (request_id,))
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


# =========================================================
# TRAVEL COMPANION MODULE (Country-Wide)
# =========================================================

class _TravelCompanionCreate(BaseModel):
    origin_country:      str
    destination_country: str
    origin_city:         str = ""
    destination_city:    str = ""
    travel_date:         str
    notes:               str = ""


@fastapi_app.post("/api/travel_companions")
async def api_create_travel_companion(request: Request, body: _TravelCompanionCreate):
    """Post a travel companion listing for country-wide journey matching."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if not user:
        return JSONResponse({"error": "User not found."}, status_code=404)

    origin_country      = body.origin_country.strip()
    destination_country = body.destination_country.strip()
    travel_date         = body.travel_date.strip()

    if not origin_country or not destination_country or not travel_date:
        return JSONResponse({"error": "origin_country, destination_country and travel_date are required."}, status_code=400)

    companion_id = str(uuid.uuid4())
    created_at   = datetime.now(timezone.utc).isoformat()

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO travel_companions (companion_id,user_id,poster_name,origin_country,destination_country,origin_city,destination_city,travel_date,notes,status,created_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'active',%s)""",
                    (companion_id, user_id, user["name"], origin_country, destination_country,
                     body.origin_city.strip(), body.destination_city.strip(), travel_date,
                     body.notes.strip(), created_at),
                )
            else:
                conn.execute(
                    """INSERT INTO travel_companions (companion_id,user_id,poster_name,origin_country,destination_country,origin_city,destination_city,travel_date,notes,status,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,'active',?)""",
                    (companion_id, user_id, user["name"], origin_country, destination_country,
                     body.origin_city.strip(), body.destination_city.strip(), travel_date,
                     body.notes.strip(), created_at),
                )
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True, "companion_id": companion_id}, status_code=201)


@fastapi_app.get("/api/travel_companions")
async def api_list_travel_companions(
    origin_country:      str | None = None,
    destination_country: str | None = None,
    travel_date:         str | None = None,
):
    """Search and list active travel companion listings.

    Supports optional filters: origin_country, destination_country, travel_date.
    """
    with _db_lock:
        conn = _get_db()
        try:
            cols = ["companion_id", "user_id", "poster_name", "origin_country", "destination_country",
                    "origin_city", "destination_city", "travel_date", "notes", "status", "created_at"]
            conditions = ["status='active'"]
            params: list = []

            if origin_country:
                if USE_POSTGRES:
                    conditions.append("LOWER(origin_country) LIKE LOWER(%s)")
                else:
                    conditions.append("LOWER(origin_country) LIKE LOWER(?)")
                params.append(f"%{origin_country}%")

            if destination_country:
                if USE_POSTGRES:
                    conditions.append("LOWER(destination_country) LIKE LOWER(%s)")
                else:
                    conditions.append("LOWER(destination_country) LIKE LOWER(?)")
                params.append(f"%{destination_country}%")

            if travel_date:
                if USE_POSTGRES:
                    conditions.append("travel_date=%s")
                else:
                    conditions.append("travel_date=?")
                params.append(travel_date)

            where_clause = " AND ".join(conditions)
            sql = (
                "SELECT companion_id,user_id,poster_name,origin_country,destination_country,"
                f"origin_city,destination_city,travel_date,notes,status,created_at FROM travel_companions WHERE {where_clause} ORDER BY travel_date ASC LIMIT 200"
            )

            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(sql, params)
                rows = cur.fetchall()
            else:
                cur = conn.execute(sql, params)
                rows = cur.fetchall()
        finally:
            conn.close()

    companions = [dict(zip(cols, r)) for r in rows]
    return JSONResponse({"companions": companions})


@fastapi_app.delete("/api/travel_companions/{companion_id}")
async def api_delete_travel_companion(request: Request, companion_id: str):
    """User removes their own travel companion listing."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id FROM travel_companions WHERE companion_id=%s", (companion_id,))
                row = cur.fetchone()
            else:
                cur = conn.execute("SELECT user_id FROM travel_companions WHERE companion_id=?", (companion_id,))
                row = cur.fetchone()
            if not row:
                return JSONResponse({"error": "Companion listing not found."}, status_code=404)
            if row[0] != user_id:
                return JSONResponse({"error": "Not authorised."}, status_code=403)

            if USE_POSTGRES:
                cur.execute("UPDATE travel_companions SET status='inactive' WHERE companion_id=%s", (companion_id,))
            else:
                conn.execute("UPDATE travel_companions SET status='inactive' WHERE companion_id=?", (companion_id,))
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


@fastapi_app.get("/api/admin/rides")
async def api_admin_rides(request: Request):
    """Return ride-sharing statistics for the admin dashboard."""
    if not request.session.get("admin_logged_in"):
        return JSONResponse({"error": "Admin login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            cols = ["ride_id", "user_id", "driver_name", "origin", "destination",
                    "departure", "seats", "notes", "status", "created_at"]
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT ride_id,user_id,driver_name,origin,destination,departure,seats,notes,status,created_at FROM rides ORDER BY created_at DESC LIMIT 500"
                )
                rows = cur.fetchall()
                cur.execute("SELECT status, COUNT(*) FROM rides GROUP BY status")
                counts_rows = cur.fetchall()
            else:
                cur = conn.execute(
                    "SELECT ride_id,user_id,driver_name,origin,destination,departure,seats,notes,status,created_at FROM rides ORDER BY created_at DESC LIMIT 500"
                )
                rows = cur.fetchall()
                counts_cur = conn.execute("SELECT status, COUNT(*) FROM rides GROUP BY status")
                counts_rows = counts_cur.fetchall()
        finally:
            conn.close()

    rides = [dict(zip(cols, row)) for row in rows]
    counts = {r[0]: r[1] for r in counts_rows}
    total = sum(counts.values())
    return JSONResponse({
        "rides": rides,
        "stats": {
            "total": total,
            "open": counts.get("open", 0),
            "taken": counts.get("taken", 0),
            "cancelled": counts.get("cancelled", 0),
        },
    })


@fastapi_app.delete("/api/admin/rides/{ride_id}")
async def api_admin_delete_ride(request: Request, ride_id: str):
    """Cancel any ride (admin only)."""
    if not request.session.get("admin_logged_in"):
        return JSONResponse({"error": "Admin login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            ph = "%s" if USE_POSTGRES else "?"
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(f"SELECT ride_id FROM rides WHERE ride_id={ph}", (ride_id,))
                row = cur.fetchone()
                if row is None:
                    return JSONResponse({"error": "Ride not found."}, status_code=404)
                cur.execute(f"UPDATE rides SET status='cancelled' WHERE ride_id={ph}", (ride_id,))
            else:
                cur = conn.execute(f"SELECT ride_id FROM rides WHERE ride_id={ph}", (ride_id,))
                row = cur.fetchone()
                if row is None:
                    return JSONResponse({"error": "Ride not found."}, status_code=404)
                conn.execute(f"UPDATE rides SET status='cancelled' WHERE ride_id={ph}", (ride_id,))
            conn.commit()
        finally:
            conn.close()

    asyncio.ensure_future(sio.emit("ride_cancelled", {"ride_id": ride_id}))
    return JSONResponse({"ok": True})


# =========================================================
# DRIVER GEOLOCATION MODULE
# =========================================================

class _DriverLocationUpdate(BaseModel):
    lat:   float
    lng:   float
    empty: bool = True  # True = car is empty / available
    seats: int  = 0     # Number of empty seats available


@fastapi_app.post("/api/driver/location")
async def api_driver_location(request: Request, body: _DriverLocationUpdate):
    """Driver broadcasts their current location. Notifies nearby connected users.

    Requires an approved driver application (verified driver).
    """
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if user is None or user.get("role") != "driver":
        return JSONResponse({"error": "Only registered drivers can broadcast location."}, status_code=403)

    ts = time.time()
    with _driver_loc_lock:
        _driver_locations[user_id] = {
            "user_id":  user_id,
            "name":     user["name"],
            "lat":      body.lat,
            "lng":      body.lng,
            "empty":    body.empty,
            "seats":    body.seats,
            "verified": True,
            "ts":       ts,
        }

    # Notify nearby users who have shared their location.
    # We include the driver's coordinates in the event so the client-side can
    # do its own proximity check before surfacing the alert.
    seats_label = f"{body.seats} empty seat{'s' if body.seats != 1 else ''}" if body.empty and body.seats > 0 else ("has empty seats" if body.empty else "is occupied")
    notification = {
        "driver_id":   user_id,
        "driver_name": user["name"],
        "lat":         body.lat,
        "lng":         body.lng,
        "empty":       body.empty,
        "seats":       body.seats,
        "radius_km":   _APP_USER_PROXIMITY_KM,
        "message":     f"Driver {user['name']} is nearby and {seats_label}!",
    }
    # Emit to users who have previously identified themselves via socket.
    # For each identified socket, only notify if the user has a stored location
    # within APP_USER_PROXIMITY_KM; otherwise fall back to broadcasting.
    targets_sent = False
    with _socket_user_lock:
        identified_sids = list(_sid_to_user.items())

    async def _notify():
        nonlocal targets_sent
        for sid, uid in identified_sids:
            u = _get_app_user(uid)
            # Only notify passengers — skip all drivers (including the
            # broadcasting driver, who is also a driver role).
            if u is None or u.get("role") == "driver":
                continue
            if u.get("location_lat") is not None and u.get("location_lng") is not None:
                dist = _haversine_km(body.lat, body.lng, u["location_lat"], u["location_lng"])
                if dist <= _APP_USER_PROXIMITY_KM:
                    await sio.emit("driver_nearby", notification, room=sid)
                    targets_sent = True
        if not targets_sent:
            # No location-aware passengers connected — broadcast to all identified
            # passengers (those without a stored location), skipping all drivers.
            for sid, uid in identified_sids:
                u = _get_app_user(uid)
                if u is None or u.get("role") == "driver":
                    continue
                await sio.emit("driver_nearby", notification, room=sid)
                targets_sent = True
        if not targets_sent:
            # Absolutely no identified passengers — broadcast to all anonymous sockets
            await sio.emit("driver_nearby", notification)

    asyncio.ensure_future(_notify())

    return JSONResponse({"ok": True, "ts": ts})


@fastapi_app.get("/api/driver/nearby")
async def api_driver_nearby(request: Request, lat: float, lng: float, radius_km: float = 10.0):
    """Return drivers who are within *radius_km* of the given coordinates."""
    now = time.time()
    with _driver_loc_lock:
        # Evict stale entries
        stale = [uid for uid, d in _driver_locations.items() if now - d["ts"] > _DRIVER_LOC_TTL_SECS]
        for uid in stale:
            del _driver_locations[uid]

        nearby = []
        for d in _driver_locations.values():
            dist = _haversine_km(lat, lng, d["lat"], d["lng"])
            if dist <= radius_km:
                nearby.append({**d, "distance_km": round(dist, 2), "ts": None})

    return JSONResponse({"drivers": nearby})


@fastapi_app.get("/api/driver/locations")
async def api_driver_locations():
    """Return all active (non-stale) driver locations (public)."""
    now = time.time()
    with _driver_loc_lock:
        active = [
            {**d, "ts": None}
            for d in _driver_locations.values()
            if now - d["ts"] <= _DRIVER_LOC_TTL_SECS
        ]
    return JSONResponse({"drivers": active})


@fastapi_app.get("/api/unified_map/nearby")
async def api_unified_map_nearby(lat: float, lng: float, radius_km: float = 25.0, mode: str = "drivers"):
    """Return nearby drivers sorted by distance, for the unified map."""
    now = time.time()
    with _driver_loc_lock:
        active = [
            {**d, "ts": None}
            for d in _driver_locations.values()
            if now - d["ts"] <= _DRIVER_LOC_TTL_SECS
        ]
    items = []
    for d in active:
        dist = _haversine_km(lat, lng, d["lat"], d["lng"])
        if dist <= radius_km:
            items.append({
                "id": d.get("user_id"),
                "name": d.get("name", "Driver"),
                "lat": d["lat"],
                "lng": d["lng"],
                "distance_km": round(dist, 2),
                "empty": d.get("empty", True),
                "seats": d.get("seats", 0),
                "vehicle": d.get("vehicle", ""),
                "avatar": d.get("avatar", "\U0001f697"),
                "rating": d.get("rating"),
            })
    items.sort(key=lambda x: x["distance_km"])
    return JSONResponse({"items": items, "mode": "drivers"})

# =========================================================
# DIRECT MESSAGING (DM) ENDPOINTS
# =========================================================

class _DMSendRequest(BaseModel):
    conv_id: str
    content: str
    reply_to_id: str | None = None

class _DMStartRequest(BaseModel):
    other_user_id: str


def _get_dm_conversation(conv_id: str) -> dict | None:
    """Return the conversation row as a dict or None."""
    with _db_lock:
        conn = _get_db()
        try:
            cur = _execute(
                conn,
                "SELECT conv_id,user1_id,user2_id,unread_u1,unread_u2,created_at FROM dm_conversations WHERE conv_id=?"
                if not USE_POSTGRES else
                "SELECT conv_id,user1_id,user2_id,unread_u1,unread_u2,created_at FROM dm_conversations WHERE conv_id=%s",
                (conv_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return dict(zip(["conv_id","user1_id","user2_id","unread_u1","unread_u2","created_at"], row))
        finally:
            conn.close()


def _dm_increment_unread(conn, conv: dict, recipient_id: str) -> None:
    """Increment the unread counter for `recipient_id` in a DM conversation (within an open connection)."""
    if recipient_id == conv["user1_id"]:
        if USE_POSTGRES:
            conn.cursor().execute("UPDATE dm_conversations SET unread_u1=unread_u1+1 WHERE conv_id=%s", (conv["conv_id"],))
        else:
            conn.execute("UPDATE dm_conversations SET unread_u1=unread_u1+1 WHERE conv_id=?", (conv["conv_id"],))
    else:
        if USE_POSTGRES:
            conn.cursor().execute("UPDATE dm_conversations SET unread_u2=unread_u2+1 WHERE conv_id=%s", (conv["conv_id"],))
        else:
            conn.execute("UPDATE dm_conversations SET unread_u2=unread_u2+1 WHERE conv_id=?", (conv["conv_id"],))


def _dm_reset_unread(conn, conv: dict, reader_id: str) -> None:
    """Reset the unread counter for `reader_id` in a DM conversation (within an open connection)."""
    if reader_id == conv["user1_id"]:
        if USE_POSTGRES:
            conn.cursor().execute("UPDATE dm_conversations SET unread_u1=0 WHERE conv_id=%s", (conv["conv_id"],))
        else:
            conn.execute("UPDATE dm_conversations SET unread_u1=0 WHERE conv_id=?", (conv["conv_id"],))
    else:
        if USE_POSTGRES:
            conn.cursor().execute("UPDATE dm_conversations SET unread_u2=0 WHERE conv_id=%s", (conv["conv_id"],))
        else:
            conn.execute("UPDATE dm_conversations SET unread_u2=0 WHERE conv_id=?", (conv["conv_id"],))


def _find_or_create_conversation(user_a: str, user_b: str) -> dict:
    """Find an existing conversation between two users, or create one."""
    # Canonical order: smaller user_id is user1 so we get a unique pair
    u1, u2 = (user_a, user_b) if user_a < user_b else (user_b, user_a)
    with _db_lock:
        conn = _get_db()
        try:
            cur = _execute(
                conn,
                "SELECT conv_id,user1_id,user2_id,unread_u1,unread_u2,created_at FROM dm_conversations WHERE user1_id=? AND user2_id=?"
                if not USE_POSTGRES else
                "SELECT conv_id,user1_id,user2_id,unread_u1,unread_u2,created_at FROM dm_conversations WHERE user1_id=%s AND user2_id=%s",
                (u1, u2),
            )
            row = cur.fetchone()
            if row:
                return dict(zip(["conv_id","user1_id","user2_id","unread_u1","unread_u2","created_at"], row))
            # Create new
            conv_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat()
            _execute(
                conn,
                "INSERT INTO dm_conversations (conv_id,user1_id,user2_id,unread_u1,unread_u2,created_at) VALUES (?,?,?,0,0,?)"
                if not USE_POSTGRES else
                "INSERT INTO dm_conversations (conv_id,user1_id,user2_id,unread_u1,unread_u2,created_at) VALUES (%s,%s,%s,0,0,%s)",
                (conv_id, u1, u2, now),
            )
            conn.commit()
            return {"conv_id": conv_id, "user1_id": u1, "user2_id": u2, "unread_u1": 0, "unread_u2": 0, "created_at": now}
        finally:
            conn.close()


@fastapi_app.get("/api/dm/conversations")
async def api_dm_list_conversations(request: Request, search: str | None = None):
    """List all DM conversations for the current user, with last-message preview.

    Optional query param ``search`` filters by participant name or message content.
    """
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            cur = _execute(
                conn,
                "SELECT conv_id,user1_id,user2_id,unread_u1,unread_u2,created_at FROM dm_conversations WHERE user1_id=? OR user2_id=?"
                if not USE_POSTGRES else
                "SELECT conv_id,user1_id,user2_id,unread_u1,unread_u2,created_at FROM dm_conversations WHERE user1_id=%s OR user2_id=%s",
                (user_id, user_id),
            )
            rows = cur.fetchall()
        finally:
            conn.close()

    search_lower = search.lower().strip() if search else None

    conversations = []
    for row in rows:
        conv = dict(zip(["conv_id","user1_id","user2_id","unread_u1","unread_u2","created_at"], row))
        other_id = conv["user2_id"] if conv["user1_id"] == user_id else conv["user1_id"]
        other = _get_app_user(other_id)
        unread = conv["unread_u1"] if conv["user1_id"] == user_id else conv["unread_u2"]

        # Get last message
        with _db_lock:
            conn = _get_db()
            try:
                cur = _execute(
                    conn,
                    "SELECT msg_id,sender_id,content,status,reply_to_id,ts FROM dm_messages WHERE conv_id=? ORDER BY ts DESC LIMIT 1"
                    if not USE_POSTGRES else
                    "SELECT msg_id,sender_id,content,status,reply_to_id,ts FROM dm_messages WHERE conv_id=%s ORDER BY ts DESC LIMIT 1",
                    (conv["conv_id"],),
                )
                lm = cur.fetchone()
            finally:
                conn.close()

        last_msg = None
        if lm:
            last_msg = dict(zip(["msg_id","sender_id","content","status","reply_to_id","ts"], lm))

        other_name = other["name"] if other else other_id
        other_username = (other.get("username") or other_name) if other else other_id

        # Apply search filter: match participant name/username or last message content
        if search_lower:
            name_match = search_lower in other_name.lower() or search_lower in other_username.lower()
            msg_match  = last_msg and search_lower in (last_msg.get("content") or "").lower()
            if not name_match and not msg_match:
                continue

        # Augment last_message with sender username for preview display
        if last_msg:
            sender = _get_app_user(last_msg["sender_id"])
            last_msg["sender_username"] = (sender.get("username") or sender.get("name") or last_msg["sender_id"]) if sender else last_msg["sender_id"]

        conversations.append({
            "conv_id":      conv["conv_id"],
            "other_user":   {"user_id": other_id, "name": other_name, "username": other_username, "online_status": "offline"},
            "unread_count": unread,
            "last_message": last_msg,
            "created_at":   conv["created_at"],
        })

    # Sort by last message timestamp (most recent first)
    conversations.sort(key=lambda c: (c["last_message"]["ts"] if c["last_message"] else 0), reverse=True)
    return JSONResponse({"conversations": conversations})


@fastapi_app.get("/api/dm/contacts")
async def api_dm_contacts(request: Request):
    """Return the list of users the current user has previously messaged.

    Results are sorted by most recent interaction. Use this to populate the
    '+ New Message' picker with previously communicated contacts.
    """
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            cur = _execute(
                conn,
                "SELECT conv_id,user1_id,user2_id,created_at FROM dm_conversations WHERE user1_id=? OR user2_id=?"
                if not USE_POSTGRES else
                "SELECT conv_id,user1_id,user2_id,created_at FROM dm_conversations WHERE user1_id=%s OR user2_id=%s",
                (user_id, user_id),
            )
            rows = cur.fetchall()
        finally:
            conn.close()

    contacts = []
    for row in rows:
        conv_id, u1, u2, created_at = row
        other_id = u2 if u1 == user_id else u1
        # Get last message timestamp for sorting
        with _db_lock:
            conn = _get_db()
            try:
                cur = _execute(
                    conn,
                    "SELECT ts FROM dm_messages WHERE conv_id=? ORDER BY ts DESC LIMIT 1"
                    if not USE_POSTGRES else
                    "SELECT ts FROM dm_messages WHERE conv_id=%s ORDER BY ts DESC LIMIT 1",
                    (conv_id,),
                )
                lm = cur.fetchone()
            finally:
                conn.close()
        last_ts = lm[0] if lm else 0

        other = _get_app_user(other_id)
        contacts.append({
            "user_id":      other_id,
            "name":         other["name"] if other else other_id,
            "username":     (other.get("username") or other["name"]) if other else other_id,
            "conv_id":      conv_id,
            "last_message_ts": last_ts,
        })

    # Sort by most recent interaction
    contacts.sort(key=lambda c: c["last_message_ts"], reverse=True)
    return JSONResponse({"contacts": contacts})


@fastapi_app.post("/api/dm/conversations")
async def api_dm_start_conversation(request: Request, body: _DMStartRequest):
    """Find or create a DM conversation with another user."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)
    other_id = body.other_user_id.strip()
    if not other_id or other_id == user_id:
        return JSONResponse({"error": "Invalid user."}, status_code=400)
    other = _get_app_user(other_id)
    if not other:
        return JSONResponse({"error": "User not found."}, status_code=404)
    conv = _find_or_create_conversation(user_id, other_id)
    return JSONResponse({"conv": conv})


@fastapi_app.get("/api/dm/conversations/{conv_id}/messages")
async def api_dm_get_messages(request: Request, conv_id: str):
    """Get messages in a DM conversation (requires auth and participation)."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)
    conv = _get_dm_conversation(conv_id)
    if not conv:
        return JSONResponse({"error": "Conversation not found."}, status_code=404)
    if user_id not in (conv["user1_id"], conv["user2_id"]):
        return JSONResponse({"error": "Access denied."}, status_code=403)

    with _db_lock:
        conn = _get_db()
        try:
            cur = _execute(
                conn,
                "SELECT msg_id,conv_id,sender_id,content,status,reply_to_id,ts,created_at FROM dm_messages WHERE conv_id=? ORDER BY ts ASC LIMIT 200"
                if not USE_POSTGRES else
                "SELECT msg_id,conv_id,sender_id,content,status,reply_to_id,ts,created_at FROM dm_messages WHERE conv_id=%s ORDER BY ts ASC LIMIT 200",
                (conv_id,),
            )
            cols = ["msg_id","conv_id","sender_id","content","status","reply_to_id","ts","created_at"]
            messages = [dict(zip(cols, r)) for r in cur.fetchall()]
        finally:
            conn.close()

    return JSONResponse({"messages": messages, "conv": conv})


@fastapi_app.post("/api/dm/send")
async def api_dm_send(request: Request, body: _DMSendRequest):
    """Send a DM message in a conversation."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)
    content = body.content.strip()[:4000]  # 4000 chars to accommodate E2E encrypted payloads (base64)
    if not content:
        return JSONResponse({"error": "Message cannot be empty."}, status_code=400)
    conv = _get_dm_conversation(body.conv_id)
    if not conv:
        return JSONResponse({"error": "Conversation not found."}, status_code=404)
    if user_id not in (conv["user1_id"], conv["user2_id"]):
        return JSONResponse({"error": "Access denied."}, status_code=403)

    msg_id   = str(uuid.uuid4())
    ts       = time.time()
    now      = datetime.now(timezone.utc).isoformat()
    reply_to = body.reply_to_id or None
    other_id = conv["user2_id"] if conv["user1_id"] == user_id else conv["user1_id"]

    with _db_lock:
        conn = _get_db()
        try:
            _execute(
                conn,
                "INSERT OR IGNORE INTO dm_messages (msg_id,conv_id,sender_id,content,status,reply_to_id,ts,created_at) VALUES (?,?,?,?,'sent',?,?,?)"
                if not USE_POSTGRES else
                "INSERT INTO dm_messages (msg_id,conv_id,sender_id,content,status,reply_to_id,ts,created_at) VALUES (%s,%s,%s,%s,'sent',%s,%s,%s) ON CONFLICT (msg_id) DO NOTHING",
                (msg_id, body.conv_id, user_id, content, reply_to, ts, now),
            )
            # Increment unread for the other participant
            _dm_increment_unread(conn, conv, other_id)
            conn.commit()
        finally:
            conn.close()

    msg = {
        "msg_id":      msg_id,
        "conv_id":     body.conv_id,
        "sender_id":   user_id,
        "content":     content,
        "status":      "sent",
        "reply_to_id": reply_to,
        "ts":          ts,
    }

    # Push real-time delivery to the conversation room
    room = f"dm_{body.conv_id}"
    await sio.emit("dm_message", msg, room=room)

    # Notify the other user if they are online (not in the room)
    with _socket_user_lock:
        other_sid = _user_to_sid.get(other_id)
    if other_sid:
        me = _get_app_user(user_id)
        sender_name = me["name"] if me else "Someone"
        await sio.emit(
            "dm_notification",
            {"conv_id": body.conv_id, "from": sender_name, "preview": content[:80]},
            room=other_sid,
        )

    return JSONResponse({"ok": True, "message": msg})


@fastapi_app.post("/api/dm/read/{conv_id}")
async def api_dm_mark_read(request: Request, conv_id: str):
    """Mark all messages in a conversation as read for the current user."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)
    conv = _get_dm_conversation(conv_id)
    if not conv:
        return JSONResponse({"error": "Conversation not found."}, status_code=404)
    if user_id not in (conv["user1_id"], conv["user2_id"]):
        return JSONResponse({"error": "Access denied."}, status_code=403)

    with _db_lock:
        conn = _get_db()
        try:
            # Update message status for messages sent by the other participant
            other_id = conv["user2_id"] if conv["user1_id"] == user_id else conv["user1_id"]
            _execute(
                conn,
                "UPDATE dm_messages SET status='read' WHERE conv_id=? AND sender_id=? AND status!='read'"
                if not USE_POSTGRES else
                "UPDATE dm_messages SET status='read' WHERE conv_id=%s AND sender_id=%s AND status!='read'",
                (conv_id, other_id),
            )
            # Reset unread counter for the current user
            _dm_reset_unread(conn, conv, user_id)
            conn.commit()
        finally:
            conn.close()

    # Notify the other side that messages are read
    room = f"dm_{conv_id}"
    await sio.emit("dm_read", {"conv_id": conv_id, "reader_id": user_id}, room=room)
    return JSONResponse({"ok": True})


@fastapi_app.delete("/api/dm/conversations/{conv_id}")
async def api_dm_delete_conversation(request: Request, conv_id: str):
    """Delete a DM conversation and all its messages for the current user."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)
    conv = _get_dm_conversation(conv_id)
    if not conv:
        return JSONResponse({"error": "Conversation not found."}, status_code=404)
    if user_id not in (conv["user1_id"], conv["user2_id"]):
        return JSONResponse({"error": "Access denied."}, status_code=403)

    with _db_lock:
        conn = _get_db()
        try:
            _execute(
                conn,
                "DELETE FROM dm_messages WHERE conv_id=?" if not USE_POSTGRES else "DELETE FROM dm_messages WHERE conv_id=%s",
                (conv_id,),
            )
            _execute(
                conn,
                "DELETE FROM dm_conversations WHERE conv_id=?" if not USE_POSTGRES else "DELETE FROM dm_conversations WHERE conv_id=%s",
                (conv_id,),
            )
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


@fastapi_app.get("/api/users/list")
async def api_list_users(request: Request):
    """Return a list of all registered users (name + user_id) for starting new conversations."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)
    with _db_lock:
        conn = _get_db()
        try:
            cur = _execute(
                conn,
                "SELECT user_id, name FROM app_users WHERE user_id!=? ORDER BY name ASC"
                if not USE_POSTGRES else
                "SELECT user_id, name FROM app_users WHERE user_id!=%s ORDER BY name ASC",
                (user_id,),
            )
            rows = cur.fetchall()
        finally:
            conn.close()
    users = [{"user_id": r[0], "name": r[1]} for r in rows]
    return JSONResponse({"users": users})


@fastapi_app.get("/api/users/search")
async def api_search_users(request: Request, q: str = ""):
    """Search users by username or name for DM autocomplete. Returns up to 15 matches."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)
    q = q.strip()
    if not q:
        return JSONResponse({"users": []})
    pattern = f"%{q}%"
    with _db_lock:
        conn = _get_db()
        try:
            cur = _execute(
                conn,
                "SELECT user_id, name, username FROM app_users WHERE user_id!=? AND (username LIKE ? OR name LIKE ?) ORDER BY name ASC LIMIT 15"
                if not USE_POSTGRES else
                "SELECT user_id, name, username FROM app_users WHERE user_id!=%s AND (username ILIKE %s OR name ILIKE %s) ORDER BY name ASC LIMIT 15",
                (user_id, pattern, pattern),
            )
            rows = cur.fetchall()
        finally:
            conn.close()
    users = [{"user_id": r[0], "name": r[1], "username": r[2] or r[1]} for r in rows]
    return JSONResponse({"users": users})


# =========================================================
# SOCKET.IO EVENTS
# =========================================================

@sio.event
async def connect(sid, environ):
    """Handle client connection"""
    logger.info(f"Client connected: {sid}")

@sio.event
async def disconnect(sid):
    """Handle client disconnection"""
    logger.info(f"Client disconnected: {sid}")
    with _socket_user_lock:
        user_id = _sid_to_user.pop(sid, None)
        if user_id:
            _user_to_sid.pop(user_id, None)

@sio.on("subscribe")
async def on_subscribe(sid, data):
    """Subscribe to download updates"""
    download_id = data.get("download_id") if isinstance(data, dict) else None
    if download_id:
        sio.enter_room(sid, download_id)
        await sio.emit("subscribed", {"id": download_id}, room=sid)
        logger.info(f"Client {sid} subscribed to {download_id}")

@sio.on("identify")
async def on_identify(sid, data):
    """Associate a socket connection with a logged-in user for targeted notifications."""
    user_id = data.get("user_id") if isinstance(data, dict) else None
    if user_id:
        with _socket_user_lock:
            _sid_to_user[sid] = user_id
            _user_to_sid[user_id] = sid
        await sio.emit("identified", {"user_id": user_id}, room=sid)
        logger.info(f"Socket {sid} identified as user {user_id}")


# ── Ride live-chat ──────────────────────────────────────────────────────────

@sio.on("join_ride_chat")
async def on_join_ride_chat(sid, data):
    """Subscribe the caller to a ride's chat room and send recent message history."""
    ride_id = data.get("ride_id") if isinstance(data, dict) else None
    if not ride_id:
        return
    room = f"ride_chat_{ride_id}"
    sio.enter_room(sid, room)
    sender_name = data.get("name", "Someone")

    # Load recent persisted messages
    history = []
    try:
        with _db_lock:
            conn = _get_db()
            try:
                cols = ["msg_id", "ride_id", "sender_name", "sender_role",
                        "text", "media_type", "media_data", "lat", "lng", "ts"]
                if USE_POSTGRES:
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT msg_id,ride_id,sender_name,sender_role,text,media_type,media_data,lat,lng,ts"
                        " FROM ride_chat_messages WHERE ride_id=%s ORDER BY ts ASC LIMIT 50",
                        (ride_id,),
                    )
                    rows = cur.fetchall()
                else:
                    cur = conn.execute(
                        "SELECT msg_id,ride_id,sender_name,sender_role,text,media_type,media_data,lat,lng,ts"
                        " FROM ride_chat_messages WHERE ride_id=? ORDER BY ts ASC LIMIT 50",
                        (ride_id,),
                    )
                    rows = cur.fetchall()
                for row in rows:
                    d = dict(zip(cols, row))
                    d["name"] = d.pop("sender_name")
                    d["role"] = d.pop("sender_role")
                    d["id"]   = d.pop("msg_id")
                    history.append(d)
                _resolve_chat_media(history)
            finally:
                conn.close()
    except Exception as e:
        logger.warning(f"Failed to load ride chat history: {e}")

    await sio.emit("ride_chat_joined", {
        "ride_id": ride_id, "name": sender_name, "history": history,
    }, room=sid)
    logger.info(f"Socket {sid} joined ride chat room {room} ({len(history)} history messages)")


@sio.on("leave_ride_chat")
async def on_leave_ride_chat(sid, data):
    """Unsubscribe the caller from a ride's chat room."""
    ride_id = data.get("ride_id") if isinstance(data, dict) else None
    if not ride_id:
        return
    room = f"ride_chat_{ride_id}"
    sio.leave_room(sid, room)
    logger.info(f"Socket {sid} left ride chat room {room}")


@sio.on("ride_chat_message")
async def on_ride_chat_message(sid, data):
    """Broadcast a chat message to all members of a ride's chat room.

    Supports text, image (media_type='image'), audio (media_type='audio'),
    and location (media_type='location') payloads.
    Persists the message and notifies the ride poster when the sender is
    a different user.
    """
    if not isinstance(data, dict):
        return
    ride_id    = data.get("ride_id")
    text       = str(data.get("text", "")).strip()
    name       = str(data.get("name", "Anonymous")).strip()
    role       = str(data.get("role", "passenger")).strip()
    msg_id     = data.get("id") or f"{time.time()}-{sid}"
    media_type = data.get("media_type")  # 'image' | 'audio' | 'location' | None
    media_data = data.get("media_data")  # base64 string for image/audio
    msg_lat    = data.get("lat")         # float, for location messages
    msg_lng    = data.get("lng")         # float, for location messages

    # Require either text or media
    if not ride_id or (not text and not media_type):
        return

    # Validate media_type
    _ALLOWED_MEDIA = {"image", "audio", "location"}
    if media_type and media_type not in _ALLOWED_MEDIA:
        media_type = None

    # Cap text length; limit base64 payload to ~1 MB
    text = text[:500]
    if media_data and len(media_data) > 1_400_000:
        media_data = None

    # When S3 is configured, upload image/audio media to the bucket and store
    # the S3 object key in place of the raw base64 payload.  This keeps large
    # binary blobs out of the database and ensures persistence across restarts.
    _MEDIA_TYPE_INFO = {
        "image": ("jpg",  "image/jpeg"),
        "audio": ("webm", "audio/webm"),
    }
    db_media_data = media_data  # value written to the database
    if _S3_ENABLED and media_data and media_type in _MEDIA_TYPE_INFO:
        try:
            raw_bytes = base64.b64decode(media_data)
            ext, mime = _MEDIA_TYPE_INFO[media_type]
            s3_key = f"chat_media/{msg_id}.{ext}"
            if _s3_upload_bytes(raw_bytes, s3_key, mime):
                db_media_data = s3_key  # store only the S3 key in the DB
        except Exception as _exc:
            logger.warning("Failed to upload ride chat media to S3: %s", _exc)

    ts = time.time()
    msg = {
        "ride_id":    ride_id,
        "name":       name,
        "text":       text,
        "ts":         ts,
        "role":       role,
        "id":         msg_id,
        "media_type": media_type,
        "media_data": media_data,
        "lat":        msg_lat,
        "lng":        msg_lng,
    }

    # Persist the message to the database
    created = datetime.now(timezone.utc).isoformat()
    try:
        with _db_lock:
            conn = _get_db()
            try:
                if USE_POSTGRES:
                    cur = conn.cursor()
                    cur.execute(
                        "INSERT INTO ride_chat_messages"
                        " (msg_id,ride_id,sender_name,sender_role,text,media_type,media_data,lat,lng,ts,created_at)"
                        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
                        " ON CONFLICT (msg_id) DO NOTHING",
                        (msg_id, ride_id, name, role, text or None, media_type, db_media_data,
                         msg_lat, msg_lng, ts, created),
                    )
                else:
                    conn.execute(
                        "INSERT OR IGNORE INTO ride_chat_messages"
                        " (msg_id,ride_id,sender_name,sender_role,text,media_type,media_data,lat,lng,ts,created_at)"
                        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (msg_id, ride_id, name, role, text or None, media_type, db_media_data,
                         msg_lat, msg_lng, ts, created),
                    )
                conn.commit()
            finally:
                conn.close()
    except Exception as e:
        logger.warning(f"Failed to persist ride chat message: {e}")

    # Notify the ride poster if the sender is a different user
    try:
        with _db_lock:
            conn = _get_db()
            try:
                if USE_POSTGRES:
                    cur = conn.cursor()
                    cur.execute("SELECT user_id FROM rides WHERE ride_id=%s", (ride_id,))
                    row = cur.fetchone()
                else:
                    cur = conn.execute("SELECT user_id FROM rides WHERE ride_id=?", (ride_id,))
                    row = cur.fetchone()
                poster_user_id = row[0] if row else None
            finally:
                conn.close()

        if poster_user_id:
            # Check if sender is the poster
            poster = _get_app_user(poster_user_id)
            if poster and poster.get("name") != name:
                # Notify poster about new message
                preview = text if text else f"[{media_type}]" if media_type else ""
                notif_id = _create_notification(
                    poster_user_id,
                    "chat_message",
                    f"New message from {name}",
                    f"Ride: {ride_id[:8]}… — {preview[:80]}",
                    link=f"#inbox",
                    link_label="View in Inbox",
                )
                # Push real-time notification to the poster's socket if online
                with _socket_user_lock:
                    poster_sid = _user_to_sid.get(poster_user_id)
                if poster_sid:
                    await sio.emit(
                        "ride_chat_notification",
                        {
                            "notif_id": notif_id,
                            "ride_id":  ride_id,
                            "from":     name,
                            "preview":  preview[:80],
                        },
                        room=poster_sid,
                    )
    except Exception as e:
        logger.warning(f"Failed to notify ride poster of chat message: {e}")

    room = f"ride_chat_{ride_id}"
    await sio.emit("ride_chat_message", msg, room=room)
    log_preview = text[:80] if text else f"[{media_type}]"
    logger.info(f"Ride chat [{ride_id}] from {name}: {log_preview}")

    # Auto-response: when a passenger sends their first message in the chat,
    # immediately reply with a structured booking prompt so the driver (or
    # system) collects all required details without back-and-forth friction.
    if role != "driver" and text:
        try:
            with _db_lock:
                conn = _get_db()
                try:
                    if USE_POSTGRES:
                        cur = conn.cursor()
                        cur.execute(
                            "SELECT COUNT(*) FROM ride_chat_messages"
                            " WHERE ride_id=%s AND sender_role != 'driver'",
                            (ride_id,),
                        )
                        passenger_msg_count = cur.fetchone()[0]
                    else:
                        cur = conn.execute(
                            "SELECT COUNT(*) FROM ride_chat_messages"
                            " WHERE ride_id=? AND sender_role != 'driver'",
                            (ride_id,),
                        )
                        passenger_msg_count = cur.fetchone()[0]
                finally:
                    conn.close()

            if passenger_msg_count == 1:
                # This is the passenger's first message — send the auto-response.
                auto_id = f"auto-{ride_id}-{time.time()}"
                auto_msg = {
                    "ride_id":    ride_id,
                    "name":       "System",
                    "text":       (
                        "Please share your current location, full name, and "
                        "contact number to complete your booking."
                    ),
                    "ts":         time.time(),
                    "role":       "system",
                    "id":         auto_id,
                    "media_type": None,
                    "media_data": None,
                    "lat":        None,
                    "lng":        None,
                }
                auto_created = datetime.now(timezone.utc).isoformat()
                with _db_lock:
                    conn = _get_db()
                    try:
                        if USE_POSTGRES:
                            cur = conn.cursor()
                            cur.execute(
                                "INSERT INTO ride_chat_messages"
                                " (msg_id,ride_id,sender_name,sender_role,text,"
                                "  media_type,media_data,lat,lng,ts,created_at)"
                                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
                                " ON CONFLICT (msg_id) DO NOTHING",
                                (auto_id, ride_id, "System", "system",
                                 auto_msg["text"], None, None,
                                 None, None, auto_msg["ts"], auto_created),
                            )
                        else:
                            conn.execute(
                                "INSERT OR IGNORE INTO ride_chat_messages"
                                " (msg_id,ride_id,sender_name,sender_role,text,"
                                "  media_type,media_data,lat,lng,ts,created_at)"
                                " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                                (auto_id, ride_id, "System", "system",
                                 auto_msg["text"], None, None,
                                 None, None, auto_msg["ts"], auto_created),
                            )
                        conn.commit()
                    finally:
                        conn.close()
                await sio.emit("ride_chat_message", auto_msg, room=room)
                logger.info(f"Ride chat [{ride_id}] auto-response sent to {name}")
        except Exception as e:
            logger.warning(f"Failed to send auto-response for ride {ride_id}: {e}")


@sio.on("ride_chat_typing")
async def on_ride_chat_typing(sid, data):
    """Broadcast typing indicator to the ride's chat room (exclude sender)."""
    if not isinstance(data, dict):
        return
    ride_id = data.get("ride_id")
    name    = str(data.get("name", "")).strip()
    if not ride_id or not name:
        return
    room = f"ride_chat_{ride_id}"
    await sio.emit("ride_chat_typing", {"ride_id": ride_id, "name": name}, room=room, skip_sid=sid)


@sio.on("ride_chat_stop_typing")
async def on_ride_chat_stop_typing(sid, data):
    """Broadcast stop-typing event to the ride's chat room."""
    if not isinstance(data, dict):
        return
    ride_id = data.get("ride_id")
    name    = str(data.get("name", "")).strip()
    if not ride_id or not name:
        return
    room = f"ride_chat_{ride_id}"
    await sio.emit("ride_chat_stop_typing", {"ride_id": ride_id, "name": name}, room=room, skip_sid=sid)


@sio.on("ride_chat_read")
async def on_ride_chat_read(sid, data):
    """Broadcast read receipt to the ride's chat room."""
    if not isinstance(data, dict):
        return
    ride_id = data.get("ride_id")
    msg_id  = data.get("msg_id")
    reader  = str(data.get("reader", "")).strip()
    if not ride_id or not msg_id or not reader:
        return
    room = f"ride_chat_{ride_id}"
    await sio.emit("ride_chat_read", {"ride_id": ride_id, "msg_id": msg_id, "reader": reader}, room=room)


# ── Agent live-chat ─────────────────────────────────────────────────────────

@sio.on("agent_chat_join")
async def on_agent_chat_join(sid, data):
    """Subscribe caller to an agent's chat room."""
    if not isinstance(data, dict):
        return
    agent_id = data.get("agent_id")
    user_id  = data.get("user_id")
    if not agent_id:
        return
    room = f"agent_chat_{agent_id}_{user_id}" if user_id else f"agent_chat_{agent_id}"
    sio.enter_room(sid, room)
    await sio.emit("agent_chat_joined", {"agent_id": agent_id, "room": room}, room=sid)


@sio.on("agent_chat_leave")
async def on_agent_chat_leave(sid, data):
    """Unsubscribe caller from an agent's chat room."""
    if not isinstance(data, dict):
        return
    agent_id = data.get("agent_id")
    user_id  = data.get("user_id")
    if not agent_id:
        return
    room = f"agent_chat_{agent_id}_{user_id}" if user_id else f"agent_chat_{agent_id}"
    sio.leave_room(sid, room)


@sio.on("agent_chat_message")
async def on_agent_chat_message(sid, data):
    """Persist and broadcast a chat message between a user and an agent."""
    if not isinstance(data, dict):
        return
    agent_id    = data.get("agent_id")
    user_id     = data.get("user_id")
    sender_role = str(data.get("sender_role", "user"))
    text        = str(data.get("text", "")).strip()[:500]
    if not agent_id or not user_id or not text:
        return
    if sender_role not in ("user", "agent"):
        sender_role = "user"

    msg_id = str(uuid.uuid4())
    ts     = time.time()
    now    = datetime.utcnow().isoformat()

    # Persist message
    try:
        with _db_lock:
            conn = _get_db()
            try:
                if USE_POSTGRES:
                    conn.cursor().execute(
                        "INSERT INTO agent_chat_messages (msg_id,agent_id,user_id,sender_role,text,ts,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                        (msg_id, agent_id, user_id, sender_role, text, ts, now),
                    )
                else:
                    conn.execute(
                        "INSERT OR IGNORE INTO agent_chat_messages (msg_id,agent_id,user_id,sender_role,text,ts,created_at) VALUES (?,?,?,?,?,?,?)",
                        (msg_id, agent_id, user_id, sender_role, text, ts, now),
                    )
                conn.commit()
            finally:
                conn.close()
    except Exception as e:
        logger.warning(f"Failed to persist agent chat message: {e}")

    msg = {"msg_id": msg_id, "agent_id": agent_id, "user_id": user_id,
           "sender_role": sender_role, "text": text, "ts": ts}
    room = f"agent_chat_{agent_id}_{user_id}"
    await sio.emit("agent_chat_message", msg, room=room)

    # Also notify the agent's linked socket if message is from user
    if sender_role == "user":
        agent = _get_agent_row(agent_id)
        if agent and agent.get("user_id"):
            agent_user_id = agent["user_id"]
            with _socket_user_lock:
                agent_sid = _user_to_sid.get(agent_user_id)
            if agent_sid:
                try:
                    await sio.emit("agent_chat_message", msg, room=agent_sid)
                except Exception as e:
                    logger.warning(f"Failed to notify agent of chat message: {e}")

    logger.info(f"Agent chat [{agent_id}] user {user_id}: {text[:80]}")


@sio.on("agent_chat_typing")
async def on_agent_chat_typing(sid, data):
    """Broadcast typing indicator in an agent chat room."""
    if not isinstance(data, dict):
        return
    agent_id = data.get("agent_id")
    user_id  = data.get("user_id")
    name     = str(data.get("name", "")).strip()
    if not agent_id or not user_id:
        return
    room = f"agent_chat_{agent_id}_{user_id}"
    await sio.emit("agent_chat_typing", {"agent_id": agent_id, "user_id": user_id, "name": name}, room=room, skip_sid=sid)


@sio.on("agent_chat_stop_typing")
async def on_agent_chat_stop_typing(sid, data):
    """Broadcast stop-typing in an agent chat room."""
    if not isinstance(data, dict):
        return
    agent_id = data.get("agent_id")
    user_id  = data.get("user_id")
    name     = str(data.get("name", "")).strip()
    if not agent_id or not user_id:
        return
    room = f"agent_chat_{agent_id}_{user_id}"
    await sio.emit("agent_chat_stop_typing", {"agent_id": agent_id, "user_id": user_id, "name": name}, room=room, skip_sid=sid)


@sio.on("agent_profile_visit")
async def on_agent_profile_visit(sid, data):
    """Notify an agent when a client visits their profile page."""
    if not isinstance(data, dict):
        return
    agent_id  = str(data.get("agent_id", "")).strip()
    visitor_id = str(data.get("user_id", "anonymous")).strip()
    if not agent_id:
        return

    # Notify the agent's linked socket if they are online
    agent = _get_agent_row(agent_id)
    if agent and agent.get("user_id"):
        agent_user_id = agent["user_id"]
        with _socket_user_lock:
            agent_sid = _user_to_sid.get(agent_user_id)
        if agent_sid:
            try:
                await sio.emit(
                    "agent_profile_visit_notify",
                    {"agent_id": agent_id, "visitor_id": visitor_id, "ts": time.time()},
                    room=agent_sid,
                )
            except Exception as e:
                logger.warning(f"Failed to notify agent of profile visit: {e}")

    logger.info(f"Agent profile visited: agent {agent_id} by visitor {visitor_id}")


# ── Direct Messaging live-chat ───────────────────────────────────────────────

@sio.on("dm_join")
async def on_dm_join(sid, data):
    """Subscribe caller to a DM conversation room and send recent history."""
    if not isinstance(data, dict):
        return
    conv_id = data.get("conv_id")
    if not conv_id:
        return
    room = f"dm_{conv_id}"
    sio.enter_room(sid, room)

    # Load recent persisted messages
    history = []
    try:
        with _db_lock:
            conn = _get_db()
            try:
                cur = _execute(
                    conn,
                    "SELECT msg_id,conv_id,sender_id,content,status,reply_to_id,ts FROM dm_messages WHERE conv_id=? ORDER BY ts ASC LIMIT 100"
                    if not USE_POSTGRES else
                    "SELECT msg_id,conv_id,sender_id,content,status,reply_to_id,ts FROM dm_messages WHERE conv_id=%s ORDER BY ts ASC LIMIT 100",
                    (conv_id,),
                )
                cols = ["msg_id","conv_id","sender_id","content","status","reply_to_id","ts"]
                history = [dict(zip(cols, r)) for r in cur.fetchall()]
            finally:
                conn.close()
    except Exception as e:
        logger.warning(f"Failed to load DM history: {e}")

    await sio.emit("dm_joined", {"conv_id": conv_id, "history": history}, room=sid)
    logger.info(f"Socket {sid} joined DM room {room} ({len(history)} history messages)")


@sio.on("dm_leave")
async def on_dm_leave(sid, data):
    """Unsubscribe caller from a DM conversation room."""
    if not isinstance(data, dict):
        return
    conv_id = data.get("conv_id")
    if not conv_id:
        return
    sio.leave_room(sid, f"dm_{conv_id}")


@sio.on("dm_message")
async def on_dm_message(sid, data):
    """Persist and broadcast a direct message."""
    if not isinstance(data, dict):
        return
    conv_id    = data.get("conv_id")
    sender_id  = data.get("sender_id")
    content    = str(data.get("content", "")).strip()[:1000]
    reply_to   = data.get("reply_to_id")
    client_id  = data.get("id")  # client-generated optimistic id

    if not conv_id or not sender_id or not content:
        return

    # Verify conversation exists
    conv = _get_dm_conversation(conv_id)
    if not conv or sender_id not in (conv["user1_id"], conv["user2_id"]):
        return

    msg_id = client_id or str(uuid.uuid4())
    ts     = time.time()
    now    = datetime.now(timezone.utc).isoformat()
    other_id = conv["user2_id"] if conv["user1_id"] == sender_id else conv["user1_id"]

    try:
        with _db_lock:
            conn = _get_db()
            try:
                _execute(
                    conn,
                    "INSERT OR IGNORE INTO dm_messages (msg_id,conv_id,sender_id,content,status,reply_to_id,ts,created_at) VALUES (?,?,?,?,'sent',?,?,?)"
                    if not USE_POSTGRES else
                    "INSERT INTO dm_messages (msg_id,conv_id,sender_id,content,status,reply_to_id,ts,created_at) VALUES (%s,%s,%s,%s,'sent',%s,%s,%s) ON CONFLICT (msg_id) DO NOTHING",
                    (msg_id, conv_id, sender_id, content, reply_to, ts, now),
                )
                _dm_increment_unread(conn, conv, other_id)
                conn.commit()
            finally:
                conn.close()
    except Exception as e:
        logger.warning(f"Failed to persist DM message: {e}")

    msg = {
        "msg_id":      msg_id,
        "conv_id":     conv_id,
        "sender_id":   sender_id,
        "content":     content,
        "status":      "sent",
        "reply_to_id": reply_to,
        "ts":          ts,
    }

    room = f"dm_{conv_id}"
    await sio.emit("dm_message", msg, room=room)

    # Notify other user if online
    with _socket_user_lock:
        other_sid = _user_to_sid.get(other_id)
    if other_sid:
        me = _get_app_user(sender_id)
        sender_name = me["name"] if me else "Someone"
        await sio.emit(
            "dm_notification",
            {"conv_id": conv_id, "from": sender_name, "preview": content[:80]},
            room=other_sid,
        )

    logger.info(f"DM [{conv_id}] from {sender_id}: {content[:80]}")


@sio.on("dm_typing")
async def on_dm_typing(sid, data):
    """Broadcast typing indicator in a DM conversation room (exclude sender)."""
    if not isinstance(data, dict):
        return
    conv_id   = data.get("conv_id")
    sender_id = data.get("sender_id")
    if not conv_id or not sender_id:
        return
    room = f"dm_{conv_id}"
    await sio.emit("dm_typing", {"conv_id": conv_id, "sender_id": sender_id}, room=room, skip_sid=sid)


@sio.on("dm_stop_typing")
async def on_dm_stop_typing(sid, data):
    """Broadcast stop-typing indicator in a DM conversation room."""
    if not isinstance(data, dict):
        return
    conv_id   = data.get("conv_id")
    sender_id = data.get("sender_id")
    if not conv_id or not sender_id:
        return
    room = f"dm_{conv_id}"
    await sio.emit("dm_stop_typing", {"conv_id": conv_id, "sender_id": sender_id}, room=room, skip_sid=sid)


@sio.on("dm_read")
async def on_dm_read(sid, data):
    """Mark messages in a DM conversation as read and broadcast the event."""
    if not isinstance(data, dict):
        return
    conv_id   = data.get("conv_id")
    reader_id = data.get("reader_id")
    if not conv_id or not reader_id:
        return

    conv = _get_dm_conversation(conv_id)
    if not conv or reader_id not in (conv["user1_id"], conv["user2_id"]):
        return

    other_id = conv["user2_id"] if conv["user1_id"] == reader_id else conv["user1_id"]

    try:
        with _db_lock:
            conn = _get_db()
            try:
                _execute(
                    conn,
                    "UPDATE dm_messages SET status='read' WHERE conv_id=? AND sender_id=? AND status!='read'"
                    if not USE_POSTGRES else
                    "UPDATE dm_messages SET status='read' WHERE conv_id=%s AND sender_id=%s AND status!='read'",
                    (conv_id, other_id),
                )
                _dm_reset_unread(conn, conv, reader_id)
                conn.commit()
            finally:
                conn.close()
    except Exception as e:
        logger.warning(f"Failed to mark DM messages read: {e}")

    room = f"dm_{conv_id}"
    await sio.emit("dm_read", {"conv_id": conv_id, "reader_id": reader_id}, room=room)


# ── Property Conversation live-chat ─────────────────────────────────────────

@sio.on("prop_conv_join")
async def on_prop_conv_join(sid, data):
    """Subscribe caller to a property conversation room and send recent history.

    Only the two participants of the conversation (buyer and agent) are allowed
    to join.  Any other socket is silently rejected to preserve message privacy.
    """
    if not isinstance(data, dict):
        return
    conv_id = data.get("conv_id")
    if not conv_id:
        return

    # Resolve the authenticated user for this socket connection
    with _socket_user_lock:
        user_id = _sid_to_user.get(sid)

    # Load the conversation record to verify participation
    conv = _get_property_conversation(conv_id)
    if not conv:
        await sio.emit("prop_conv_error", {"conv_id": conv_id, "error": "Conversation not found."}, room=sid)
        return

    # Enforce privacy: only the buyer (user_id) or the agent (agent_id) may join
    if not user_id or user_id not in (conv["user_id"], conv["agent_id"]):
        await sio.emit("prop_conv_error", {"conv_id": conv_id, "error": "Access denied."}, room=sid)
        return

    room = f"prop_conv_{conv_id}"
    sio.enter_room(sid, room)

    history = []
    try:
        with _db_lock:
            conn = _get_db()
            try:
                cur = _execute(
                    conn,
                    "SELECT msg_id,conv_id,sender_id,sender_role,content,ts FROM property_messages WHERE conv_id=? ORDER BY ts ASC LIMIT 100"
                    if not USE_POSTGRES else
                    "SELECT msg_id,conv_id,sender_id,sender_role,content,ts FROM property_messages WHERE conv_id=%s ORDER BY ts ASC LIMIT 100",
                    (conv_id,),
                )
                cols = ["msg_id","conv_id","sender_id","sender_role","content","ts"]
                history = [dict(zip(cols, r)) for r in cur.fetchall()]
            finally:
                conn.close()
    except Exception as e:
        logger.warning(f"Failed to load property conversation history: {e}")

    await sio.emit("prop_conv_joined", {"conv_id": conv_id, "history": history}, room=sid)


@sio.on("prop_conv_leave")
async def on_prop_conv_leave(sid, data):
    """Unsubscribe caller from a property conversation room."""
    if not isinstance(data, dict):
        return
    conv_id = data.get("conv_id")
    if not conv_id:
        return
    sio.leave_room(sid, f"prop_conv_{conv_id}")


@sio.on("prop_conv_typing")
async def on_prop_conv_typing(sid, data):
    """Broadcast typing indicator to property conversation room."""
    if not isinstance(data, dict):
        return
    conv_id   = data.get("conv_id")
    sender_id = data.get("sender_id")
    if not conv_id or not sender_id:
        return
    room = f"prop_conv_{conv_id}"
    await sio.emit("prop_conv_typing", {"conv_id": conv_id, "sender_id": sender_id}, room=room, skip_sid=sid)


@sio.on("prop_conv_stop_typing")
async def on_prop_conv_stop_typing(sid, data):
    """Broadcast stop-typing indicator to property conversation room."""
    if not isinstance(data, dict):
        return
    conv_id   = data.get("conv_id")
    sender_id = data.get("sender_id")
    if not conv_id or not sender_id:
        return
    room = f"prop_conv_{conv_id}"
    await sio.emit("prop_conv_stop_typing", {"conv_id": conv_id, "sender_id": sender_id}, room=room, skip_sid=sid)



# =========================================================
# INITIALIZATION
# =========================================================

logger.info("=" * 50)
logger.info("Starting Ride-Sharing Platform (Production)")
logger.info("=" * 50)

# Warn if ADMIN_PASSWORD was not explicitly set
if not os.environ.get("ADMIN_PASSWORD"):
    logger.warning(
        "WARNING: ADMIN_PASSWORD env var is not set. "
        "A random password has been generated for this session: %s  "
        "Set the ADMIN_PASSWORD environment variable to a persistent strong password before deploying.",
        Config.ADMIN_PASSWORD,
    )

# Log paths
logger.info(f"Root directory: {ROOT_DIR}")
logger.info(f"Templates directory: {TEMPLATES_DIR}")
logger.info(f"Template exists: {os.path.exists(os.path.join(TEMPLATES_DIR, 'index.html'))}")

# Initialise database schema
init_db()
if USE_POSTGRES:
    logger.info("Using PostgreSQL database via DATABASE_URL")
else:
    logger.info(f"Using SQLite database at {DB_PATH}")

if _S3_ENABLED:
    logger.info(
        "S3 object storage enabled: bucket=%s region=%s endpoint=%s",
        BUCKET_NAME,
        BUCKET_REGION or "(default)",
        BUCKET_ENDPOINT or "(AWS)",
    )
else:
    logger.info("S3 object storage disabled (BUCKET_* variables not set)")

logger.info("=" * 50)


# =========================================================
# ERROR HANDLERS
# =========================================================

@fastapi_app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    # For 404s on non-API paths, serve the React SPA so client-side routing works
    if exc.status_code == 404:
        path = request.url.path
        # Only serve SPA for non-API / non-static paths
        api_prefixes = (
            "/admin/db/", "/admin/cookies", "/admin/auth_status", "/admin/has_admin",
            "/admin/api/", "/health", "/ads.txt", "/static/", "/assets/",
            "/api/", "/yotweek.png",
        )
        if not any(path.startswith(p) for p in api_prefixes):
            return _react_index()
        return JSONResponse({"error": "Not found"}, status_code=404)
    if exc.status_code == 500:
        logger.error(f"Internal error: {exc.detail}")
        return JSONResponse({"error": "Internal server error"}, status_code=500)
    return JSONResponse({"error": exc.detail or "Error"}, status_code=exc.status_code)

@fastapi_app.exception_handler(500)
async def internal_error(request: Request, exc):
    logger.error(f"Internal error: {exc}")
    return JSONResponse({"error": "Internal server error"}, status_code=500)

# =========================================================
# BROADCAST MODULE
# =========================================================

_VALID_WAITING_TIMES = ("Leave now", "15 min", "30 min", "1 hour")
_WAITING_TIME_MINUTES = {"Leave now": 0, "15 min": 15, "30 min": 30, "1 hour": 60}

class _BroadcastPostRequest(BaseModel):
    seats: int
    waiting_time: str
    start_destination: str
    end_destination: str
    start_lat: float | None = None
    start_lng: float | None = None
    end_lat: float | None = None
    end_lng: float | None = None
    fare: float | None = None


class _BroadcastUpdateRequest(BaseModel):
    seats: int | None = None
    waiting_time: str | None = None
    fare: float | None = None


class _BookingPayRequest(BaseModel):
    card_last4: str = ""
    payment_method: str = "card"
    billing_name: str = ""
    billing_email: str = ""


@fastapi_app.post("/api/broadcasts")
async def api_broadcast_post(request: Request, body: _BroadcastPostRequest):
    """Post a new ride broadcast. Any logged-in user may broadcast."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required to post a broadcast."}, status_code=401)

    user = _get_app_user(user_id)
    if user is None:
        return JSONResponse({"error": "User not found."}, status_code=404)

    if body.seats < 1 or body.seats > 8:
        return JSONResponse({"error": "Seats must be between 1 and 8."}, status_code=400)

    if body.waiting_time not in _VALID_WAITING_TIMES:
        return JSONResponse(
            {"error": f"waiting_time must be one of: {', '.join(_VALID_WAITING_TIMES)}."},
            status_code=400,
        )

    start = body.start_destination.strip()
    end = body.end_destination.strip()
    if not start or not end:
        return JSONResponse({"error": "start_destination and end_destination are required."}, status_code=400)

    # Auto-calculate fare from distance if coordinates provided and fare not given
    fare = body.fare
    if fare is None and body.start_lat is not None and body.end_lat is not None:
        dist_km = _haversine_km(body.start_lat, body.start_lng, body.end_lat, body.end_lng)
        fare = round(dist_km * _FARE_PER_KM, 2)

    # Calculate expiry based on waiting_time
    minutes = _WAITING_TIME_MINUTES[body.waiting_time]
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(minutes=minutes)).isoformat() if minutes > 0 else now.isoformat()
    created_at = now.isoformat()
    broadcast_id = str(uuid.uuid4())

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO broadcasts (broadcast_id,user_id,poster_name,seats,waiting_time,
                       start_destination,end_destination,start_lat,start_lng,end_lat,end_lng,fare,
                       status,created_at,expires_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'active',%s,%s)""",
                    (broadcast_id, user_id, user["name"], body.seats, body.waiting_time,
                     start, end, body.start_lat, body.start_lng, body.end_lat, body.end_lng,
                     fare, created_at, expires_at),
                )
            else:
                conn.execute(
                    """INSERT INTO broadcasts (broadcast_id,user_id,poster_name,seats,waiting_time,
                       start_destination,end_destination,start_lat,start_lng,end_lat,end_lng,fare,
                       status,created_at,expires_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)""",
                    (broadcast_id, user_id, user["name"], body.seats, body.waiting_time,
                     start, end, body.start_lat, body.start_lng, body.end_lat, body.end_lng,
                     fare, created_at, expires_at),
                )
            conn.commit()
        finally:
            conn.close()

    broadcast_data = {
        "broadcast_id": broadcast_id,
        "user_id": user_id,
        "poster_name": user["name"],
        "seats": body.seats,
        "waiting_time": body.waiting_time,
        "start_destination": start,
        "end_destination": end,
        "start_lat": body.start_lat,
        "start_lng": body.start_lng,
        "end_lat": body.end_lat,
        "end_lng": body.end_lng,
        "fare": fare,
        "per_seat_cost": round(fare / body.seats, 2) if fare is not None else None,
        "status": "active",
        "created_at": created_at,
        "expires_at": expires_at,
    }

    _bucket_write_json("broadcasts", "broadcast", broadcast_id, broadcast_data)

    return JSONResponse({"ok": True, "broadcast_id": broadcast_id}, status_code=201)


@fastapi_app.get("/api/broadcasts")
async def api_broadcasts_list(request: Request, status: str | None = None, mine: bool = False):
    """List broadcasts. Optionally filter by status (active/expired/filled) or own broadcasts."""
    user_id = request.session.get("app_user_id")

    _valid_statuses = ("active", "expired", "filled")
    if status and status not in _valid_statuses:
        return JSONResponse({"error": f"status must be one of: {', '.join(_valid_statuses)}."},
                            status_code=400)

    # Auto-expire broadcasts whose expires_at is in the past
    _expire_stale_broadcasts()

    cols = ["broadcast_id", "user_id", "poster_name", "seats", "waiting_time",
            "start_destination", "end_destination", "start_lat", "start_lng",
            "end_lat", "end_lng", "fare", "status", "created_at", "expires_at"]

    with _db_lock:
        conn = _get_db()
        try:
            if mine and user_id:
                if USE_POSTGRES:
                    cur = conn.cursor()
                    if status:
                        cur.execute(
                            "SELECT broadcast_id,user_id,poster_name,seats,waiting_time,start_destination,end_destination,start_lat,start_lng,end_lat,end_lng,fare,status,created_at,expires_at FROM broadcasts WHERE user_id=%s AND status=%s ORDER BY created_at DESC",
                            (user_id, status),
                        )
                    else:
                        cur.execute(
                            "SELECT broadcast_id,user_id,poster_name,seats,waiting_time,start_destination,end_destination,start_lat,start_lng,end_lat,end_lng,fare,status,created_at,expires_at FROM broadcasts WHERE user_id=%s ORDER BY created_at DESC",
                            (user_id,),
                        )
                else:
                    if status:
                        cur = conn.execute(
                            "SELECT broadcast_id,user_id,poster_name,seats,waiting_time,start_destination,end_destination,start_lat,start_lng,end_lat,end_lng,fare,status,created_at,expires_at FROM broadcasts WHERE user_id=? AND status=? ORDER BY created_at DESC",
                            (user_id, status),
                        )
                    else:
                        cur = conn.execute(
                            "SELECT broadcast_id,user_id,poster_name,seats,waiting_time,start_destination,end_destination,start_lat,start_lng,end_lat,end_lng,fare,status,created_at,expires_at FROM broadcasts WHERE user_id=? ORDER BY created_at DESC",
                            (user_id,),
                        )
            else:
                filter_status = status or "active"
                if USE_POSTGRES:
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT broadcast_id,user_id,poster_name,seats,waiting_time,start_destination,end_destination,start_lat,start_lng,end_lat,end_lng,fare,status,created_at,expires_at FROM broadcasts WHERE status=%s ORDER BY created_at DESC LIMIT 200",
                        (filter_status,),
                    )
                else:
                    cur = conn.execute(
                        "SELECT broadcast_id,user_id,poster_name,seats,waiting_time,start_destination,end_destination,start_lat,start_lng,end_lat,end_lng,fare,status,created_at,expires_at FROM broadcasts WHERE status=? ORDER BY created_at DESC LIMIT 200",
                        (filter_status,),
                    )
            rows = cur.fetchall()
        finally:
            conn.close()

    broadcasts = []
    for row in rows:
        b = dict(zip(cols, row))
        if b["fare"] is not None and b["seats"] and b["seats"] > 0:
            b["per_seat_cost"] = round(b["fare"] / b["seats"], 2)
        else:
            b["per_seat_cost"] = None
        broadcasts.append(b)

    return JSONResponse({"broadcasts": broadcasts})


@fastapi_app.get("/api/broadcasts/{broadcast_id}")
async def api_broadcast_get(broadcast_id: str):
    """Get a single broadcast by ID."""
    cols = ["broadcast_id", "user_id", "poster_name", "seats", "waiting_time",
            "start_destination", "end_destination", "start_lat", "start_lng",
            "end_lat", "end_lng", "fare", "status", "created_at", "expires_at"]

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT broadcast_id,user_id,poster_name,seats,waiting_time,start_destination,end_destination,start_lat,start_lng,end_lat,end_lng,fare,status,created_at,expires_at FROM broadcasts WHERE broadcast_id=%s",
                    (broadcast_id,),
                )
            else:
                cur = conn.execute(
                    "SELECT broadcast_id,user_id,poster_name,seats,waiting_time,start_destination,end_destination,start_lat,start_lng,end_lat,end_lng,fare,status,created_at,expires_at FROM broadcasts WHERE broadcast_id=?",
                    (broadcast_id,),
                )
            row = cur.fetchone()
        finally:
            conn.close()

    if row is None:
        return JSONResponse({"error": "Broadcast not found."}, status_code=404)

    b = dict(zip(cols, row))
    if b["fare"] is not None and b["seats"] and b["seats"] > 0:
        b["per_seat_cost"] = round(b["fare"] / b["seats"], 2)
    else:
        b["per_seat_cost"] = None
    return JSONResponse({"broadcast": b})


@fastapi_app.put("/api/broadcasts/{broadcast_id}")
async def api_broadcast_update(request: Request, broadcast_id: str, body: _BroadcastUpdateRequest):
    """Update a broadcast (owner only). Can update seats, waiting_time, or fare."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id, status FROM broadcasts WHERE broadcast_id=%s", (broadcast_id,))
            else:
                cur = conn.execute("SELECT user_id, status FROM broadcasts WHERE broadcast_id=?", (broadcast_id,))
            row = cur.fetchone()
            if row is None:
                conn.close()
                return JSONResponse({"error": "Broadcast not found."}, status_code=404)
            owner_id, current_status = row
            if owner_id != user_id:
                conn.close()
                return JSONResponse({"error": "Not the broadcast owner."}, status_code=403)
            if current_status not in ("active",):
                conn.close()
                return JSONResponse({"error": "Only active broadcasts can be updated."}, status_code=400)

            updates = {}
            if body.seats is not None:
                if body.seats < 1 or body.seats > 8:
                    conn.close()
                    return JSONResponse({"error": "Seats must be between 1 and 8."}, status_code=400)
                updates["seats"] = body.seats
            if body.waiting_time is not None:
                if body.waiting_time not in _VALID_WAITING_TIMES:
                    conn.close()
                    return JSONResponse(
                        {"error": f"waiting_time must be one of: {', '.join(_VALID_WAITING_TIMES)}."},
                        status_code=400,
                    )
                updates["waiting_time"] = body.waiting_time
                # Recalculate expires_at
                minutes = _WAITING_TIME_MINUTES[body.waiting_time]
                now = datetime.now(timezone.utc)
                updates["expires_at"] = (now + timedelta(minutes=minutes)).isoformat() if minutes > 0 else now.isoformat()
            if body.fare is not None:
                updates["fare"] = round(body.fare, 2)

            if not updates:
                conn.close()
                return JSONResponse({"ok": True})

            if USE_POSTGRES:
                set_clause = ", ".join(f"{k}=%s" for k in updates)
                cur.execute(f"UPDATE broadcasts SET {set_clause} WHERE broadcast_id=%s",
                            (*updates.values(), broadcast_id))
            else:
                set_clause = ", ".join(f"{k}=?" for k in updates)
                conn.execute(f"UPDATE broadcasts SET {set_clause} WHERE broadcast_id=?",
                             (*updates.values(), broadcast_id))
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


@fastapi_app.delete("/api/broadcasts/{broadcast_id}")
async def api_broadcast_delete(request: Request, broadcast_id: str):
    """Cancel (delete) a broadcast. Only the owner can cancel it."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("SELECT user_id FROM broadcasts WHERE broadcast_id=%s", (broadcast_id,))
            else:
                cur = conn.execute("SELECT user_id FROM broadcasts WHERE broadcast_id=?", (broadcast_id,))
            row = cur.fetchone()
            if row is None:
                conn.close()
                return JSONResponse({"error": "Broadcast not found."}, status_code=404)
            if row[0] != user_id:
                conn.close()
                return JSONResponse({"error": "Not the broadcast owner."}, status_code=403)

            if USE_POSTGRES:
                cur.execute("UPDATE broadcasts SET status='expired' WHERE broadcast_id=%s", (broadcast_id,))
            else:
                conn.execute("UPDATE broadcasts SET status='expired' WHERE broadcast_id=?", (broadcast_id,))
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


# ── Booking & Payment ──────────────────────────────────────────────────────────

@fastapi_app.post("/api/broadcasts/{broadcast_id}/book")
async def api_broadcast_book(request: Request, broadcast_id: str):
    """Book a seat on a broadcast ride. Returns booking_id and fare details."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if user is None:
        return JSONResponse({"error": "User not found."}, status_code=404)

    cols = ["broadcast_id", "user_id", "poster_name", "seats", "fare", "status",
            "start_destination", "end_destination"]

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT broadcast_id,user_id,poster_name,seats,fare,status,start_destination,end_destination FROM broadcasts WHERE broadcast_id=%s",
                    (broadcast_id,),
                )
            else:
                cur = conn.execute(
                    "SELECT broadcast_id,user_id,poster_name,seats,fare,status,start_destination,end_destination FROM broadcasts WHERE broadcast_id=?",
                    (broadcast_id,),
                )
            row = cur.fetchone()
        finally:
            conn.close()

    if row is None:
        return JSONResponse({"error": "Broadcast not found."}, status_code=404)

    bcast = dict(zip(cols, row))
    if bcast["status"] != "active":
        return JSONResponse({"error": "This broadcast is no longer active."}, status_code=400)
    if bcast["user_id"] == user_id:
        return JSONResponse({"error": "You cannot book your own broadcast."}, status_code=400)

    # Calculate per-seat cost based on current bookings
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT COUNT(*) FROM bookings WHERE broadcast_id=%s AND status IN ('pending','paid')",
                    (broadcast_id,),
                )
            else:
                cur = conn.execute(
                    "SELECT COUNT(*) FROM bookings WHERE broadcast_id=? AND status IN ('pending','paid')",
                    (broadcast_id,),
                )
            booked_count = (cur.fetchone() or [0])[0]
        finally:
            conn.close()

    total_seats = bcast["seats"]
    if total_seats <= 0:
        return JSONResponse({"error": "This broadcast has no available seats."}, status_code=400)
    if booked_count >= total_seats:
        return JSONResponse({"error": "No seats available on this broadcast."}, status_code=400)

    fare = bcast["fare"] or 0.0
    # Per-seat cost: total fare ÷ total seats (shared cost model)
    per_seat_cost = round(fare / total_seats, 2)
    # Dynamic adjustment if not all seats fill: total/current_bookers+1
    current_passengers = booked_count + 1
    dynamic_cost = round(fare / current_passengers, 2)

    booking_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO bookings (booking_id,broadcast_id,passenger_id,passenger_name,seats,amount,status,created_at)
                       VALUES (%s,%s,%s,%s,1,%s,'pending',%s)""",
                    (booking_id, broadcast_id, user_id, user["name"], per_seat_cost, created_at),
                )
            else:
                conn.execute(
                    """INSERT INTO bookings (booking_id,broadcast_id,passenger_id,passenger_name,seats,amount,status,created_at)
                       VALUES (?,?,?,?,1,?,'pending',?)""",
                    (booking_id, broadcast_id, user_id, user["name"], per_seat_cost, created_at),
                )
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({
        "ok": True,
        "booking_id": booking_id,
        "per_seat_cost": per_seat_cost,
        "dynamic_cost": dynamic_cost,
        "total_fare": round(fare, 2),
        "total_seats": total_seats,
        "message": (
            f"If all seats fill, your cost is ${per_seat_cost:.2f}. "
            f"If only {current_passengers} seat(s) fill, your cost adjusts to ${dynamic_cost:.2f}. "
            "You will be notified before departure."
        ),
    }, status_code=201)


@fastapi_app.post("/api/bookings/{booking_id}/pay")
async def api_booking_pay(request: Request, booking_id: str, body: _BookingPayRequest = None):
    """Process payment for a booking and generate a receipt."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    booking_cols = ["booking_id", "broadcast_id", "passenger_id", "passenger_name", "amount", "status"]

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT booking_id,broadcast_id,passenger_id,passenger_name,amount,status FROM bookings WHERE booking_id=%s",
                    (booking_id,),
                )
            else:
                cur = conn.execute(
                    "SELECT booking_id,broadcast_id,passenger_id,passenger_name,amount,status FROM bookings WHERE booking_id=?",
                    (booking_id,),
                )
            row = cur.fetchone()
        finally:
            conn.close()

    if row is None:
        return JSONResponse({"error": "Booking not found."}, status_code=404)

    booking = dict(zip(booking_cols, row))
    if booking["passenger_id"] != user_id:
        return JSONResponse({"error": "Not your booking."}, status_code=403)
    if booking["status"] != "pending":
        return JSONResponse({"error": "Booking is not in pending state."}, status_code=400)

    # Fetch broadcast details for receipt
    bcast_cols = ["broadcast_id", "user_id", "poster_name", "start_destination", "end_destination"]
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT broadcast_id,user_id,poster_name,start_destination,end_destination FROM broadcasts WHERE broadcast_id=%s",
                    (booking["broadcast_id"],),
                )
            else:
                cur = conn.execute(
                    "SELECT broadcast_id,user_id,poster_name,start_destination,end_destination FROM broadcasts WHERE broadcast_id=?",
                    (booking["broadcast_id"],),
                )
            brow = cur.fetchone()
        finally:
            conn.close()

    if brow is None:
        return JSONResponse({"error": "Associated broadcast not found."}, status_code=404)

    bcast = dict(zip(bcast_cols, brow))

    # Mark booking as paid
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("UPDATE bookings SET status='paid' WHERE booking_id=%s", (booking_id,))
            else:
                conn.execute("UPDATE bookings SET status='paid' WHERE booking_id=?", (booking_id,))
            conn.commit()
        finally:
            conn.close()

    # Generate receipt
    receipt_id = str(uuid.uuid4())
    transaction_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    subtotal = round(float(booking["amount"]), 2)
    tax_amount = round(subtotal * _BOOKING_TAX_RATE, 2)
    total_amount = round(subtotal + tax_amount, 2)
    pay_body = body or _BookingPayRequest()

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO receipts (receipt_id,booking_id,broadcast_id,passenger_id,passenger_name,driver_id,driver_name,amount,subtotal,transaction_id,start_destination,end_destination,created_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (receipt_id, booking_id, booking["broadcast_id"],
                     user_id, booking["passenger_name"],
                     bcast["user_id"], bcast["poster_name"],
                     total_amount, subtotal, transaction_id,
                     bcast["start_destination"], bcast["end_destination"], created_at),
                )
            else:
                conn.execute(
                    """INSERT INTO receipts (receipt_id,booking_id,broadcast_id,passenger_id,passenger_name,driver_id,driver_name,amount,subtotal,transaction_id,start_destination,end_destination,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (receipt_id, booking_id, booking["broadcast_id"],
                     user_id, booking["passenger_name"],
                     bcast["user_id"], bcast["poster_name"],
                     total_amount, subtotal, transaction_id,
                     bcast["start_destination"], bcast["end_destination"], created_at),
                )
            conn.commit()
        finally:
            conn.close()

    receipt_data = {
        "receipt_id": receipt_id,
        "booking_id": booking_id,
        "broadcast_id": booking["broadcast_id"],
        "passenger_id": user_id,
        "passenger_name": booking["passenger_name"],
        "driver_id": bcast["user_id"],
        "driver_name": bcast["poster_name"],
        "amount": total_amount,
        "subtotal": subtotal,
        "tax_amount": tax_amount,
        "tax_rate": _BOOKING_TAX_RATE,
        "transaction_id": transaction_id,
        "start_destination": bcast["start_destination"],
        "end_destination": bcast["end_destination"],
        "created_at": created_at,
        "billing_name": pay_body.billing_name,
        "billing_email": pay_body.billing_email,
        "payment_method": pay_body.payment_method,
        "card_last4": pay_body.card_last4,
        "items": [
            {
                "description": f"Ride: {bcast['start_destination']} → {bcast['end_destination']}",
                "amount": subtotal,
            }
        ],
    }

    _bucket_write_json("receipts", "receipt", receipt_id, receipt_data)

    return JSONResponse({"ok": True, "receipt_id": receipt_id, "receipt": receipt_data}, status_code=201)


@fastapi_app.get("/api/receipts/{receipt_id}/pdf")
async def api_receipt_pdf(request: Request, receipt_id: str):
    """Generate and return a downloadable PDF receipt."""
    from fpdf import FPDF
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    cols = ["receipt_id", "booking_id", "broadcast_id", "passenger_id", "passenger_name",
            "driver_id", "driver_name", "amount", "subtotal", "transaction_id",
            "start_destination", "end_destination", "created_at"]

    with _db_lock:
        conn = _get_db()
        try:
            cur = _execute(
                conn,
                "SELECT receipt_id,booking_id,broadcast_id,passenger_id,passenger_name,driver_id,driver_name,amount,subtotal,transaction_id,start_destination,end_destination,created_at FROM receipts WHERE receipt_id=?"
                if not USE_POSTGRES else
                "SELECT receipt_id,booking_id,broadcast_id,passenger_id,passenger_name,driver_id,driver_name,amount,subtotal,transaction_id,start_destination,end_destination,created_at FROM receipts WHERE receipt_id=%s",
                (receipt_id,),
            )
            row = cur.fetchone()
        finally:
            conn.close()

    if not row:
        return JSONResponse({"error": "Receipt not found."}, status_code=404)

    rec = dict(zip(cols, row))
    if rec["passenger_id"] != user_id and rec["driver_id"] != user_id:
        return JSONResponse({"error": "Access denied."}, status_code=403)

    # Build PDF
    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    # Header
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(30, 64, 175)
    pdf.cell(0, 12, "Payment Receipt", ln=True, align="C")

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 6, "YOT Ride Service", ln=True, align="C")
    pdf.ln(4)

    # Divider
    pdf.set_draw_color(200, 200, 200)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(6)

    # Transaction info
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(0, 7, "Transaction Details", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(60, 60, 60)

    created_dt = rec["created_at"]
    try:
        from datetime import datetime as _dt
        created_dt = _dt.fromisoformat(rec["created_at"].replace("Z", "+00:00")).strftime("%d %b %Y, %H:%M UTC")
    except Exception:
        pass

    rows_info = [
        ("Transaction ID", rec["transaction_id"]),
        ("Receipt ID", rec["receipt_id"]),
        ("Date & Time", created_dt),
    ]
    for label, value in rows_info:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(55, 6, label + ":", ln=False)
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(0, 6, str(value), ln=True)

    pdf.ln(4)

    # Billing details
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(0, 7, "Billing Details", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(60, 60, 60)

    billing_rows = [
        ("Passenger Name", rec["passenger_name"]),
        ("Driver Name", rec["driver_name"]),
    ]
    for label, value in billing_rows:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(55, 6, label + ":", ln=False)
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(0, 6, str(value), ln=True)

    pdf.ln(4)

    # Itemised services
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(0, 7, "Services", ln=True)

    # Table header
    pdf.set_fill_color(230, 236, 255)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(130, 7, "Description", border=1, fill=True)
    pdf.cell(50, 7, "Amount", border=1, fill=True, align="R", ln=True)

    # Item row
    item_desc = f"Ride: {rec['start_destination']} \u2192 {rec['end_destination']}"
    # Use stored subtotal to avoid rounding errors from back-calculation
    subtotal = round(float(rec.get("subtotal") or rec["amount"]), 2)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(60, 60, 60)
    pdf.cell(130, 7, item_desc, border=1)
    pdf.cell(50, 7, f"GBP {subtotal:.2f}", border=1, align="R", ln=True)

    pdf.ln(2)

    # Totals
    total = round(float(rec["amount"]), 2)
    tax_amount = round(total - subtotal, 2)

    pdf.set_font("Helvetica", "", 9)
    pdf.cell(130, 6, "")
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(25, 6, "Subtotal:")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(25, 6, f"GBP {subtotal:.2f}", align="R", ln=True)

    pdf.cell(130, 6, "")
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(25, 6, "Tax (10%):")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(25, 6, f"GBP {tax_amount:.2f}", align="R", ln=True)

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(30, 64, 175)
    pdf.cell(130, 8, "")
    pdf.cell(25, 8, "TOTAL:")
    pdf.cell(25, 8, f"GBP {total:.2f}", align="R", ln=True)

    pdf.ln(4)
    pdf.set_draw_color(200, 200, 200)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(4)

    # Footer
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(130, 130, 130)
    pdf.cell(0, 5, "Thank you for using YOT Ride Service. This is an official receipt.", ln=True, align="C")

    pdf_bytes = pdf.output()

    from fastapi.responses import Response as _FastAPIResponse
    return _FastAPIResponse(
        content=bytes(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="receipt-{receipt_id[:8]}.pdf"'},
    )


@fastapi_app.get("/api/receipts")
async def api_get_receipts(request: Request):
    """Get all receipts for the logged-in user (as passenger or driver)."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    cols = ["receipt_id", "booking_id", "broadcast_id", "passenger_id", "passenger_name",
            "driver_id", "driver_name", "amount", "transaction_id",
            "start_destination", "end_destination", "created_at"]

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT receipt_id,booking_id,broadcast_id,passenger_id,passenger_name,driver_id,driver_name,amount,transaction_id,start_destination,end_destination,created_at FROM receipts WHERE passenger_id=%s OR driver_id=%s ORDER BY created_at DESC",
                    (user_id, user_id),
                )
            else:
                cur = conn.execute(
                    "SELECT receipt_id,booking_id,broadcast_id,passenger_id,passenger_name,driver_id,driver_name,amount,transaction_id,start_destination,end_destination,created_at FROM receipts WHERE passenger_id=? OR driver_id=? ORDER BY created_at DESC",
                    (user_id, user_id),
                )
            rows = cur.fetchall()
        finally:
            conn.close()

    receipts = [dict(zip(cols, r)) for r in rows]
    return JSONResponse({"receipts": receipts})


# ── Phone profile update ───────────────────────────────────────────────────────

class _UserPhoneUpdate(BaseModel):
    phone: str


@fastapi_app.put("/api/auth/profile/phone")
async def api_user_update_phone(request: Request, body: _UserPhoneUpdate):
    """Update the logged-in user's phone / WhatsApp number."""
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    phone = body.phone.strip()
    if not phone:
        return JSONResponse({"error": "Phone number cannot be empty."}, status_code=400)

    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("UPDATE app_users SET phone=%s WHERE user_id=%s", (phone, user_id))
            else:
                conn.execute("UPDATE app_users SET phone=? WHERE user_id=?", (phone, user_id))
            conn.commit()
        finally:
            conn.close()

    return JSONResponse({"ok": True})


# ── Auto-populated contact template ───────────────────────────────────────────

@fastapi_app.get("/api/broadcasts/{broadcast_id}/contact_template")
async def api_broadcast_contact_template(request: Request, broadcast_id: str):
    """Return a pre-filled message template for contacting the broadcast poster.

    Requires the requesting user to have a phone number and location set.
    """
    user_id = request.session.get("app_user_id")
    if not user_id:
        return JSONResponse({"error": "Login required."}, status_code=401)

    user = _get_app_user(user_id)
    if user is None:
        return JSONResponse({"error": "User not found."}, status_code=404)

    missing = []
    if not user.get("phone"):
        missing.append("phone number")
    if user.get("location_lat") is None:
        missing.append("current location")
    if missing:
        return JSONResponse(
            {"error": f"Please complete your {' and '.join(missing)} in your profile before contacting a driver."},
            status_code=400,
        )

    cols = ["broadcast_id", "poster_name", "start_destination", "end_destination"]
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT broadcast_id,poster_name,start_destination,end_destination FROM broadcasts WHERE broadcast_id=%s",
                    (broadcast_id,),
                )
            else:
                cur = conn.execute(
                    "SELECT broadcast_id,poster_name,start_destination,end_destination FROM broadcasts WHERE broadcast_id=?",
                    (broadcast_id,),
                )
            row = cur.fetchone()
        finally:
            conn.close()

    if row is None:
        return JSONResponse({"error": "Broadcast not found."}, status_code=404)

    bcast = dict(zip(cols, row))
    location_str = user.get("location_name") or f"{user['location_lat']:.4f},{user['location_lng']:.4f}"

    message = (
        f"Hi {bcast['poster_name']}, I need an airport pickup from "
        f"{bcast['start_destination']} to {bcast['end_destination']}. "
        f"Please find my details below:\n"
        f"Name: {user['name']}\n"
        f"Contact: {user['phone']}\n"
        f"Current Location: {location_str}\n"
        f"Are you available?"
    )

    return JSONResponse({
        "template": message,
        "name": user["name"],
        "phone": user["phone"],
        "location": location_str,
    })


def _expire_stale_broadcasts():
    """Mark broadcasts as 'expired' if their expires_at timestamp has passed."""
    now = datetime.now(timezone.utc).isoformat()
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE broadcasts SET status='expired' WHERE status='active' AND expires_at <= %s",
                    (now,),
                )
            else:
                conn.execute(
                    "UPDATE broadcasts SET status='expired' WHERE status='active' AND expires_at <= ?",
                    (now,),
                )
            conn.commit()
        finally:
            conn.close()

# =========================================================
# ADMIN — USERS / BROADCASTS
# =========================================================


@fastapi_app.get("/api/admin/users")
async def api_admin_users(request: Request):
    """Return all registered platform users (admin only)."""
    if not request.session.get("admin_logged_in"):
        return JSONResponse({"error": "Admin login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            cols = ["user_id", "name", "email", "role", "can_post_properties", "created_at"]
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT user_id, name, email, role, can_post_properties, created_at"
                    " FROM app_users ORDER BY created_at DESC LIMIT 1000"
                )
            else:
                cur = conn.execute(
                    "SELECT user_id, name, email, role, can_post_properties, created_at"
                    " FROM app_users ORDER BY created_at DESC LIMIT 1000"
                )
            rows = cur.fetchall()
        finally:
            conn.close()

    users = [dict(zip(cols, r)) for r in rows]
    return JSONResponse({"users": users})


@fastapi_app.delete("/api/admin/users/{user_id}")
async def api_admin_delete_user(request: Request, user_id: str):
    """Delete a platform user account and all their related data (admin only)."""
    if not request.session.get("admin_logged_in"):
        return JSONResponse({"error": "Admin login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            ph = "%s" if USE_POSTGRES else "?"
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(f"SELECT user_id FROM app_users WHERE user_id={ph}", (user_id,))
                row = cur.fetchone()
            else:
                cur = conn.execute(f"SELECT user_id FROM app_users WHERE user_id={ph}", (user_id,))
                row = cur.fetchone()
            if not row:
                conn.close()
                return JSONResponse({"error": "User not found."}, status_code=404)
            # Cascade: delete all data owned by this user before removing the account
            for table, col in [
                ("rides",                "user_id"),
                ("driver_applications",  "user_id"),
                ("notifications",        "user_id"),
                ("broadcasts",           "user_id"),
                ("bookings",             "passenger_id"),
            ]:
                _execute(conn, f"DELETE FROM {table} WHERE {col}={ph}", (user_id,))
            # DM conversations where this user is a participant
            _execute(conn, f"DELETE FROM dm_conversations WHERE user1_id={ph} OR user2_id={ph}", (user_id, user_id))
            _execute(conn, f"DELETE FROM app_users WHERE user_id={ph}", (user_id,))
            conn.commit()
        finally:
            conn.close()
    return JSONResponse({"ok": True})


@fastapi_app.get("/api/admin/broadcasts")
async def api_admin_broadcasts(request: Request):
    """Return all broadcasts (admin only)."""
    if not request.session.get("admin_logged_in"):
        return JSONResponse({"error": "Admin login required."}, status_code=401)

    _expire_stale_broadcasts()

    with _db_lock:
        conn = _get_db()
        try:
            cols = ["broadcast_id", "user_id", "poster_name", "seats", "waiting_time",
                    "start_destination", "end_destination", "fare", "status", "created_at", "expires_at"]
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(
                    "SELECT broadcast_id, user_id, poster_name, seats, waiting_time,"
                    " start_destination, end_destination, fare, status, created_at, expires_at"
                    " FROM broadcasts ORDER BY created_at DESC LIMIT 500"
                )
            else:
                cur = conn.execute(
                    "SELECT broadcast_id, user_id, poster_name, seats, waiting_time,"
                    " start_destination, end_destination, fare, status, created_at, expires_at"
                    " FROM broadcasts ORDER BY created_at DESC LIMIT 500"
                )
            rows = cur.fetchall()
        finally:
            conn.close()

    broadcasts = [dict(zip(cols, r)) for r in rows]
    return JSONResponse({"broadcasts": broadcasts})


@fastapi_app.delete("/api/admin/broadcasts/{broadcast_id}")
async def api_admin_delete_broadcast(request: Request, broadcast_id: str):
    """Cancel any broadcast (admin only)."""
    if not request.session.get("admin_logged_in"):
        return JSONResponse({"error": "Admin login required."}, status_code=401)

    with _db_lock:
        conn = _get_db()
        try:
            ph = "%s" if USE_POSTGRES else "?"
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute(f"SELECT broadcast_id FROM broadcasts WHERE broadcast_id={ph}", (broadcast_id,))
                row = cur.fetchone()
            else:
                cur = conn.execute(f"SELECT broadcast_id FROM broadcasts WHERE broadcast_id={ph}", (broadcast_id,))
                row = cur.fetchone()
            if not row:
                conn.close()
                return JSONResponse({"error": "Broadcast not found."}, status_code=404)
            _execute(conn, f"UPDATE broadcasts SET status='expired' WHERE broadcast_id={ph}", (broadcast_id,))
            conn.commit()
        finally:
            conn.close()
    return JSONResponse({"ok": True})


# =========================================================
# ENTRY POINT
# =========================================================

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "False").lower() == "true"

    logger.info(f"Starting server on port {port}")
    logger.info(f"Debug mode: {debug}")

    uvicorn.run(
        "api.app:app",
        host="0.0.0.0",
        port=port,
        reload=debug,
        workers=1,
    )