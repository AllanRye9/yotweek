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
import zipfile
import ipaddress
import certifi
import yt_dlp
from pathlib import Path
from datetime import datetime, timedelta
from functools import wraps

from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    send_from_directory,
    url_for,
    session,
    redirect,
)
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
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

# Create directories
os.makedirs(TEMPLATES_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

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
# FLASK APP INITIALIZATION
# =========================================================

app = Flask(__name__, 
            template_folder=TEMPLATES_DIR,
            static_folder=STATIC_DIR,
            static_url_path='/static')

app.config.from_object(Config)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

# Enable CORS with production settings
CORS(app, resources={
    r"/*": {
        "origins": os.environ.get("ALLOWED_ORIGINS", "*").split(","),
        "methods": ["GET", "POST", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

# Socket.IO with production settings
socketio = SocketIO(
    app,
    cors_allowed_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
    async_mode='eventlet',
    logger=True if os.environ.get("FLASK_DEBUG") else False,
    engineio_logger=True if os.environ.get("FLASK_DEBUG") else False,
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=1e8,
    manage_session=False
)

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

# Paths whose visits are tracked for analytics (main site + admin page)
TRACKED_VISITOR_PATHS = {"/const", "/"}

# =========================================================
# ISO 3166-1 ALPHA-2 → COUNTRY NAME LOOKUP
# =========================================================

_ISO2_TO_NAME: dict[str, str] = {
    "US": "United States", "GB": "United Kingdom", "DE": "Germany",
    "FR": "France", "IN": "India", "CN": "China", "RU": "Russia",
    "CA": "Canada", "AU": "Australia", "BR": "Brazil", "JP": "Japan",
    "KR": "South Korea", "NL": "Netherlands", "SE": "Sweden",
    "NO": "Norway", "PL": "Poland", "IT": "Italy", "ES": "Spain",
    "MX": "Mexico", "ZA": "South Africa", "NG": "Nigeria",
    "KE": "Kenya", "GH": "Ghana", "EG": "Egypt", "PK": "Pakistan",
    "ID": "Indonesia", "TH": "Thailand", "VN": "Vietnam",
    "PH": "Philippines", "TR": "Turkey", "AR": "Argentina",
    "CO": "Colombia", "CL": "Chile", "PE": "Peru",
    "UA": "Ukraine", "BE": "Belgium", "CH": "Switzerland",
    "AT": "Austria", "PT": "Portugal", "FI": "Finland",
    "DK": "Denmark", "CZ": "Czech Republic", "RO": "Romania",
    "HU": "Hungary", "SG": "Singapore", "MY": "Malaysia",
    "NZ": "New Zealand", "IR": "Iran", "SA": "Saudi Arabia",
    "AE": "United Arab Emirates", "IL": "Israel",
}

# =========================================================
# SSL CERTIFICATE FIX
# =========================================================

os.environ['SSL_CERT_FILE'] = certifi.where()
os.environ['REQUESTS_CA_BUNDLE'] = certifi.where()

# =========================================================
# SQLITE PERSISTENCE
# =========================================================

_db_lock = threading.Lock()


def _get_db():
    """Open a short-lived SQLite connection for the calling thread.

    Callers hold _db_lock and immediately close the connection after use,
    so each connection is used by exactly one thread — check_same_thread is
    not needed.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create tables if they don't exist."""
    with _db_lock:
        conn = _get_db()
        try:
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
            row = conn.execute("SELECT COUNT(*) FROM admin_users").fetchone()
            return row[0] > 0
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
            conn.execute(
                "INSERT INTO admin_users (username, password_hash) VALUES (?, ?)",
                (username, ph),
            )
            conn.commit()
            return True, ""
        except sqlite3.IntegrityError:
            return False, "User already exists"
        finally:
            conn.close()


def verify_admin_user(username: str, password: str) -> bool:
    """Check username+password against the stored hash."""
    with _db_lock:
        conn = _get_db()
        try:
            row = conn.execute(
                "SELECT password_hash FROM admin_users WHERE username=?",
                (username,),
            ).fetchone()
        finally:
            conn.close()
    if row is None:
        return False
    return check_password_hash(row["password_hash"], password)


def load_persistence():
    """Load downloads and visitors from SQLite on startup."""
    global downloads, visitors
    # Migrate legacy JSON files into SQLite (one-time migration)
    _migrate_json_to_sqlite()

    with _db_lock:
        conn = _get_db()
        try:
            rows = conn.execute("SELECT id, data FROM downloads").fetchall()
            saved_dl = {r["id"]: json.loads(r["data"]) for r in rows}
            rows_v = conn.execute("SELECT data FROM visitors ORDER BY rowid").fetchall()
            saved_v = [json.loads(r["data"]) for r in rows_v]
        finally:
            conn.close()

    with downloads_lock:
        downloads.update(saved_dl)
    with visitors_lock:
        visitors.extend(saved_v)
    logger.info(f"Loaded {len(saved_dl)} download records and {len(saved_v)} visitor records from SQLite")


def _migrate_json_to_sqlite():
    """One-time migration: import legacy JSON persistence files into SQLite."""
    legacy_dl = os.path.join(DATA_DIR, "downloads.json")
    legacy_v = os.path.join(DATA_DIR, "visitors.json")
    conn = _get_db()
    try:
        if os.path.exists(legacy_dl):
            try:
                with open(legacy_dl) as fh:
                    data = json.load(fh)
                for did, d in data.items():
                    conn.execute(
                        "INSERT OR IGNORE INTO downloads (id, data) VALUES (?, ?)",
                        (did, json.dumps(d, default=str)),
                    )
                conn.commit()
                os.rename(legacy_dl, legacy_dl + ".migrated")
                logger.info(f"Migrated {len(data)} download records from JSON to SQLite")
            except Exception as exc:
                logger.error(f"JSON→SQLite migration failed for downloads: {exc}")
        if os.path.exists(legacy_v):
            try:
                with open(legacy_v) as fh:
                    data = json.load(fh)
                for v in data:
                    conn.execute(
                        "INSERT INTO visitors (data) VALUES (?)",
                        (json.dumps(v, default=str),),
                    )
                conn.commit()
                os.rename(legacy_v, legacy_v + ".migrated")
                logger.info(f"Migrated {len(data)} visitor records from JSON to SQLite")
            except Exception as exc:
                logger.error(f"JSON→SQLite migration failed for visitors: {exc}")
    finally:
        conn.close()


def save_downloads_to_disk():
    """Persist current downloads dict to SQLite (upsert all records)."""
    try:
        with downloads_lock:
            data = dict(downloads)
        with _db_lock:
            conn = _get_db()
            try:
                for did, d in data.items():
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
    """Persist visitor list to SQLite (replace all rows)."""
    try:
        with visitors_lock:
            data = list(visitors)
        with _db_lock:
            conn = _get_db()
            try:
                conn.execute("DELETE FROM visitors")
                for v in data:
                    conn.execute(
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


def _lookup_country_async(ip: str):
    """Resolve an IP to its country using multiple geo-IP services (fallback chain)."""
    if ip in ip_country_cache:
        return

    # Private / loopback addresses cannot be geo-located
    if _is_private_ip(ip):
        ip_country_cache[ip] = {"country": "Local", "code": ""}
        with visitors_lock:
            for v in visitors[-200:]:
                if v.get("ip") == ip and not v.get("country"):
                    v["country"] = "Local"
                    v["country_code"] = ""
        with downloads_lock:
            for d in downloads.values():
                if d.get("ip") == ip and not d.get("country"):
                    d["country"] = "Local"
                    d["country_code"] = ""
        _schedule_visitor_save()
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()
        return

    country, code = "Unknown", ""

    # --- Service 1: ip-api.com (free, no key) ---
    try:
        with urllib.request.urlopen(
            f"https://ip-api.com/json/{ip}?fields=status,country,countryCode", timeout=5
        ) as resp:
            data = json.loads(resp.read())
        if data.get("status") == "success" and data.get("country"):
            country = data["country"]
            code = data.get("countryCode", "")
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
        except Exception:
            pass

    # --- Service 3: ipwhois.app (second fallback) ---
    if country == "Unknown":
        try:
            with urllib.request.urlopen(
                f"https://ipwhois.app/json/{ip}?objects=country,country_code", timeout=5
            ) as resp:
                data = json.loads(resp.read())
            if data.get("country"):
                country = data["country"]
                code = data.get("country_code", "")
        except Exception:
            pass

    ip_country_cache[ip] = {"country": country, "code": code}
    # Back-fill any visitor records that are waiting for this IP's country
    with visitors_lock:
        for v in visitors[-200:]:
            if v.get("ip") == ip and not v.get("country"):
                v["country"] = country
                v["country_code"] = code
    # Back-fill any download records that are waiting for this IP's country
    with downloads_lock:
        for d in downloads.values():
            if d.get("ip") == ip and not d.get("country"):
                d["country"] = country
                d["country_code"] = code
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
    """Rate limiting decorator"""
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            ip = request.remote_addr
            with downloads_lock:
                count = ip_download_count.get(ip, 0)
                if count >= max_per_ip:
                    return jsonify({
                        "error": f"Rate limit exceeded. Maximum {max_per_ip} concurrent downloads per IP."
                    }), 429
                ip_download_count[ip] = count + 1
            
            try:
                return f(*args, **kwargs)
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
    """Decorator that requires admin login for the wrapped view."""
    @wraps(f)
    def wrapped(*args, **kwargs):
        if not session.get("admin_logged_in"):
            # Non-GET requests (DELETE, POST, PUT, PATCH) are always API calls —
            # return JSON 401 so the client can handle the error without receiving HTML.
            if request.method != "GET":
                return jsonify({"error": "Authentication required"}), 401
            # Detect API vs browser requests: if the client prefers JSON (e.g. fetch())
            # or explicitly requests it, return a JSON 401; otherwise redirect to login.
            best = request.accept_mimetypes.best_match(
                ["application/json", "text/html"],
                default="text/html",
            )
            if best == "application/json":
                return jsonify({"error": "Authentication required"}), 401
            return redirect(url_for("admin_login", next=request.url))
        return f(*args, **kwargs)
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
    """Build YouTube extractor args with player clients that avoid bot detection.

    Uses the ``android_vr``, ``web``, and ``web_safari`` player clients, which
    are the default clients supported by yt-dlp 2026.x and reliably bypass
    YouTube's bot-detection checks without requiring cookies.

    See https://github.com/yt-dlp/yt-dlp/wiki/Extractors#youtube for details.
    """
    args: dict = {"player_client": ["android_vr", "web", "web_safari"]}
    return {"youtube": args}

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
    "Chrome/124.0.0.0 Safari/537.36"
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
        error_msg = str(e)
        return {"error": error_msg}
    except Exception as e:
        return {"error": str(e)}

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
            socketio.emit(
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

        socketio.emit("completed", {
            "id": download_id,
            "filename": downloads[download_id].get("filename"),
            "title": downloads[download_id].get("title")
        }, room=download_id)
        socketio.emit("files_updated")
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()

    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e)
        with downloads_lock:
            downloads[download_id].update({
                "status": "failed",
                "error": error_msg,
                "end_time": time.time(),
            })
        socketio.emit("failed", {
            "id": download_id,
            "error": error_msg
        }, room=download_id)
        threading.Thread(target=save_downloads_to_disk, daemon=True).start()

    except Exception as e:
        logger.error(f"Download worker error: {e}")
        with downloads_lock:
            downloads[download_id].update({
                "status": "failed",
                "error": str(e),
                "end_time": time.time(),
            })
        socketio.emit("failed", {
            "id": download_id,
            "error": str(e)
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

    Returns ``(abs_path, None)`` on success or ``(None, error_response)`` on
    failure so callers can simply ``return err`` when it is set.
    """
    if not filename:
        return None, (jsonify({"error": "filename is required"}), 400)
    filepath = os.path.join(DOWNLOAD_FOLDER, filename)
    if not os.path.abspath(filepath).startswith(os.path.abspath(DOWNLOAD_FOLDER)):
        return None, (jsonify({"error": "Invalid filename"}), 400)
    if not os.path.isfile(filepath):
        return None, (jsonify({"error": "File not found"}), 404)
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
                socketio.emit(event + "_failed", {"id": job_id, "error": err})
                logger.error("ffmpeg [%s]: %s", job_id, err)
            else:
                with conversions_lock:
                    conversions[job_id].update({
                        "status": "completed",
                        "filename": output_filename,
                    })
                socketio.emit(event, {"id": job_id, "filename": output_filename})
                socketio.emit("files_updated")
        except subprocess.TimeoutExpired:
            err = "ffmpeg timed out (1-hour limit exceeded)"
            with conversions_lock:
                conversions[job_id].update({"status": "failed", "error": err})
            socketio.emit(event + "_failed", {"id": job_id, "error": err})
        except Exception as exc:
            err = str(exc)
            logger.error("ffmpeg worker exception [%s]: %s", job_id, exc)
            with conversions_lock:
                conversions[job_id].update({"status": "failed", "error": err})
            socketio.emit(event + "_failed", {"id": job_id, "error": err})
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

@app.route("/")
def index():
    """Main page"""
    try:
        return render_template("index.html", is_admin=bool(session.get("admin_logged_in")))
    except Exception as e:
        logger.error(f"Template error: {e}")
        return jsonify({"error": "Template not found"}), 500

@app.route("/ads.txt")
def ads_txt():
    """Serve ads.txt for Google AdSense verification"""
    ads_txt_path = os.path.join(ROOT_DIR, "ads.txt")
    if os.path.exists(ads_txt_path):
        return send_from_directory(ROOT_DIR, "ads.txt", mimetype="text/plain")
    logger.warning("ads.txt file not found at %s", ads_txt_path)
    return jsonify({"error": "ads.txt not found"}), 404

@app.route("/health")
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    })

@app.route("/start_download", methods=["POST"])
@rate_limit()
def start_download():
    """Start a download with better error feedback"""
    url = request.form.get("url")
    format_spec = request.form.get("format", "best")
    
    if not url:
        return jsonify({"error": "URL is required"}), 400
    
    # Check concurrent downloads
    with downloads_lock:
        active_count = sum(1 for d in downloads.values() 
                          if d["status"] in ("queued", "downloading"))
        if active_count >= Config.MAX_CONCURRENT_DOWNLOADS:
            return jsonify({
                "error": f"Maximum concurrent downloads reached ({Config.MAX_CONCURRENT_DOWNLOADS})"
            }), 429
    
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
    ip = request.remote_addr
    # Try CDN/proxy headers first for country
    hdr_country, hdr_code = _get_country_from_headers(request)
    if hdr_country and ip not in ip_country_cache:
        ip_country_cache[ip] = {"country": hdr_country, "code": hdr_code}
    elif ip not in ip_country_cache and _is_private_ip(ip):
        ip_country_cache[ip] = {"country": "Local", "code": ""}
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
            "info_error": info.get("error") if info and "error" in info else None
        }
    # Resolve the requester's country in background if not already cached
    if ip not in ip_country_cache:
        threading.Thread(
            target=_lookup_country_async, args=(ip,), daemon=True
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

    return jsonify({
        "download_id": download_id,
        "title": title,
        "status": "queued",
        "warning": info.get("error") if info and "error" in info else None
    })

@app.route("/status/<download_id>")
def get_status(download_id):
    """Get download status"""
    with downloads_lock:
        download = downloads.get(download_id, {})
        # Don't send internal data
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
    return jsonify(safe_download)

@app.route("/files")
def list_files():
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
                    "url": url_for('download_file', filename=name, _external=True)
                })
        files.sort(key=lambda f: f["modified"], reverse=True)
    except Exception as e:
        logger.error(f"Error listing files: {e}")
        return jsonify({"error": "Failed to list files"}), 500
    
    return jsonify(files)

@app.route("/downloads/<path:filename>")
def download_file(filename):
    """Serve downloaded file"""
    try:
        return send_from_directory(
            DOWNLOAD_FOLDER, 
            filename, 
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        logger.error(f"Download error: {e}")
        return jsonify({"error": "File not found"}), 404

# MIME types that Python's mimetypes module maps incorrectly or leaves absent,
# causing browsers to refuse to decode the audio track inside video files.
_MIME_OVERRIDES = {
    ".ts":   "video/mp2t",    # Python maps .ts → text/vnd.trolltech.linguist
    ".weba": "audio/webm",    # Python has no mapping for .weba
    ".opus": "audio/opus",    # Python maps .opus → audio/ogg (imprecise)
    ".3gp":  "video/3gpp",    # Python maps .3gp → audio/3gpp (wrong for video)
    ".3g2":  "video/3gpp2",   # Python maps .3g2 → audio/3gpp2 (wrong for video)
}

@app.route("/stream/<path:filename>")
def stream_file(filename):
    """Serve a downloaded file inline for in-browser preview.

    Differs from /downloads/ in that the file is served without the
    Content-Disposition: attachment header, so browsers (including iOS Safari)
    can play it directly in a <video>/<audio> element.  Werkzeug's
    send_from_directory supports HTTP range requests out-of-the-box, which is
    required by iOS Safari for media playback.

    Explicit MIME type overrides are applied for extensions that Python's
    mimetypes module maps incorrectly (e.g. .ts → text/vnd.trolltech.linguist),
    which would otherwise prevent the browser from decoding the audio track.
    """
    try:
        filepath = os.path.join(DOWNLOAD_FOLDER, filename)
        if not os.path.realpath(filepath).startswith(os.path.realpath(DOWNLOAD_FOLDER)):
            return jsonify({"error": "Invalid filename"}), 400
        if not os.path.isfile(filepath):
            return jsonify({"error": "File not found"}), 404
        ext = os.path.splitext(filename)[1].lower()
        return send_from_directory(
            DOWNLOAD_FOLDER,
            filename,
            as_attachment=False,
            mimetype=_MIME_OVERRIDES.get(ext),
        )
    except Exception as e:
        logger.error(f"Stream error: {e}")
        return jsonify({"error": "File not found"}), 404


@app.route("/delete/<path:filename>", methods=["DELETE"])
def delete_file(filename):
    """Delete a downloaded file"""
    try:
        filepath = os.path.join(DOWNLOAD_FOLDER, filename)
        
        # Security check
        if not os.path.abspath(filepath).startswith(os.path.abspath(DOWNLOAD_FOLDER)):
            return jsonify({"error": "Invalid filename"}), 400
        
        if os.path.exists(filepath) and os.path.isfile(filepath):
            os.remove(filepath)
            socketio.emit("files_updated")
            logger.info(f"Deleted file: {filename}")
            return jsonify({"success": True})
        else:
            return jsonify({"error": "File not found"}), 404
    except Exception as e:
        logger.error(f"Delete error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/stats")
def get_stats():
    """Get download statistics"""
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
        
        return jsonify({
            "file_count": len(files),
            "total_size": total_size,
            "total_size_hr": format_size(total_size),
            "active_downloads": active_count,
            "max_concurrent": Config.MAX_CONCURRENT_DOWNLOADS
        })
    except Exception as e:
        logger.error(f"Stats error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/active_downloads")
def active_downloads_list():
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
    return jsonify({"count": len(active), "downloads": active})

@app.route("/cancel/<download_id>", methods=["POST"])
def cancel_download(download_id):
    """Cancel an ongoing download"""
    with downloads_lock:
        if download_id in downloads:
            if downloads[download_id]["status"] in ("queued", "downloading"):
                downloads[download_id]["status"] = "cancelled"
                socketio.emit("cancelled", {"id": download_id}, room=download_id)
                logger.info(f"Cancelled download: {download_id}")
                return jsonify({"success": True})
    
    return jsonify({"error": "Download not found"}), 404

@app.route("/const")
@admin_required
def admin_page():
    """Admin page — full download history (authentication required)"""
    return render_template("const.html")


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    """Admin login page (username + password)."""
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        # If no DB user exists, fall back to legacy env-var password (username is ignored)
        if not admin_user_exists():
            if secrets.compare_digest(password, app.config["ADMIN_PASSWORD"]):
                session.permanent = True
                session["admin_logged_in"] = True
                session["admin_username"] = username or "admin"
                next_url = request.args.get("next") or url_for("admin_page")
                return redirect(next_url)
            error = "Incorrect password. Please try again."
        else:
            if verify_admin_user(username, password):
                session.permanent = True
                session["admin_logged_in"] = True
                session["admin_username"] = username
                next_url = request.args.get("next") or url_for("admin_page")
                return redirect(next_url)
            error = "Incorrect username or password. Please try again."
    return render_template("admin_login.html", error=error, has_admin=admin_user_exists())


@app.route("/admin/register", methods=["GET", "POST"])
def admin_register():
    """Admin registration page — only one admin account is allowed."""
    # If already logged in, redirect to dashboard
    if session.get("admin_logged_in"):
        return redirect(url_for("admin_page"))
    error = None
    success = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        confirm  = request.form.get("confirm_password", "")
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
    return render_template("admin_login.html", error=error, success=success,
                           register_mode=True, has_admin=admin_user_exists())


@app.route("/admin/logout", methods=["POST"])
def admin_logout():
    """Log out of the admin panel."""
    session.pop("admin_logged_in", None)
    session.pop("admin_username", None)
    return redirect(url_for("admin_login"))


@app.before_request
def track_admin_visitor():
    """Record a visit to tracked pages (main site + admin page) for analytics."""
    if request.path not in TRACKED_VISITOR_PATHS:
        return
    ip = request.remote_addr or "unknown"
    ua = request.headers.get("User-Agent", "")

    # Try to get country from CDN/proxy headers first
    hdr_country, hdr_code = _get_country_from_headers(request)
    if hdr_country and ip not in ip_country_cache:
        ip_country_cache[ip] = {"country": hdr_country, "code": hdr_code}
    # Pre-populate cache for private/loopback IPs to avoid unnecessary async lookups
    elif ip not in ip_country_cache and _is_private_ip(ip):
        ip_country_cache[ip] = {"country": "Local", "code": ""}

    cached = ip_country_cache.get(ip, {})
    visitor_entry = {
        "ip": ip,
        "timestamp": time.time(),
        "user_agent": ua,
        "browser": _parse_browser(ua),
        "country": cached.get("country", ""),
        "country_code": cached.get("code", ""),
        "page": request.path,
    }
    with visitors_lock:
        visitors.append(visitor_entry)
    # Resolve country in the background if not cached yet
    if ip not in ip_country_cache:
        threading.Thread(
            target=_lookup_country_async, args=(ip,), daemon=True
        ).start()
    # Debounced save to avoid a thread-per-visit under high traffic
    _schedule_visitor_save()


@app.route("/admin/downloads")
@admin_required
def admin_downloads_api():
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
            })
        history.sort(key=lambda x: x.get("created_at") or 0, reverse=True)
    return jsonify(history)


@app.route("/admin/visitors")
@admin_required
def admin_visitors_api():
    """Return visitor analytics for the admin page."""
    with visitors_lock:
        data = list(visitors)
    data.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
    return jsonify(data)


def _get_persistent_stats() -> dict:
    """Query SQLite for all-time aggregate stats (accurate even after in-memory cleanup).

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
                dl_rows = conn.execute("SELECT data FROM downloads").fetchall()
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
                v_rows = conn.execute("SELECT data FROM visitors").fetchall()
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


@app.route("/admin/analytics")
@admin_required
def admin_analytics_api():
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

    # Persistent aggregate stats (queried from SQLite for accuracy)
    persistent = _get_persistent_stats()

    return jsonify({
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


@app.route("/admin/delete_record/<download_id>", methods=["DELETE"])
@admin_required
def admin_delete_record(download_id):
    """Remove a download record from the history (admin only)."""
    with downloads_lock:
        if download_id not in downloads:
            return jsonify({"error": "Record not found"}), 404
        status = downloads[download_id].get("status")
        if status in ("queued", "downloading"):
            return jsonify({"error": "Cannot delete an active download. Cancel it first."}), 409
        del downloads[download_id]
    threading.Thread(target=save_downloads_to_disk, daemon=True).start()
    logger.info(f"Admin deleted download record: {download_id}")
    return jsonify({"success": True})


@app.route("/admin/clear_visitors", methods=["DELETE"])
@admin_required
def admin_clear_visitors():
    """Clear all visitor records (admin only)."""
    with visitors_lock:
        visitors.clear()
    threading.Thread(target=save_visitors_to_disk, daemon=True).start()
    logger.info("Admin cleared all visitor records")
    return jsonify({"success": True})


@app.route("/admin/db/download")
@admin_required
def admin_db_download():
    """Download the SQLite database file for backup (admin only)."""
    if not os.path.exists(DB_PATH):
        return jsonify({"error": "Database file not found"}), 404
    # Flush in-memory state to disk before serving the file
    save_downloads_to_disk()
    save_visitors_to_disk()
    logger.info("Admin downloaded database backup")
    return send_from_directory(
        DATA_DIR,
        os.path.basename(DB_PATH),
        as_attachment=True,
        download_name="admin.db",
        mimetype="application/x-sqlite3",
    )


@app.route("/admin/db/upload", methods=["POST"])
@admin_required
def admin_db_upload():
    """Merge an uploaded backup database into the live database (admin only).

    The uploaded file is validated as a SQLite database before merging.
    Downloads are merged using INSERT OR IGNORE (live records take precedence;
    backup-only records are added). Visitors from both databases are combined
    and re-sorted by timestamp so that records appear in chronological order.
    After a successful merge the in-memory state is reloaded.
    """
    if "db_file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["db_file"]
    if not f or not f.filename:
        return jsonify({"error": "No file selected"}), 400

    # Read uploaded content and validate SQLite magic header
    content = f.read()
    if len(content) < 16 or content[:16] != b"SQLite format 3\x00":
        return jsonify({"error": "Uploaded file is not a valid SQLite database"}), 400

    # Write to a temp file and run an integrity check
    tmp_path = DB_PATH + ".upload_tmp"
    try:
        with open(tmp_path, "wb") as fh:
            fh.write(content)

        # Integrity check runs on the temp file — no lock needed
        check_conn = sqlite3.connect(tmp_path)
        check_conn.row_factory = sqlite3.Row
        try:
            result = check_conn.execute("PRAGMA integrity_check").fetchone()
            if result[0] != "ok":
                return jsonify({"error": "Uploaded database failed integrity check"}), 400

            # Read downloads and visitors from the backup
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

        # Flush current in-memory state to disk before merging
        save_downloads_to_disk()
        save_visitors_to_disk()

        # Merge backup data into the live database under _db_lock
        with _db_lock:
            conn = _get_db()
            try:
                # Downloads: INSERT OR IGNORE preserves live records and adds
                # any backup records whose id does not yet exist in the live DB.
                for (did, data_json) in backup_dl:
                    conn.execute(
                        "INSERT OR IGNORE INTO downloads (id, data) VALUES (?, ?)",
                        (did, data_json),
                    )

                # Visitors: combine live + backup, deduplicate by JSON content,
                # then re-insert sorted by the "timestamp" field so the full
                # history is stored in chronological order.
                live_v_rows = conn.execute("SELECT data FROM visitors").fetchall()
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

                conn.execute("DELETE FROM visitors")
                for v in all_visitors:
                    conn.execute(
                        "INSERT INTO visitors (data) VALUES (?)",
                        (json.dumps(v, default=str),),
                    )

                conn.commit()
            finally:
                conn.close()

        # Reload in-memory state from the merged database.
        # We must NOT hold _db_lock here because load_persistence() acquires it
        # internally.
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
        return jsonify({
            "success": True,
            "message": (
                f"Database merged successfully. "
                f"Processed {added_dl} download record(s) and "
                f"{added_v} visitor record(s) from backup."
            ),
        })
    except Exception as exc:
        logger.error(f"DB upload error: {exc}")
        return jsonify({"error": f"Upload failed: {exc}"}), 500
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass

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


@app.route("/convert", methods=["POST"])
def convert_file():
    """Convert a downloaded file to a different format, resolution, or bitrate."""
    filename      = request.form.get("filename", "").strip()
    fmt           = request.form.get("format", "mp4").strip().lower()
    resolution    = request.form.get("resolution", "").strip()
    audio_bitrate = request.form.get("audio_bitrate", "").strip()
    video_bitrate = request.form.get("video_bitrate", "").strip()

    if fmt not in _ALL_CONVERT_FORMATS:
        return jsonify({"error": f"Unsupported format. Choose from: {', '.join(sorted(_ALL_CONVERT_FORMATS))}"}), 400

    filepath, err = _resolve_download_file(filename)
    if err:
        return err

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return jsonify({"error": "ffmpeg is not installed on this server"}), 503

    if resolution and not _VALID_RESOLUTION_RE.match(resolution):
        return jsonify({"error": "Invalid resolution. Use WxH (e.g. 1280x720)"}), 400
    if audio_bitrate and not _VALID_BITRATE_RE.match(audio_bitrate):
        return jsonify({"error": "Invalid audio bitrate (e.g. 128k, 192k)"}), 400
    if video_bitrate and not _VALID_BITRATE_RE.match(video_bitrate):
        return jsonify({"error": "Invalid video bitrate (e.g. 2M, 1500k)"}), 400

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
    return jsonify({"job_id": job_id, "output_filename": output_filename})


@app.route("/batch_convert", methods=["POST"])
def batch_convert():
    """Convert multiple files to a target format/resolution/bitrate."""
    filenames_json = request.form.get("filenames", "[]")
    fmt           = request.form.get("format", "mp4").strip().lower()
    resolution    = request.form.get("resolution", "").strip()
    audio_bitrate = request.form.get("audio_bitrate", "").strip()
    video_bitrate = request.form.get("video_bitrate", "").strip()

    try:
        filenames = json.loads(filenames_json)
    except (json.JSONDecodeError, ValueError):
        return jsonify({"error": "Invalid filenames JSON"}), 400

    if not isinstance(filenames, list) or len(filenames) == 0:
        return jsonify({"error": "No files provided"}), 400

    if fmt not in _ALL_CONVERT_FORMATS:
        return jsonify({"error": f"Unsupported format. Choose from: {', '.join(sorted(_ALL_CONVERT_FORMATS))}"}), 400

    if len(filenames) > 20:
        return jsonify({"error": "Maximum 20 files per batch"}), 400

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return jsonify({"error": "ffmpeg is not installed on this server"}), 503

    if resolution and not _VALID_RESOLUTION_RE.match(resolution):
        return jsonify({"error": "Invalid resolution. Use WxH (e.g. 1280x720)"}), 400
    if audio_bitrate and not _VALID_BITRATE_RE.match(audio_bitrate):
        return jsonify({"error": "Invalid audio bitrate"}), 400
    if video_bitrate and not _VALID_BITRATE_RE.match(video_bitrate):
        return jsonify({"error": "Invalid video bitrate"}), 400

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
        return jsonify({"error": "No valid files to convert"}), 400

    return jsonify({"jobs": jobs, "total": len(jobs)})


# =========================================================
# VIDEO EDITING TOOLS
# =========================================================

@app.route("/trim", methods=["POST"])
def trim_video():
    """Trim a video to [start_time, end_time]."""
    filename   = request.form.get("filename", "").strip()
    start_time = request.form.get("start_time", "0").strip() or "0"
    end_time   = request.form.get("end_time", "").strip()

    if not end_time:
        return jsonify({"error": "end_time is required"}), 400

    filepath, err = _resolve_download_file(filename)
    if err:
        return err

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return jsonify({"error": "ffmpeg is not installed on this server"}), 503

    time_re = _VALID_TIME_RE
    if not time_re.match(start_time):
        return jsonify({"error": "Invalid start_time. Use seconds or HH:MM:SS"}), 400
    if not time_re.match(end_time):
        return jsonify({"error": "Invalid end_time. Use seconds or HH:MM:SS"}), 400

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
    return jsonify({"job_id": job_id, "output_filename": output_filename})


@app.route("/crop", methods=["POST"])
def crop_video():
    """Crop a video frame to (x, y, width, height)."""
    filename = request.form.get("filename", "").strip()
    x        = request.form.get("x", "0").strip() or "0"
    y        = request.form.get("y", "0").strip() or "0"
    width    = request.form.get("width", "").strip()
    height   = request.form.get("height", "").strip()

    if not width or not height:
        return jsonify({"error": "width and height are required"}), 400

    filepath, err = _resolve_download_file(filename)
    if err:
        return err

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return jsonify({"error": "ffmpeg is not installed on this server"}), 503

    for val in [x, y, width, height]:
        if not val.isdigit():
            return jsonify({"error": "x, y, width, and height must be positive integers"}), 400

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
    return jsonify({"job_id": job_id, "output_filename": output_filename})


@app.route("/watermark", methods=["POST"])
def watermark_video():
    """Overlay a text watermark onto a video."""
    filename = request.form.get("filename", "").strip()
    text     = request.form.get("text", "").strip()
    position = request.form.get("position", "bottom-right").strip()
    fontsize = request.form.get("fontsize", "24").strip() or "24"

    if not text:
        return jsonify({"error": "Watermark text is required"}), 400
    if len(text) > 200:
        return jsonify({"error": "Watermark text too long (max 200 chars)"}), 400

    filepath, err = _resolve_download_file(filename)
    if err:
        return err

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return jsonify({"error": "ffmpeg is not installed on this server"}), 503

    if not fontsize.isdigit() or not (8 <= int(fontsize) <= 120):
        return jsonify({"error": "fontsize must be an integer between 8 and 120"}), 400

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
    return jsonify({"job_id": job_id, "output_filename": output_filename})


@app.route("/extract_clip", methods=["POST"])
def extract_clip():
    """Extract a short clip (10–60 s) starting at start_time."""
    filename   = request.form.get("filename", "").strip()
    start_time = request.form.get("start_time", "0").strip() or "0"
    duration   = request.form.get("duration", "30").strip() or "30"

    filepath, err = _resolve_download_file(filename)
    if err:
        return err

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return jsonify({"error": "ffmpeg is not installed on this server"}), 503

    try:
        dur_sec = float(duration)
    except ValueError:
        return jsonify({"error": "duration must be a number"}), 400
    if not (10 <= dur_sec <= 60):
        return jsonify({"error": "duration must be between 10 and 60 seconds"}), 400

    if not _VALID_TIME_RE.match(start_time):
        return jsonify({"error": "Invalid start_time. Use seconds or HH:MM:SS"}), 400

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
    return jsonify({"job_id": job_id, "output_filename": output_filename})


@app.route("/merge", methods=["POST"])
def merge_videos():
    """Concatenate multiple downloaded videos into a single output file."""
    filenames_json = request.form.get("filenames", "[]")
    output_format  = request.form.get("format", "mp4").strip().lower()

    try:
        filenames = json.loads(filenames_json)
    except (json.JSONDecodeError, ValueError):
        return jsonify({"error": "Invalid filenames JSON"}), 400

    if not isinstance(filenames, list) or len(filenames) < 2:
        return jsonify({"error": "At least 2 files are required for merge"}), 400
    if len(filenames) > 20:
        return jsonify({"error": "Maximum 20 files per merge"}), 400

    if output_format not in _VALID_VIDEO_FORMATS:
        return jsonify({"error": f"Unsupported format. Choose from: {', '.join(sorted(_VALID_VIDEO_FORMATS))}"}), 400

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return jsonify({"error": "ffmpeg is not installed on this server"}), 503

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
    return jsonify({"job_id": job_id, "output_filename": output_filename})


@app.route("/job_status/<job_id>")
def job_status(job_id):
    """Return the current status of a conversion or editing job."""
    with conversions_lock:
        job = conversions.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({
        "job_id":    job_id,
        "status":    job.get("status"),
        "type":      job.get("type"),
        "filename":  job.get("filename"),
        "error":     job.get("error"),
    })


# =========================================================
# PLAYLIST & BULK DOWNLOAD
# =========================================================

@app.route("/start_playlist_download", methods=["POST"])
@rate_limit()
def start_playlist_download():
    """Download an entire playlist or channel (yt-dlp playlist mode)."""
    url         = request.form.get("url", "").strip()
    format_spec = request.form.get("format", "bestvideo*+bestaudio*/best")

    if not url:
        return jsonify({"error": "URL is required"}), 400

    with downloads_lock:
        active_count = sum(
            1 for d in downloads.values()
            if d["status"] in ("queued", "downloading")
        )
        if active_count >= Config.MAX_CONCURRENT_DOWNLOADS:
            return jsonify({
                "error": f"Maximum concurrent downloads reached ({Config.MAX_CONCURRENT_DOWNLOADS})"
            }), 429

    batch_id = str(uuid.uuid4())
    ip = request.remote_addr
    hdr_country, hdr_code = _get_country_from_headers(request)
    if hdr_country and ip not in ip_country_cache:
        ip_country_cache[ip] = {"country": hdr_country, "code": hdr_code}
    elif ip not in ip_country_cache and _is_private_ip(ip):
        ip_country_cache[ip] = {"country": "Local", "code": ""}
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
                socketio.emit(
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
            "geo_bypass":      True,
            "progress_hooks":  [progress_hook],
            "quiet":           True,
            "no_warnings":     True,
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
            socketio.emit(
                "completed",
                {"id": batch_id, "title": downloads[batch_id].get("title")},
                room=batch_id,
            )
            socketio.emit("files_updated")
            threading.Thread(target=save_downloads_to_disk, daemon=True).start()

        except Exception as exc:
            logger.error("Playlist download error: %s", exc)
            with downloads_lock:
                downloads[batch_id].update({
                    "status":   "failed",
                    "error":    str(exc),
                    "end_time": time.time(),
                })
            socketio.emit("failed", {"id": batch_id, "error": str(exc)}, room=batch_id)
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
        threading.Thread(target=_lookup_country_async, args=(ip,), daemon=True).start()

    return jsonify({"download_id": batch_id, "title": "Playlist Download", "status": "queued"})


@app.route("/start_batch_download", methods=["POST"])
def start_batch_download():
    """Start individual downloads for a newline-separated list of URLs."""
    urls_text   = request.form.get("urls", "").strip()
    format_spec = request.form.get("format", "bestvideo*+bestaudio*/best")

    urls = [u.strip() for u in urls_text.splitlines() if u.strip()]
    if not urls:
        return jsonify({"error": "At least one URL is required"}), 400
    if len(urls) > 20:
        return jsonify({"error": "Maximum 20 URLs per batch"}), 400

    started = []
    ip = request.remote_addr
    hdr_country, hdr_code = _get_country_from_headers(request)
    if hdr_country and ip not in ip_country_cache:
        ip_country_cache[ip] = {"country": hdr_country, "code": hdr_code}
    elif ip not in ip_country_cache and _is_private_ip(ip):
        ip_country_cache[ip] = {"country": "Local", "code": ""}
    cached_geo = ip_country_cache.get(ip, {})

    for url in urls:
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
        return jsonify({"error": "Could not start any downloads (concurrent limit reached)"}), 429

    threading.Thread(target=save_downloads_to_disk, daemon=True).start()
    if ip not in ip_country_cache:
        threading.Thread(target=_lookup_country_async, args=(ip,), daemon=True).start()

    return jsonify({"started": started, "total": len(started)})


@app.route("/download_zip", methods=["POST"])
def download_zip():
    """Package a selection of downloaded files into a ZIP and serve it."""
    filenames_json = request.form.get("filenames", "[]")

    try:
        filenames = json.loads(filenames_json)
    except (json.JSONDecodeError, ValueError):
        return jsonify({"error": "Invalid filenames JSON"}), 400

    if not isinstance(filenames, list) or len(filenames) == 0:
        return jsonify({"error": "No files selected"}), 400

    filepairs = []
    for fn in filenames:
        if not fn:
            continue
        fp = os.path.join(DOWNLOAD_FOLDER, fn)
        if not os.path.abspath(fp).startswith(os.path.abspath(DOWNLOAD_FOLDER)):
            continue
        if os.path.isfile(fp):
            filepairs.append((fn, fp))

    if not filepairs:
        return jsonify({"error": "No valid files found"}), 404

    zip_filename = f"downloads_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    zip_path     = os.path.join(DOWNLOAD_FOLDER, zip_filename)
    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for fn, fp in filepairs:
                zf.write(fp, fn)
    except Exception as exc:
        logger.error("ZIP creation error: %s", exc)
        return jsonify({"error": f"Failed to create ZIP: {exc}"}), 500

    return send_from_directory(
        DOWNLOAD_FOLDER,
        zip_filename,
        as_attachment=True,
        download_name=zip_filename,
        mimetype="application/zip",
    )


# =========================================================
# SOCKET.IO EVENTS
# =========================================================

@socketio.on("connect")
def on_connect():
    """Handle client connection"""
    logger.info(f"Client connected: {request.sid}")

@socketio.on("disconnect")
def on_disconnect():
    """Handle client disconnection"""
    logger.info(f"Client disconnected: {request.sid}")

@socketio.on("subscribe")
def on_subscribe(data):
    """Subscribe to download updates"""
    download_id = data.get("download_id")
    if download_id:
        join_room(download_id)
        emit("subscribed", {"id": download_id})
        logger.info(f"Client {request.sid} subscribed to {download_id}")

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
            socketio.emit("files_updated")
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

# Initialise SQLite schema
init_db()

# Load persisted data
load_persistence()

# Start cleanup thread
cleanup_thread = threading.Thread(target=cleanup_thread, daemon=True)
cleanup_thread.start()

logger.info("=" * 50)

# =========================================================
# ERROR HANDLERS
# =========================================================

@app.errorhandler(404)
def not_found_error(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal error: {error}")
    return jsonify({"error": "Internal server error"}), 500

# =========================================================
# ENTRY POINT
# =========================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "False").lower() == "true"
    
    logger.info(f"🌐 Starting server on port {port}")
    logger.info(f"🐛 Debug mode: {debug}")
    
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=debug
    )