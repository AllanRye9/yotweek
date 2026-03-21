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
    MAX_REVIEWS_PER_IP = 1
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
# React frontend build output
FRONTEND_DIST = os.path.join(ROOT_DIR, "frontend_dist")

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

reviews_lock = Lock()
reviews: list = []        # List of review dicts submitted by visitors

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

# Optional ipapi.com (ipstack) API key – enables an extra geolocation fallback.
# Sign up at https://ipapi.com/signup/free for a free key, then set the env var.
IPAPI_ACCESS_KEY = os.environ.get("IPAPI_ACCESS_KEY", "")


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
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS reviews (
                        id SERIAL PRIMARY KEY,
                        data TEXT NOT NULL
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
                    CREATE TABLE IF NOT EXISTS reviews (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        data TEXT NOT NULL
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

    # Load reviews
    _load_reviews_from_db()
    with reviews_lock:
        logger.info(f"Loaded {len(reviews)} review records from {'PostgreSQL' if USE_POSTGRES else 'SQLite'}")


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


def _parse_device(ua: str) -> str:
    """Best-effort device type detection from User-Agent string."""
    ua_lower = ua.lower()
    if "tablet" in ua_lower or "ipad" in ua_lower or "kindle" in ua_lower or "silk" in ua_lower:
        return "Tablet"
    if "android" in ua_lower and "mobi" not in ua_lower:
        return "Tablet"
    if "mobi" in ua_lower or "iphone" in ua_lower or "ipod" in ua_lower:
        return "Mobile"
    if ua_lower:
        return "Desktop"
    return "Other"


def _is_private_ip(ip: str) -> bool:
    """Return True if *ip* is a loopback, private, link-local or reserved address."""
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved
    except ValueError:
        return False


# Ordered list of headers that may carry the real client IP when the
# application sits behind a CDN, load-balancer, or reverse proxy.
# Priority (highest first):
#   1. CDN-specific single-IP headers  (Cloudflare, Akamai, Fastly, Fly.io)
#   2. Standard proxy headers          (X-Real-IP, X-Forwarded-For)
#   3. Less-common proxy headers       (X-Client-IP, X-Cluster-Client-IP)
_REAL_IP_HEADERS: tuple[str, ...] = (
    "CF-Connecting-IP",      # Cloudflare – always a single, verified IP
    "True-Client-IP",        # Akamai / Cloudflare Enterprise
    "Fastly-Client-IP",      # Fastly CDN
    "Fly-Client-IP",         # Fly.io
    "X-Real-IP",             # nginx / Apache mod_remoteip
    "X-Forwarded-For",       # Standard multi-proxy chain header
    "X-Client-IP",           # HAProxy / some load-balancers
    "X-Cluster-Client-IP",   # Rackspace Cloud Load Balancers
    "Forwarded",             # RFC 7239 – "for=<ip>" syntax
)

# CDN/proxy headers that carry the visitor's country ISO-2 code directly.
# Checked in priority order in _get_country_from_headers().
_CDN_GEO_HEADERS: tuple[str, ...] = (
    "CF-IPCountry",              # Cloudflare
    "CloudFront-Viewer-Country", # AWS CloudFront
    "X-Vercel-IP-Country",       # Vercel
    "X-Appengine-Country",       # Google App Engine
    "Fastly-Geo-Country",        # Fastly CDN
    "X-Country-Code",            # generic reverse-proxy
    "X-GeoIP-Country",           # generic reverse-proxy
    "X-Forwarded-Country",       # generic reverse-proxy
)


def _get_real_ip(request) -> str:
    """Return the best-guess real client IP from a FastAPI/Starlette request.

    When the application runs behind a reverse proxy or CDN the TCP peer
    visible at ``request.client.host`` is the proxy, not the actual visitor.
    This helper inspects a prioritised list of well-known forwarding headers
    to recover the original client address.

    The returned IP is always validated with :func:`ipaddress.ip_address` so
    that header injection cannot sneak in garbage values.  Private / loopback
    addresses in the ``X-Forwarded-For`` chain are skipped so that an internal
    hop does not obscure the public client IP.
    """
    for header in _REAL_IP_HEADERS:
        raw = request.headers.get(header, "").strip()
        if not raw:
            continue
        # RFC 7239 "Forwarded" header uses "for=<token>" syntax
        if header.lower() == "forwarded":
            for part in raw.split(","):
                for field in part.split(";"):
                    field = field.strip()
                    if field.lower().startswith("for="):
                        candidate = field[4:].strip().strip('"')
                        # RFC 7239 tokens may be "[IPv6]:port" or "IPv4:port"
                        if candidate.startswith("["):
                            # IPv6 in brackets – extract content, drop zone id
                            candidate = candidate.split("]")[0].lstrip("[").split("%")[0]
                        elif candidate.count(":") == 1:
                            # IPv4:port – keep only the IP part
                            candidate = candidate.split(":")[0]
                        # For bare IPv6 (no brackets) just drop any zone id
                        candidate = candidate.split("%")[0]
                        try:
                            addr = ipaddress.ip_address(candidate)
                            if not (addr.is_private or addr.is_loopback or addr.is_link_local):
                                return str(addr)
                        except ValueError:
                            continue
            continue
        # X-Forwarded-For may contain a comma-separated chain; take the first
        # non-private public IP (leftmost = original client in most setups).
        for candidate in raw.split(","):
            candidate = candidate.strip().split("%")[0]  # strip IPv6 zone id
            # Handle "ip:port" notation – keep only the IP part
            if candidate.startswith("["):
                candidate = candidate.split("]")[0].lstrip("[")
            elif candidate.count(":") == 1:  # IPv4:port
                candidate = candidate.split(":")[0]
            try:
                addr = ipaddress.ip_address(candidate)
                if not (addr.is_private or addr.is_loopback or addr.is_link_local):
                    return str(addr)
            except ValueError:
                continue
    # Fallback: direct TCP peer (works for direct connections / local dev)
    return request.client.host if request.client else "unknown"


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
    "am": "ET", "az": "AZ", "be": "BY", "bg": "BG", "ca": "ES",
    "cy": "GB", "eu": "ES", "gl": "ES", "hr": "HR", "hy": "AM",
    "is": "IS", "ka": "GE", "km": "KH", "lo": "LA", "lt": "LT",
    "lv": "LV", "mk": "MK", "mn": "MN", "my": "MM", "ne": "NP",
    "si": "LK", "sk": "SK", "sl": "SI", "sq": "AL", "sr": "RS",
    "ta": "IN", "te": "IN", "ur": "PK", "uz": "UZ", "kk": "KZ",
    "ky": "KG", "tk": "TM", "tg": "TJ", "ps": "AF", "pa": "IN",
    "gu": "IN", "mr": "IN", "ml": "IN", "kn": "IN", "or": "IN",
    "so": "SO", "ha": "NG", "yo": "NG", "ig": "NG",
}

# Maps common IANA timezone prefixes/names to their most likely country ISO-2
# code. Used as a secondary heuristic before Accept-Language fallback.
_TZ_TO_COUNTRY: dict[str, str] = {
    # United States
    "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US",
    "America/Los_Angeles": "US", "America/Anchorage": "US", "Pacific/Honolulu": "US",
    "America/Phoenix": "US", "America/Detroit": "US", "America/Indiana/Indianapolis": "US",
    "America/Indiana/Knox": "US", "America/Indiana/Marengo": "US",
    "America/Indiana/Petersburg": "US", "America/Indiana/Tell_City": "US",
    "America/Indiana/Vevay": "US", "America/Indiana/Vincennes": "US",
    "America/Indiana/Winamac": "US", "America/Kentucky/Louisville": "US",
    "America/Kentucky/Monticello": "US", "America/North_Dakota/Beulah": "US",
    "America/North_Dakota/Center": "US", "America/North_Dakota/New_Salem": "US",
    "America/Adak": "US", "America/Boise": "US", "America/Juneau": "US",
    "America/Metlakatla": "US", "America/Nome": "US", "America/Sitka": "US",
    "America/Yakutat": "US",
    # Canada
    "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA",
    "America/Winnipeg": "CA", "America/Halifax": "CA", "America/St_Johns": "CA",
    "America/Moncton": "CA", "America/Glace_Bay": "CA", "America/Goose_Bay": "CA",
    "America/Iqaluit": "CA", "America/Nipigon": "CA", "America/Pangnirtung": "CA",
    "America/Rainy_River": "CA", "America/Rankin_Inlet": "CA",
    "America/Regina": "CA", "America/Resolute": "CA", "America/Swift_Current": "CA",
    "America/Thunder_Bay": "CA", "America/Whitehorse": "CA", "America/Yellowknife": "CA",
    "America/Dawson": "CA", "America/Dawson_Creek": "CA", "America/Fort_Nelson": "CA",
    "America/Cambridge_Bay": "CA", "America/Creston": "CA",
    # Mexico
    "America/Mexico_City": "MX", "America/Cancun": "MX", "America/Tijuana": "MX",
    "America/Hermosillo": "MX", "America/Chihuahua": "MX", "America/Matamoros": "MX",
    "America/Mazatlan": "MX", "America/Merida": "MX", "America/Monterrey": "MX",
    "America/Ojinaga": "MX", "America/Santa_Isabel": "MX",
    # South America
    "America/Sao_Paulo": "BR", "America/Fortaleza": "BR", "America/Manaus": "BR",
    "America/Belem": "BR", "America/Boa_Vista": "BR", "America/Campo_Grande": "BR",
    "America/Cuiaba": "BR", "America/Eirunepe": "BR", "America/Maceio": "BR",
    "America/Noronha": "BR", "America/Porto_Velho": "BR", "America/Recife": "BR",
    "America/Rio_Branco": "BR", "America/Santarem": "BR",
    "America/Argentina/Buenos_Aires": "AR", "America/Argentina/Catamarca": "AR",
    "America/Argentina/Cordoba": "AR", "America/Argentina/Jujuy": "AR",
    "America/Argentina/La_Rioja": "AR", "America/Argentina/Mendoza": "AR",
    "America/Argentina/Rio_Gallegos": "AR", "America/Argentina/Salta": "AR",
    "America/Argentina/San_Juan": "AR", "America/Argentina/San_Luis": "AR",
    "America/Argentina/Tucuman": "AR", "America/Argentina/Ushuaia": "AR",
    "America/Bogota": "CO", "America/Lima": "PE", "America/Santiago": "CL",
    "America/Caracas": "VE", "America/Guayaquil": "EC", "America/La_Paz": "BO",
    "America/Asuncion": "PY", "America/Montevideo": "UY",
    "America/Cayenne": "GF", "America/Guyana": "GY", "America/Paramaribo": "SR",
    # Central America & Caribbean
    "America/Panama": "PA", "America/Costa_Rica": "CR", "America/Guatemala": "GT",
    "America/Havana": "CU", "America/Jamaica": "JM", "America/Port-au-Prince": "HT",
    "America/Santo_Domingo": "DO", "America/Tegucigalpa": "HN",
    "America/Managua": "NI", "America/El_Salvador": "SV", "America/Belize": "BZ",
    "America/Nassau": "BS", "America/Barbados": "BB", "America/Martinique": "MQ",
    "America/Port_of_Spain": "TT", "America/Aruba": "AW", "America/Curacao": "CW",
    "America/Puerto_Rico": "PR",
    # Europe
    "Europe/London": "GB", "Europe/Paris": "FR", "Europe/Berlin": "DE",
    "Europe/Madrid": "ES", "Europe/Rome": "IT", "Europe/Amsterdam": "NL",
    "Europe/Brussels": "BE", "Europe/Zurich": "CH", "Europe/Vienna": "AT",
    "Europe/Stockholm": "SE", "Europe/Oslo": "NO", "Europe/Copenhagen": "DK",
    "Europe/Helsinki": "FI", "Europe/Warsaw": "PL", "Europe/Prague": "CZ",
    "Europe/Budapest": "HU", "Europe/Bucharest": "RO", "Europe/Sofia": "BG",
    "Europe/Athens": "GR", "Europe/Istanbul": "TR", "Europe/Moscow": "RU",
    "Europe/Kiev": "UA", "Europe/Kyiv": "UA", "Europe/Lisbon": "PT",
    "Europe/Dublin": "IE", "Europe/Belgrade": "RS", "Europe/Zagreb": "HR",
    "Europe/Bratislava": "SK", "Europe/Ljubljana": "SI", "Europe/Tallinn": "EE",
    "Europe/Riga": "LV", "Europe/Vilnius": "LT", "Europe/Minsk": "BY",
    "Europe/Luxembourg": "LU", "Europe/Monaco": "MC", "Europe/Andorra": "AD",
    "Europe/Malta": "MT", "Europe/Nicosia": "CY", "Europe/Tirane": "AL",
    "Europe/Skopje": "MK", "Europe/Sarajevo": "BA", "Europe/Podgorica": "ME",
    "Europe/Kaliningrad": "RU", "Europe/Samara": "RU", "Europe/Saratov": "RU",
    "Europe/Ulyanovsk": "RU", "Europe/Volgograd": "RU",
    "Atlantic/Reykjavik": "IS", "Atlantic/Faroe": "FO",
    # Asia
    "Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Asia/Shanghai": "CN",
    "Asia/Hong_Kong": "HK", "Asia/Taipei": "TW", "Asia/Singapore": "SG",
    "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Karachi": "PK",
    "Asia/Dhaka": "BD", "Asia/Bangkok": "TH", "Asia/Ho_Chi_Minh": "VN",
    "Asia/Jakarta": "ID", "Asia/Manila": "PH", "Asia/Kuala_Lumpur": "MY",
    "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Tehran": "IR",
    "Asia/Baghdad": "IQ", "Asia/Jerusalem": "IL", "Asia/Beirut": "LB",
    "Asia/Colombo": "LK", "Asia/Kathmandu": "NP", "Asia/Yangon": "MM",
    "Asia/Almaty": "KZ", "Asia/Tashkent": "UZ", "Asia/Bishkek": "KG",
    "Asia/Kabul": "AF", "Asia/Yerevan": "AM", "Asia/Baku": "AZ",
    "Asia/Tbilisi": "GE", "Asia/Ashgabat": "TM", "Asia/Dushanbe": "TJ",
    "Asia/Katmandu": "NP", "Asia/Rangoon": "MM", "Asia/Saigon": "VN",
    "Asia/Phnom_Penh": "KH", "Asia/Vientiane": "LA", "Asia/Brunei": "BN",
    "Asia/Makassar": "ID", "Asia/Jayapura": "ID", "Asia/Pontianak": "ID",
    "Asia/Kuching": "MY", "Asia/Macau": "MO", "Asia/Ulaanbaatar": "MN",
    "Asia/Choibalsan": "MN", "Asia/Hovd": "MN", "Asia/Aden": "YE",
    "Asia/Kuwait": "KW", "Asia/Bahrain": "BH", "Asia/Qatar": "QA",
    "Asia/Muscat": "OM", "Asia/Nicosia": "CY", "Asia/Amman": "JO",
    "Asia/Damascus": "SY", "Asia/Gaza": "PS", "Asia/Hebron": "PS",
    "Asia/Pyongyang": "KP", "Asia/Urumqi": "CN", "Asia/Chongqing": "CN",
    "Asia/Harbin": "CN", "Asia/Kashgar": "CN",
    "Asia/Novosibirsk": "RU", "Asia/Omsk": "RU", "Asia/Krasnoyarsk": "RU",
    "Asia/Irkutsk": "RU", "Asia/Yakutsk": "RU", "Asia/Vladivostok": "RU",
    "Asia/Magadan": "RU", "Asia/Kamchatka": "RU", "Asia/Anadyr": "RU",
    "Asia/Sakhalin": "RU", "Asia/Srednekolymsk": "RU", "Asia/Chita": "RU",
    "Asia/Khandyga": "RU", "Asia/Ust-Nera": "RU", "Asia/Yekaterinburg": "RU",
    # Africa
    "Africa/Cairo": "EG", "Africa/Lagos": "NG", "Africa/Nairobi": "KE",
    "Africa/Johannesburg": "ZA", "Africa/Casablanca": "MA", "Africa/Algiers": "DZ",
    "Africa/Tunis": "TN", "Africa/Accra": "GH", "Africa/Addis_Ababa": "ET",
    "Africa/Dar_es_Salaam": "TZ", "Africa/Kampala": "UG", "Africa/Khartoum": "SD",
    "Africa/Abidjan": "CI", "Africa/Dakar": "SN", "Africa/Maputo": "MZ",
    "Africa/Lusaka": "ZM", "Africa/Harare": "ZW", "Africa/Tripoli": "LY",
    "Africa/Luanda": "AO", "Africa/Douala": "CM", "Africa/Brazzaville": "CG",
    "Africa/Kinshasa": "CD", "Africa/Libreville": "GA", "Africa/Bangui": "CF",
    "Africa/Ndjamena": "TD", "Africa/Malabo": "GQ", "Africa/Windhoek": "NA",
    "Africa/Gaborone": "BW", "Africa/Maseru": "LS", "Africa/Mbabane": "SZ",
    "Africa/Bujumbura": "BI", "Africa/Kigali": "RW", "Africa/Djibouti": "DJ",
    "Africa/Mogadishu": "SO", "Africa/Asmara": "ER", "Africa/Juba": "SS",
    "Africa/Bamako": "ML", "Africa/Conakry": "GN", "Africa/Bissau": "GW",
    "Africa/Freetown": "SL", "Africa/Monrovia": "LR", "Africa/Ouagadougou": "BF",
    "Africa/Lome": "TG", "Africa/Porto-Novo": "BJ", "Africa/Niamey": "NE",
    "Africa/Nouakchott": "MR", "Africa/El_Aaiun": "EH", "Africa/Ceuta": "ES",
    # Oceania / Pacific
    "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Brisbane": "AU",
    "Australia/Perth": "AU", "Australia/Adelaide": "AU", "Australia/Darwin": "AU",
    "Australia/Hobart": "AU", "Australia/Lord_Howe": "AU",
    "Australia/Broken_Hill": "AU", "Australia/Currie": "AU",
    "Australia/Eucla": "AU", "Australia/Lindeman": "AU",
    "Pacific/Auckland": "NZ", "Pacific/Chatham": "NZ",
    "Pacific/Fiji": "FJ", "Pacific/Guam": "GU", "Pacific/Port_Moresby": "PG",
    "Pacific/Bougainville": "PG", "Pacific/Noumea": "NC",
    "Pacific/Guadalcanal": "SB", "Pacific/Efate": "VU",
    "Pacific/Tarawa": "KI", "Pacific/Enderbury": "KI", "Pacific/Kiritimati": "KI",
    "Pacific/Funafuti": "TV", "Pacific/Majuro": "MH", "Pacific/Kwajalein": "MH",
    "Pacific/Nauru": "NR", "Pacific/Palau": "PW", "Pacific/Yap": "FM",
    "Pacific/Pohnpei": "FM", "Pacific/Kosrae": "FM", "Pacific/Chuuk": "FM",
    "Pacific/Honolulu": "US", "Pacific/Pago_Pago": "AS", "Pacific/Midway": "UM",
    "Pacific/Tongatapu": "TO", "Pacific/Apia": "WS", "Pacific/Niue": "NU",
    "Pacific/Rarotonga": "CK", "Pacific/Tahiti": "PF", "Pacific/Gambier": "PF",
    "Pacific/Marquesas": "PF", "Pacific/Pitcairn": "PN",
    "Pacific/Easter": "CL", "Pacific/Galapagos": "EC",
    "Indian/Maldives": "MV", "Indian/Mauritius": "MU", "Indian/Reunion": "RE",
    "Indian/Mayotte": "YT", "Indian/Comoro": "KM", "Indian/Antananarivo": "MG",
    "Indian/Mahe": "SC", "Indian/Kerguelen": "TF", "Indian/Cocos": "CC",
    "Indian/Christmas": "CX",
}


def _country_from_accept_language(accept_lang: str) -> tuple[str, str]:
    """Best-effort country guess from an Accept-Language header value.

    Returns (country_name, iso2_code) or ("", "") when no guess can be made.
    Handles formats like "en-US,en;q=0.9" or "en,en-GB;q=0.9".

    Accuracy improvement: scans ALL language tags (not just the first) for an
    explicit region subtag (e.g. "en-GB") before falling back to the primary
    language code.  This fixes cases where a browser sends the bare language
    first (e.g. "en") followed by the region-qualified tag (e.g. "en-GB"),
    which previously caused UK visitors to be reported as United States.
    """
    if not accept_lang:
        return "", ""
    # Extract all tags, stripped of quality weights
    tags = [t.split(";")[0].strip() for t in accept_lang.split(",")]
    # First pass: scan every tag for an explicit two-letter region subtag
    for tag in tags:
        parts = tag.replace("_", "-").split("-")
        if len(parts) >= 2:
            region = parts[1].upper()
            if len(region) == 2 and region.isalpha():
                name = _ISO2_TO_NAME.get(region)
                if name:
                    return name, region
    # Second pass: fall back to primary language code of the first tag
    first_parts = tags[0].replace("_", "-").split("-") if tags else []
    lang = first_parts[0].lower() if first_parts else ""
    code = _LANG_TO_COUNTRY.get(lang, "")
    if code:
        return _ISO2_TO_NAME.get(code, code), code
    return "", ""


def _lookup_country_async(ip: str, accept_language: str = "", client_tz: str = ""):
    """Resolve an IP to its country (and city/region when available).

    Lookup order:
    1. Local GeoIP database (DB-IP City Lite MMDB – most accurate, offline)
    2. ip-api.com / ipinfo.io / ipwhois.app / ipapi.co / api.country.is
       / reallyfreegeoip.org / freeipapi.com / ipapi.com (ipstack)
    3. Timezone heuristic via worldtimeapi.org
    4. Browser-reported IANA timezone (client_tz) – more precise than Accept-Language
    5. Accept-Language header heuristic (last resort)

    Args:
        ip: The IP address to geo-locate.
        accept_language: Optional Accept-Language header value used as a
            last-resort heuristic when all geo-IP services fail.
        client_tz: Optional IANA timezone string reported by the browser
            (``Intl.DateTimeFormat().resolvedOptions().timeZone``).  Used as a
            high-confidence fallback when all network-based lookups fail.
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
                    # Prefer our canonical dictionary name for consistency
                    country = _ISO2_TO_NAME.get(code) or c.get("names", {}).get("en") or code
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
            if data.get("status") == "success" and data.get("countryCode"):
                code = data["countryCode"].upper()
                # Normalise name through our dictionary for consistency
                country = _ISO2_TO_NAME.get(code, data.get("country", code))
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
            if data.get("country_code"):
                code = data["country_code"].upper()
                country = _ISO2_TO_NAME.get(code, data.get("country", code))
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
            if data.get("country_code") and not data.get("error"):
                code = data["country_code"].upper()
                country = _ISO2_TO_NAME.get(code, data.get("country_name", code))
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

    # --- Service 6: reallyfreegeoip.org (free, no key required) ---
    if country == "Unknown":
        try:
            with urllib.request.urlopen(
                f"https://reallyfreegeoip.org/json/{ip}", timeout=5
            ) as resp:
                data = json.loads(resp.read())
            iso = (data.get("country_code") or "").upper()
            if iso and len(iso) == 2:
                code = iso
                country = _ISO2_TO_NAME.get(code, data.get("country_name", code))
                city = data.get("city", "") or city
                region = data.get("region_name", "") or region
        except Exception:
            pass

    # --- Service 7: freeipapi.com (free, returns country + timezone) ---
    if country == "Unknown":
        try:
            with urllib.request.urlopen(
                f"https://freeipapi.com/api/json/{ip}", timeout=5
            ) as resp:
                data = json.loads(resp.read())
            iso = (data.get("countryCode") or "").upper()
            if iso and len(iso) == 2:
                code = iso
                country = _ISO2_TO_NAME.get(code, data.get("countryName", code))
                city = data.get("cityName", "") or city
                region = data.get("regionName", "") or region
        except Exception:
            pass

    # --- Service 8: ipapi.com / ipstack (requires IPAPI_ACCESS_KEY env var) ---
    if country == "Unknown" and IPAPI_ACCESS_KEY:
        try:
            req = urllib.request.Request(
                f"https://api.ipapi.com/{ip}?access_key={IPAPI_ACCESS_KEY}&output=json",
                headers={"User-Agent": "Mozilla/5.0"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
            iso = (data.get("country_code") or "").upper()
            if iso and len(iso) == 2:
                code = iso
                country = _ISO2_TO_NAME.get(code, data.get("country_name", code))
                city = data.get("city", "") or city
                region = data.get("region_name", "") or region
        except Exception:
            pass

    # --- Timezone-based heuristic (maps IANA timezone to likely country) ---
    if country == "Unknown" and not code:
        try:
            # Try fetching timezone from worldtimeapi.org and map to a country
            with urllib.request.urlopen(
                f"https://worldtimeapi.org/api/ip/{ip}", timeout=5
            ) as resp:
                data = json.loads(resp.read())
            tz = data.get("timezone", "")
            if tz:
                tz_code = _TZ_TO_COUNTRY.get(tz, "")
                if tz_code and tz_code in _ISO2_TO_NAME:
                    code = tz_code
                    country = _ISO2_TO_NAME[code]
        except Exception:
            pass

    # --- Last-resort: Accept-Language header heuristic ---
    # The browser language region subtag (e.g. en-US, en-GB) reflects locale
    # preference, not geographic location, so it is imprecise.  However it is
    # better than leaving the country as "Unknown" when every geo-IP service
    # has failed.
    if country == "Unknown" and not code and client_tz:
        tz_code = _TZ_TO_COUNTRY.get(client_tz, "")
        if tz_code and tz_code in _ISO2_TO_NAME:
            code = tz_code
            country = _ISO2_TO_NAME[code]

    if country == "Unknown" and not code and accept_language:
        al_country, al_code = _country_from_accept_language(accept_language)
        if al_country and al_code:
            code = al_code
            country = al_country

    # Final normalisation: validate the ISO code and ensure the country name
    # matches our canonical dictionary so every record uses the exact same
    # spelling regardless of which lookup service resolved it.
    if code:
        code = code.upper()
        if len(code) == 2 and code in _ISO2_TO_NAME:
            country = _ISO2_TO_NAME[code]
        elif len(code) != 2:
            code = ""  # discard invalid codes

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
    - CF-IPCountry            (Cloudflare)
    - CloudFront-Viewer-Country (AWS CloudFront)
    - X-Vercel-IP-Country     (Vercel)
    - X-Appengine-Country     (Google App Engine)
    - Fastly-Geo-Country      (Fastly CDN)
    - X-Country-Code          (generic)
    - X-GeoIP-Country         (generic)
    - X-Forwarded-Country     (generic)

    Returns (country_name, iso2_code) or ("", "") when not found.
    """
    for header in _CDN_GEO_HEADERS:
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
            ip = _get_real_ip(request)
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
        logger.info(f"OK: yt-dlp version: {yt_dlp.version.__version__}")
        return True
    except Exception as e:
        logger.error(f"ERROR: Error checking yt-dlp: {e}")
        return False

def check_ffmpeg():
    """Check if ffmpeg is installed"""
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        logger.info(f"OK: ffmpeg found at: {ffmpeg_path}")
        return True
    else:
        logger.warning("WARNING: ffmpeg not found - some formats may not work")
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

    ⚠️  DO NOT REMOVE ``"default"`` from ``player_client``.
    ``"default"`` lets yt-dlp automatically switch between:
      • unauthenticated defaults: ``android_vr``, ``web_safari``
      • authenticated defaults:   ``tv_downgraded``, ``web_safari``
    Removing it causes YouTube authentication errors (investigated in PR #78).

    ``web_embedded`` and ``tv`` are added alongside ``"default"`` because
    yt-dlp 2026.3.13 removed the ``web`` client from its unauthenticated
    defaults (``web`` and ``web_safari`` now require PO tokens for HTTPS/DASH
    streams).  ``web_embedded`` and ``tv`` have no PO-token requirement, support
    cookies, and work with or without a JS runtime — providing reliable fallback
    clients for unauthenticated sessions where ``web_safari`` would otherwise
    fail without a POT provider.

    See https://github.com/yt-dlp/yt-dlp/wiki/Extractors#youtube for details.
    """
    # ⚠️ DO NOT REMOVE "default" — see docstring above and PR #78
    # web_embedded + tv: no POT required, SUPPORTS_COOKIES=True — reliable fallbacks
    args: dict = {"player_client": ["default", "web_embedded", "tv"]}
    return {"youtube": args}


def _get_cookieless_extractor_args() -> dict:
    """Build YouTube extractor args using only clients that work without authentication.

    ``web_embedded`` and ``tv`` require no PO tokens and no cookies to fetch
    publicly available videos.  These clients are used as a last-resort fallback
    when the normal extraction attempt triggers bot-detection and no cookies file
    is available, giving the best chance of downloading without authentication.
    """
    return {"youtube": {"player_client": ["web_embedded", "tv"]}}


def _get_cookie_opts() -> dict:
    """Return yt-dlp ``cookiefile`` option when a valid cookies file exists.

    The cookies file path is controlled by the ``COOKIES_FILE`` env-var and
    defaults to ``data/cookies.txt``.  If the file doesn't exist an empty dict
    is returned so callers can simply unpack it into their ``ydl_opts``.
    """
    if os.path.isfile(COOKIES_FILE):
        return {"cookiefile": COOKIES_FILE}
    return {}

# Bot-detection and login/auth patterns yt-dlp may emit
_AUTH_PATTERNS = (
    "sign in to confirm",
    "confirm you're not a bot",
    "login required",
    "this video requires login",
    "please sign in",
    "sign in to view",
    "session has been invalidated",
    "required to log in",
    "use --cookies",
    "use --cookies-from-browser",
    "requires authentication",
    "not authenticated",
)


def _is_auth_error(error_msg: str) -> bool:
    """Return ``True`` if *error_msg* matches a known authentication/bot-detection pattern."""
    lower = error_msg.lower()
    if any(p in lower for p in _AUTH_PATTERNS):
        return True
    # Also catch cookie-specific failures (expired / invalid / missing cookies)
    if "cookie" in lower and any(w in lower for w in ("invalid", "expired", "missing", "rejected")):
        return True
    return False


def _friendly_cookie_error(error_msg: str) -> str:
    """Return a user-friendly message when YouTube bot-detection triggers.

    Detects the ``Sign in to confirm you're not a bot`` error emitted by
    yt-dlp (and related authentication / login-required errors) and replaces
    them with a plain, actionable message that does not expose admin-panel
    instructions to regular users.
    """
    lower = error_msg.lower()

    if _is_auth_error(error_msg):
        return (
            "This video cannot be downloaded right now. "
            "Please try again in a few minutes, or try a different video."
        )

    # Private / age-restricted videos
    if "private video" in lower:
        return (
            "This video is private and cannot be downloaded."
        )
    if "age" in lower and ("restricted" in lower or "gate" in lower):
        return (
            "This video is age-restricted and cannot be downloaded "
            "without an authenticated session."
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
    "Chrome/134.0.0.0 Safari/537.36"
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


def _build_info_dict(info: dict) -> dict:
    """Convert a yt-dlp info dict to the shape returned by ``get_video_info``."""
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


def get_video_info(url: str) -> dict:
    """Get video information without downloading, using the yt-dlp Python API.

    If the initial attempt fails with an authentication/bot-detection error and
    no cookies file is present, a second attempt is made using only the
    ``web_embedded`` and ``tv`` player clients which require no PO tokens or
    authentication and can fetch publicly available videos without cookies.
    """
    _base_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "http_headers": {"User-Agent": _CHROME_UA},
        "extractor_retries": 5,
        "retries": 5,
        "sleep_requests": 1,
        "sleep_interval": 5,
        "max_sleep_interval": 10,
        "geo_bypass": True,
        # ⚠️ DO NOT REMOVE — Node.js fallback for JS challenge solving (PR #78)
        "js_runtimes": {"deno": {}, "node": {}},
    }
    try:
        ydl_opts = {
            **_base_opts,
            "extractor_args": _get_yt_extractor_args(),
            **_get_cookie_opts(),
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        return _build_info_dict(info)
    except yt_dlp.utils.DownloadError as e:
        # When bot-detection fires and there are no cookies, retry with only
        # the POT-free clients (web_embedded + tv) that work without auth.
        if _is_auth_error(str(e)) and not os.path.isfile(COOKIES_FILE):
            logger.info("Auth error without cookies — retrying with cookieless clients")
            try:
                ydl_opts_retry = {
                    **_base_opts,
                    "extractor_args": _get_cookieless_extractor_args(),
                }
                with yt_dlp.YoutubeDL(ydl_opts_retry) as ydl:
                    info = ydl.extract_info(url, download=False)
                return _build_info_dict(info)
            except yt_dlp.utils.DownloadError as retry_err:
                logger.info("Cookieless retry also failed: %s", retry_err)
            except Exception as retry_err:
                logger.warning("Unexpected error during cookieless retry: %s", retry_err)
        error_msg = _friendly_cookie_error(str(e))
        return {"error": error_msg}
    except Exception as e:
        return {"error": _friendly_cookie_error(str(e))}

# =========================================================
# DOWNLOAD WORKER
# =========================================================

def download_worker(download_id, url, output_template, format_spec, output_ext=None):
    """Background thread for downloading using the yt-dlp Python API"""

    # ── Phase 1: notify the frontend that the worker has started ──────────────
    emit_from_thread("started", {"id": download_id}, room=download_id)

    # ── Phase 2: fetch video info to resolve the real title / filename ─────────
    with downloads_lock:
        downloads[download_id]["status"] = "fetching_info"
    emit_from_thread(
        "status_update",
        {"id": download_id, "status": "fetching_info", "message": "Fetching video info…"},
        room=download_id,
    )

    info = get_video_info(url)

    # Check if the user cancelled the download while info was being fetched.
    with downloads_lock:
        if downloads.get(download_id, {}).get("status") == "cancelled":
            emit_from_thread("cancelled", {"id": download_id}, room=download_id)
            threading.Thread(target=save_downloads_to_disk, daemon=True).start()
            return

    if info and "error" not in info:
        real_title = info.get("title", "")
        if real_title:
            safe_real_title = safe_filename(real_title)
            output_template = os.path.join(DOWNLOAD_FOLDER, f"{safe_real_title}.%(ext)s")
            with downloads_lock:
                downloads[download_id]["title"] = real_title
                downloads[download_id]["safe_title"] = safe_real_title
                downloads[download_id]["output_template"] = output_template
            emit_from_thread(
                "title_update",
                {"id": download_id, "title": real_title},
                room=download_id,
            )
    elif info and "error" in info:
        logger.warning(f"Info error for {url}: {info['error']}")
        with downloads_lock:
            downloads[download_id]["info_error"] = info["error"]
        emit_from_thread(
            "warning",
            {"id": download_id, "message": info["error"]},
            room=download_id,
        )

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
            # Check if download was cancelled (e.g. by page refresh or admin)
            if downloads.get(download_id, {}).get("status") == "cancelled":
                raise yt_dlp.utils.DownloadCancelled("Download cancelled")
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
        # ⚠️ DO NOT REMOVE — Node.js fallback for JS challenge solving (PR #78)
        "js_runtimes": {"deno": {}, "node": {}},
        "progress_hooks": [progress_hook],
        "quiet": True,
        "no_warnings": True,
        **_get_cookie_opts(),
    }

    # Force output container format (e.g. mp4, webm, mkv) or extract audio
    if output_ext in _AUDIO_OUTPUT_EXTS:
        # Audio-only extraction via ffmpeg postprocessor
        ydl_opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": output_ext,
            "preferredquality": "192",
        }]
        # Override output template extension for audio files
        output_template = os.path.splitext(output_template)[0] + ".%(ext)s"
    elif output_ext in _VALID_OUTPUT_EXTS:
        ydl_opts["merge_output_format"] = output_ext

    # Add ffmpeg if available
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        ydl_opts["ffmpeg_location"] = ffmpeg_path

    def _do_download(opts: dict) -> None:
        """Run yt-dlp download with the given options."""
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

    def _finalize_completed() -> None:
        """Update state and emit events after a successful download."""
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

        emit_from_thread(
            "progress",
            {"id": download_id, "line": "", "percent": 100,
             "speed": "", "eta": "", "size": downloads[download_id].get("size", "")},
            room=download_id,
        )
        emit_from_thread("completed", {
            "id": download_id,
            "filename": downloads[download_id].get("filename"),
            "title": downloads[download_id].get("title")
        }, room=download_id)
        emit_from_thread("files_updated")
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()

    with downloads_lock:
        downloads[download_id]["status"] = "downloading"
        downloads[download_id]["start_time"] = time.time()

    try:
        _do_download(ydl_opts)
        _finalize_completed()

    except yt_dlp.utils.DownloadCancelled:
        logger.info(f"Download cancelled via hook: {download_id}")
        with downloads_lock:
            downloads[download_id].update({
                "status": "cancelled",
                "end_time": time.time(),
            })
        emit_from_thread("cancelled", {"id": download_id}, room=download_id)
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()

    except yt_dlp.utils.DownloadError as e:
        # When bot-detection fires and no cookies are present, retry using only
        # the POT-free clients (web_embedded + tv) that work without authentication.
        final_error: Exception = e
        if _is_auth_error(str(e)) and not os.path.isfile(COOKIES_FILE):
            logger.info(
                f"Auth error without cookies for {download_id} — "
                "retrying with cookieless clients"
            )
            emit_from_thread(
                "status_update",
                {
                    "id": download_id,
                    "status": "downloading",
                    "message": "Retrying without authentication…",
                },
                room=download_id,
            )
            ydl_opts_retry = {
                **ydl_opts,
                "extractor_args": _get_cookieless_extractor_args(),
            }
            # Defensive: ensure no cookiefile leaks into the cookieless retry
            ydl_opts_retry.pop("cookiefile", None)
            try:
                _do_download(ydl_opts_retry)
                _finalize_completed()
                return
            except yt_dlp.utils.DownloadCancelled:
                logger.info(f"Download cancelled via hook (cookieless retry): {download_id}")
                with downloads_lock:
                    downloads[download_id].update({
                        "status": "cancelled",
                        "end_time": time.time(),
                    })
                emit_from_thread("cancelled", {"id": download_id}, room=download_id)
                threading.Thread(target=save_downloads_to_disk, daemon=True).start()
                return
            except Exception as retry_err:
                logger.info("Cookieless retry also failed for %s: %s", download_id, retry_err)
                final_error = retry_err
        error_msg = _friendly_cookie_error(str(final_error))
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

_VALID_VIDEO_FORMATS = {"mp4", "webm", "avi", "mkv"}
_VALID_AUDIO_FORMATS = {"mp3", "wav"}
_ALL_CONVERT_FORMATS = _VALID_VIDEO_FORMATS | _VALID_AUDIO_FORMATS
_VALID_OUTPUT_EXTS   = {"mp4", "webm", "mkv", "avi"}
_AUDIO_OUTPUT_EXTS   = {"mp3", "m4a", "wav", "aac", "opus"}

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
    session_id: str = "",
):
    """Run an ffmpeg *cmd* in a daemon thread, updating *conversions[job_id]*.

    Emits ``event`` with ``{id, filename}`` on success, or ``event_failed``
    with ``{id, error}`` on failure.  The optional *cleanup* callable is
    invoked (once) when the thread finishes, regardless of outcome.

    When *session_id* is provided, the output file is registered in *downloads*
    so it appears in /files for the user who triggered the job.
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
                # Register output file in downloads so it shows up in /files
                # for the session that triggered the job
                with downloads_lock:
                    downloads[job_id] = {
                        "status": "completed",
                        "type": "edit_output",
                        "filename": output_filename,
                        "owner_session": session_id or "",
                        "end_time": time.time(),
                    }
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
# REACT SPA HELPERS
# =========================================================

def _react_index():
    """Return the React build index.html, falling back to a basic HTML stub."""
    idx = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.isfile(idx):
        return FileResponse(idx, media_type="text/html")
    # Fallback stub while the React build is absent (dev/CI)
    return Response(
        '<html><body><h1>YOT Downloader</h1>'
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
    """Health check endpoint"""
    return JSONResponse({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    })


@fastapi_app.post("/api/client_hints")
async def client_hints(request: Request):
    """Accept client-side hints (browser timezone, language) for improved geo-detection.

    The browser reports its local ``Intl.DateTimeFormat().resolvedOptions().timeZone``
    and ``navigator.language`` via a small JS snippet.  These signals are used to
    refine the cached country for the client IP when all server-side geo-IP
    services have already been tried but the country is still unknown.

    The endpoint is intentionally lightweight – it returns immediately and does
    all cache updates synchronously (the data is already in-process).
    """
    ip = _get_real_ip(request)
    if not ip or ip == "unknown":
        return JSONResponse({"ok": False}, status_code=400)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False}, status_code=400)

    tz = (body.get("timezone") or "").strip()
    lang = (body.get("language") or "").strip()

    # Only refine – never overwrite a successfully resolved country
    cached = ip_country_cache.get(ip, {})
    if cached.get("country") and cached["country"] not in ("Unknown", ""):
        return JSONResponse({"ok": True, "country": cached["country"]})

    country, code = "", ""

    # 1. Try IANA timezone from the browser (more precise than IP heuristic)
    if tz and not code:
        tz_code = _TZ_TO_COUNTRY.get(tz, "")
        if tz_code and tz_code in _ISO2_TO_NAME:
            code = tz_code
            country = _ISO2_TO_NAME[code]

    # 2. Try Accept-Language-style hint from navigator.language
    if not code and lang:
        country, code = _country_from_accept_language(lang)

    if country and code:
        ip_country_cache[ip] = {
            "country": country, "code": code, "city": "", "region": ""
        }
        # Back-fill pending visitor / download records (last 200 entries is a
        # reasonable window that covers recent unresolved visitors without
        # iterating the entire in-memory list)
        with visitors_lock:
            for v in visitors[-200:]:
                if v.get("ip") == ip and not v.get("country"):
                    v["country"] = country
                    v["country_code"] = code
        with downloads_lock:
            for d in downloads.values():
                if d.get("ip") == ip and not d.get("country"):
                    d["country"] = country
                    d["country_code"] = code
        _schedule_visitor_save()

    return JSONResponse({"ok": True, "country": country or "Unknown"})

@fastapi_app.post("/video_info")
@rate_limit()
async def video_info_endpoint(request: Request, url: str = Form(None)):
    """Fetch video metadata (title, thumbnail, duration, available formats) without downloading."""
    if not url or not url.strip():
        return JSONResponse({"error": "URL is required"}, status_code=400)
    url = url.strip()
    info = get_video_info(url)
    if not info or "error" in info:
        return JSONResponse({"error": (info or {}).get("error", "Failed to fetch video info")}, status_code=422)
    return JSONResponse(info)


@fastapi_app.post("/start_download")
@rate_limit()
async def start_download(request: Request, url: str = Form(None), format: str = Form("best"), ext: str = Form("mp4"), session_id: str = Form(None)):
    """Start a download with better error feedback"""
    format_spec = format
    output_ext  = ext.strip().lower() if ext else "mp4"
    if output_ext not in _VALID_OUTPUT_EXTS and output_ext not in _AUDIO_OUTPUT_EXTS:
        output_ext = "mp4"

    if not url:
        return JSONResponse({"error": "URL is required"}, status_code=400)

    # Check concurrent downloads
    with downloads_lock:
        active_count = sum(1 for d in downloads.values()
                          if d["status"] in ("starting", "fetching_info", "queued", "downloading"))
        if active_count >= Config.MAX_CONCURRENT_DOWNLOADS:
            return JSONResponse({
                "error": f"Maximum concurrent downloads reached ({Config.MAX_CONCURRENT_DOWNLOADS})"
            }, status_code=429)

    download_id = str(uuid.uuid4())

    # Use a placeholder title; the worker will resolve the real title via
    # get_video_info() in the background and emit a title_update event.
    title = f"video_{download_id[:8]}"
    safe_title = safe_filename(title)
    output_template = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}.%(ext)s")

    # Store download info
    ip = _get_real_ip(request)
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
            "status": "starting",
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
            "info_error": None,
            "owner_session": session_id or "",
        }
    # Resolve the requester's country in background if not already cached
    if ip not in ip_country_cache:
        accept_lang = request.headers.get("accept-language", "")
        threading.Thread(
            target=_lookup_country_async, args=(ip, accept_lang), daemon=True
        ).start()

    # Start download thread immediately — returns download_id to the client
    # right away so the frontend can subscribe and show real-time progress.
    thread = threading.Thread(
        target=download_worker,
        args=(download_id, url, output_template, format_spec, output_ext),
        daemon=True,
    )
    thread.start()

    with downloads_lock:
        active_threads[download_id] = thread

    threading.Thread(target=save_downloads_to_disk, daemon=True).start()

    return JSONResponse({
        "download_id": download_id,
        "title": title,
        "status": "starting",
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
async def list_files(request: Request, session_id: str = None):
    """List downloaded files.

    When *session_id* is provided (non-admin users), only files that were
    downloaded in the same session are returned.  Admin users see every file.
    """
    is_admin = request.session.get("admin_logged_in", False)

    # Build a mapping from filename → owner_session from in-memory download records
    with downloads_lock:
        filename_to_session: dict[str, str] = {
            d["filename"]: d.get("owner_session", "")
            for d in downloads.values()
            if d.get("filename")
        }

    files = []
    try:
        for name in os.listdir(DOWNLOAD_FOLDER):
            path = os.path.join(DOWNLOAD_FOLDER, name)
            if not os.path.isfile(path):
                continue
            owner_sess = filename_to_session.get(name, "")
            # Non-admin users only see files belonging to their session
            if not is_admin and session_id:
                if owner_sess != session_id:
                    continue
            elif not is_admin and not session_id:
                # No session_id provided by a non-admin: show nothing
                continue
            stat = os.stat(path)
            files.append({
                "name": name,
                "size": stat.st_size,
                "size_hr": format_size(stat.st_size),
                "modified": stat.st_mtime,
                "modified_str": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                "url": str(request.url_for('download_file', filename=name)),
                "owner_session": owner_sess,
            })
        files.sort(key=lambda f: f["modified"], reverse=True)
    except Exception as e:
        logger.error(f"Error listing files: {e}")
        return JSONResponse({"error": "Failed to list files"}, status_code=500)

    return JSONResponse(files)


@fastapi_app.delete("/session/{session_id}")
async def delete_session_files(session_id: str):
    """Delete all files associated with *session_id*.

    Called by the frontend on page load to clean up the previous session's
    downloaded files, ensuring each page refresh starts fresh.
    """
    if not session_id or len(session_id) > 128:
        return JSONResponse({"deleted": []})

    deleted = []
    with downloads_lock:
        owned_files = [
            d["filename"]
            for d in downloads.values()
            if d.get("owner_session") == session_id and d.get("filename")
        ]

    for filename in owned_files:
        filepath = os.path.join(DOWNLOAD_FOLDER, filename)
        try:
            if os.path.abspath(filepath).startswith(os.path.abspath(DOWNLOAD_FOLDER)) and os.path.isfile(filepath):
                os.remove(filepath)
                deleted.append(filename)
        except Exception as e:
            logger.warning(f"Could not delete session file {filename}: {e}")

    return JSONResponse({"deleted": deleted})

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


_ALLOWED_UPLOAD_EXTENSIONS = {
    "mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "wmv",
    "mp3", "wav", "aac", "ogg", "flac", "m4a",
}

@fastapi_app.post("/upload_local")
async def upload_local_file(
    request: Request,
    file: UploadFile = File(...),
    session_id: str = Form(None),
):
    """Upload a local video/audio file to the downloads folder for use with editing tools."""
    raw_name = file.filename or "upload"
    ext = os.path.splitext(raw_name)[1].lstrip(".").lower()
    if ext not in _ALLOWED_UPLOAD_EXTENSIONS:
        return JSONResponse(
            {"error": f"Unsupported file type. Allowed extensions: {', '.join(sorted(_ALLOWED_UPLOAD_EXTENSIONS))}"},
            status_code=400,
        )

    content = await file.read()
    if len(content) == 0:
        return JSONResponse({"error": "Empty file"}, status_code=400)
    if len(content) > Config.MAX_CONTENT_LENGTH:
        max_mb = Config.MAX_CONTENT_LENGTH // (1024 * 1024)
        return JSONResponse({"error": f"File too large (max {max_mb} MB)"}, status_code=413)

    safe_base = safe_filename(os.path.splitext(raw_name)[0]) or "upload"
    output_filename = f"{safe_base}.{ext}"
    output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)

    # Avoid overwriting existing files
    counter = 2
    while os.path.exists(output_path):
        output_filename = f"{safe_base}_{counter}.{ext}"
        output_path = os.path.join(DOWNLOAD_FOLDER, output_filename)
        counter += 1

    with open(output_path, "wb") as fh:
        fh.write(content)

    # Register in downloads so the file appears in /files for the uploader's session
    upload_id = str(uuid.uuid4())
    with downloads_lock:
        downloads[upload_id] = {
            "status": "completed",
            "type": "upload",
            "filename": output_filename,
            "owner_session": session_id or "",
            "end_time": time.time(),
        }

    emit_from_thread("files_updated")
    logger.info(f"Local file uploaded: {output_filename} ({len(content)} bytes)")
    return JSONResponse({"filename": output_filename, "success": True})


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
                              if d["status"] in ("starting", "fetching_info", "queued", "downloading"))

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
            if d["status"] in ("starting", "fetching_info", "queued", "downloading")
        ]
    return JSONResponse({"count": len(active), "downloads": active})

@fastapi_app.post("/cancel/{download_id}")
async def cancel_download(download_id: str):
    """Cancel an ongoing download"""
    with downloads_lock:
        if download_id in downloads:
            if downloads[download_id]["status"] in ("starting", "fetching_info", "queued", "downloading"):
                downloads[download_id]["status"] = "cancelled"
                downloads[download_id]["end_time"] = time.time()
                emit_from_thread("cancelled", {"id": download_id}, room=download_id)
                logger.info(f"Cancelled download: {download_id}")
                return JSONResponse({"success": True})

    return JSONResponse({"error": "Download not found"}, status_code=404)

@fastapi_app.post("/cancel_all")
async def cancel_all_downloads(request: Request):
    """Cancel all active/queued downloads for the requesting client IP.
    Called on page refresh so orphaned downloads are cleaned up."""
    ip = _get_real_ip(request)
    cancelled_ids = []
    with downloads_lock:
        for did, d in downloads.items():
            if d["status"] in ("starting", "fetching_info", "queued", "downloading") and d.get("ip") == ip:
                d["status"] = "cancelled"
                d["end_time"] = time.time()
                cancelled_ids.append(did)
    for did in cancelled_ids:
        emit_from_thread("cancelled", {"id": did}, room=did)
    if cancelled_ids:
        logger.info(f"Cancelled {len(cancelled_ids)} downloads for IP {ip}")
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()
    return JSONResponse({"success": True, "cancelled": len(cancelled_ids)})


# ── Review endpoints ──────────────────────────────────────────────
def _load_reviews_from_db():
    """Load reviews from the database into memory on startup."""
    try:
        with _db_lock:
            conn = _get_db()
            try:
                order_col = "id" if USE_POSTGRES else "rowid"
                rows = _execute(conn, f"SELECT data FROM reviews ORDER BY {order_col} DESC").fetchall()
            finally:
                conn.close()
        loaded = []
        for row in rows:
            try:
                loaded.append(json.loads(row["data"]))
            except Exception:
                pass
        with reviews_lock:
            reviews.clear()
            reviews.extend(loaded)
    except Exception as e:
        logger.warning("Could not load reviews from DB: %s", e)


def _save_review_to_db(review_data: dict):
    """Persist a single review to the database."""
    try:
        with _db_lock:
            conn = _get_db()
            try:
                _execute(conn, "INSERT INTO reviews (data) VALUES (?)", (json.dumps(review_data),))
                conn.commit()
            finally:
                conn.close()
    except Exception as e:
        logger.warning("Could not save review to DB: %s", e)


@fastapi_app.get("/reviews")
async def get_reviews():
    """Return all reviews for the public home page (IP stripped for privacy)."""
    with reviews_lock:
        safe = [{k: v for k, v in r.items() if k != "ip"} for r in reviews]
    return JSONResponse(safe)


@fastapi_app.get("/reviews/can_submit")
async def can_submit_review(request: Request):
    """Return whether this IP is allowed to submit another review."""
    ip = _get_real_ip(request)
    with reviews_lock:
        count = sum(1 for r in reviews if r.get("ip") == ip)
    return JSONResponse({"can_submit": count < Config.MAX_REVIEWS_PER_IP})


@fastapi_app.post("/reviews")
async def submit_review(request: Request):
    """Submit a new review from a visitor (max 1 per IP)."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    name = (body.get("name") or "Anonymous").strip()[:50] or "Anonymous"
    comment = (body.get("comment") or "").strip()[:500]
    rating = body.get("rating")

    try:
        rating = int(rating)
        if rating < 1 or rating > 5:
            raise ValueError
    except (TypeError, ValueError):
        return JSONResponse({"error": "Rating must be 1-5"}, status_code=400)

    ip = _get_real_ip(request)
    with reviews_lock:
        ip_review_count = sum(1 for r in reviews if r.get("ip") == ip)
        if ip_review_count >= Config.MAX_REVIEWS_PER_IP:
            return JSONResponse(
                {"error": f"You have already submitted the maximum of {Config.MAX_REVIEWS_PER_IP} reviews."},
                status_code=429,
            )

    review = {
        "id": str(uuid.uuid4()),
        "name": name,
        "comment": comment,
        "rating": rating,
        "timestamp": time.time(),
        "ip": ip,
    }

    with reviews_lock:
        reviews.insert(0, review)

    _save_review_to_db(review)

    return JSONResponse({"success": True, "review": {k: v for k, v in review.items() if k != "ip"}})


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

@fastapi_app.middleware("http")
async def track_admin_visitor(request: Request, call_next):
    """Record a visit to tracked pages (main site + admin page) for analytics."""
    response = await call_next(request)

    if request.url.path not in TRACKED_VISITOR_PATHS:
        return response

    ip = _get_real_ip(request)
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
        "device": _parse_device(ua),
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
    """Return the complete download history for the admin page.

    Merges in-memory records (which have live progress) with persisted
    database records so that logs survive in-memory eviction and server
    restarts.  In-memory entries take precedence for active downloads.
    """
    _fields = (
        "id", "title", "url", "status", "percent", "filename",
        "file_size_hr", "created_at", "end_time", "error", "ip",
        "country", "country_code", "city", "region", "format",
    )

    def _pick(d: dict) -> dict:
        return {k: d.get(k, "" if k in ("country", "country_code", "city", "region") else None) for k in _fields}

    # Start with all DB records (these persist after in-memory cleanup)
    merged: dict = {}
    try:
        with _db_lock:
            conn = _get_db()
            try:
                rows = _execute(conn, "SELECT id, data FROM downloads").fetchall()
            finally:
                conn.close()
        for row in rows:
            try:
                d = json.loads(row["data"])
                did = d.get("id") or row["id"]
                merged[did] = _pick(d)
            except Exception:
                pass
    except Exception as exc:
        logger.error(f"admin_downloads_api DB read error: {exc}")

    # Overlay in-memory records (they have live progress for active downloads)
    with downloads_lock:
        for did, d in downloads.items():
            merged[did] = _pick(d)

    history = sorted(merged.values(), key=lambda x: x.get("created_at") or 0, reverse=True)
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
    """Return aggregated analytics including country totals, persistent stats,
    and deep-insight metrics (peak hours, format preferences, OS breakdown,
    success rate, repeat visitors, average file size).
    """
    # --- Collect full download list from DB + in-memory overlay ---
    db_downloads: dict = {}
    try:
        with _db_lock:
            conn = _get_db()
            try:
                rows = _execute(conn, "SELECT id, data FROM downloads").fetchall()
            finally:
                conn.close()
        for row in rows:
            try:
                d = json.loads(row["data"])
                db_downloads[d.get("id") or row["id"]] = d
            except Exception:
                pass
    except Exception:
        pass
    with downloads_lock:
        for did, d in downloads.items():
            db_downloads[did] = d
    dl_list = list(db_downloads.values())

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

    # --- Deep-insight analytics ---

    # 1. Peak download hours (0-23)
    peak_hours = [0] * 24
    for d in dl_list:
        ts = d.get("created_at")
        if ts:
            try:
                peak_hours[datetime.fromtimestamp(float(ts)).hour] += 1
            except Exception:
                pass

    # 2. Peak visitor hours (0-23)
    visitor_hours = [0] * 24
    for v in v_list:
        ts = v.get("timestamp")
        if ts:
            try:
                visitor_hours[datetime.fromtimestamp(float(ts)).hour] += 1
            except Exception:
                pass

    # 3. Format preferences (from download records)
    format_counts: dict = {}
    for d in dl_list:
        fmt = d.get("format") or "unknown"
        # Simplify long format strings to a readable label
        label = fmt.split("/")[0].split("+")[0].strip()[:30] if fmt else "unknown"
        format_counts[label] = format_counts.get(label, 0) + 1

    # 4. Success / failure rate
    total_dl = len(dl_list)
    completed_count = sum(1 for d in dl_list if d.get("status") == "completed")
    failed_count = sum(1 for d in dl_list if d.get("status") == "failed")
    cancelled_count = sum(1 for d in dl_list if d.get("status") == "cancelled")
    success_rate = round(100.0 * completed_count / total_dl, 1) if total_dl else 0

    # 5. Average file size (completed downloads only)
    sizes = []
    for d in dl_list:
        if d.get("status") == "completed":
            sz = d.get("file_size")
            if sz and isinstance(sz, (int, float)) and sz > 0:
                sizes.append(sz)
    avg_file_size = round(sum(sizes) / len(sizes)) if sizes else 0
    avg_file_size_hr = format_size(avg_file_size) if avg_file_size else "—"

    # 6. OS / device breakdown (from visitor user-agents)
    os_counts: dict = {}
    for v in v_list:
        ua = (v.get("user_agent") or "").lower()
        if "windows" in ua:
            os_name = "Windows"
        elif "macintosh" in ua or "mac os" in ua:
            os_name = "macOS"
        elif "android" in ua:
            os_name = "Android"
        elif "iphone" in ua or "ipad" in ua:
            os_name = "iOS"
        elif "linux" in ua:
            os_name = "Linux"
        elif "cros" in ua:
            os_name = "ChromeOS"
        else:
            os_name = "Other"
        os_counts[os_name] = os_counts.get(os_name, 0) + 1

    # 7. Device type breakdown (from visitor user-agents)
    device_counts: dict = {}
    for v in v_list:
        device = v.get("device") or _parse_device(v.get("user_agent") or "")
        device_counts[device] = device_counts.get(device, 0) + 1

    # 8. Repeat visitors (IPs seen more than once on the main site)
    ip_visit_counts: dict = {}
    for v in v_list:
        if v.get("page") == "/":
            ip_visit_counts[v.get("ip", "")] = ip_visit_counts.get(v.get("ip", ""), 0) + 1
    unique_ips = len(ip_visit_counts)
    repeat_ips = sum(1 for c in ip_visit_counts.values() if c > 1)
    repeat_rate = round(100.0 * repeat_ips / unique_ips, 1) if unique_ips else 0

    # 8. Downloads by day-of-week (Mon=0 … Sun=6)
    dow_downloads = [0] * 7
    for d in dl_list:
        ts = d.get("created_at")
        if ts:
            try:
                dow_downloads[datetime.fromtimestamp(float(ts)).weekday()] += 1
            except Exception:
                pass

    # 9. Review rating breakdown
    with reviews_lock:
        review_ratings = [0] * 5  # index 0 = 1-star, index 4 = 5-star
        for r in reviews:
            rt = r.get("rating")
            if isinstance(rt, int) and 1 <= rt <= 5:
                review_ratings[rt - 1] += 1
        total_reviews = len(reviews)

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
        # Deep insights
        "peak_hours": peak_hours,
        "visitor_hours": visitor_hours,
        "format_preferences": [
            {"format": k, "count": v}
            for k, v in sorted(format_counts.items(), key=lambda x: x[1], reverse=True)[:15]
        ],
        "success_rate": success_rate,
        "completed_count": completed_count,
        "failed_count": failed_count,
        "cancelled_count": cancelled_count,
        "avg_file_size": avg_file_size,
        "avg_file_size_hr": avg_file_size_hr,
        "os_breakdown": [
            {"os": k, "count": v}
            for k, v in sorted(os_counts.items(), key=lambda x: x[1], reverse=True)
        ],
        "device_breakdown": [
            {"device": k, "count": v}
            for k, v in sorted(device_counts.items(), key=lambda x: x[1], reverse=True)
        ],
        "unique_visitors": unique_ips,
        "repeat_visitors": repeat_ips,
        "repeat_rate": repeat_rate,
        "dow_downloads": dow_downloads,
        "review_ratings": review_ratings,
        "total_reviews": total_reviews,
    })


@fastapi_app.post("/admin/cancel_download/{download_id}")
@admin_required
async def admin_cancel_download(request: Request, download_id: str):
    """Cancel an active download (admin only)."""
    with downloads_lock:
        if download_id in downloads:
            if downloads[download_id]["status"] in ("starting", "fetching_info", "queued", "downloading"):
                downloads[download_id]["status"] = "cancelled"
                downloads[download_id]["end_time"] = time.time()
                emit_from_thread("cancelled", {"id": download_id}, room=download_id)
                logger.info(f"Admin cancelled download: {download_id}")
                threading.Thread(target=save_downloads_to_disk, daemon=True).start()
                return JSONResponse({"success": True})
            return JSONResponse({"error": "Download is not active"}, status_code=409)
    return JSONResponse({"error": "Download not found"}, status_code=404)


@fastapi_app.delete("/admin/delete_record/{download_id}")
@admin_required
async def admin_delete_record(request: Request, download_id: str):
    """Remove a download record from the history (admin only).
    Active downloads are automatically cancelled before deletion."""
    with downloads_lock:
        if download_id in downloads:
            status = downloads[download_id].get("status")
            if status in ("starting", "fetching_info", "queued", "downloading"):
                downloads[download_id]["status"] = "cancelled"
                downloads[download_id]["end_time"] = time.time()
                emit_from_thread("cancelled", {"id": download_id}, room=download_id)
                logger.info(f"Admin force-cancelled download for deletion: {download_id}")
            del downloads[download_id]

    # Delete from database as well so the record is permanently removed
    def _db_delete():
        try:
            with _db_lock:
                conn = _get_db()
                try:
                    _execute(conn, "DELETE FROM downloads WHERE id = ?", (download_id,))
                    conn.commit()
                finally:
                    conn.close()
        except Exception as exc:
            logger.error(f"DB delete error for {download_id}: {exc}")
    threading.Thread(target=_db_delete, daemon=True).start()
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
    session_id: str = Form(""),
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

    _start_ffmpeg_job(job_id, cmd, output_filename, session_id=session_id)
    return JSONResponse({"job_id": job_id, "output_filename": output_filename})


@fastapi_app.post("/batch_convert")
async def batch_convert(
    request: Request,
    filenames: str = Form("[]"),
    format: str = Form("mp4"),
    resolution: str = Form(""),
    audio_bitrate: str = Form(""),
    video_bitrate: str = Form(""),
    session_id: str = Form(""),
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
        _start_ffmpeg_job(job_id, cmd, output_filename, session_id=session_id)
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
    session_id: str = Form(""),
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

    _start_ffmpeg_job(job_id, cmd, output_filename, session_id=session_id)
    return JSONResponse({"job_id": job_id, "output_filename": output_filename})


@fastapi_app.post("/crop")
async def crop_video(
    request: Request,
    filename: str = Form(""),
    x: str = Form("0"),
    y: str = Form("0"),
    width: str = Form(""),
    height: str = Form(""),
    session_id: str = Form(""),
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

    _start_ffmpeg_job(job_id, cmd, output_filename, session_id=session_id)
    return JSONResponse({"job_id": job_id, "output_filename": output_filename})


@fastapi_app.post("/watermark")
async def watermark_video(
    request: Request,
    filename: str = Form(""),
    text: str = Form(""),
    position: str = Form("bottom-right"),
    fontsize: str = Form("24"),
    session_id: str = Form(""),
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

    _start_ffmpeg_job(job_id, cmd, output_filename, session_id=session_id)
    return JSONResponse({"job_id": job_id, "output_filename": output_filename})


@fastapi_app.post("/extract_clip")
async def extract_clip(
    request: Request,
    filename: str = Form(""),
    start_time: str = Form("0"),
    duration: str = Form("30"),
    session_id: str = Form(""),
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

    _start_ffmpeg_job(job_id, cmd, output_filename, session_id=session_id)
    return JSONResponse({"job_id": job_id, "output_filename": output_filename})


@fastapi_app.post("/merge")
async def merge_videos(
    request: Request,
    filenames: str = Form("[]"),
    format: str = Form("mp4"),
    session_id: str = Form(""),
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

    _start_ffmpeg_job(job_id, cmd, output_filename, cleanup=_remove_list_file, session_id=session_id)
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
    ext: str = Form("mp4"),
    session_id: str = Form(None),
):
    """Download an entire playlist or channel (yt-dlp playlist mode)."""
    url = url.strip()
    format_spec = format
    output_ext  = ext.strip().lower() if ext else "mp4"
    if output_ext not in _VALID_OUTPUT_EXTS:
        output_ext = "mp4"

    if not url:
        return JSONResponse({"error": "URL is required"}, status_code=400)

    with downloads_lock:
        active_count = sum(
            1 for d in downloads.values()
            if d["status"] in ("starting", "fetching_info", "queued", "downloading")
        )
        if active_count >= Config.MAX_CONCURRENT_DOWNLOADS:
            return JSONResponse({
                "error": f"Maximum concurrent downloads reached ({Config.MAX_CONCURRENT_DOWNLOADS})"
            }, status_code=429)

    batch_id = str(uuid.uuid4())
    ip = _get_real_ip(request)
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
            "created_at":      time.time(),
            "owner_session":   session_id or "",
        }

    completed = [0]
    total     = [0]

    def progress_hook(d):
        if d["status"] == "finished":
            completed[0] += 1
            pct = (100.0 * completed[0] / total[0]) if total[0] else 0
            with downloads_lock:
                # Check if download was cancelled
                if downloads.get(batch_id, {}).get("status") == "cancelled":
                    raise yt_dlp.utils.DownloadCancelled("Download cancelled")
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
        # ⚠️ DO NOT REMOVE — Node.js fallback for JS challenge solving (PR #78)
        "js_runtimes":     {"deno": {}, "node": {}},
        "progress_hooks":  [progress_hook],
        "quiet":           True,
        "no_warnings":     True,
        **_get_cookie_opts(),
    }
    if output_ext in _VALID_OUTPUT_EXTS:
        ydl_opts["merge_output_format"] = output_ext
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        ydl_opts["ffmpeg_location"] = ffmpeg_path

    def playlist_worker():
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
                "progress",
                {"id": batch_id, "line": "", "percent": 100, "speed": "", "eta": ""},
                room=batch_id,
            )
            emit_from_thread(
                "completed",
                {"id": batch_id, "title": downloads[batch_id].get("title")},
                room=batch_id,
            )
            emit_from_thread("files_updated")
            threading.Thread(target=save_downloads_to_disk, daemon=True).start()

        except yt_dlp.utils.DownloadCancelled:
            logger.info(f"Playlist download cancelled via hook: {batch_id}")
            with downloads_lock:
                downloads[batch_id].update({
                    "status":   "cancelled",
                    "end_time": time.time(),
                })
            emit_from_thread("cancelled", {"id": batch_id}, room=batch_id)
            threading.Thread(target=save_downloads_to_disk, daemon=True).start()

        except Exception as exc:
            # When bot-detection fires and no cookies are present, retry using only
            # the POT-free clients (web_embedded + tv) that work without authentication.
            final_exc: Exception = exc
            if _is_auth_error(str(exc)) and not os.path.isfile(COOKIES_FILE):
                logger.info(
                    f"Auth error without cookies for playlist {batch_id} — "
                    "retrying with cookieless clients"
                )
                emit_from_thread(
                    "status_update",
                    {
                        "id": batch_id,
                        "status": "downloading",
                        "message": "Retrying without authentication…",
                    },
                    room=batch_id,
                )
                ydl_opts_retry = {
                    **ydl_opts,
                    "extractor_args": _get_cookieless_extractor_args(),
                }
                # Defensive: ensure no cookiefile leaks into the cookieless retry
                ydl_opts_retry.pop("cookiefile", None)
                try:
                    with yt_dlp.YoutubeDL(ydl_opts_retry) as ydl:
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
                        "progress",
                        {"id": batch_id, "line": "", "percent": 100, "speed": "", "eta": ""},
                        room=batch_id,
                    )
                    emit_from_thread(
                        "completed",
                        {"id": batch_id, "title": downloads[batch_id].get("title")},
                        room=batch_id,
                    )
                    emit_from_thread("files_updated")
                    threading.Thread(target=save_downloads_to_disk, daemon=True).start()
                    return
                except yt_dlp.utils.DownloadCancelled:
                    logger.info(f"Playlist download cancelled via hook (cookieless retry): {batch_id}")
                    with downloads_lock:
                        downloads[batch_id].update({
                            "status":   "cancelled",
                            "end_time": time.time(),
                        })
                    emit_from_thread("cancelled", {"id": batch_id}, room=batch_id)
                    threading.Thread(target=save_downloads_to_disk, daemon=True).start()
                    return
                except Exception as retry_exc:
                    logger.info("Cookieless retry also failed for playlist %s: %s", batch_id, retry_exc)
                    final_exc = retry_exc
            logger.error("Playlist download error: %s", final_exc)
            error_msg = _friendly_cookie_error(str(final_exc))
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
    ext: str = Form("mp4"),
    session_id: str = Form(None),
):
    """Start individual downloads for a newline-separated list of URLs."""
    urls_text   = urls.strip()
    format_spec = format
    output_ext  = ext.strip().lower() if ext else "mp4"
    if output_ext not in _VALID_OUTPUT_EXTS:
        output_ext = "mp4"

    url_list = [u.strip() for u in urls_text.splitlines() if u.strip()]
    if not url_list:
        return JSONResponse({"error": "At least one URL is required"}, status_code=400)
    if len(url_list) > 20:
        return JSONResponse({"error": "Maximum 20 URLs per batch"}, status_code=400)

    started = []
    ip = _get_real_ip(request)
    hdr_country, hdr_code = _get_country_from_headers(request)
    if hdr_country and ip not in ip_country_cache:
        ip_country_cache[ip] = {"country": hdr_country, "code": hdr_code, "city": "", "region": ""}
    elif ip not in ip_country_cache and _is_private_ip(ip):
        ip_country_cache[ip] = {"country": "Local", "code": "", "city": "", "region": ""}
    cached_geo = ip_country_cache.get(ip, {})

    batch_items = []  # (download_id, url, output_template, format_spec, output_ext)
    for url in url_list:
        # Register all downloads immediately with "queued" status so the UI
        # can show them.  The sequential orchestration thread will start them
        # one at a time in order.
        download_id     = str(uuid.uuid4())
        title           = f"video_{download_id[:8]}"
        safe_title      = safe_filename(title)
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
                "info_error":      None,
                "owner_session":   session_id or "",
            }

        batch_items.append((download_id, url, output_template, format_spec, output_ext))
        started.append({"download_id": download_id, "url": url, "title": title})

    if not started:
        return JSONResponse({"error": "Could not start any downloads (concurrent limit reached)"}, status_code=429)

    # Orchestration thread: run each download_worker sequentially so downloads
    # complete one at a time rather than all at once.
    def _batch_orchestrator(items):
        for dl_id, dl_url, dl_template, dl_format, dl_ext in items:
            # Skip if cancelled while waiting in queue
            with downloads_lock:
                if downloads.get(dl_id, {}).get("status") == "cancelled":
                    continue
                active_threads[dl_id] = threading.current_thread()
            try:
                download_worker(dl_id, dl_url, dl_template, dl_format, dl_ext)
            finally:
                with downloads_lock:
                    active_threads.pop(dl_id, None)

    orch_thread = threading.Thread(
        target=_batch_orchestrator,
        args=(batch_items,),
        daemon=True,
    )
    orch_thread.start()

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
# CV GENERATION MODULE
# =========================================================

_MAX_CV_LOGO_BYTES = 5 * 1024 * 1024  # 5 MB max for CV logo uploads

# ---------------------------------------------------------------------------
# Pure-Python PDF builder (fpdf2).  No LaTeX / LibreOffice required.
# ---------------------------------------------------------------------------
def _build_cv_pdf(
    output_path: str,
    *,
    name: str,
    email: str,
    phone: str = "",
    location: str = "",
    link: str = "",
    summary: str = "",
    experience: str = "",
    education: str = "",
    skills: str = "",
    projects: str = "",
    publications: str = "",
    logo_path: str = "",
    theme: str = "classic",
) -> None:
    """Build a professional single-file PDF CV using fpdf2.

    Supported themes: 'classic' (blue), 'modern' (dark header), 'minimal' (B&W),
    'executive' (navy/gold).
    """
    from fpdf import FPDF, XPos, YPos

    _NL = dict(new_x=XPos.LMARGIN, new_y=YPos.NEXT)  # replaces deprecated ln=True

    # ---- Colour palettes ----
    _THEMES = {
        "classic": {
            "dark":   (30,  30,  30),
            "accent": (37,  99, 235),   # blue-600
            "light":  (107, 114, 128),  # gray-500
            "header_bg": None,          # no filled header band
            "header_fg": (30, 30, 30),
        },
        "modern": {
            "dark":   (20,  20,  20),
            "accent": (15,  23,  42),   # slate-900 heading bar
            "light":  (100, 116, 139),  # slate-500
            "header_bg": (15, 23, 42),  # filled dark band
            "header_fg": (255, 255, 255),
        },
        "minimal": {
            "dark":   (0,   0,   0),
            "accent": (0,   0,   0),    # pure black
            "light":  (120, 120, 120),
            "header_bg": None,
            "header_fg": (0, 0, 0),
        },
        "executive": {
            "dark":   (22,  36,  71),   # deep navy
            "accent": (22,  36,  71),
            "light":  (100, 100, 130),
            "header_bg": (22, 36, 71),  # navy band
            "header_fg": (212, 175, 55),  # gold text
        },
    }
    t = _THEMES.get(theme, _THEMES["classic"])
    DARK      = t["dark"]
    ACCENT    = t["accent"]
    LIGHT     = t["light"]
    HEADER_BG = t["header_bg"]
    HEADER_FG = t["header_fg"]

    # ---- Unicode → Latin-1 safe text normaliser ----
    # Helvetica is a core PDF font that uses Latin-1 encoding.  Any character
    # outside Latin-1 (e.g. em-dashes, bullets, curly quotes) must be replaced
    # with ASCII equivalents before being passed to fpdf.
    _UNICODE_MAP = str.maketrans({
        "\u2013": " - ",   # en dash
        "\u2014": " - ",   # em dash
        "\u2015": " - ",   # horizontal bar
        "\u2022": "*",     # bullet •
        "\u2018": "'",     # left single quote
        "\u2019": "'",     # right single quote
        "\u201C": '"',     # left double quote
        "\u201D": '"',     # right double quote
        "\u2026": "...",   # ellipsis
        "\u00A0": " ",     # non-breaking space
    })

    def _safe(text: str) -> str:
        """Return *text* with all non-Latin-1 characters replaced safely."""
        text = text.translate(_UNICODE_MAP)
        return text.encode("latin-1", errors="replace").decode("latin-1")

    class CV(FPDF):
        def header(self):
            pass  # custom header drawn in body
        def footer(self):
            self.set_y(-12)
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(*LIGHT)
            self.cell(0, 8, f"Page {self.page_no()}", align="C")

    pdf = CV(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_margins(18, 18, 18)

    page_w = pdf.w - 36  # usable width (A4 210 mm − 18 mm × 2)

    # ---- Helper: section divider ----
    def section_heading(title: str):
        pdf.ln(4)
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(*ACCENT)
        pdf.cell(0, 7, _safe(title.upper()), **_NL)
        pdf.set_draw_color(*ACCENT)
        pdf.set_line_width(0.4)
        pdf.line(18, pdf.get_y(), 18 + page_w, pdf.get_y())
        pdf.ln(2)
        pdf.set_text_color(*DARK)

    # ---- Helper: wrap long text ----
    def multi(txt: str, font_size: int = 9, style: str = "", indent: float = 0):
        pdf.set_font("Helvetica", style, font_size)
        pdf.set_text_color(*DARK)
        if indent:
            pdf.set_x(18 + indent)
        pdf.multi_cell(page_w - indent, 5, _safe(txt), **_NL)

    # ================================================================
    # HEADER BLOCK
    # ================================================================
    # Themed header: themes with HEADER_BG get a filled colour band.
    header_top_y = 14
    header_h = 28 + (5 if link else 0) + (5 if [p for p in (email, phone, location) if p] else 0)

    if HEADER_BG:
        pdf.set_fill_color(*HEADER_BG)
        pdf.rect(0, header_top_y - 2, pdf.w, header_h + 4, style="F")

    logo_w = 0.0
    if logo_path and os.path.isfile(logo_path):
        try:
            logo_w = 22.0
            pdf.image(logo_path, x=18, y=header_top_y, w=logo_w)
        except Exception:
            logo_w = 0.0

    x_text = 18 + (logo_w + 4 if logo_w else 0)
    w_text = page_w - (logo_w + 4 if logo_w else 0)

    name_fg = HEADER_FG if HEADER_BG else DARK
    pdf.set_xy(x_text, header_top_y)
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(*name_fg)
    pdf.cell(w_text, 10, _safe(name), **_NL)

    # Contact line
    contact_parts = [p for p in (email, phone, location) if p]
    if contact_parts:
        pdf.set_x(x_text)
        pdf.set_font("Helvetica", "", 9)
        contact_fg = HEADER_FG if HEADER_BG else LIGHT
        pdf.set_text_color(*contact_fg)
        pdf.cell(w_text, 5, _safe("  |  ".join(contact_parts)), **_NL)

    if link:
        pdf.set_x(x_text)
        pdf.set_font("Helvetica", "U", 9)
        link_fg = HEADER_FG if HEADER_BG else ACCENT
        pdf.set_text_color(*link_fg)
        pdf.cell(w_text, 5, _safe(link), **_NL)

    # Move below the header band
    pdf.ln(3)
    if HEADER_BG:
        # Ensure we're past the band before drawing the separator
        band_bottom = header_top_y + header_h + 4
        if pdf.get_y() < band_bottom:
            pdf.set_y(band_bottom)
    pdf.set_draw_color(*ACCENT)
    pdf.set_line_width(0.8)
    pdf.line(18, pdf.get_y(), 18 + page_w, pdf.get_y())
    pdf.ln(4)
    pdf.set_text_color(*DARK)

    # ================================================================
    # SUMMARY
    # ================================================================
    if summary.strip():
        section_heading("Professional Summary")
        multi(summary.strip())

    # ================================================================
    # SKILLS
    # ================================================================
    skill_list = [s.strip() for s in skills.split(",") if s.strip()]
    if skill_list:
        section_heading("Skills")
        # Render as a flowing comma-separated line with * bullets per item
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*DARK)
        # Group into rows of ~5 items each
        row_size = 5
        for i in range(0, len(skill_list), row_size):
            row = skill_list[i:i + row_size]
            pdf.set_x(18)
            pdf.cell(0, 5, _safe("  *  ".join(row)), **_NL)
        pdf.ln(1)

    # ================================================================
    # EXPERIENCE
    # ================================================================
    if experience.strip():
        section_heading("Work Experience")
        for block in re.split(r'\n\s*\n', experience.strip()):
            lines = [l.strip() for l in block.split('\n') if l.strip()]
            if not lines:
                continue
            # Header line: "Company - Title - Dates"
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(*DARK)
            pdf.multi_cell(page_w, 5, _safe(lines[0]), **_NL)
            # Bullet points
            for bullet in lines[1:]:
                bullet_text = bullet.lstrip("*-\u2022\u2013\u2014 ").strip()
                if bullet_text:
                    pdf.set_font("Helvetica", "", 9)
                    pdf.set_text_color(*DARK)
                    pdf.set_x(22)  # indent bullets
                    pdf.multi_cell(page_w - 4, 5, _safe(f"* {bullet_text}"), **_NL)
            pdf.ln(1)

    # ================================================================
    # EDUCATION
    # ================================================================
    if education.strip():
        section_heading("Education")
        for block in re.split(r'\n\s*\n', education.strip()):
            lines = [l.strip() for l in block.split('\n') if l.strip()]
            if not lines:
                continue
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(*DARK)
            pdf.multi_cell(page_w, 5, _safe(lines[0]), **_NL)
            for extra in lines[1:]:
                if extra.strip():
                    pdf.set_font("Helvetica", "", 9)
                    pdf.set_text_color(*LIGHT)
                    pdf.set_x(22)
                    pdf.multi_cell(page_w - 4, 5, _safe(extra.strip()), **_NL)
            pdf.ln(1)

    # ================================================================
    # PROJECTS
    # ================================================================
    if projects.strip():
        section_heading("Projects")
        for block in re.split(r'\n\s*\n', projects.strip()):
            lines = [l.strip() for l in block.split('\n') if l.strip()]
            if not lines:
                continue
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(*DARK)
            pdf.multi_cell(page_w, 5, _safe(lines[0]), **_NL)
            for extra in lines[1:]:
                if extra.strip():
                    pdf.set_font("Helvetica", "", 9)
                    pdf.set_text_color(*DARK)
                    pdf.set_x(22)
                    pdf.multi_cell(page_w - 4, 5, _safe(extra.strip()), **_NL)
            pdf.ln(1)

    # ================================================================
    # PUBLICATIONS
    # ================================================================
    if publications.strip():
        section_heading("Publications")
        for block in re.split(r'\n\s*\n', publications.strip()):
            lines = [l.strip() for l in block.split('\n') if l.strip()]
            if not lines:
                continue
            pdf.set_font("Helvetica", "I", 9)
            pdf.set_text_color(*DARK)
            pdf.multi_cell(page_w, 5, _safe(lines[0]), **_NL)
            for extra in lines[1:]:
                if extra.strip():
                    pdf.set_font("Helvetica", "", 9)
                    pdf.set_text_color(*LIGHT)
                    pdf.set_x(22)
                    pdf.multi_cell(page_w - 4, 5, _safe(extra.strip()), **_NL)
            pdf.ln(1)

    pdf.output(output_path)


@fastapi_app.post("/api/cv/generate")
async def api_cv_generate(
    request: Request,
    name: str = Form(""),
    email: str = Form(""),
    phone: str = Form(""),
    location: str = Form(""),
    link: str = Form(""),
    summary: str = Form(""),
    experience: str = Form(""),
    education: str = Form(""),
    skills: str = Form(""),
    projects: str = Form(""),
    publications: str = Form(""),
    logo: UploadFile = File(None),
    theme: str = Form("classic"),
):
    """Generate a professional PDF CV using fpdf2 (pure Python, no LaTeX required)."""
    import tempfile

    try:
        from fpdf import FPDF  # noqa: F401
    except ImportError:
        return JSONResponse(
            {"error": "CV generation is not available: fpdf2 is not installed on this server."},
            status_code=503,
        )

    name = name.strip()
    email = email.strip()
    theme = (theme or "").strip().lower() or "classic"
    _VALID_THEMES = {"classic", "modern", "minimal", "executive"}
    if theme not in _VALID_THEMES:
        theme = "classic"
    if not name or not email:
        return JSONResponse({"error": "Name and email are required."}, status_code=400)

    ip = _get_real_ip(request)

    tmpdir = tempfile.mkdtemp(prefix="cv_", dir=DOWNLOAD_FOLDER)
    try:
        # Save logo if provided
        logo_path = ""
        if logo and logo.filename:
            ext = os.path.splitext(logo.filename)[1].lower()
            if ext not in (".png", ".jpg", ".jpeg"):
                return JSONResponse({"error": "Logo must be PNG or JPG."}, status_code=400)
            logo_path = os.path.join(tmpdir, f"logo{ext}")
            content = await logo.read()
            if len(content) > _MAX_CV_LOGO_BYTES:
                return JSONResponse({"error": f"Logo file is too large (max {_MAX_CV_LOGO_BYTES // (1024*1024)} MB)."}, status_code=400)
            with open(logo_path, "wb") as f:
                f.write(content)

        output_pdf = os.path.join(tmpdir, "cv.pdf")

        # Build PDF directly using fpdf2 (no external tools required)
        _build_cv_pdf(
            output_pdf,
            name=name,
            email=email,
            phone=phone.strip(),
            location=location.strip(),
            link=link.strip(),
            summary=summary.strip(),
            experience=experience,
            education=education,
            skills=skills,
            projects=projects,
            publications=publications,
            logo_path=logo_path,
            theme=theme,
        )

        if not os.path.isfile(output_pdf):
            return JSONResponse({"error": "CV generation produced no output."}, status_code=500)

        # Track the CV generation as a download record
        record_id = str(uuid.uuid4())
        cached_geo = ip_country_cache.get(ip, {})
        with downloads_lock:
            downloads[record_id] = {
                "id": record_id,
                "url": "cv_generation",
                "title": f"CV: {name}",
                "safe_title": safe_filename(f"cv_{name}"),
                "status": "complete",
                "type": "cv_generation",
                "percent": 100,
                "created_at": time.time(),
                "end_time": time.time(),
                "filename": "cv.pdf",
                "ip": ip,
                "country": cached_geo.get("country", ""),
                "country_code": cached_geo.get("code", ""),
                "city": cached_geo.get("city", ""),
                "region": cached_geo.get("region", ""),
            }
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()

        return FileResponse(
            output_pdf,
            filename="cv.pdf",
            media_type="application/pdf",
            background=None,
        )
    except Exception as exc:
        logger.error("CV generation error: %s", exc, exc_info=True)
        return JSONResponse({"error": f"CV generation failed: {exc}"}, status_code=500)
    finally:
        # Clean up temp directory after a short delay to allow FileResponse to stream
        def _delayed_rm(path, delay=30):
            time.sleep(delay)
            shutil.rmtree(path, ignore_errors=True)
        threading.Thread(target=_delayed_rm, args=(tmpdir,), daemon=True).start()


# =========================================================
# DOCUMENT CONVERSION MODULE
# =========================================================

# Supported conversion targets
_DOC_CONV_TARGETS = {
    "pdf", "docx", "xlsx", "pptx", "odt", "html", "md", "txt", "csv", "png", "jpg", "epub",
}

# ---------------------------------------------------------------------------
# LibreOffice filter helpers
# ---------------------------------------------------------------------------
# Document family sets (extension without leading dot)
_LO_WRITER_EXTS  = frozenset({"docx", "doc", "odt", "fodt", "txt", "html", "htm"})
_LO_IMPRESS_EXTS = frozenset({"pptx", "ppt", "odp", "fodp"})
_LO_CALC_EXTS    = frozenset({"xlsx", "xls", "ods", "fods", "csv"})

# Explicit LibreOffice --convert-to filter strings: (family, target) → filter
_LO_FILTER_MAP: dict = {
    # Writer → various
    ("writer",  "pdf"):  "pdf:writer_pdf_Export",
    ("writer",  "docx"): "docx:MS Word 2007 XML",
    ("writer",  "doc"):  "doc:MS Word 97",
    ("writer",  "odt"):  "odt:writer8",
    ("writer",  "txt"):  "txt:Text (encoded)",
    ("writer",  "html"): "html:HTML (StarWriter)",
    # Impress → various
    ("impress", "pdf"):  "pdf:impress_pdf_Export",
    ("impress", "pptx"): "pptx:Impress MS PowerPoint 2007 XML",
    ("impress", "ppt"):  "ppt:MS PowerPoint 97",
    ("impress", "odp"):  "odp:impress8",
    # Calc → various
    ("calc",    "pdf"):  "pdf:calc_pdf_Export",
    ("calc",    "xlsx"): "xlsx:Calc MS Excel 2007 XML",
    ("calc",    "xls"):  "xls:MS Excel 97",
    ("calc",    "ods"):  "ods:calc8",
    ("calc",    "csv"):  "csv:Text - txt - csv (StarCalc)",
    ("calc",    "html"): "html:HTML (StarCalc)",
}


def _lo_doc_family(ext: str) -> str:
    """Return LibreOffice document family ('writer'/'impress'/'calc') for *ext*."""
    e = ext.lstrip(".")
    if e in _LO_IMPRESS_EXTS:
        return "impress"
    if e in _LO_CALC_EXTS:
        return "calc"
    return "writer"  # safe default


def _lo_filter_str(src_ext: str, target: str) -> str:
    """Return the proper ``--convert-to`` argument for LibreOffice.

    Falls back to the bare extension when no explicit mapping is known.
    """
    family = _lo_doc_family(src_ext)
    return _LO_FILTER_MAP.get((family, target), target)


# Image extensions that cannot be used as Pandoc input and cannot be
# converted to document formats (only image→PDF via img2pdf is supported).
_IMAGE_EXTS = frozenset({"png", "jpg", "jpeg", "tiff", "bmp", "gif", "webp"})

# Map of (input_ext → target_ext) → conversion strategy
# Strategies: "pdf2docx", "tabula", "libreoffice", "pandoc", "img2pdf", "pdf2img", "unsupported"
def _doc_conv_strategy(src_ext: str, target: str) -> str:
    src_ext = src_ext.lstrip(".")
    if src_ext == target:
        return "passthrough"
    if src_ext == "pdf" and target == "docx":
        return "pdf2docx"
    if src_ext == "pdf" and target in ("png", "jpg"):
        return "pdf2img"
    if src_ext == "pdf" and target == "xlsx":
        return "tabula"
    if src_ext in _IMAGE_EXTS and target == "pdf":
        return "img2pdf"
    # Image files cannot be converted to document/text formats.
    # Returning "unsupported" prevents Pandoc from receiving an image format
    # as its --from argument, which would produce a cryptic format-list error.
    if src_ext in _IMAGE_EXTS:
        return "unsupported"
    if target in ("html", "md", "txt", "epub") or src_ext in ("md", "html", "txt", "epub"):
        # Pandoc does not support Excel as an input format – route xlsx/xls to
        # LibreOffice regardless of target so we get the Python fallbacks too.
        if src_ext not in ("xlsx", "xls"):
            return "pandoc"
    # Default: LibreOffice for Office/ODF conversions
    return "libreoffice"


def _unsupported_conversion_error(src_ext: str, target: str) -> str:
    """Return a readable error message for an unsupported source→target combination.

    Used both in ``api_doc_convert`` and in the test suite so the wording
    stays consistent between the production path and the tests.
    """
    src_clean = src_ext.lstrip(".") or "unknown"
    if src_clean in _IMAGE_EXTS:
        return (
            f"Image files (.{src_clean}) can only be converted to PDF. "
            f"Converting to .{target} is not supported."
        )
    return f"Converting .{src_clean} files to .{target} is not supported."


@fastapi_app.post("/api/doc/convert")
async def api_doc_convert(
    request: Request,
    file: UploadFile = File(...),
    target: str = Form(...),
):
    """Convert an uploaded document to the requested target format."""
    import tempfile

    target = target.strip().lower()
    if target not in _DOC_CONV_TARGETS:
        return JSONResponse(
            {"error": f"Unsupported target format '{target}'."},
            status_code=400,
        )

    original_name = file.filename or "document"
    src_ext = os.path.splitext(original_name)[1].lower()

    # Validate the source→target combination before doing any I/O so the user
    # gets a clear, readable error instead of a cryptic library message.
    strategy_check = _doc_conv_strategy(src_ext, target)
    if strategy_check == "unsupported":
        return JSONResponse(
            {"error": _unsupported_conversion_error(src_ext, target)},
            status_code=400,
        )

    content = await file.read()
    if len(content) > Config.MAX_CONTENT_LENGTH:
        return JSONResponse(
            {"error": f"File is too large (max {Config.MAX_CONTENT_LENGTH // (1024 * 1024)} MB)."},
            status_code=400,
        )
    if not content:
        return JSONResponse({"error": "Uploaded file is empty."}, status_code=400)

    ip = _get_real_ip(request)
    tmpdir = tempfile.mkdtemp(prefix="docconv_", dir=DOWNLOAD_FOLDER)
    try:
        input_path = os.path.join(tmpdir, f"input{src_ext}")
        with open(input_path, "wb") as f:
            f.write(content)

        output_path = os.path.join(tmpdir, f"output.{target}")
        strategy = _doc_conv_strategy(src_ext, target)
        err_msg = None

        if strategy == "unsupported":
            src_clean = src_ext.lstrip(".")
            return JSONResponse(
                {"error": (
                    f"Converting a {src_clean.upper()} image to {target.upper()} is not supported. "
                    "Images can only be converted to PDF. "
                    "Please upload a document file (e.g. DOCX, PDF, HTML, TXT) instead."
                )},
                status_code=400,
            )

        elif strategy == "passthrough":
            shutil.copy2(input_path, output_path)

        elif strategy == "pdf2docx":
            try:
                from pdf2docx import Converter
                cv = Converter(input_path)
                cv.convert(output_path)
                cv.close()
            except ImportError:
                err_msg = "pdf2docx is not installed on this server."
            except Exception as exc:
                err_msg = f"PDF→Word conversion failed: {exc}"

        elif strategy == "tabula":
            try:
                import tabula
                dfs = tabula.read_pdf(input_path, pages="all")
                import openpyxl
                wb = openpyxl.Workbook()
                for i, df in enumerate(dfs):
                    ws = wb.active if i == 0 else wb.create_sheet(f"Sheet{i+1}")
                    ws.append(list(df.columns))
                    for row in df.itertuples(index=False):
                        ws.append(list(row))
                wb.save(output_path)
            except ImportError:
                err_msg = "tabula-py or openpyxl is not installed on this server."
            except Exception as exc:
                err_msg = f"PDF→Excel conversion failed: {exc}"

        elif strategy == "img2pdf":
            try:
                import img2pdf
                with open(output_path, "wb") as out_f:
                    out_f.write(img2pdf.convert(input_path))
            except ImportError:
                err_msg = "img2pdf is not installed on this server."
            except Exception as exc:
                err_msg = f"Image→PDF conversion failed: {exc}"

        elif strategy == "pdf2img":
            try:
                result = subprocess.run(
                    ["pdftoppm", f"-{target}", input_path, os.path.join(tmpdir, "page")],
                    capture_output=True, timeout=120,
                )
                pages = sorted(
                    p for p in os.listdir(tmpdir)
                    if p.startswith("page") and p.endswith(f".{target}")
                )
                if not pages:
                    err_msg = "PDF→image conversion produced no output (pdftoppm missing?)."
                else:
                    # Return first page; for multi-page return a zip
                    if len(pages) == 1:
                        output_path = os.path.join(tmpdir, pages[0])
                    else:
                        zip_out = os.path.join(tmpdir, "pages.zip")
                        with zipfile.ZipFile(zip_out, "w") as zf:
                            for p in pages:
                                zf.write(os.path.join(tmpdir, p), p)
                        output_path = zip_out
                        target = "zip"
            except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
                err_msg = f"PDF→image conversion failed: {exc}"

        elif strategy == "pandoc":
            pandoc_ok = False
            try:
                import pypandoc
                pypandoc.convert_file(input_path, target, outputfile=output_path)
                pandoc_ok = True
            except ImportError:
                err_msg = "pypandoc is not installed on this server."
            except Exception as exc:
                exc_str = str(exc)
                exc_str_lower = exc_str.lower()
                # Pandoc raises a cryptic error listing all supported formats when
                # given an unsupported input type (e.g. an image extension).
                # Replace it with a readable message.
                if "invalid input format" in exc_str_lower or "expected one of these" in exc_str_lower:
                    src_clean = src_ext.lstrip(".") or "unknown"
                    err_msg = (
                        f"Cannot convert .{src_clean} files to .{target}. "
                        f"The source format is not supported for document conversion. "
                        f"Supported text-based formats include: md, html, txt, docx, odt, epub, rst."
                    )
                else:
                    err_msg = f"Pandoc conversion failed: {exc}"
            # If pandoc failed and the source is a format LibreOffice can open,
            # fall through to the LibreOffice path as a secondary attempt.
            if not pandoc_ok:
                lo_path = shutil.which("libreoffice") or shutil.which("soffice")
                src_clean = src_ext.lstrip(".")
                lo_capable = src_clean in (_LO_WRITER_EXTS | _LO_IMPRESS_EXTS | _LO_CALC_EXTS)
                if lo_path and lo_capable:
                    lo_filter = _lo_filter_str(src_ext, target)
                    lo_result = subprocess.run(
                        [lo_path, "--headless", "--convert-to", lo_filter,
                         "--outdir", tmpdir, input_path],
                        capture_output=True, text=True, timeout=300,
                    )
                    stem = os.path.splitext(os.path.basename(input_path))[0]
                    lo_out = os.path.join(tmpdir, f"{stem}.{target}")
                    if lo_result.returncode == 0 and os.path.isfile(lo_out):
                        output_path = lo_out
                        err_msg = None  # LO fallback succeeded

        else:  # libreoffice
            lo_path = shutil.which("libreoffice") or shutil.which("soffice")
            if lo_path:
                # Use an explicit filter string to avoid "no export filter" errors.
                lo_filter = _lo_filter_str(src_ext, target)
                result = subprocess.run(
                    [lo_path, "--headless", "--convert-to", lo_filter,
                     "--outdir", tmpdir, input_path],
                    capture_output=True, text=True, timeout=300,
                )
                # LibreOffice names output after input stem
                stem = os.path.splitext(os.path.basename(input_path))[0]
                lo_out = os.path.join(tmpdir, f"{stem}.{target}")
                if result.returncode != 0 or not os.path.isfile(lo_out):
                    err_detail = (result.stderr or result.stdout or "").strip()[:300]
                    logger.warning("LibreOffice conversion failed for %s: %s", original_name, err_detail)
                    lo_err = f"Failed to convert {original_name}"
                    # LibreOffice failed – attempt Python-only fallbacks before
                    # giving up so that common conversions still work.
                    src_clean = src_ext.lstrip(".")
                    fb_done = False

                    # docx/doc → txt or html via python-docx
                    if src_clean in ("docx", "doc") and target in ("txt", "html"):
                        try:
                            import docx as python_docx
                            doc = python_docx.Document(input_path)
                            paragraphs = [p.text for p in doc.paragraphs]
                            if target == "txt":
                                with open(output_path, "w", encoding="utf-8") as out_f:
                                    out_f.write("\n".join(paragraphs))
                            else:
                                html_body = "".join(f"<p>{p}</p>" for p in paragraphs if p.strip())
                                with open(output_path, "w", encoding="utf-8") as out_f:
                                    out_f.write(f"<!DOCTYPE html><html><body>{html_body}</body></html>")
                            fb_done = True
                        except Exception:
                            pass

                    # docx/doc → pdf via fpdf2 + python-docx (text-only)
                    if not fb_done and src_clean in ("docx", "doc") and target == "pdf":
                        try:
                            import docx as python_docx
                            from fpdf import FPDF
                            doc = python_docx.Document(input_path)
                            pdf = FPDF()
                            pdf.set_auto_page_break(auto=True, margin=15)
                            pdf.add_page()
                            pdf.set_font("Helvetica", size=11)
                            for para in doc.paragraphs:
                                if para.text.strip():
                                    pdf.multi_cell(0, 6, para.text.encode("latin-1", errors="replace").decode("latin-1"))
                                else:
                                    pdf.ln(3)
                            pdf.output(output_path)
                            fb_done = True
                        except Exception:
                            pass

                    # pptx → txt or html via python-pptx
                    if not fb_done and src_clean == "pptx" and target in ("txt", "html"):
                        try:
                            from pptx import Presentation
                            prs = Presentation(input_path)
                            lines = []
                            for slide in prs.slides:
                                for shape in slide.shapes:
                                    if shape.has_text_frame:
                                        for para in shape.text_frame.paragraphs:
                                            txt = "".join(run.text for run in para.runs)
                                            if txt.strip():
                                                lines.append(txt)
                            if target == "txt":
                                with open(output_path, "w", encoding="utf-8") as out_f:
                                    out_f.write("\n".join(lines))
                            else:
                                html_body = "".join(f"<p>{l}</p>" for l in lines)
                                with open(output_path, "w", encoding="utf-8") as out_f:
                                    out_f.write(f"<!DOCTYPE html><html><body>{html_body}</body></html>")
                            fb_done = True
                        except Exception:
                            pass

                    # pptx → pdf via fpdf2 + python-pptx (text-only)
                    if not fb_done and src_clean == "pptx" and target == "pdf":
                        try:
                            from pptx import Presentation
                            from fpdf import FPDF
                            prs = Presentation(input_path)
                            pdf = FPDF()
                            pdf.set_auto_page_break(auto=True, margin=15)
                            pdf.set_font("Helvetica", size=11)
                            for slide_num, slide in enumerate(prs.slides, 1):
                                pdf.add_page()
                                pdf.set_font("Helvetica", "B", 13)
                                pdf.cell(0, 8, f"Slide {slide_num}", new_x="LMARGIN", new_y="NEXT")
                                pdf.set_font("Helvetica", size=10)
                                for shape in slide.shapes:
                                    if shape.has_text_frame:
                                        for para in shape.text_frame.paragraphs:
                                            txt = "".join(run.text for run in para.runs)
                                            if txt.strip():
                                                pdf.multi_cell(0, 6, txt.encode("latin-1", errors="replace").decode("latin-1"))
                            pdf.output(output_path)
                            fb_done = True
                        except Exception:
                            pass

                    if fb_done:
                        err_msg = None
                    else:
                        err_msg = lo_err
                else:
                    output_path = lo_out
            else:
                # LibreOffice is not available — attempt Python-only fallbacks
                # for the most common Office→text/html conversions.
                src_clean = src_ext.lstrip(".")
                fallback_attempted = False

                # .docx / .doc → plain-text via python-docx (text extraction only)
                if src_clean in ("docx", "doc") and target in ("txt", "html"):
                    try:
                        import docx as python_docx
                        doc = python_docx.Document(input_path)
                        paragraphs = [p.text for p in doc.paragraphs]
                        if target == "txt":
                            with open(output_path, "w", encoding="utf-8") as out_f:
                                out_f.write("\n".join(paragraphs))
                        else:  # html
                            html_body = "".join(
                                f"<p>{p}</p>" for p in paragraphs if p.strip()
                            )
                            with open(output_path, "w", encoding="utf-8") as out_f:
                                out_f.write(
                                    f"<!DOCTYPE html><html><body>{html_body}</body></html>"
                                )
                        fallback_attempted = True
                    except ImportError:
                        pass
                    except Exception as exc:
                        err_msg = f"Word text extraction failed: {exc}"
                        fallback_attempted = True

                # .xlsx / .xls → CSV via openpyxl
                elif src_clean in ("xlsx", "xls") and target == "csv":
                    try:
                        import openpyxl
                        import csv as csv_mod
                        wb = openpyxl.load_workbook(input_path, read_only=True, data_only=True)
                        ws = wb.active
                        with open(output_path, "w", newline="", encoding="utf-8") as out_f:
                            writer = csv_mod.writer(out_f)
                            for row in ws.iter_rows(values_only=True):
                                writer.writerow(["" if v is None else v for v in row])
                        fallback_attempted = True
                    except ImportError:
                        pass
                    except Exception as exc:
                        err_msg = f"Excel→CSV conversion failed: {exc}"
                        fallback_attempted = True

                # .xlsx / .xls → PDF via fpdf2 + openpyxl (text/table representation)
                elif src_clean in ("xlsx", "xls") and target == "pdf":
                    try:
                        import openpyxl
                        from fpdf import FPDF
                        _PDF_ROW_MAX_CHARS = 300  # truncate very wide rows
                        _PDF_COL_SEP = "  |  "
                        wb = openpyxl.load_workbook(input_path, read_only=True, data_only=True)
                        pdf = FPDF()
                        pdf.set_auto_page_break(auto=True, margin=10)
                        for sheet_name in wb.sheetnames:
                            ws = wb[sheet_name]
                            pdf.add_page()
                            pdf.set_font("Helvetica", "B", 12)
                            pdf.cell(0, 8, sheet_name, new_x="LMARGIN", new_y="NEXT")
                            pdf.set_font("Helvetica", size=8)
                            for row in ws.iter_rows(values_only=True):
                                row_text = _PDF_COL_SEP.join(
                                    "" if v is None else str(v) for v in row
                                )
                                pdf.multi_cell(0, 5, row_text[:_PDF_ROW_MAX_CHARS])
                        pdf.output(output_path)
                        fallback_attempted = True
                    except ImportError:
                        pass
                    except Exception as exc:
                        err_msg = f"Excel→PDF conversion failed: {exc}"
                        fallback_attempted = True

                # .xlsx / .xls → DOCX via openpyxl + python-docx
                elif src_clean in ("xlsx", "xls") and target == "docx":
                    try:
                        import openpyxl
                        import docx as python_docx
                        wb = openpyxl.load_workbook(input_path, read_only=True, data_only=True)
                        doc = python_docx.Document()
                        for sheet_name in wb.sheetnames:
                            doc.add_heading(sheet_name, level=1)
                            ws = wb[sheet_name]
                            rows = list(ws.iter_rows(values_only=True))
                            if rows:
                                n_cols = max((len(r) for r in rows), default=1)
                                table = doc.add_table(rows=len(rows), cols=n_cols)
                                for r_idx, row in enumerate(rows):
                                    for c_idx in range(n_cols):
                                        val = row[c_idx] if c_idx < len(row) else None
                                        table.cell(r_idx, c_idx).text = (
                                            "" if val is None else str(val)
                                        )
                        doc.save(output_path)
                        fallback_attempted = True
                    except ImportError:
                        pass
                    except Exception as exc:
                        err_msg = f"Excel→Word conversion failed: {exc}"
                        fallback_attempted = True

                # .xlsx / .xls → PNG/JPG via openpyxl + Pillow (table image)
                elif src_clean in ("xlsx", "xls") and target in ("png", "jpg"):
                    try:
                        import openpyxl
                        from PIL import Image, ImageDraw, ImageFont
                        _IMG_CELL_W = 130     # pixels per column
                        _IMG_CELL_H = 22      # pixels per row
                        _IMG_PAD = 4          # border padding
                        _IMG_MAX_H = 8000     # maximum image height (pixels)
                        _IMG_MAX_CHARS = 20   # max chars displayed per cell
                        _IMG_TEXT_OFFSET = (3, 4)   # (x, y) text offset within cell
                        _COLOR_HEADER = "#d0e8ff"
                        _COLOR_ROW_EVEN = "white"
                        _COLOR_ROW_ODD = "#f5f5f5"
                        _COLOR_GRID = "#cccccc"
                        wb = openpyxl.load_workbook(input_path, read_only=True, data_only=True)
                        ws = wb.active
                        rows = list(ws.iter_rows(values_only=True))
                        if not rows:
                            raise ValueError("Spreadsheet has no data")
                        n_cols = max((len(r) for r in rows), default=1)
                        img_w = n_cols * _IMG_CELL_W + 2 * _IMG_PAD
                        img_h = min(len(rows) * _IMG_CELL_H + 2 * _IMG_PAD, _IMG_MAX_H)
                        img = Image.new("RGB", (img_w, img_h), "white")
                        draw = ImageDraw.Draw(img)
                        try:
                            font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
                            bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
                            font = ImageFont.truetype(font_path, 11)
                            header_font = ImageFont.truetype(bold_path, 11)
                        except Exception:
                            font = ImageFont.load_default()
                            header_font = font
                        for r_idx, row in enumerate(rows):
                            y = _IMG_PAD + r_idx * _IMG_CELL_H
                            if y + _IMG_CELL_H > img_h:
                                break
                            for c_idx in range(n_cols):
                                x = _IMG_PAD + c_idx * _IMG_CELL_W
                                val = (
                                    str(row[c_idx])
                                    if c_idx < len(row) and row[c_idx] is not None
                                    else ""
                                )
                                if r_idx == 0:
                                    bg = _COLOR_HEADER
                                elif r_idx % 2 == 0:
                                    bg = _COLOR_ROW_EVEN
                                else:
                                    bg = _COLOR_ROW_ODD
                                draw.rectangle(
                                    [x, y, x + _IMG_CELL_W - 1, y + _IMG_CELL_H - 1],
                                    fill=bg, outline=_COLOR_GRID,
                                )
                                draw.text(
                                    (x + _IMG_TEXT_OFFSET[0], y + _IMG_TEXT_OFFSET[1]),
                                    val[:_IMG_MAX_CHARS], fill="black",
                                    font=header_font if r_idx == 0 else font,
                                )
                        img.save(output_path)
                        fallback_attempted = True
                    except ImportError:
                        pass
                    except Exception as exc:
                        err_msg = f"Excel→Image conversion failed: {exc}"
                        fallback_attempted = True

                # .pptx → txt via python-pptx (text extraction only)
                elif src_clean == "pptx" and target in ("txt", "html"):
                    try:
                        from pptx import Presentation
                        prs = Presentation(input_path)
                        lines = []
                        for slide in prs.slides:
                            for shape in slide.shapes:
                                if shape.has_text_frame:
                                    for para in shape.text_frame.paragraphs:
                                        txt = "".join(run.text for run in para.runs)
                                        if txt.strip():
                                            lines.append(txt)
                        if target == "txt":
                            with open(output_path, "w", encoding="utf-8") as out_f:
                                out_f.write("\n".join(lines))
                        else:  # html
                            html_body = "".join(f"<p>{l}</p>" for l in lines)
                            with open(output_path, "w", encoding="utf-8") as out_f:
                                out_f.write(
                                    f"<!DOCTYPE html><html><body>{html_body}</body></html>"
                                )
                        fallback_attempted = True
                    except ImportError:
                        pass
                    except Exception as exc:
                        err_msg = f"PowerPoint text extraction failed: {exc}"
                        fallback_attempted = True

                if not fallback_attempted and not err_msg:
                    err_msg = (
                        "LibreOffice is not installed on this server. "
                        f"Converting {src_ext} → {target} requires LibreOffice. "
                        "Please install it or try a different conversion."
                    )

        if err_msg:
            return JSONResponse({"error": err_msg}, status_code=500)

        if not os.path.isfile(output_path):
            return JSONResponse({"error": "Conversion produced no output file."}, status_code=500)

        # Track the conversion as a record
        record_id = str(uuid.uuid4())
        cached_geo = ip_country_cache.get(ip, {})
        with downloads_lock:
            downloads[record_id] = {
                "id": record_id,
                "url": "doc_conversion",
                "title": f"Convert: {original_name} → .{target}",
                "safe_title": safe_filename(f"convert_{original_name}"),
                "status": "complete",
                "type": "doc_conversion",
                "percent": 100,
                "created_at": time.time(),
                "end_time": time.time(),
                "filename": os.path.basename(output_path),
                "ip": ip,
                "country": cached_geo.get("country", ""),
                "country_code": cached_geo.get("code", ""),
                "city": cached_geo.get("city", ""),
                "region": cached_geo.get("region", ""),
            }
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()

        out_name = f"{os.path.splitext(original_name)[0]}.{target}"
        media_type = mimetypes.guess_type(output_path)[0] or "application/octet-stream"
        return FileResponse(
            output_path,
            filename=out_name,
            media_type=media_type,
        )

    except subprocess.TimeoutExpired:
        return JSONResponse({"error": "Conversion timed out."}, status_code=500)
    except Exception as exc:
        logger.error("Document conversion error: %s", exc, exc_info=True)
        return JSONResponse({"error": f"Conversion error: {exc}"}, status_code=500)
    finally:
        def _delayed_rm(path, delay=30):
            time.sleep(delay)
            shutil.rmtree(path, ignore_errors=True)
        threading.Thread(target=_delayed_rm, args=(tmpdir,), daemon=True).start()


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

        # Flush in-memory records to DB before evicting stale ones so that
        # the admin dashboard (which reads from the DB) retains a complete
        # download log even after the video files and in-memory entries are
        # cleaned up.
        save_downloads_to_disk()

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
logger.info("Starting Video Downloader (Production)")
logger.info("=" * 50)

# Warn if using the default admin password
if Config.ADMIN_PASSWORD == "admin":
    logger.warning(
        "WARNING: ADMIN_PASSWORD is set to the default value 'admin'. "
        "Set the ADMIN_PASSWORD environment variable to a strong password before deploying."
    )

# Check dependencies
check_yt_dlp()
check_ffmpeg()

# Log paths
logger.info(f"Root directory: {ROOT_DIR}")
logger.info(f"Templates directory: {TEMPLATES_DIR}")
logger.info(f"Downloads directory: {DOWNLOAD_FOLDER}")
logger.info(f"Template exists: {os.path.exists(os.path.join(TEMPLATES_DIR, 'index.html'))}")

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

@fastapi_app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    # For 404s on non-API paths, serve the React SPA so client-side routing works
    if exc.status_code == 404:
        path = request.url.path
        # Only serve SPA for non-API / non-static paths
        api_prefixes = (
            "/video_info", "/start_download", "/status/", "/files", "/downloads/",
            "/stream/", "/delete/", "/cancel", "/cancel_all", "/stats",
            "/active_downloads", "/start_playlist_download", "/start_batch_download",
            "/download_zip", "/convert_file", "/batch_convert", "/trim", "/crop",
            "/watermark", "/extract_clip", "/merge", "/job_status/", "/reviews",
            "/admin/downloads", "/admin/visitors", "/admin/analytics",
            "/admin/cancel_download/", "/admin/delete_record/", "/admin/clear_visitors",
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