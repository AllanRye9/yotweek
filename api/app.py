import os
import re
import sys
import secrets
import subprocess
import threading
import time
import uuid
import shutil
import json
import logging
import sqlite3
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    psycopg2 = None
# Tuple of integrity-error types so except clauses work for both backends
_IntegrityErrors: tuple = (sqlite3.IntegrityError,)
if psycopg2 is not None:
    _IntegrityErrors = (sqlite3.IntegrityError, psycopg2.IntegrityError)
import gzip
import zipfile
import ipaddress
import maxminddb
import asyncio
import mimetypes
import certifi
import yt_dlp
from pathlib import Path
from datetime import datetime, timedelta
from functools import wraps

import socketio as socketio_pkg
from fastapi import FastAPI, Request, Form, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, FileResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
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
    DOWNLOAD_FOLDER = "downloads"
    TEMPLATES_FOLDER = "templates"
    STATIC_FOLDER = "static"
    MAX_DOWNLOADS_PER_IP = 5
    MAX_CONCURRENT_DOWNLOADS = 3
    DOWNLOAD_TIMEOUT = 3600  # 1 hour
    CLEANUP_INTERVAL = 60    # Run cleanup every 60 seconds
    FILE_RETENTION_MINUTES = 5  # Delete files that are older than this many minutes (up to 1 extra minute until the next cleanup cycle)
    SESSION_TYPE = 'filesystem'
    PERMANENT_SESSION_LIFETIME = timedelta(hours=1)
    # Admin authentication — set ADMIN_PASSWORD env var in production
    ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin")

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
DOWNLOAD_FOLDER = os.path.join(ROOT_DIR, Config.DOWNLOAD_FOLDER)
DATA_DIR = os.path.join(ROOT_DIR, "data")
COOKIES_FILE = os.environ.get("COOKIES_FILE", os.path.join(DATA_DIR, "cookies.txt"))

# Create directories
os.makedirs(TEMPLATES_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# =========================================================
# LOGGING SETUP
# =========================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(ROOT_DIR, 'app.log'))
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
    # Initialize the local GeoIP database in a background thread so the
    # server stays responsive while the (potentially large) download runs.
    threading.Thread(target=_init_geoip_db, daemon=True).start()
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

# Jinja2 template rendering
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# Mount static files
from starlette.staticfiles import StaticFiles
if os.path.isdir(STATIC_DIR):
    fastapi_app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

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

from threading import Lock, RLock
import urllib.request

downloads_lock = RLock()  # Reentrant lock for nested access
downloads = {}            # download_id -> metadata
active_threads = {}       # download_id -> thread
ip_download_count = {}    # ip -> count

conversions_lock = RLock()  # Lock for ffmpeg/editing jobs
conversions = {}             # job_id -> editing/conversion job metadata

visitors_lock = Lock()
visitors = []             # List of visitor dicts tracked on page visits
ip_country_cache = {}     # ip -> {"country": str, "code": str}

# Paths for persistent storage
DATA_DIR = os.path.join(ROOT_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "admin.db")
os.makedirs(DATA_DIR, exist_ok=True)

# PostgreSQL support: when DATABASE_URL is set, use PostgreSQL instead of SQLite
DATABASE_URL = os.environ.get("DATABASE_URL")
USE_POSTGRES = bool(DATABASE_URL and psycopg2 is not None)

# Paths whose visits are tracked for analytics (main site + admin page)
TRACKED_VISITOR_PATHS = {"/const", "/"}

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
# LOCAL GEOIP DATABASE (DB-IP City Lite – free, MMDB format)
# =========================================================

GEOIP_DB_PATH = os.path.join(DATA_DIR, "dbip-city-lite.mmdb")
GEOIP_DB_REFRESH_SECONDS = 35 * 86400  # Re-download after ~35 days (database is updated monthly)
_geoip_reader: maxminddb.Reader | None = None


def _init_geoip_db():
    """Download the free DB-IP City Lite MMDB database if absent or stale, then open it."""
    global _geoip_reader

    need_download = not os.path.exists(GEOIP_DB_PATH)
    if not need_download:
        age = time.time() - os.path.getmtime(GEOIP_DB_PATH)
        if age > GEOIP_DB_REFRESH_SECONDS:
            need_download = True

    if need_download:
        now = datetime.utcnow()
        url = (
            f"https://download.db-ip.com/free/"
            f"dbip-city-lite-{now.year}-{now.month:02d}.mmdb.gz"
        )
        gz_path = GEOIP_DB_PATH + ".gz"
        tmp_path = GEOIP_DB_PATH + ".tmp"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                with open(gz_path, "wb") as f:
                    shutil.copyfileobj(resp, f)
            with gzip.open(gz_path, "rb") as gz_in, open(tmp_path, "wb") as out:
                shutil.copyfileobj(gz_in, out)
            os.replace(tmp_path, GEOIP_DB_PATH)
            logger.info("GeoIP database downloaded successfully")
        except Exception as e:
            logger.warning(f"Failed to download GeoIP database: {e}")
        finally:
            # Clean up temp files
            for p in (gz_path, tmp_path):
                try:
                    os.remove(p)
                except OSError:
                    pass

    if os.path.exists(GEOIP_DB_PATH):
        try:
            _geoip_reader = maxminddb.open_database(GEOIP_DB_PATH)
            logger.info("GeoIP database loaded successfully")
        except Exception as e:
            logger.warning(f"Failed to open GeoIP database: {e}")
            _geoip_reader = None


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
                    CREATE TABLE IF NOT EXISTS downloads (
                        id TEXT PRIMARY KEY,
                        data TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS visitors (
                        id SERIAL PRIMARY KEY,
                        data TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS admin_users (
                        id SERIAL PRIMARY KEY,
                        username TEXT UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL
                    )
                """)
            else:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS downloads (
                        id TEXT PRIMARY KEY,
                        data TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS visitors (
                        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                        data TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS admin_users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL
                    );
                """)
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


def load_persistence():
    """Load downloads and visitors from the database on startup."""
    global downloads, visitors
    # Migrate legacy JSON files into the database (one-time migration)
    _migrate_json_to_db()

    with _db_lock:
        conn = _get_db()
        try:
            rows = _execute(conn, "SELECT id, data FROM downloads").fetchall()
            saved_dl = {r["id"]: json.loads(r["data"]) for r in rows}
            visitor_order_col = "id" if USE_POSTGRES else "rowid"
            rows_v = _execute(conn, f"SELECT data FROM visitors ORDER BY {visitor_order_col}").fetchall()
            saved_v = [json.loads(r["data"]) for r in rows_v]
        finally:
            conn.close()

    with downloads_lock:
        downloads.update(saved_dl)
    with visitors_lock:
        visitors.extend(saved_v)
    logger.info(f"Loaded {len(saved_dl)} download records and {len(saved_v)} visitor records from {'PostgreSQL' if USE_POSTGRES else 'SQLite'}")


def _migrate_json_to_db():
    """One-time migration: import legacy JSON persistence files into the database."""
    legacy_dl = os.path.join(DATA_DIR, "downloads.json")
    legacy_v = os.path.join(DATA_DIR, "visitors.json")
    conn = _get_db()
    try:
        if os.path.exists(legacy_dl):
            try:
                with open(legacy_dl) as fh:
                    data = json.load(fh)
                for did, d in data.items():
                    if USE_POSTGRES:
                        cur = conn.cursor()
                        cur.execute(
                            "INSERT INTO downloads (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
                            (did, json.dumps(d, default=str)),
                        )
                    else:
                        conn.execute(
                            "INSERT OR IGNORE INTO downloads (id, data) VALUES (?, ?)",
                            (did, json.dumps(d, default=str)),
                        )
                conn.commit()
                os.rename(legacy_dl, legacy_dl + ".migrated")
                logger.info(f"Migrated {len(data)} download records from JSON to {'PostgreSQL' if USE_POSTGRES else 'SQLite'}")
            except Exception as exc:
                logger.error(f"JSON→DB migration failed for downloads: {exc}")
        if os.path.exists(legacy_v):
            try:
                with open(legacy_v) as fh:
                    data = json.load(fh)
                for v in data:
                    _execute(
                        conn,
                        "INSERT INTO visitors (data) VALUES (?)",
                        (json.dumps(v, default=str),),
                    )
                conn.commit()
                os.rename(legacy_v, legacy_v + ".migrated")
                logger.info(f"Migrated {len(data)} visitor records from JSON to {'PostgreSQL' if USE_POSTGRES else 'SQLite'}")
            except Exception as exc:
                logger.error(f"JSON→DB migration failed for visitors: {exc}")
    finally:
        conn.close()


def save_downloads_to_disk():
    """Persist current downloads dict to the database (upsert all records)."""
    try:
        with downloads_lock:
            data = dict(downloads)
        with _db_lock:
            conn = _get_db()
            try:
                for did, d in data.items():
                    if USE_POSTGRES:
                        cur = conn.cursor()
                        cur.execute(
                            "INSERT INTO downloads (id, data) VALUES (%s, %s) "
                            "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
                            (did, json.dumps(d, default=str)),
                        )
                    else:
                        conn.execute(
                            "INSERT OR REPLACE INTO downloads (id, data) VALUES (?, ?)",
                            (did, json.dumps(d, default=str)),
                        )
                conn.commit()
            finally:
                conn.close()
    except Exception as exc:
        logger.error(f"Could not persist downloads: {exc}")


def save_visitors_to_disk():
    """Persist visitor list to the database (replace all rows)."""
    try:
        with visitors_lock:
            data = list(visitors)
        with _db_lock:
            conn = _get_db()
            try:
                _execute(conn, "DELETE FROM visitors")
                for v in data:
                    _execute(
                        conn,
                        "INSERT INTO visitors (data) VALUES (?)",
                        (json.dumps(v, default=str),),
                    )
                conn.commit()
            finally:
                conn.close()
    except Exception as exc:
        logger.error(f"Could not persist visitors: {exc}")


# Shared timer for debounced visitor saves (avoids thread-per-visit churn)
_visitor_save_timer: threading.Timer | None = None
_visitor_save_timer_lock = threading.Lock()


def _schedule_visitor_save(delay: float = 5.0):
    """Schedule a visitor save in `delay` seconds, cancelling any pending save."""
    global _visitor_save_timer
    with _visitor_save_timer_lock:
        if _visitor_save_timer is not None:
            _visitor_save_timer.cancel()
        _visitor_save_timer = threading.Timer(delay, save_visitors_to_disk)
        _visitor_save_timer.daemon = True
        _visitor_save_timer.start()


def _parse_browser(ua: str) -> str:
    """Best-effort browser detection from User-Agent string."""
    ua_lower = ua.lower()
    if "edg/" in ua_lower or "edghtml" in ua_lower:
        return "Edge"
    if "chrome" in ua_lower:
        return "Chrome"
    if "firefox" in ua_lower:
        return "Firefox"
    if "safari" in ua_lower:
        return "Safari"
    if "msie" in ua_lower or "trident" in ua_lower:
        return "IE"
    return "Other"


def _is_private_ip(ip: str) -> bool:
    """Return True if *ip* is a loopback, private, link-local or reserved address."""
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved
    except ValueError:
        return False


# ── Accept-Language → country heuristic ──────────────────────────────────
# Maps common primary language codes to their most likely country ISO-2 code.
# Used only as a last-resort fallback when all geo-IP services fail.
_LANG_TO_COUNTRY: dict[str, str] = {
    "en": "US", "zh": "CN", "hi": "IN", "es": "ES", "fr": "FR",
    "ar": "SA", "bn": "BD", "pt": "BR", "ru": "RU", "ja": "JP",
    "de": "DE", "ko": "KR", "vi": "VN", "it": "IT", "tr": "TR",
    "pl": "PL", "uk": "UA", "nl": "NL", "th": "TH", "id": "ID",
    "sv": "SE", "da": "DK", "fi": "FI", "nb": "NO", "no": "NO",
    "cs": "CZ", "ro": "RO", "hu": "HU", "el": "GR", "he": "IL",
    "ms": "MY", "tl": "PH", "sw": "KE", "fa": "IR",
}


def _country_from_accept_language(accept_lang: str) -> tuple[str, str]:
    """Best-effort country guess from an Accept-Language header value.

    Returns (country_name, iso2_code) or ("", "") when no guess can be made.
    Handles formats like "en-US,en;q=0.9" – tries region subtag first, then
    falls back to the primary language code.
    """
    if not accept_lang:
        return "", ""
    # Parse the first (highest-priority) language tag
    first = accept_lang.split(",")[0].split(";")[0].strip()
    parts = first.replace("_", "-").split("-")
    # Check for explicit region subtag (e.g. "en-GB", "pt-BR")
    if len(parts) >= 2:
        region = parts[1].upper()
        if len(region) == 2 and region.isalpha():
            name = _ISO2_TO_NAME.get(region)
            if name:
                return name, region
    # Fall back to primary language code
    lang = parts[0].lower()
    code = _LANG_TO_COUNTRY.get(lang, "")
    if code:
        return _ISO2_TO_NAME.get(code, code), code
    return "", ""


def _lookup_country_async(ip: str, accept_language: str = ""):
    """Resolve an IP to its country (and city/region when available).

    Lookup order:
    1. Local GeoIP database (DB-IP City Lite MMDB – most accurate, offline)
    2. ip-api.com / ipinfo.io / ipwhois.app / ipapi.co / api.country.is
    3. Accept-Language header heuristic (last resort)

    Args:
        ip: The IP address to geo-locate.
        accept_language: Optional Accept-Language header value used as a
            last-resort heuristic when all geo-IP services fail.
    """
    if ip in ip_country_cache:
        return

    # Private / loopback addresses cannot be geo-located
    if _is_private_ip(ip):
        ip_country_cache[ip] = {"country": "Local", "code": "", "city": "", "region": ""}
        with visitors_lock:
            for v in visitors[-200:]:
                if v.get("ip") == ip and not v.get("country"):
                    v["country"] = "Local"
                    v["country_code"] = ""
                    v["city"] = ""
                    v["region"] = ""
        with downloads_lock:
            for d in downloads.values():
                if d.get("ip") == ip and not d.get("country"):
                    d["country"] = "Local"
                    d["country_code"] = ""
                    d["city"] = ""
                    d["region"] = ""
        _schedule_visitor_save()
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()
        return

    country, code, city, region = "Unknown", "", "", ""

    # --- Primary: Local GeoIP database (accurate, offline, no rate limits) ---
    if _geoip_reader is not None:
        try:
            result = _geoip_reader.get(ip)
            if result:
                c = result.get("country", {})
                iso = (c.get("iso_code") or "").upper()
                if iso and len(iso) == 2:
                    code = iso
                    country = c.get("names", {}).get("en") or _ISO2_TO_NAME.get(code, code)
                    city_data = result.get("city", {})
                    city = city_data.get("names", {}).get("en", "")
                    subdivisions = result.get("subdivisions", [])
                    if subdivisions:
                        region = subdivisions[0].get("names", {}).get("en", "")
        except Exception:
            pass

    # --- Service 1: ip-api.com (free, no key) ---
    if country == "Unknown":
        try:
            with urllib.request.urlopen(
                f"https://ip-api.com/json/{ip}?fields=status,country,countryCode,city,regionName", timeout=5
            ) as resp:
                data = json.loads(resp.read())
            if data.get("status") == "success" and data.get("country"):
                country = data["country"]
                code = data.get("countryCode", "")
                city = data.get("city", "")
                region = data.get("regionName", "")
        except Exception:
            pass

    # --- Service 2: ipinfo.io (fallback) ---
    if country == "Unknown":
        try:
            with urllib.request.urlopen(
                f"https://ipinfo.io/{ip}/json", timeout=5
            ) as resp:
                data = json.loads(resp.read())
            if data.get("country") and not data.get("bogon"):
                code = data["country"].upper()  # ipinfo returns 2-letter code in "country"
                country = _ISO2_TO_NAME.get(code, code)
                city = data.get("city", "")
                region = data.get("region", "")
        except Exception:
            pass

    # --- Service 3: ipwhois.app (second fallback) ---
    if country == "Unknown":
        try:
            with urllib.request.urlopen(
                f"https://ipwhois.app/json/{ip}?objects=country,country_code,city,region", timeout=5
            ) as resp:
                data = json.loads(resp.read())
            if data.get("country"):
                country = data["country"]
                code = data.get("country_code", "")
                city = data.get("city", "")
                region = data.get("region", "")
        except Exception:
            pass

    # --- Service 4: ipapi.co (third fallback) ---
    if country == "Unknown":
        try:
            req = urllib.request.Request(
                f"https://ipapi.co/{ip}/json/",
                headers={"User-Agent": "Mozilla/5.0"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
            if data.get("country_name") and not data.get("error"):
                country = data["country_name"]
                code = data.get("country_code", "").upper()
                city = data.get("city", "")
                region = data.get("region", "")
        except Exception:
            pass

    # --- Service 5: api.country.is (lightweight, returns ISO code only) ---
    if country == "Unknown":
        try:
            with urllib.request.urlopen(
                f"https://api.country.is/{ip}", timeout=5
            ) as resp:
                data = json.loads(resp.read())
            iso = (data.get("country") or "").upper()
            if iso and len(iso) == 2:
                code = iso
                country = _ISO2_TO_NAME.get(code, code)
        except Exception:
            pass

    # --- Last resort: Accept-Language header heuristic ---
    if country == "Unknown" and accept_language:
        lang_country, lang_code = _country_from_accept_language(accept_language)
        if lang_country:
            country = lang_country
            code = lang_code

    ip_country_cache[ip] = {"country": country, "code": code, "city": city, "region": region}
    # Back-fill any visitor records that are waiting for this IP's country
    with visitors_lock:
        for v in visitors[-200:]:
            if v.get("ip") == ip and not v.get("country"):
                v["country"] = country
                v["country_code"] = code
                v["city"] = city
                v["region"] = region
    # Back-fill any download records that are waiting for this IP's country
    with downloads_lock:
        for d in downloads.values():
            if d.get("ip") == ip and not d.get("country"):
                d["country"] = country
                d["country_code"] = code
                d["city"] = city
                d["region"] = region
    _schedule_visitor_save()
    # Persist updated download records so country is not lost on restart
    threading.Thread(target=save_downloads_to_disk, daemon=True).start()


def _get_country_from_headers(req) -> tuple[str, str]:
    """Extract country from CDN/proxy headers before hitting external APIs.

    Supported headers (in priority order):
    - CF-IPCountry (Cloudflare)
    - X-Country-Code
    - X-GeoIP-Country
    - X-Forwarded-Country
    Returns (country_name, iso2_code) or ("", "") when not found.
    """
    for header in ("CF-IPCountry", "X-Country-Code", "X-GeoIP-Country", "X-Forwarded-Country"):
        code = req.headers.get(header, "").strip().upper()
        if len(code) == 2 and code.isalpha() and code not in ("XX", "T1"):
            return _ISO2_TO_NAME.get(code, code), code
    return "", ""


# =========================================================
# RATE LIMITING DECORATOR
# =========================================================

def rate_limit(max_per_ip=Config.MAX_DOWNLOADS_PER_IP):
    """Rate limiting decorator for FastAPI endpoints.

    The decorated function must accept ``request: Request`` as its first
    positional or keyword argument so that the IP address can be extracted.
    """
    def decorator(f):
        @wraps(f)
        async def wrapped(*args, request: Request, **kwargs):
            ip = request.client.host if request.client else "unknown"
            with downloads_lock:
                count = ip_download_count.get(ip, 0)
                if count >= max_per_ip:
                    return JSONResponse(
                        {"error": f"Rate limit exceeded. Maximum {max_per_ip} concurrent downloads per IP."},
                        status_code=429,
                    )
                ip_download_count[ip] = count + 1

            try:
                return await f(*args, request=request, **kwargs)
            finally:
                with downloads_lock:
                    ip_download_count[ip] = ip_download_count.get(ip, 1) - 1
                    if ip_download_count[ip] <= 0:
                        ip_download_count.pop(ip, None)
        return wrapped
    return decorator

# =========================================================
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


def check_yt_dlp():
    """Check if yt-dlp is installed and accessible"""
    try:
        logger.info(f"✅ yt-dlp version: {yt_dlp.version.__version__}")
        return True
    except Exception as e:
        logger.error(f"❌ Error checking yt-dlp: {e}")
        return False

def check_ffmpeg():
    """Check if ffmpeg is installed"""
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        logger.info(f"✅ ffmpeg found at: {ffmpeg_path}")
        return True
    else:
        logger.warning("⚠️ ffmpeg not found - some formats may not work")
        return False

# =========================================================
# HELPER FUNCTIONS
# =========================================================

def safe_filename(name: str) -> str:
    """Create a safe filename"""
    # Remove invalid characters
    name = "".join(c for c in name if c.isalnum() or c in (" ", "-", "_", ".", "(", ")"))
    # Limit length
    if len(name) > 100:
        name = name[:100]
    return name.strip()

def format_size(size_bytes):
    """Format file size"""
    if size_bytes == 0:
        return "0 B"
    size_names = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    while size_bytes >= 1024 and i < len(size_names) - 1:
        size_bytes /= 1024.0
        i += 1
    return f"{size_bytes:.2f} {size_names[i]}"

def get_ssl_env() -> dict:
    """Return environment with SSL certificate vars"""
    env = os.environ.copy()
    env["SSL_CERT_FILE"] = certifi.where()
    env["REQUESTS_CA_BUNDLE"] = certifi.where()
    return env

def _get_yt_extractor_args() -> dict:
    """Build YouTube extractor args letting yt-dlp pick the best player clients.

    Using ``"default"`` delegates the client selection to yt-dlp so it can
    automatically switch between its unauthenticated defaults (``android_vr``,
    ``web``, ``web_safari``) and its authenticated defaults (``tv_downgraded``,
    ``web``, ``web_safari``) depending on whether a cookies file is present.

    Hard-coding specific clients caused YouTube authentication errors because
    ``android_vr`` does not support cookies and was silently dropped when a
    cookies file was supplied, removing the high-priority ``tv_downgraded``
    client that yt-dlp would otherwise use for authenticated sessions.

    See https://github.com/yt-dlp/yt-dlp/wiki/Extractors#youtube for details.
    """
    args: dict = {"player_client": ["default"]}
    return {"youtube": args}


def _get_cookie_opts() -> dict:
    """Return yt-dlp ``cookiefile`` option when a valid cookies file exists.

    The cookies file path is controlled by the ``COOKIES_FILE`` env-var and
    defaults to ``data/cookies.txt``.  If the file doesn't exist an empty dict
    is returned so callers can simply unpack it into their ``ydl_opts``.
    """
    if os.path.isfile(COOKIES_FILE):
        return {"cookiefile": COOKIES_FILE}
    return {}

def _friendly_cookie_error(error_msg: str) -> str:
    """Return a user-friendly message when YouTube bot-detection triggers.

    Detects the ``Sign in to confirm you're not a bot`` error emitted by
    yt-dlp and replaces it with actionable guidance so the user knows they
    need to upload a cookies file via the admin panel.
    """
    lower = error_msg.lower()
    if "sign in to confirm" in lower or "confirm you're not a bot" in lower:
        if os.path.isfile(COOKIES_FILE):
            return (
                "YouTube bot detection triggered. Your cookies file may be "
                "expired or invalid. Please upload a fresh cookies.txt file "
                "via the Admin panel (Admin → Cookies)."
            )
        return (
            "YouTube requires authentication. Please upload a cookies.txt "
            "file via the Admin panel (Admin → Cookies) to bypass bot "
            "detection. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ"
            "#how-do-i-pass-cookies-to-yt-dlp for how to export cookies."
        )
    return error_msg


def format_speed(bytes_per_sec) -> str:
    """Format bytes/s to a human-readable speed string"""
    if bytes_per_sec is None or bytes_per_sec <= 0:
        return ""
    for unit in ("B", "KiB", "MiB", "GiB"):
        if bytes_per_sec < 1024.0:
            return f"{bytes_per_sec:.2f}{unit}/s"
        bytes_per_sec /= 1024.0
    return f"{bytes_per_sec:.2f}TiB/s"

def format_eta(seconds) -> str:
    """Format seconds to mm:ss ETA string"""
    if seconds is None:
        return ""
    m, s = divmod(int(seconds), 60)
    return f"{m}:{s:02d}"

_CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/132.0.0.0 Safari/537.36"
)


def normalize_format_spec(fmt: str) -> str:
    """Ensure the format spec has a fallback so that 'format not available'
    errors are avoided.  Any spec that already contains '/' already has its
    own fallback chain and is returned unchanged.  Otherwise '/best' is
    appended so yt-dlp can always find something to download.
    """
    fmt = (fmt or "best").strip() or "best"
    # Already contains a fallback separator — leave untouched
    if "/" in fmt:
        return fmt
    # Append a generic fallback so yt-dlp can always find something to download
    return f"{fmt}/best"


def get_video_info(url: str) -> dict:
    """Get video information without downloading, using the yt-dlp Python API"""
    try:
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "extractor_args": _get_yt_extractor_args(),
            "http_headers": {"User-Agent": _CHROME_UA},
            "extractor_retries": 5,
            "retries": 5,
            "sleep_requests": 1,
            "sleep_interval": 5,
            "max_sleep_interval": 10,
            "geo_bypass": True,
            **_get_cookie_opts(),
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        return {
            "title": info.get("title", "Unknown"),
            "duration": info.get("duration", 0),
            "uploader": info.get("uploader", "Unknown"),
            "thumbnail": info.get("thumbnail", ""),
            "formats": [
                {
                    "format_id": f.get("format_id"),
                    "ext": f.get("ext"),
                    "resolution": f.get("resolution", "N/A"),
                    "filesize": f.get("filesize", 0),
                    "format_note": f.get("format_note", "")
                }
                for f in info.get("formats", [])
                if f.get("vcodec") != "none"
            ],
            "audio_formats": [
                {
                    "format_id": f.get("format_id"),
                    "ext": f.get("ext"),
                    "abr": f.get("abr", 0),
                    "filesize": f.get("filesize", 0),
                    "format_note": f.get("format_note", "")
                }
                for f in info.get("formats", [])
                if f.get("acodec") != "none" and f.get("vcodec") == "none"
            ]
        }
    except yt_dlp.utils.DownloadError as e:
        error_msg = _friendly_cookie_error(str(e))
        return {"error": error_msg}
    except Exception as e:
        return {"error": _friendly_cookie_error(str(e))}

# =========================================================
# DOWNLOAD WORKER
# =========================================================

def download_worker(download_id, url, output_template, format_spec):
    """Background thread for downloading using the yt-dlp Python API"""

    def progress_hook(d):
        if d["status"] != "downloading":
            return

        downloaded = d.get("downloaded_bytes") or 0
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        percent = (100.0 * downloaded / total) if total else 0
        speed = format_speed(d.get("speed"))
        eta = format_eta(d.get("eta"))
        size = format_size(total) if total else ""

        with downloads_lock:
            downloads[download_id].update({
                "percent": percent,
                "speed": speed,
                "eta": eta,
                "size": size,
            })

        try:
            emit_from_thread(
                "progress",
                {
                    "id": download_id,
                    "line": "",
                    "percent": percent,
                    "speed": speed,
                    "eta": eta,
                    "size": size,
                },
                room=download_id,
            )
        except Exception as e:
            logger.error(f"Socket emit error: {e}")

    ydl_opts = {
        "format": normalize_format_spec(format_spec),
        "outtmpl": output_template,
        "noplaylist": True,
        "extractor_args": _get_yt_extractor_args(),
        "http_headers": {"User-Agent": _CHROME_UA},
        "extractor_retries": 5,
        "retries": 5,
        "sleep_requests": 1,
        "sleep_interval": 5,
        "max_sleep_interval": 10,
        "geo_bypass": True,
        "progress_hooks": [progress_hook],
        "quiet": True,
        "no_warnings": True,
        **_get_cookie_opts(),
    }

    # Add ffmpeg if available
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        ydl_opts["ffmpeg_location"] = ffmpeg_path

    with downloads_lock:
        downloads[download_id]["status"] = "downloading"
        downloads[download_id]["start_time"] = time.time()

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        with downloads_lock:
            downloads[download_id].update({
                "status": "completed",
                "end_time": time.time(),
                "percent": 100
            })

            # Find downloaded file
            base_name = os.path.splitext(os.path.basename(output_template))[0]
            for file in os.listdir(DOWNLOAD_FOLDER):
                if file.startswith(base_name):
                    file_path = os.path.join(DOWNLOAD_FOLDER, file)
                    downloads[download_id].update({
                        "filename": file,
                        "file_size": os.path.getsize(file_path),
                        "file_size_hr": format_size(os.path.getsize(file_path))
                    })
                    break

        emit_from_thread("completed", {
            "id": download_id,
            "filename": downloads[download_id].get("filename"),
            "title": downloads[download_id].get("title")
        }, room=download_id)
        emit_from_thread("files_updated")
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()

    except yt_dlp.utils.DownloadError as e:
        error_msg = _friendly_cookie_error(str(e))
        with downloads_lock:
            downloads[download_id].update({
                "status": "failed",
                "error": error_msg,
                "end_time": time.time(),
            })
        emit_from_thread("failed", {
            "id": download_id,
            "error": error_msg
        }, room=download_id)
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()

    except Exception as e:
        logger.error(f"Download worker error: {e}")
        error_msg = _friendly_cookie_error(str(e))
        with downloads_lock:
            downloads[download_id].update({
                "status": "failed",
                "error": error_msg,
                "end_time": time.time(),
            })
        emit_from_thread("failed", {
            "id": download_id,
            "error": error_msg
        }, room=download_id)
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()

    finally:
        # Cleanup
        with downloads_lock:
            if download_id in active_threads:
                del active_threads[download_id]

# =========================================================
# CONVERSION / EDITING HELPERS
# =========================================================

_VALID_VIDEO_FORMATS = {"mp4", "webm", "avi"}
_VALID_AUDIO_FORMATS = {"mp3", "wav"}
_ALL_CONVERT_FORMATS = _VALID_VIDEO_FORMATS | _VALID_AUDIO_FORMATS

_VALID_RESOLUTION_RE = re.compile(r"^\d{2,5}x\d{2,5}$")
_VALID_BITRATE_RE    = re.compile(r"^\d+[kKmMgG]?$")
# Matches: plain seconds (e.g. "90", "1.5"), MM:SS (e.g. "1:30"), HH:MM:SS (e.g. "1:02:30")
_VALID_TIME_RE = re.compile(r"^\d+(\.\d+)?$|^\d+:\d{1,2}(\.\d+)?$|^\d+:\d{2}:\d{2}(\.\d+)?$")


def _resolve_download_file(filename: str):
    """Validate that *filename* refers to a real file inside DOWNLOAD_FOLDER.

    Returns ``(abs_path, None)`` on success or ``(None, JSONResponse)`` on
    failure so callers can simply ``return err`` when it is set.
    """
    if not filename:
        return None, JSONResponse({"error": "filename is required"}, status_code=400)
    filepath = os.path.join(DOWNLOAD_FOLDER, filename)
    if not os.path.abspath(filepath).startswith(os.path.abspath(DOWNLOAD_FOLDER)):
        return None, JSONResponse({"error": "Invalid filename"}, status_code=400)
    if not os.path.isfile(filepath):
        return None, JSONResponse({"error": "File not found"}, status_code=404)
    return filepath, None


def _unique_output(base: str, suffix: str, ext: str) -> tuple[str, str]:
    """Return ``(abs_path, filename)`` for a new file inside DOWNLOAD_FOLDER.

    If ``base_suffix.ext`` already exists, a counter is appended until a free
    name is found.
    """
    name = f"{base}_{suffix}.{ext}"
    path = os.path.join(DOWNLOAD_FOLDER, name)
    i = 2
    while os.path.exists(path):
        name = f"{base}_{suffix}_{i}.{ext}"
        path = os.path.join(DOWNLOAD_FOLDER, name)
        i += 1
    return path, name


def _start_ffmpeg_job(
    job_id: str,
    cmd: list,
    output_filename: str,
    event: str = "job_complete",
    cleanup=None,
):
    """Run an ffmpeg *cmd* in a daemon thread, updating *conversions[job_id]*.

    Emits ``event`` with ``{id, filename}`` on success, or ``event_failed``
    with ``{id, error}`` on failure.  The optional *cleanup* callable is
    invoked (once) when the thread finishes, regardless of outcome.
    """
    def _worker():
        with conversions_lock:
            conversions[job_id]["status"] = "processing"
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True,
                timeout=3600, env=get_ssl_env(),
            )
            if result.returncode != 0:
                err = (result.stderr or "ffmpeg returned a non-zero exit code")[-800:]
                with conversions_lock:
                    conversions[job_id].update({"status": "failed", "error": err})
                emit_from_thread(event + "_failed", {"id": job_id, "error": err})
                logger.error("ffmpeg [%s]: %s", job_id, err)
            else:
                with conversions_lock:
                    conversions[job_id].update({
                        "status": "completed",
                        "filename": output_filename,
                    })
                emit_from_thread(event, {"id": job_id, "filename": output_filename})
                emit_from_thread("files_updated")
        except subprocess.TimeoutExpired:
            err = "ffmpeg timed out (1-hour limit exceeded)"
            with conversions_lock:
                conversions[job_id].update({"status": "failed", "error": err})
            emit_from_thread(event + "_failed", {"id": job_id, "error": err})
        except Exception as exc:
            err = str(exc)
            logger.error("ffmpeg worker exception [%s]: %s", job_id, exc)
            with conversions_lock:
                conversions[job_id].update({"status": "failed", "error": err})
            emit_from_thread(event + "_failed", {"id": job_id, "error": err})
        finally:
            if cleanup:
                try:
                    cleanup()
                except Exception:
                    pass

    threading.Thread(target=_worker, daemon=True).start()


# =========================================================
# ROUTES
# =========================================================

@fastapi_app.get("/")
async def index(request: Request):
    """Main page"""
    try:
        return templates.TemplateResponse(
            "index.html",
            {"request": request, "is_admin": bool(request.session.get("admin_logged_in"))},
        )
    except Exception as e:
        logger.error(f"Template error: {e}")
        return JSONResponse({"error": "Template not found"}, status_code=500)

@fastapi_app.get("/ads.txt")
async def ads_txt():
    """Serve ads.txt for Google AdSense verification"""
    ads_txt_path = os.path.join(ROOT_DIR, "ads.txt")
    if os.path.exists(ads_txt_path):
        return FileResponse(ads_txt_path, media_type="text/plain")
    logger.warning("ads.txt file not found at %s", ads_txt_path)
    return JSONResponse({"error": "ads.txt not found"}, status_code=404)

@fastapi_app.get("/health")
async def health():
    """Health check endpoint"""
    return JSONResponse({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    })

@fastapi_app.post("/start_download")
@rate_limit()
async def start_download(request: Request, url: str = Form(None), format: str = Form("best")):
    """Start a download with better error feedback"""
    format_spec = format

    if not url:
        return JSONResponse({"error": "URL is required"}, status_code=400)

    # Check concurrent downloads
    with downloads_lock:
        active_count = sum(1 for d in downloads.values()
                          if d["status"] in ("queued", "downloading"))
        if active_count >= Config.MAX_CONCURRENT_DOWNLOADS:
            return JSONResponse({
                "error": f"Maximum concurrent downloads reached ({Config.MAX_CONCURRENT_DOWNLOADS})"
            }, status_code=429)

    download_id = str(uuid.uuid4())

    # Get video info (may contain error, but we still allow download attempt)
    info = get_video_info(url)
    if info and "error" not in info:
        title = info.get("title", f"video_{download_id[:8]}")
    else:
        title = f"video_{download_id[:8]}"
        if info and "error" in info:
            logger.warning(f"Info error for {url}: {info['error']}")

    safe_title = safe_filename(title)
    output_template = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}.%(ext)s")

    # Store download info
    ip = request.client.host if request.client else "unknown"
    # Try CDN/proxy headers first for country
    hdr_country, hdr_code = _get_country_from_headers(request)
    if hdr_country and ip not in ip_country_cache:
        ip_country_cache[ip] = {"country": hdr_country, "code": hdr_code, "city": "", "region": ""}
    elif ip not in ip_country_cache and _is_private_ip(ip):
        ip_country_cache[ip] = {"country": "Local", "code": "", "city": "", "region": ""}
    cached_geo = ip_country_cache.get(ip, {})
    with downloads_lock:
        downloads[download_id] = {
            "id": download_id,
            "url": url,
            "title": title,
            "safe_title": safe_title,
            "status": "queued",
            "percent": 0,
            "output_template": output_template,
            "format": format_spec,
            "created_at": time.time(),
            "filename": None,
            "ip": ip,
            "country": cached_geo.get("country", ""),
            "country_code": cached_geo.get("code", ""),
            "city": cached_geo.get("city", ""),
            "region": cached_geo.get("region", ""),
            "info_error": info.get("error") if info and "error" in info else None
        }
    # Resolve the requester's country in background if not already cached
    if ip not in ip_country_cache:
        accept_lang = request.headers.get("accept-language", "")
        threading.Thread(
            target=_lookup_country_async, args=(ip, accept_lang), daemon=True
        ).start()

    # Start download thread
    thread = threading.Thread(
        target=download_worker,
        args=(download_id, url, output_template, format_spec),
        daemon=True,
    )
    thread.start()

    with downloads_lock:
        active_threads[download_id] = thread

    threading.Thread(target=save_downloads_to_disk, daemon=True).start()

    return JSONResponse({
        "download_id": download_id,
        "title": title,
        "status": "queued",
        "warning": info.get("error") if info and "error" in info else None
    })

@fastapi_app.get("/status/{download_id}")
async def get_status(download_id: str):
    """Get download status"""
    with downloads_lock:
        download = downloads.get(download_id, {})
        safe_download = {
            "id": download.get("id"),
            "title": download.get("title"),
            "status": download.get("status"),
            "percent": download.get("percent"),
            "speed": download.get("speed"),
            "eta": download.get("eta"),
            "size": download.get("size"),
            "filename": download.get("filename"),
            "file_size_hr": download.get("file_size_hr"),
            "error": download.get("error")
        }
    return JSONResponse(safe_download)

@fastapi_app.get("/files")
async def list_files(request: Request):
    """List downloaded files"""
    files = []
    try:
        for name in os.listdir(DOWNLOAD_FOLDER):
            path = os.path.join(DOWNLOAD_FOLDER, name)
            if os.path.isfile(path):
                stat = os.stat(path)
                files.append({
                    "name": name,
                    "size": stat.st_size,
                    "size_hr": format_size(stat.st_size),
                    "modified": stat.st_mtime,
                    "modified_str": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                    "url": str(request.url_for('download_file', filename=name))
                })
        files.sort(key=lambda f: f["modified"], reverse=True)
    except Exception as e:
        logger.error(f"Error listing files: {e}")
        return JSONResponse({"error": "Failed to list files"}, status_code=500)

    return JSONResponse(files)

@fastapi_app.get("/downloads/{filename:path}", name="download_file")
async def download_file(filename: str):
    """Serve downloaded file"""
    try:
        filepath = os.path.join(DOWNLOAD_FOLDER, filename)
        if not os.path.abspath(filepath).startswith(os.path.abspath(DOWNLOAD_FOLDER)):
            return JSONResponse({"error": "Invalid filename"}, status_code=400)
        if not os.path.isfile(filepath):
            return JSONResponse({"error": "File not found"}, status_code=404)
        return FileResponse(
            filepath,
            filename=filename,
            media_type="application/octet-stream",
        )
    except Exception as e:
        logger.error(f"Download error: {e}")
        return JSONResponse({"error": "File not found"}, status_code=404)

# MIME types that Python's mimetypes module maps incorrectly or leaves absent,
# causing browsers to refuse to decode the audio track inside video files.
_MIME_OVERRIDES = {
    ".ts":   "video/mp2t",    # Python maps .ts → text/vnd.trolltech.linguist
    ".weba": "audio/webm",    # Python has no mapping for .weba
    ".opus": "audio/opus",    # Python maps .opus → audio/ogg (imprecise)
    ".3gp":  "video/3gpp",    # Python maps .3gp → audio/3gpp (wrong for video)
    ".3g2":  "video/3gpp2",   # Python maps .3g2 → audio/3gpp2 (wrong for video)
}

@fastapi_app.get("/stream/{filename:path}")
async def stream_file(filename: str):
    """Serve a downloaded file inline for in-browser preview.

    Differs from /downloads/ in that the file is served without the
    Content-Disposition: attachment header, so browsers (including iOS Safari)
    can play it directly in a <video>/<audio> element.

    Explicit MIME type overrides are applied for extensions that Python's
    mimetypes module maps incorrectly (e.g. .ts → text/vnd.trolltech.linguist),
    which would otherwise prevent the browser from decoding the audio track.
    """
    try:
        filepath = os.path.join(DOWNLOAD_FOLDER, filename)
        if not os.path.realpath(filepath).startswith(os.path.realpath(DOWNLOAD_FOLDER)):
            return JSONResponse({"error": "Invalid filename"}, status_code=400)
        if not os.path.isfile(filepath):
            return JSONResponse({"error": "File not found"}, status_code=404)
        ext = os.path.splitext(filename)[1].lower()
        media_type = _MIME_OVERRIDES.get(ext) or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        return FileResponse(
            filepath,
            media_type=media_type,
            content_disposition_type="inline",
        )
    except Exception as e:
        logger.error(f"Stream error: {e}")
        return JSONResponse({"error": "File not found"}, status_code=404)


@fastapi_app.delete("/delete/{filename:path}")
async def delete_file(filename: str):
    """Delete a downloaded file"""
    try:
        filepath = os.path.join(DOWNLOAD_FOLDER, filename)

        # Security check
        if not os.path.abspath(filepath).startswith(os.path.abspath(DOWNLOAD_FOLDER)):
            return JSONResponse({"error": "Invalid filename"}, status_code=400)

        if os.path.exists(filepath) and os.path.isfile(filepath):
            os.remove(filepath)
            emit_from_thread("files_updated")
            logger.info(f"Deleted file: {filename}")
            return JSONResponse({"success": True})
        else:
            return JSONResponse({"error": "File not found"}, status_code=404)
    except Exception as e:
        logger.error(f"Delete error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

@fastapi_app.get("/stats")
async def get_stats():
    """Get download statistics including all-time totals"""
    try:
        files = []
        total_size = 0
        for name in os.listdir(DOWNLOAD_FOLDER):
            path = os.path.join(DOWNLOAD_FOLDER, name)
            if os.path.isfile(path):
                size = os.path.getsize(path)
                total_size += size
                files.append(name)

        with downloads_lock:
            active_count = sum(1 for d in downloads.values()
                              if d["status"] in ("queued", "downloading"))

        persistent = _get_persistent_stats()

        return JSONResponse({
            "file_count": len(files),
            "total_size": total_size,
            "total_size_hr": format_size(total_size),
            "active_downloads": active_count,
            "max_concurrent": Config.MAX_CONCURRENT_DOWNLOADS,
            "total_downloads": persistent["total_downloads"],
            "total_visitors": persistent["total_site_visitors"],
        })
    except Exception as e:
        logger.error(f"Stats error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

@fastapi_app.get("/active_downloads")
async def active_downloads_list():
    """Return count and details of active/queued downloads"""
    with downloads_lock:
        active = [
            {
                "id": d["id"],
                "title": d.get("title"),
                "status": d["status"],
                "percent": d.get("percent", 0),
                "speed": d.get("speed", ""),
                "eta": d.get("eta", ""),
                "size": d.get("size", "")
            }
            for d in downloads.values()
            if d["status"] in ("queued", "downloading")
        ]
    return JSONResponse({"count": len(active), "downloads": active})

@fastapi_app.post("/cancel/{download_id}")
async def cancel_download(download_id: str):
    """Cancel an ongoing download"""
    with downloads_lock:
        if download_id in downloads:
            if downloads[download_id]["status"] in ("queued", "downloading"):
                downloads[download_id]["status"] = "cancelled"
                emit_from_thread("cancelled", {"id": download_id}, room=download_id)
                logger.info(f"Cancelled download: {download_id}")
                return JSONResponse({"success": True})

    return JSONResponse({"error": "Download not found"}, status_code=404)

@fastapi_app.get("/const")
@admin_required
async def admin_page(request: Request):
    """Admin page — full download history (authentication required)"""
    return templates.TemplateResponse("const.html", {"request": request})


@fastapi_app.get("/admin/login")
async def admin_login_get(request: Request):
    """Admin login page (GET)."""
    return templates.TemplateResponse(
        "admin_login.html",
        {"request": request, "error": None, "has_admin": admin_user_exists()},
    )


@fastapi_app.post("/admin/login")
async def admin_login_post(request: Request):
    """Admin login (POST with form data)."""
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
    """Admin registration page (GET)."""
    if request.session.get("admin_logged_in"):
        return RedirectResponse(url="/const", status_code=302)
    return templates.TemplateResponse(
        "admin_login.html",
        {"request": request, "error": None, "success": None,
         "register_mode": True, "has_admin": admin_user_exists()},
    )


@fastapi_app.post("/admin/register")
async def admin_register_post(request: Request):
    """Admin registration (POST with form data)."""
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


@fastapi_app.middleware("http")
async def track_admin_visitor(request: Request, call_next):
    """Record a visit to tracked pages (main site + admin page) for analytics."""
    response = await call_next(request)

    if request.url.path not in TRACKED_VISITOR_PATHS:
        return response

    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")

    # Try to get country from CDN/proxy headers first
    hdr_country, hdr_code = _get_country_from_headers(request)
    if hdr_country and ip not in ip_country_cache:
        ip_country_cache[ip] = {"country": hdr_country, "code": hdr_code, "city": "", "region": ""}
    elif ip not in ip_country_cache and _is_private_ip(ip):
        ip_country_cache[ip] = {"country": "Local", "code": "", "city": "", "region": ""}

    cached = ip_country_cache.get(ip, {})
    visitor_entry = {
        "ip": ip,
        "timestamp": time.time(),
        "user_agent": ua,
        "browser": _parse_browser(ua),
        "country": cached.get("country", ""),
        "country_code": cached.get("code", ""),
        "city": cached.get("city", ""),
        "region": cached.get("region", ""),
        "page": request.url.path,
    }
    with visitors_lock:
        visitors.append(visitor_entry)
    # Resolve country in the background if not cached yet
    if ip not in ip_country_cache:
        accept_lang = request.headers.get("accept-language", "")
        threading.Thread(
            target=_lookup_country_async, args=(ip, accept_lang), daemon=True
        ).start()
    # Debounced save to avoid a thread-per-visit under high traffic
    _schedule_visitor_save()

    return response


@fastapi_app.get("/admin/downloads")
@admin_required
async def admin_downloads_api(request: Request):
    """Return the complete download history for the admin page"""
    with downloads_lock:
        history = []
        for d in downloads.values():
            history.append({
                "id":           d.get("id"),
                "title":        d.get("title"),
                "url":          d.get("url"),
                "status":       d.get("status"),
                "percent":      d.get("percent"),
                "filename":     d.get("filename"),
                "file_size_hr": d.get("file_size_hr"),
                "created_at":   d.get("created_at"),
                "end_time":     d.get("end_time"),
                "error":        d.get("error"),
                "ip":           d.get("ip"),
                "country":      d.get("country", ""),
                "country_code": d.get("country_code", ""),
                "city":         d.get("city", ""),
                "region":       d.get("region", ""),
            })
        history.sort(key=lambda x: x.get("created_at") or 0, reverse=True)
    return JSONResponse(history)


@fastapi_app.get("/admin/visitors")
@admin_required
async def admin_visitors_api(request: Request):
    """Return visitor analytics for the admin page."""
    with visitors_lock:
        data = list(visitors)
    data.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
    return JSONResponse(data)


def _get_persistent_stats() -> dict:
    """Query the database for all-time aggregate stats (accurate even after in-memory cleanup).

    Returns a dict with keys:
        total_downloads, daily_downloads, download_rate_per_day,
        total_site_visitors, daily_site_visitors
    """
    now = datetime.now()
    today_start = datetime.combine(now.date(), datetime.min.time()).timestamp()
    week_start = (now - timedelta(days=7)).timestamp()

    try:
        with _db_lock:
            conn = _get_db()
            try:
                # Downloads: parse created_at from the JSON blob
                dl_rows = _execute(conn, "SELECT data FROM downloads").fetchall()
                total_downloads = len(dl_rows)
                daily_downloads = 0
                week_downloads = 0
                for row in dl_rows:
                    try:
                        d = json.loads(row["data"])
                        created = d.get("created_at") or 0
                        if created >= today_start:
                            daily_downloads += 1
                        if created >= week_start:
                            week_downloads += 1
                    except Exception:
                        pass

                # Visitors: only count main-site visits (page == "/")
                # Legacy records without a "page" key were admin-page visits, so skip them.
                v_rows = _execute(conn, "SELECT data FROM visitors").fetchall()
                total_site_visitors = 0
                daily_site_visitors = 0
                for row in v_rows:
                    try:
                        v = json.loads(row["data"])
                        if v.get("page") == "/":
                            total_site_visitors += 1
                            if v.get("timestamp", 0) >= today_start:
                                daily_site_visitors += 1
                    except Exception:
                        pass
            finally:
                conn.close()
    except Exception as exc:
        logger.error(f"_get_persistent_stats error: {exc}")
        total_downloads = 0
        daily_downloads = 0
        week_downloads = 0
        total_site_visitors = 0
        daily_site_visitors = 0

    download_rate_per_day = round(week_downloads / 7.0, 2)

    return {
        "total_downloads": total_downloads,
        "daily_downloads": daily_downloads,
        "download_rate_per_day": download_rate_per_day,
        "total_site_visitors": total_site_visitors,
        "daily_site_visitors": daily_site_visitors,
    }


@fastapi_app.get("/admin/analytics")
@admin_required
async def admin_analytics_api(request: Request):
    """Return aggregated analytics including country totals and persistent stats."""
    with downloads_lock:
        dl_list = list(downloads.values())
    with visitors_lock:
        v_list = list(visitors)

    # Country totals for downloads
    dl_countries: dict = {}
    for d in dl_list:
        country = d.get("country") or "Unknown"
        code = d.get("country_code") or ""
        key = f"{country}||{code}"
        dl_countries[key] = dl_countries.get(key, 0) + 1

    # Country totals for visitors (main-site and admin page combined)
    v_countries: dict = {}
    for v in v_list:
        country = v.get("country") or "Unknown"
        code = v.get("country_code") or ""
        key = f"{country}||{code}"
        v_countries[key] = v_countries.get(key, 0) + 1

    # Unique countries represented across both downloads and visitors
    all_country_names = set()
    for k in list(dl_countries.keys()) + list(v_countries.keys()):
        name = k.split("||")[0]
        if name and name != "Unknown":
            all_country_names.add(name)

    # Persistent aggregate stats (queried from the database for accuracy)
    persistent = _get_persistent_stats()

    return JSONResponse({
        "download_countries": [
            {"country": k.split("||")[0], "code": k.split("||")[1], "count": v}
            for k, v in sorted(dl_countries.items(), key=lambda x: x[1], reverse=True)
        ],
        "visitor_countries": [
            {"country": k.split("||")[0], "code": k.split("||")[1], "count": v}
            for k, v in sorted(v_countries.items(), key=lambda x: x[1], reverse=True)
        ],
        "unique_countries_total": len(all_country_names),
        "total_downloads": persistent["total_downloads"],
        "daily_downloads": persistent["daily_downloads"],
        "download_rate_per_day": persistent["download_rate_per_day"],
        "total_site_visitors": persistent["total_site_visitors"],
        "daily_site_visitors": persistent["daily_site_visitors"],
    })


@fastapi_app.delete("/admin/delete_record/{download_id}")
@admin_required
async def admin_delete_record(request: Request, download_id: str):
    """Remove a download record from the history (admin only)."""
    with downloads_lock:
        if download_id not in downloads:
            return JSONResponse({"error": "Record not found"}, status_code=404)
        status = downloads[download_id].get("status")
        if status in ("queued", "downloading"):
            return JSONResponse({"error": "Cannot delete an active download. Cancel it first."}, status_code=409)
        del downloads[download_id]
    threading.Thread(target=save_downloads_to_disk, daemon=True).start()
    logger.info(f"Admin deleted download record: {download_id}")
    return JSONResponse({"success": True})


@fastapi_app.delete("/admin/clear_visitors")
@admin_required
async def admin_clear_visitors(request: Request):
    """Clear all visitor records (admin only)."""
    with visitors_lock:
        visitors.clear()
    threading.Thread(target=save_visitors_to_disk, daemon=True).start()
    logger.info("Admin cleared all visitor records")
    return JSONResponse({"success": True})


@fastapi_app.get("/admin/db/download")
@admin_required
async def admin_db_download(request: Request):
    """Download a database backup (admin only).

    When using PostgreSQL the backup is a JSON file; otherwise the raw SQLite
    file is returned.
    """
    # Flush in-memory state to disk before serving
    save_downloads_to_disk()
    save_visitors_to_disk()
    logger.info("Admin downloaded database backup")

    if USE_POSTGRES:
        # Export PostgreSQL data as JSON
        with _db_lock:
            conn = _get_db()
            try:
                dl_rows = _execute(conn, "SELECT id, data FROM downloads").fetchall()
                v_rows = _execute(conn, "SELECT data FROM visitors ORDER BY id").fetchall()
            finally:
                conn.close()
        backup = {
            "downloads": {r["id"]: json.loads(r["data"]) for r in dl_rows},
            "visitors": [json.loads(r["data"]) for r in v_rows],
        }
        return Response(
            content=json.dumps(backup, indent=2, default=str),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=admin_backup.json"},
        )
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
    """Merge an uploaded backup into the live database (admin only).

    Accepts either a SQLite ``.db`` file (always supported for migration) or a
    JSON backup produced by the PostgreSQL download endpoint.  Downloads are
    merged using an *ignore-on-conflict* strategy (live records take
    precedence).  Visitors from both sources are combined, deduplicated by JSON
    content, and re-sorted chronologically.  After a successful merge the
    in-memory state is reloaded.
    """
    form = await request.form()
    db_file = form.get("db_file")
    if db_file is None:
        return JSONResponse({"error": "No file uploaded"}, status_code=400)
    if not hasattr(db_file, "read"):
        return JSONResponse({"error": "No file selected"}, status_code=400)

    content = await db_file.read()

    # ── Detect format ────────────────────────────────────────
    is_sqlite = len(content) >= 16 and content[:16] == b"SQLite format 3\x00"
    is_json = False
    backup_dl: list[tuple[str, str]] = []
    backup_visitors: list[str] = []

    if not is_sqlite:
        # Try to parse as JSON backup
        _bad_backup_msg = "Uploaded file is not a valid backup (expected SQLite or JSON)"
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict) and ("downloads" in parsed or "visitors" in parsed):
                is_json = True
                dl_data = parsed.get("downloads", {})
                for did, d in dl_data.items():
                    backup_dl.append((did, json.dumps(d, default=str)))
                v_data = parsed.get("visitors", [])
                for v in v_data:
                    backup_visitors.append(json.dumps(v, default=str))
            else:
                return JSONResponse({"error": _bad_backup_msg}, status_code=400)
        except (json.JSONDecodeError, ValueError):
            return JSONResponse({"error": _bad_backup_msg}, status_code=400)

    if is_sqlite:
        # Parse the SQLite backup file
        tmp_path = os.path.join(DATA_DIR, "upload_tmp.db")
        try:
            with open(tmp_path, "wb") as fh:
                fh.write(content)

            check_conn = sqlite3.connect(tmp_path)
            check_conn.row_factory = sqlite3.Row
            try:
                result = check_conn.execute("PRAGMA integrity_check").fetchone()
                if result[0] != "ok":
                    return JSONResponse({"error": "Uploaded database failed integrity check"}, status_code=400)
                try:
                    backup_dl_rows = check_conn.execute("SELECT id, data FROM downloads").fetchall()
                    backup_dl = [(r["id"], r["data"]) for r in backup_dl_rows]
                except sqlite3.OperationalError:
                    backup_dl = []
                try:
                    backup_v_rows = check_conn.execute("SELECT data FROM visitors ORDER BY rowid").fetchall()
                    backup_visitors = [r["data"] for r in backup_v_rows]
                except sqlite3.OperationalError:
                    backup_visitors = []
            finally:
                check_conn.close()
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    # ── Merge into live database ─────────────────────────────
    try:
        save_downloads_to_disk()
        save_visitors_to_disk()

        with _db_lock:
            conn = _get_db()
            try:
                for (did, data_json) in backup_dl:
                    if USE_POSTGRES:
                        cur = conn.cursor()
                        cur.execute(
                            "INSERT INTO downloads (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
                            (did, data_json),
                        )
                    else:
                        conn.execute(
                            "INSERT OR IGNORE INTO downloads (id, data) VALUES (?, ?)",
                            (did, data_json),
                        )

                live_v_rows = _execute(conn, "SELECT data FROM visitors").fetchall()
                live_v_jsons = [r["data"] for r in live_v_rows]

                seen_visitor_jsons: set[str] = set()
                all_visitors = []
                for v_json in live_v_jsons + backup_visitors:
                    if v_json not in seen_visitor_jsons:
                        seen_visitor_jsons.add(v_json)
                        try:
                            all_visitors.append(json.loads(v_json))
                        except (json.JSONDecodeError, ValueError):
                            pass

                all_visitors.sort(key=lambda v: v.get("timestamp", 0))

                _execute(conn, "DELETE FROM visitors")
                for v in all_visitors:
                    _execute(
                        conn,
                        "INSERT INTO visitors (data) VALUES (?)",
                        (json.dumps(v, default=str),),
                    )

                conn.commit()
            finally:
                conn.close()

        global downloads, visitors
        with downloads_lock:
            downloads.clear()
        with visitors_lock:
            visitors.clear()
        load_persistence()

        added_dl = len(backup_dl)
        added_v = len(backup_visitors)
        logger.info(
            f"Admin merged database backup: {added_dl} download records and "
            f"{added_v} visitor records from backup processed"
        )
        return JSONResponse({
            "success": True,
            "message": (
                f"Database merged successfully. "
                f"Processed {added_dl} download record(s) and "
                f"{added_v} visitor record(s) from backup."
            ),
        })
    except Exception as exc:
        logger.error(f"DB upload error: {exc}")
        return JSONResponse({"error": f"Upload failed: {exc}"}, status_code=500)


# ── Cookie management (admin) ─────────────────────────────
@fastapi_app.get("/admin/cookies/status")
@admin_required
async def admin_cookies_status(request: Request):
    """Return whether a cookies file is currently configured."""
    exists = os.path.isfile(COOKIES_FILE)
    info: dict = {"has_cookies": exists}
    if exists:
        info["size"] = os.path.getsize(COOKIES_FILE)
        info["modified"] = os.path.getmtime(COOKIES_FILE)
    return JSONResponse(info)


@fastapi_app.post("/admin/cookies/upload")
@admin_required
async def admin_cookies_upload(request: Request):
    """Upload a Netscape-format cookies.txt file for yt-dlp."""
    form = await request.form()
    cookie_file = form.get("cookie_file")
    if cookie_file is None or not hasattr(cookie_file, "read"):
        return JSONResponse({"error": "No file uploaded"}, status_code=400)

    content = await cookie_file.read()
    if not content:
        return JSONResponse({"error": "Uploaded file is empty"}, status_code=400)

    # Basic validation: Netscape cookies files start with a comment or domain
    text = content.decode("utf-8", errors="replace")
    lines = [s for ln in text.splitlines() if (s := ln.strip()) and not s.startswith("#")]
    if not lines:
        return JSONResponse({"error": "Cookies file appears to be empty (no cookie entries)"}, status_code=400)

    os.makedirs(os.path.dirname(COOKIES_FILE), exist_ok=True)
    with open(COOKIES_FILE, "wb") as fh:
        fh.write(content)
    logger.info("Admin uploaded new cookies file (%d bytes)", len(content))
    return JSONResponse({"success": True, "message": "Cookies file uploaded successfully."})


@fastapi_app.delete("/admin/cookies")
@admin_required
async def admin_cookies_delete(request: Request):
    """Delete the current cookies file."""
    if os.path.isfile(COOKIES_FILE):
        os.remove(COOKIES_FILE)
        logger.info("Admin deleted cookies file")
        return JSONResponse({"success": True, "message": "Cookies file deleted."})
    return JSONResponse({"error": "No cookies file found"}, status_code=404)


# =========================================================
# VIDEO / AUDIO CONVERSION
# =========================================================

def _build_video_convert_cmd(ffmpeg_path, input_path, output_path, fmt,
                              resolution, video_bitrate, audio_bitrate):
    """Build an ffmpeg command list for video/audio conversion."""
    cmd = [ffmpeg_path, "-y", "-i", input_path]
    is_audio_only = fmt in _VALID_AUDIO_FORMATS
    if is_audio_only:
        cmd.append("-vn")
        if fmt == "mp3":
            cmd.extend(["-c:a", "libmp3lame", "-b:a", audio_bitrate or "128k"])
        else:  # wav
            cmd.extend(["-c:a", "pcm_s16le"])
    else:
        if resolution:
            w, h = resolution.split("x")
            cmd.extend(["-vf", f"scale={w}:{h}"])
        if fmt == "mp4":
            cmd.extend(["-c:v", "libx264"])
            if video_bitrate:
                cmd.extend(["-b:v", video_bitrate])
            cmd.extend(["-c:a", "aac"])
            if audio_bitrate:
                cmd.extend(["-b:a", audio_bitrate])
        elif fmt == "webm":
            cmd.extend(["-c:v", "libvpx"])
            if video_bitrate:
                cmd.extend(["-b:v", video_bitrate])
            cmd.extend(["-c:a", "libvorbis"])
            if audio_bitrate:
                cmd.extend(["-b:a", audio_bitrate])
        elif fmt == "avi":
            cmd.extend(["-c:v", "libx264"])
            if video_bitrate:
                cmd.extend(["-b:v", video_bitrate])
            cmd.extend(["-c:a", "libmp3lame"])
            if audio_bitrate:
                cmd.extend(["-b:a", audio_bitrate])
    cmd.append(output_path)
    return cmd


@fastapi_app.post("/convert")
async def convert_file(
    request: Request,
    filename: str = Form(""),
    format: str = Form("mp4"),
    resolution: str = Form(""),
    audio_bitrate: str = Form(""),
    video_bitrate: str = Form(""),
):
    """Convert a downloaded file to a different format, resolution, or bitrate."""
    filename      = filename.strip()
    fmt           = format.strip().lower()
    resolution    = resolution.strip()
    audio_bitrate = audio_bitrate.strip()
    video_bitrate = video_bitrate.strip()

    if fmt not in _ALL_CONVERT_FORMATS:
        return JSONResponse({"error": f"Unsupported format. Choose from: {', '.join(sorted(_ALL_CONVERT_FORMATS))}"}, status_code=400)

    filepath, err = _resolve_download_file(filename)
    if err:
        return err

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return JSONResponse({"error": "ffmpeg is not installed on this server"}, status_code=503)

    if resolution and not _VALID_RESOLUTION_RE.match(resolution):
        return JSONResponse({"error": "Invalid resolution. Use WxH (e.g. 1280x720)"}, status_code=400)
    if audio_bitrate and not _VALID_BITRATE_RE.match(audio_bitrate):
        return JSONResponse({"error": "Invalid audio bitrate (e.g. 128k, 192k)"}, status_code=400)
    if video_bitrate and not _VALID_BITRATE_RE.match(video_bitrate):
        return JSONResponse({"error": "Invalid video bitrate (e.g. 2M, 1500k)"}, status_code=400)

    base = safe_filename(os.path.splitext(filename)[0])
    output_path, output_filename = _unique_output(base, fmt, fmt)

    cmd = _build_video_convert_cmd(
        ffmpeg_path, filepath, output_path, fmt,
        resolution, video_bitrate, audio_bitrate,
    )

    job_id = str(uuid.uuid4())
    with conversions_lock:
        conversions[job_id] = {"status": "queued", "type": "convert", "filename": output_filename}

    _start_ffmpeg_job(job_id, cmd, output_filename)
    return JSONResponse({"job_id": job_id, "output_filename": output_filename})


@fastapi_app.post("/batch_convert")
async def batch_convert(
    request: Request,
    filenames: str = Form("[]"),
    format: str = Form("mp4"),
    resolution: str = Form(""),
    audio_bitrate: str = Form(""),
    video_bitrate: str = Form(""),
):
    """Convert multiple files to a target format/resolution/bitrate."""
    filenames_json = filenames
    fmt           = format.strip().lower()
    resolution    = resolution.strip()
    audio_bitrate = audio_bitrate.strip()
    video_bitrate = video_bitrate.strip()

    try:
        filenames = json.loads(filenames_json)
    except (json.JSONDecodeError, ValueError):
        return JSONResponse({"error": "Invalid filenames JSON"}, status_code=400)

    if not isinstance(filenames, list) or len(filenames) == 0:
        return JSONResponse({"error": "No files provided"}, status_code=400)

    if fmt not in _ALL_CONVERT_FORMATS:
        return JSONResponse({"error": f"Unsupported format. Choose from: {', '.join(sorted(_ALL_CONVERT_FORMATS))}"}, status_code=400)

    if len(filenames) > 20:
        return JSONResponse({"error": "Maximum 20 files per batch"}, status_code=400)

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return JSONResponse({"error": "ffmpeg is not installed on this server"}, status_code=503)

    if resolution and not _VALID_RESOLUTION_RE.match(resolution):
        return JSONResponse({"error": "Invalid resolution. Use WxH (e.g. 1280x720)"}, status_code=400)
    if audio_bitrate and not _VALID_BITRATE_RE.match(audio_bitrate):
        return JSONResponse({"error": "Invalid audio bitrate"}, status_code=400)
    if video_bitrate and not _VALID_BITRATE_RE.match(video_bitrate):
        return JSONResponse({"error": "Invalid video bitrate"}, status_code=400)

    jobs = []
    for fn in filenames:
        filepath, ferr = _resolve_download_file(fn)
        if ferr:
            continue  # skip invalid files silently
        base = safe_filename(os.path.splitext(fn)[0])
        output_path, output_filename = _unique_output(base, fmt, fmt)
        cmd = _build_video_convert_cmd(
            ffmpeg_path, filepath, output_path, fmt,
            resolution, video_bitrate, audio_bitrate,
        )
        job_id = str(uuid.uuid4())
        with conversions_lock:
            conversions[job_id] = {"status": "queued", "type": "batch_convert", "filename": output_filename}
        _start_ffmpeg_job(job_id, cmd, output_filename)
        jobs.append({"job_id": job_id, "source": fn, "output_filename": output_filename})

    if not jobs:
        return JSONResponse({"error": "No valid files to convert"}, status_code=400)

    return JSONResponse({"jobs": jobs, "total": len(jobs)})


# =========================================================
# VIDEO EDITING TOOLS
# =========================================================

@fastapi_app.post("/trim")
async def trim_video(
    request: Request,
    filename: str = Form(""),
    start_time: str = Form("0"),
    end_time: str = Form(""),
):
    """Trim a video to [start_time, end_time]."""
    filename   = filename.strip()
    start_time = start_time.strip() or "0"
    end_time   = end_time.strip()

    if not end_time:
        return JSONResponse({"error": "end_time is required"}, status_code=400)

    filepath, err = _resolve_download_file(filename)
    if err:
        return err

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return JSONResponse({"error": "ffmpeg is not installed on this server"}, status_code=503)

    time_re = _VALID_TIME_RE
    if not time_re.match(start_time):
        return JSONResponse({"error": "Invalid start_time. Use seconds or HH:MM:SS"}, status_code=400)
    if not time_re.match(end_time):
        return JSONResponse({"error": "Invalid end_time. Use seconds or HH:MM:SS"}, status_code=400)

    ext = os.path.splitext(filename)[1].lstrip(".") or "mp4"
    base = safe_filename(os.path.splitext(filename)[0])
    output_path, output_filename = _unique_output(base, "trim", ext)

    cmd = [
        ffmpeg_path, "-y", "-i", filepath,
        "-ss", start_time, "-to", end_time,
        "-c", "copy", output_path,
    ]

    job_id = str(uuid.uuid4())
    with conversions_lock:
        conversions[job_id] = {"status": "queued", "type": "trim", "filename": output_filename}

    _start_ffmpeg_job(job_id, cmd, output_filename)
    return JSONResponse({"job_id": job_id, "output_filename": output_filename})


@fastapi_app.post("/crop")
async def crop_video(
    request: Request,
    filename: str = Form(""),
    x: str = Form("0"),
    y: str = Form("0"),
    width: str = Form(""),
    height: str = Form(""),
):
    """Crop a video frame to (x, y, width, height)."""
    filename = filename.strip()
    x        = x.strip() or "0"
    y        = y.strip() or "0"
    width    = width.strip()
    height   = height.strip()

    if not width or not height:
        return JSONResponse({"error": "width and height are required"}, status_code=400)

    filepath, err = _resolve_download_file(filename)
    if err:
        return err

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return JSONResponse({"error": "ffmpeg is not installed on this server"}, status_code=503)

    for val in [x, y, width, height]:
        if not val.isdigit():
            return JSONResponse({"error": "x, y, width, and height must be positive integers"}, status_code=400)

    ext = os.path.splitext(filename)[1].lstrip(".") or "mp4"
    base = safe_filename(os.path.splitext(filename)[0])
    output_path, output_filename = _unique_output(base, "crop", ext)

    # ffmpeg crop filter: crop=w:h:x:y
    cmd = [
        ffmpeg_path, "-y", "-i", filepath,
        "-vf", f"crop={width}:{height}:{x}:{y}",
        output_path,
    ]

    job_id = str(uuid.uuid4())
    with conversions_lock:
        conversions[job_id] = {"status": "queued", "type": "crop", "filename": output_filename}

    _start_ffmpeg_job(job_id, cmd, output_filename)
    return JSONResponse({"job_id": job_id, "output_filename": output_filename})


@fastapi_app.post("/watermark")
async def watermark_video(
    request: Request,
    filename: str = Form(""),
    text: str = Form(""),
    position: str = Form("bottom-right"),
    fontsize: str = Form("24"),
):
    """Overlay a text watermark onto a video."""
    filename = filename.strip()
    text     = text.strip()
    position = position.strip()
    fontsize = fontsize.strip() or "24"

    if not text:
        return JSONResponse({"error": "Watermark text is required"}, status_code=400)
    if len(text) > 200:
        return JSONResponse({"error": "Watermark text too long (max 200 chars)"}, status_code=400)

    filepath, err = _resolve_download_file(filename)
    if err:
        return err

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return JSONResponse({"error": "ffmpeg is not installed on this server"}, status_code=503)

    if not fontsize.isdigit() or not (8 <= int(fontsize) <= 120):
        return JSONResponse({"error": "fontsize must be an integer between 8 and 120"}, status_code=400)

    # Escape special chars for ffmpeg drawtext
    escaped = (
        text
        .replace("\\", "\\\\")
        .replace("'",  "\\'")
        .replace(":",  "\\:")
        .replace("%",  "\\%")
    )

    pos_map = {
        "top-left":     "x=10:y=10",
        "top-right":    "x=w-tw-10:y=10",
        "bottom-left":  "x=10:y=h-th-10",
        "bottom-right": "x=w-tw-10:y=h-th-10",
        "center":       "x=(w-tw)/2:y=(h-th)/2",
    }
    xy = pos_map.get(position, pos_map["bottom-right"])

    drawtext = (
        f"drawtext=text='{escaped}':fontsize={fontsize}"
        f":fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=4:{xy}"
    )

    ext = os.path.splitext(filename)[1].lstrip(".") or "mp4"
    base = safe_filename(os.path.splitext(filename)[0])
    output_path, output_filename = _unique_output(base, "watermark", ext)

    cmd = [
        ffmpeg_path, "-y", "-i", filepath,
        "-vf", drawtext, "-c:a", "copy", output_path,
    ]

    job_id = str(uuid.uuid4())
    with conversions_lock:
        conversions[job_id] = {"status": "queued", "type": "watermark", "filename": output_filename}

    _start_ffmpeg_job(job_id, cmd, output_filename)
    return JSONResponse({"job_id": job_id, "output_filename": output_filename})


@fastapi_app.post("/extract_clip")
async def extract_clip(
    request: Request,
    filename: str = Form(""),
    start_time: str = Form("0"),
    duration: str = Form("30"),
):
    """Extract a short clip (10–60 s) starting at start_time."""
    filename   = filename.strip()
    start_time = start_time.strip() or "0"
    duration   = duration.strip() or "30"

    filepath, err = _resolve_download_file(filename)
    if err:
        return err

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return JSONResponse({"error": "ffmpeg is not installed on this server"}, status_code=503)

    try:
        dur_sec = float(duration)
    except ValueError:
        return JSONResponse({"error": "duration must be a number"}, status_code=400)
    if not (10 <= dur_sec <= 60):
        return JSONResponse({"error": "duration must be between 10 and 60 seconds"}, status_code=400)

    if not _VALID_TIME_RE.match(start_time):
        return JSONResponse({"error": "Invalid start_time. Use seconds or HH:MM:SS"}, status_code=400)

    ext = os.path.splitext(filename)[1].lstrip(".") or "mp4"
    base = safe_filename(os.path.splitext(filename)[0])
    output_path, output_filename = _unique_output(base, "clip", ext)

    cmd = [
        ffmpeg_path, "-y", "-i", filepath,
        "-ss", start_time, "-t", str(dur_sec),
        "-c", "copy", output_path,
    ]

    job_id = str(uuid.uuid4())
    with conversions_lock:
        conversions[job_id] = {"status": "queued", "type": "extract_clip", "filename": output_filename}

    _start_ffmpeg_job(job_id, cmd, output_filename)
    return JSONResponse({"job_id": job_id, "output_filename": output_filename})


@fastapi_app.post("/merge")
async def merge_videos(
    request: Request,
    filenames: str = Form("[]"),
    format: str = Form("mp4"),
):
    """Concatenate multiple downloaded videos into a single output file."""
    filenames_json = filenames
    output_format  = format.strip().lower()

    try:
        filenames = json.loads(filenames_json)
    except (json.JSONDecodeError, ValueError):
        return JSONResponse({"error": "Invalid filenames JSON"}, status_code=400)

    if not isinstance(filenames, list) or len(filenames) < 2:
        return JSONResponse({"error": "At least 2 files are required for merge"}, status_code=400)
    if len(filenames) > 20:
        return JSONResponse({"error": "Maximum 20 files per merge"}, status_code=400)

    if output_format not in _VALID_VIDEO_FORMATS:
        return JSONResponse({"error": f"Unsupported format. Choose from: {', '.join(sorted(_VALID_VIDEO_FORMATS))}"}, status_code=400)

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return JSONResponse({"error": "ffmpeg is not installed on this server"}, status_code=503)

    filepaths = []
    for fn in filenames:
        fp, ferr = _resolve_download_file(fn)
        if ferr:
            return ferr
        filepaths.append(fp)

    job_id    = str(uuid.uuid4())
    list_file = os.path.join(DOWNLOAD_FOLDER, f"concat_{job_id}.txt")
    with open(list_file, "w") as fh:
        for fp in filepaths:
            fh.write(f"file '{fp}'\n")

    output_path, output_filename = _unique_output("merged", "videos", output_format)

    cmd = [
        ffmpeg_path, "-y", "-f", "concat", "-safe", "0",
        "-i", list_file, "-c", "copy", output_path,
    ]

    with conversions_lock:
        conversions[job_id] = {"status": "queued", "type": "merge", "filename": output_filename}

    def _remove_list_file():
        try:
            os.remove(list_file)
        except OSError:
            pass

    _start_ffmpeg_job(job_id, cmd, output_filename, cleanup=_remove_list_file)
    return JSONResponse({"job_id": job_id, "output_filename": output_filename})


@fastapi_app.get("/job_status/{job_id}")
async def job_status(job_id: str):
    """Return the current status of a conversion or editing job."""
    with conversions_lock:
        job = conversions.get(job_id)
    if not job:
        return JSONResponse({"error": "Job not found"}, status_code=404)
    return JSONResponse({
        "job_id":    job_id,
        "status":    job.get("status"),
        "type":      job.get("type"),
        "filename":  job.get("filename"),
        "error":     job.get("error"),
    })


# =========================================================
# PLAYLIST & BULK DOWNLOAD
# =========================================================

@fastapi_app.post("/start_playlist_download")
@rate_limit()
async def start_playlist_download(
    request: Request,
    url: str = Form(""),
    format: str = Form("bestvideo*+bestaudio*/best"),
):
    """Download an entire playlist or channel (yt-dlp playlist mode)."""
    url = url.strip()
    format_spec = format

    if not url:
        return JSONResponse({"error": "URL is required"}, status_code=400)

    with downloads_lock:
        active_count = sum(
            1 for d in downloads.values()
            if d["status"] in ("queued", "downloading")
        )
        if active_count >= Config.MAX_CONCURRENT_DOWNLOADS:
            return JSONResponse({
                "error": f"Maximum concurrent downloads reached ({Config.MAX_CONCURRENT_DOWNLOADS})"
            }, status_code=429)

    batch_id = str(uuid.uuid4())
    ip = request.client.host if request.client else "unknown"
    hdr_country, hdr_code = _get_country_from_headers(request)
    if hdr_country and ip not in ip_country_cache:
        ip_country_cache[ip] = {"country": hdr_country, "code": hdr_code, "city": "", "region": ""}
    elif ip not in ip_country_cache and _is_private_ip(ip):
        ip_country_cache[ip] = {"country": "Local", "code": "", "city": "", "region": ""}
    cached_geo = ip_country_cache.get(ip, {})

    output_template = os.path.join(
        DOWNLOAD_FOLDER, "%(playlist_index)02d_%(title).80s.%(ext)s"
    )

    with downloads_lock:
        downloads[batch_id] = {
            "id":           batch_id,
            "url":          url,
            "title":        "Playlist Download",
            "type":         "playlist",
            "status":       "queued",
            "percent":      0,
            "ip":           ip,
            "country":      cached_geo.get("country", ""),
            "country_code": cached_geo.get("code", ""),
            "city":         cached_geo.get("city", ""),
            "region":       cached_geo.get("region", ""),
            "created_at":   time.time(),
        }

    def playlist_worker():
        completed = [0]
        total     = [0]

        def progress_hook(d):
            if d["status"] == "finished":
                completed[0] += 1
                pct = (100.0 * completed[0] / total[0]) if total[0] else 0
                with downloads_lock:
                    downloads[batch_id].update({"percent": pct, "status": "downloading"})
                emit_from_thread(
                    "progress",
                    {"id": batch_id, "percent": pct,
                     "line": f"Downloaded {completed[0]}/{total[0]} videos"},
                    room=batch_id,
                )

        ydl_opts = {
            "format":          normalize_format_spec(format_spec),
            "outtmpl":         output_template,
            "noplaylist":      False,
            "extractor_args":  _get_yt_extractor_args(),
            "http_headers":    {"User-Agent": _CHROME_UA},
            "extractor_retries": 5,
            "retries":         5,
            "sleep_requests":  1,
            "sleep_interval":  5,
            "max_sleep_interval": 10,
            "geo_bypass":      True,
            "progress_hooks":  [progress_hook],
            "quiet":           True,
            "no_warnings":     True,
            **_get_cookie_opts(),
        }
        ffmpeg_path = shutil.which("ffmpeg")
        if ffmpeg_path:
            ydl_opts["ffmpeg_location"] = ffmpeg_path

        with downloads_lock:
            downloads[batch_id]["status"]     = "downloading"
            downloads[batch_id]["start_time"] = time.time()

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if info:
                    entries = info.get("entries") or [info]
                    total[0] = len(entries)
                    with downloads_lock:
                        downloads[batch_id]["title"] = info.get("title", "Playlist")
                ydl.download([url])

            with downloads_lock:
                downloads[batch_id].update({
                    "status":   "completed",
                    "percent":  100,
                    "end_time": time.time(),
                })
            emit_from_thread(
                "completed",
                {"id": batch_id, "title": downloads[batch_id].get("title")},
                room=batch_id,
            )
            emit_from_thread("files_updated")
            threading.Thread(target=save_downloads_to_disk, daemon=True).start()

        except Exception as exc:
            logger.error("Playlist download error: %s", exc)
            error_msg = _friendly_cookie_error(str(exc))
            with downloads_lock:
                downloads[batch_id].update({
                    "status":   "failed",
                    "error":    error_msg,
                    "end_time": time.time(),
                })
            emit_from_thread("failed", {"id": batch_id, "error": error_msg}, room=batch_id)
            threading.Thread(target=save_downloads_to_disk, daemon=True).start()

        finally:
            with downloads_lock:
                active_threads.pop(batch_id, None)

    thread = threading.Thread(target=playlist_worker, daemon=True)
    thread.start()
    with downloads_lock:
        active_threads[batch_id] = thread

    threading.Thread(target=save_downloads_to_disk, daemon=True).start()
    if ip not in ip_country_cache:
        accept_lang = request.headers.get("accept-language", "")
        threading.Thread(target=_lookup_country_async, args=(ip, accept_lang), daemon=True).start()

    return JSONResponse({"download_id": batch_id, "title": "Playlist Download", "status": "queued"})


@fastapi_app.post("/start_batch_download")
async def start_batch_download(
    request: Request,
    urls: str = Form(""),
    format: str = Form("bestvideo*+bestaudio*/best"),
):
    """Start individual downloads for a newline-separated list of URLs."""
    urls_text   = urls.strip()
    format_spec = format

    url_list = [u.strip() for u in urls_text.splitlines() if u.strip()]
    if not url_list:
        return JSONResponse({"error": "At least one URL is required"}, status_code=400)
    if len(url_list) > 20:
        return JSONResponse({"error": "Maximum 20 URLs per batch"}, status_code=400)

    started = []
    ip = request.client.host if request.client else "unknown"
    hdr_country, hdr_code = _get_country_from_headers(request)
    if hdr_country and ip not in ip_country_cache:
        ip_country_cache[ip] = {"country": hdr_country, "code": hdr_code, "city": "", "region": ""}
    elif ip not in ip_country_cache and _is_private_ip(ip):
        ip_country_cache[ip] = {"country": "Local", "code": "", "city": "", "region": ""}
    cached_geo = ip_country_cache.get(ip, {})

    for url in url_list:
        with downloads_lock:
            active_count = sum(
                1 for d in downloads.values()
                if d["status"] in ("queued", "downloading")
            )
            if active_count >= Config.MAX_CONCURRENT_DOWNLOADS:
                break  # stop adding once limit reached

        info = get_video_info(url)
        title = (
            info.get("title", f"video_{uuid.uuid4().hex[:8]}")
            if info and "error" not in info
            else f"video_{uuid.uuid4().hex[:8]}"
        )
        safe_title      = safe_filename(title)
        download_id     = str(uuid.uuid4())
        output_template = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}.%(ext)s")

        with downloads_lock:
            downloads[download_id] = {
                "id":              download_id,
                "url":             url,
                "title":           title,
                "safe_title":      safe_title,
                "status":          "queued",
                "percent":         0,
                "output_template": output_template,
                "format":          format_spec,
                "created_at":      time.time(),
                "filename":        None,
                "ip":              ip,
                "country":         cached_geo.get("country", ""),
                "country_code":    cached_geo.get("code", ""),
                "city":            cached_geo.get("city", ""),
                "region":          cached_geo.get("region", ""),
            }

        thread = threading.Thread(
            target=download_worker,
            args=(download_id, url, output_template, format_spec),
            daemon=True,
        )
        thread.start()
        with downloads_lock:
            active_threads[download_id] = thread

        started.append({"download_id": download_id, "url": url, "title": title})

    if not started:
        return JSONResponse({"error": "Could not start any downloads (concurrent limit reached)"}, status_code=429)

    threading.Thread(target=save_downloads_to_disk, daemon=True).start()
    if ip not in ip_country_cache:
        accept_lang = request.headers.get("accept-language", "")
        threading.Thread(target=_lookup_country_async, args=(ip, accept_lang), daemon=True).start()

    return JSONResponse({"started": started, "total": len(started)})


@fastapi_app.post("/download_zip")
async def download_zip(
    request: Request,
    filenames: str = Form("[]"),
):
    """Package a selection of downloaded files into a ZIP and serve it."""
    filenames_json = filenames

    try:
        parsed_filenames = json.loads(filenames_json)
    except (json.JSONDecodeError, ValueError):
        return JSONResponse({"error": "Invalid filenames JSON"}, status_code=400)

    if not isinstance(parsed_filenames, list) or len(parsed_filenames) == 0:
        return JSONResponse({"error": "No files selected"}, status_code=400)

    filepairs = []
    for fn in parsed_filenames:
        if not fn:
            continue
        fp = os.path.join(DOWNLOAD_FOLDER, fn)
        if not os.path.abspath(fp).startswith(os.path.abspath(DOWNLOAD_FOLDER)):
            continue
        if os.path.isfile(fp):
            filepairs.append((fn, fp))

    if not filepairs:
        return JSONResponse({"error": "No valid files found"}, status_code=404)

    zip_filename = f"downloads_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    zip_path     = os.path.join(DOWNLOAD_FOLDER, zip_filename)
    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for fn, fp in filepairs:
                zf.write(fp, fn)
    except Exception as exc:
        logger.error("ZIP creation error: %s", exc)
        return JSONResponse({"error": f"Failed to create ZIP: {exc}"}, status_code=500)

    return FileResponse(
        zip_path,
        filename=zip_filename,
        media_type="application/zip",
    )


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

@sio.on("subscribe")
async def on_subscribe(sid, data):
    """Subscribe to download updates"""
    download_id = data.get("download_id") if isinstance(data, dict) else None
    if download_id:
        sio.enter_room(sid, download_id)
        await sio.emit("subscribed", {"id": download_id}, room=sid)
        logger.info(f"Client {sid} subscribed to {download_id}")

# =========================================================
# CLEANUP THREAD
# =========================================================

def cleanup_old_files():
    """Delete files that have been on disk for longer than FILE_RETENTION_MINUTES."""
    try:
        current_time = time.time()
        cutoff = current_time - (Config.FILE_RETENTION_MINUTES * 60)
        files_deleted = False

        for filename in os.listdir(DOWNLOAD_FOLDER):
            filepath = os.path.join(DOWNLOAD_FOLDER, filename)
            if os.path.isfile(filepath):
                if os.path.getmtime(filepath) < cutoff:
                    os.remove(filepath)
                    logger.info(f"Auto-cleaned file (>{Config.FILE_RETENTION_MINUTES} min): {filename}")
                    files_deleted = True

        if files_deleted:
            # Notify all connected clients from this background thread so they
            # refresh their "Downloaded Videos" list without waiting for the next
            # manual refresh or Socket.IO reconnect.
            emit_from_thread("files_updated")
    except Exception as e:
        logger.error(f"Cleanup error: {e}")

def cleanup_thread():
    """Background thread for periodic cleanup"""
    while True:
        time.sleep(Config.CLEANUP_INTERVAL)
        cleanup_old_files()

        # Remove stale in-memory download records (keep for 1 h after completion)
        with downloads_lock:
            current_time = time.time()
            to_delete = []
            for did, d in downloads.items():
                if d["status"] in ("completed", "failed", "cancelled"):
                    if current_time - d.get("end_time", current_time) > 3600:
                        to_delete.append(did)
            for did in to_delete:
                del downloads[did]

# =========================================================
# INITIALIZATION
# =========================================================

logger.info("=" * 50)
logger.info("🚀 Starting Video Downloader (Production)")
logger.info("=" * 50)

# Warn if using the default admin password
if Config.ADMIN_PASSWORD == "admin":
    logger.warning(
        "⚠️  ADMIN_PASSWORD is set to the default value 'admin'. "
        "Set the ADMIN_PASSWORD environment variable to a strong password before deploying."
    )

# Check dependencies
check_yt_dlp()
check_ffmpeg()

# Log paths
logger.info(f"📁 Root directory: {ROOT_DIR}")
logger.info(f"📁 Templates directory: {TEMPLATES_DIR}")
logger.info(f"📁 Downloads directory: {DOWNLOAD_FOLDER}")
logger.info(f"📁 Template exists: {os.path.exists(os.path.join(TEMPLATES_DIR, 'index.html'))}")

# Initialise database schema
init_db()
if USE_POSTGRES:
    logger.info("Using PostgreSQL database via DATABASE_URL")
else:
    logger.info(f"Using SQLite database at {DB_PATH}")

# Load persisted data
load_persistence()

# Start cleanup thread
cleanup_thread = threading.Thread(target=cleanup_thread, daemon=True)
cleanup_thread.start()

logger.info("=" * 50)

# =========================================================
# ERROR HANDLERS
# =========================================================

@fastapi_app.exception_handler(404)
async def not_found_error(request: Request, exc):
    return JSONResponse({"error": "Not found"}, status_code=404)

@fastapi_app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404:
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
# ENTRY POINT
# =========================================================

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "False").lower() == "true"

    logger.info(f"🌐 Starting server on port {port}")
    logger.info(f"🐛 Debug mode: {debug}")

    uvicorn.run(
        "api.app:app",
        host="0.0.0.0",
        port=port,
        reload=debug,
        workers=1,
    )