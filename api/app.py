import os
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

visitors_lock = Lock()
visitors = []             # List of visitor dicts tracked on admin page visits
ip_country_cache = {}     # ip -> {"country": str, "code": str}

# Paths for persistent storage
DATA_DIR = os.path.join(ROOT_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "admin.db")
os.makedirs(DATA_DIR, exist_ok=True)

# Route name for the admin page (used in before_request tracking)
ADMIN_PAGE_PATH = "/const"

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


def _lookup_country_async(ip: str):
    """Resolve an IP to its country using multiple geo-IP services (fallback chain)."""
    if ip in ip_country_cache:
        return
    country, code = "Unknown", ""

    # --- Service 1: ip-api.com (free, no key) ---
    try:
        with urllib.request.urlopen(
            f"https://ip-api.com/json/{ip}?fields=country,countryCode", timeout=4
        ) as resp:
            data = json.loads(resp.read())
        if data.get("country"):
            country = data["country"]
            code = data.get("countryCode", "")
    except Exception:
        pass

    # --- Service 2: ipinfo.io (fallback) ---
    if country == "Unknown":
        try:
            with urllib.request.urlopen(
                f"https://ipinfo.io/{ip}/json", timeout=4
            ) as resp:
                data = json.loads(resp.read())
            if data.get("country"):
                code = data["country"].upper()  # ipinfo returns 2-letter code in "country"
                country = _ISO2_TO_NAME.get(code, code)
        except Exception:
            pass

    # --- Service 3: ipwhois.app (second fallback) ---
    if country == "Unknown":
        try:
            with urllib.request.urlopen(
                f"https://ipwhois.app/json/{ip}?objects=country,country_code", timeout=4
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
            # API endpoints (paths under /admin/ that aren't the login page) return 401 JSON.
            # The /const page and other browser-facing routes get a redirect to login.
            if request.path.startswith("/admin/") and request.path not in ("/admin/login", "/admin/logout", "/admin/register"):
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
# ROUTES
# =========================================================

@app.route("/")
def index():
    """Main page"""
    try:
        return render_template("index.html")
    except Exception as e:
        logger.error(f"Template error: {e}")
        return jsonify({"error": "Template not found"}), 500

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

@app.route("/delete/<path:filename>", methods=["DELETE"])
@admin_required
def delete_file(filename):
    """Delete a downloaded file (admin only)"""
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
    """Record a visit to the admin page for analytics."""
    if request.path != ADMIN_PAGE_PATH:
        return
    ip = request.remote_addr or "unknown"
    ua = request.headers.get("User-Agent", "")

    # Try to get country from CDN/proxy headers first
    hdr_country, hdr_code = _get_country_from_headers(request)
    if hdr_country and ip not in ip_country_cache:
        ip_country_cache[ip] = {"country": hdr_country, "code": hdr_code}

    cached = ip_country_cache.get(ip, {})
    visitor_entry = {
        "ip": ip,
        "timestamp": time.time(),
        "user_agent": ua,
        "browser": _parse_browser(ua),
        "country": cached.get("country", ""),
        "country_code": cached.get("code", ""),
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


@app.route("/admin/analytics")
@admin_required
def admin_analytics_api():
    """Return aggregated analytics including country totals."""
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

    # Country totals for visitors
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