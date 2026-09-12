#!/usr/bin/env python3
"""
VS Infra & Cranes — Hardened Production Backend API Server
Supports:
- MongoDB / MongoDB Atlas (via MONGODB_URI) with dual-tier local database mirror (SQLite & JSON)
- Customer Form Inquiries API (/api/inquiries) for Quotes, Contact, Services, AMC, Modernization
- Asynchronous SMTP Email Notifications to Site Administrator
- Secure Admin Authentication (PBKDF2 Password Hashing, HMAC Bearer & Cookie Sessions, Rate-Limiting)
- Full Inquiries CRM (Status, Priority, Notes, Follow-Up, CSV Export, Quick WhatsApp/Call)
- Lightweight Website Content Management (CMS for Products, Services, Gallery, Projects, Map Pins, Contact Info, Blog, Catalog)
- Production Security Headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
"""

import os
import sys
# Ensure bundled vendor libraries (pymongo, dnspython, etc.) in ./lib are accessible
LIB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")
if os.path.exists(LIB_DIR) and LIB_DIR not in sys.path:
    sys.path.insert(0, LIB_DIR)

import re
import json
import time
import uuid
import hmac
import base64
import signal
import hashlib
import sqlite3
import smtplib
import threading
from collections import deque
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

# Operational Monitoring & Health State
SERVER_START_TIME = time.time()
TOTAL_REQUESTS = 0
METRICS_LOCK = threading.Lock()
HTTP_METRICS = {
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
    "by_path": {}
}
API_LATENCY_SAMPLES = deque(maxlen=1000)
RECENT_ERRORS = deque(maxlen=50)
ADMIN_AUTH_FAILURES = deque(maxlen=100)
ACTIVE_SESSIONS = {}  # session_id -> last_seen_timestamp
REVOKED_TOKENS = {}   # token_str -> revocation_timestamp
MAX_BODY_SIZE = 25 * 1024 * 1024  # 25MB max request body size
ALLOWED_CMS_SECTIONS = {
    "contact", "products", "services", "gallery",
    "projects", "map_pins", "blog", "catalog", "certificates"
}

# -------------------------------------------------------------
# 1. ENVIRONMENT CONFIGURATION
# -------------------------------------------------------------
def load_env_file(filepath=None):
    if filepath is None:
        filepath = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'").strip('"')
                    if k not in os.environ:
                        os.environ[k] = v

load_env_file()

PORT = int(os.environ.get("PORT", 8080))
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT_DIR, "data")
CERTIFICATES_DIR = os.path.join(ROOT_DIR, "assets", "documents", "certificates")
DB_FILE = os.path.join(DATA_DIR, "inquiries.db")
JSON_FILE = os.path.join(DATA_DIR, "inquiries.json")
CMS_FILE = os.path.join(DATA_DIR, "cms_content.json")
MONGODB_URI = os.environ.get("MONGODB_URI", "").strip()
MONGODB_DB_NAME = os.environ.get("MONGODB_DB_NAME", "vs_infra_cranes").strip()

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "vsinfracranes@gmail.com").strip()
ADMIN_PASS = os.environ.get("ADMIN_PASS", "").strip()
if not ADMIN_PASS:
    ADMIN_PASS = "HR29AK6751"  # Default fallback credential
SECRET_KEY = os.environ.get("SECRET_KEY", "").strip()
if not SECRET_KEY:
    SECRET_KEY = "vs_infra_cranes_secure_session_key_2026"

# Hosting-Agnostic Portable Configuration
BASE_URL = os.environ.get("BASE_URL", f"http://localhost:{PORT}").rstrip("/")
CORS_ORIGINS_RAW = os.environ.get("CORS_ORIGINS", "").strip()

def is_allowed_origin(origin: str) -> bool:
    """Validate cross-origin requests for local development and production environments."""
    if not origin:
        return False
    origin_str = origin.strip()
    # 1. Allow 'null' origin for direct local file opening (file:///...)
    if origin_str == "null":
        return True
    try:
        parsed = urlparse(origin_str)
        hostname = (parsed.hostname or "").lower()
        # 2. Allow local development loopback origins on any port (localhost, 127.0.0.1, 0.0.0.0, ::1)
        if hostname in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
            return True
    except Exception:
        pass
    # 3. Allow configured production/staging origins from CORS_ORIGINS
    if CORS_ORIGINS_RAW:
        configured = [o.strip().rstrip("/") for o in CORS_ORIGINS_RAW.split(",") if o.strip()]
        if origin_str.rstrip("/") in configured or "*" in configured:
            return True
    # 4. Allow current server BASE_URL
    if BASE_URL and origin_str.rstrip("/") == BASE_URL:
        return True
    return False

# SMTP Email Configuration
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", 587))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASS = os.environ.get("SMTP_PASS", "").strip()
NOTIFICATION_EMAIL = os.environ.get("NOTIFICATION_EMAIL", "vsinfracranes@gmail.com").strip()

os.makedirs(DATA_DIR, exist_ok=True)

def parse_user_agent(ua: str) -> tuple:
    ua_lower = ua.lower() if ua else ""
    if "tablet" in ua_lower or "ipad" in ua_lower:
        device = "Tablet"
    elif "mobile" in ua_lower or "android" in ua_lower or "iphone" in ua_lower:
        device = "Mobile"
    else:
        device = "Desktop"

    if "edg" in ua_lower:
        browser = "Edge"
    elif "chrome" in ua_lower and "chromium" not in ua_lower:
        browser = "Chrome"
    elif "safari" in ua_lower and "chrome" not in ua_lower:
        browser = "Safari"
    elif "firefox" in ua_lower:
        browser = "Firefox"
    else:
        browser = "Other"

    if "windows" in ua_lower:
        os_name = "Windows"
    elif "android" in ua_lower:
        os_name = "Android"
    elif "iphone" in ua_lower or "ipad" in ua_lower or "ios" in ua_lower:
        os_name = "iOS"
    elif "mac" in ua_lower:
        os_name = "macOS"
    elif "linux" in ua_lower:
        os_name = "Linux"
    else:
        os_name = "Other"

    return device, browser, os_name

def sanitize_text(text: str) -> str:
    """Safely redact credentials, tokens, and database secrets from strings."""
    if not text:
        return ""
    s = str(text)
    # Redact MongoDB URI credentials
    s = re.sub(r"://([^:]+):([^@]+)@", r"://\1:*****@", s)
    # Redact known secrets if present
    if ADMIN_PASS and len(ADMIN_PASS) > 3:
        s = s.replace(ADMIN_PASS, "*****")
    if SMTP_PASS and len(SMTP_PASS) > 3:
        s = s.replace(SMTP_PASS, "*****")
    if SECRET_KEY and len(SECRET_KEY) > 5:
        s = s.replace(SECRET_KEY, "*****")
    return s

def record_http_metric(status_code: int, path: str, latency_ms: float):
    global TOTAL_REQUESTS
    with METRICS_LOCK:
        TOTAL_REQUESTS += 1
        if 200 <= status_code < 300:
            HTTP_METRICS["2xx"] += 1
        elif 300 <= status_code < 400:
            HTTP_METRICS["3xx"] += 1
        elif 400 <= status_code < 500:
            HTTP_METRICS["4xx"] += 1
        elif status_code >= 500:
            HTTP_METRICS["5xx"] += 1

        clean_path = path.split("?")[0]
        if len(HTTP_METRICS["by_path"]) < 100 or clean_path in HTTP_METRICS["by_path"]:
            HTTP_METRICS["by_path"][clean_path] = HTTP_METRICS["by_path"].get(clean_path, 0) + 1

        API_LATENCY_SAMPLES.append(round(latency_ms, 2))

def record_app_error(path: str, method: str, status_code: int, err):
    err_str = sanitize_text(str(err))
    err_type = type(err).__name__ if isinstance(err, Exception) else "AppError"
    err_obj = {
        "id": f"err_{uuid.uuid4().hex[:8]}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "path": path,
        "method": method,
        "status_code": status_code,
        "error_type": err_type,
        "message": err_str[:300]
    }
    with METRICS_LOCK:
        RECENT_ERRORS.append(err_obj)

def record_admin_auth_failure(ip: str):
    now = time.time()
    with METRICS_LOCK:
        ADMIN_AUTH_FAILURES.append(now)
        recent = [t for t in ADMIN_AUTH_FAILURES if now - t <= 300]
        if len(recent) >= 3:
            # Trigger alert in background thread
            threading.Thread(
                target=lambda: db_manager.record_alert(
                    "MEDIUM",
                    "Security",
                    "Multiple Failed Admin Logins",
                    f"Detected {len(recent)} failed login attempts within 5 minutes."
                ),
                daemon=True
            ).start()

def categorize_lead_source(referrer: str = "", utm_source: str = "", utm_medium: str = "") -> str:
    ref_lower = (referrer or "").lower()
    utm_s_lower = (utm_source or "").lower()
    utm_m_lower = (utm_medium or "").lower()

    if utm_s_lower == "whatsapp" or "whatsapp" in ref_lower or "wa.me" in ref_lower:
        return "WhatsApp"
    if "google" in utm_s_lower or "google" in ref_lower:
        if "cpc" in utm_m_lower or "ads" in utm_m_lower:
            return "Google Ads"
        return "Google Search"
    if any(s in utm_s_lower or s in ref_lower for s in ["bing", "yahoo", "duckduckgo", "ecosia", "baidu"]):
        return "Organic Search"
    if any(s in utm_s_lower or s in ref_lower for s in ["facebook", "instagram", "linkedin", "twitter", "x.com", "youtube", "pinterest", "reddit"]):
        return "Social Media"
    if utm_s_lower or utm_m_lower:
        return "Campaign"
    if ref_lower and not any(h in ref_lower for h in ["localhost", "127.0.0.1", "0.0.0.0", "vsinfra"]):
        return "Referral"
    return "Direct"

def resolve_approx_geo(headers: dict = None, payload_data: dict = None) -> dict:
    country = "Unknown"
    city = "Unknown"
    headers = headers or {}
    payload_data = payload_data or {}

    # 1. Reverse proxy headers (Cloudflare, Vercel, AWS CloudFront, etc.)
    if headers.get("CF-IPCountry"):
        country = headers.get("CF-IPCountry").strip()
    elif headers.get("X-Country-Code"):
        country = headers.get("X-Country-Code").strip()
    elif headers.get("X-Vercel-IP-Country"):
        country = headers.get("X-Vercel-IP-Country").strip()
    elif headers.get("X-Geo-Country"):
        country = headers.get("X-Geo-Country").strip()

    if headers.get("CF-IPCity"):
        city = headers.get("CF-IPCity").strip()
    elif headers.get("X-Vercel-IP-City"):
        city = headers.get("X-Vercel-IP-City").strip()
    elif headers.get("X-Geo-City"):
        city = headers.get("X-Geo-City").strip()

    # 2. Client-provided approximate location or timezone
    if country == "Unknown" and payload_data.get("country"):
        country = str(payload_data.get("country")).strip()[:50]
    if city == "Unknown" and payload_data.get("city"):
        city = str(payload_data.get("city")).strip()[:50]
    if country == "Unknown" and payload_data.get("timezone"):
        tz = str(payload_data.get("timezone")).lower()
        if "calcutta" in tz or "kolkata" in tz or "asia/kolkata" in tz or "ist" in tz:
            country = "India"
            city = "Delhi NCR / Haryana"
        elif "london" in tz or "europe/london" in tz:
            country = "United Kingdom"
        elif "new_york" in tz or "america/new_york" in tz:
            country = "United States"
        elif "dubai" in tz or "asia/dubai" in tz:
            country = "United Arab Emirates"

    # No fabricated fallback — if geo is unknown, keep it as "Unknown"
    return {"country": country, "city": city}

# -------------------------------------------------------------
# 2. PASSWORD SECURITY & AUTHENTICATION
# -------------------------------------------------------------
def hash_password(password: str, salt: bytes = None) -> str:
    """PBKDF2-HMAC-SHA256 with 100,000 iterations."""
    if not salt:
        salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return f"pbkdf2:sha256:100000${salt.hex()}${key.hex()}"

def verify_password(password: str, hashed_str: str) -> bool:
    if not hashed_str:
        return False
    if not hashed_str.startswith("pbkdf2:"):
        return hmac.compare_digest(password, hashed_str)
    try:
        parts = hashed_str.split("$")
        if len(parts) != 3:
            return False
        meta, salt_hex, key_hex = parts
        salt = bytes.fromhex(salt_hex)
        expected_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
        return hmac.compare_digest(expected_key.hex(), key_hex)
    except Exception:
        return False

# Initialize Admin Password Hash
ADMIN_PASS_HASH = hash_password(ADMIN_PASS)

# Brute-force Login Rate Limiter (IP -> [timestamps])
LOGIN_ATTEMPTS = {}
LOGIN_LOCKOUT_MINUTES = 15
MAX_FAILED_ATTEMPTS = 5

def is_ip_rate_limited(ip: str) -> bool:
    now = time.time()
    cutoff = now - (LOGIN_LOCKOUT_MINUTES * 60)
    attempts = [t for t in LOGIN_ATTEMPTS.get(ip, []) if t > cutoff]
    LOGIN_ATTEMPTS[ip] = attempts
    return len(attempts) >= MAX_FAILED_ATTEMPTS

def record_failed_login(ip: str):
    now = time.time()
    if ip not in LOGIN_ATTEMPTS:
        LOGIN_ATTEMPTS[ip] = []
    LOGIN_ATTEMPTS[ip].append(now)

def clear_login_attempts(ip: str):
    LOGIN_ATTEMPTS.pop(ip, None)

# Public Inquiry Rate Limiter (IP -> [timestamps])
INQUIRY_ATTEMPTS = {}
INQUIRY_WINDOW_MINUTES = 5
MAX_INQUIRIES_PER_WINDOW = 10

def is_inquiry_rate_limited(ip: str) -> bool:
    now = time.time()
    cutoff = now - (INQUIRY_WINDOW_MINUTES * 60)
    attempts = [t for t in INQUIRY_ATTEMPTS.get(ip, []) if t > cutoff]
    INQUIRY_ATTEMPTS[ip] = attempts
    return len(attempts) >= MAX_INQUIRIES_PER_WINDOW

def record_inquiry_attempt(ip: str):
    now = time.time()
    if ip not in INQUIRY_ATTEMPTS:
        INQUIRY_ATTEMPTS[ip] = []
    INQUIRY_ATTEMPTS[ip].append(now)

# Duplicate Submission Prevention (key -> (timestamp, saved_record))
RECENT_SUBMISSIONS = {}
DUPLICATE_WINDOW_SECONDS = 30

def check_duplicate_submission(contact: str, message: str):
    now = time.time()
    expired = [k for k, (ts, _) in RECENT_SUBMISSIONS.items() if now - ts > DUPLICATE_WINDOW_SECONDS]
    for k in expired:
        RECENT_SUBMISSIONS.pop(k, None)
    sub_key = hashlib.sha256(f"{contact.strip().lower()}:{message.strip().lower()}".encode("utf-8")).hexdigest()
    if sub_key in RECENT_SUBMISSIONS:
        ts, record = RECENT_SUBMISSIONS[sub_key]
        if now - ts <= DUPLICATE_WINDOW_SECONDS:
            return record
    return None

def record_submission(contact: str, message: str, record: dict):
    now = time.time()
    sub_key = hashlib.sha256(f"{contact.strip().lower()}:{message.strip().lower()}".encode("utf-8")).hexdigest()
    RECENT_SUBMISSIONS[sub_key] = (now, record)

# Public Analytics Ingestion Rate Limiter (IP -> [timestamps], max 60/min)
ANALYTICS_ATTEMPTS = {}
ANALYTICS_WINDOW_SECONDS = 60
MAX_ANALYTICS_PER_WINDOW = 60

def is_analytics_rate_limited(ip: str) -> bool:
    now = time.time()
    cutoff = now - ANALYTICS_WINDOW_SECONDS
    attempts = [t for t in ANALYTICS_ATTEMPTS.get(ip, []) if t > cutoff]
    ANALYTICS_ATTEMPTS[ip] = attempts
    if len(attempts) >= MAX_ANALYTICS_PER_WINDOW:
        return True
    ANALYTICS_ATTEMPTS[ip].append(now)
    return False

# Admin Upload Rate Limiter (IP -> [timestamps], max 30 per 10 min)
UPLOAD_ATTEMPTS = {}
UPLOAD_WINDOW_SECONDS = 600
MAX_UPLOADS_PER_WINDOW = 30

def is_upload_rate_limited(ip: str) -> bool:
    now = time.time()
    cutoff = now - UPLOAD_WINDOW_SECONDS
    attempts = [t for t in UPLOAD_ATTEMPTS.get(ip, []) if t > cutoff]
    UPLOAD_ATTEMPTS[ip] = attempts
    if len(attempts) >= MAX_UPLOADS_PER_WINDOW:
        return True
    UPLOAD_ATTEMPTS[ip].append(now)
    return False

# Admin Mutation Rate Limiter (IP -> [timestamps], max 120 per min)
ADMIN_MUTATION_ATTEMPTS = {}
ADMIN_MUTATION_WINDOW_SECONDS = 60
MAX_ADMIN_MUTATIONS_PER_WINDOW = 120

def is_admin_mutation_rate_limited(ip: str) -> bool:
    now = time.time()
    cutoff = now - ADMIN_MUTATION_WINDOW_SECONDS
    attempts = [t for t in ADMIN_MUTATION_ATTEMPTS.get(ip, []) if t > cutoff]
    ADMIN_MUTATION_ATTEMPTS[ip] = attempts
    if len(attempts) >= MAX_ADMIN_MUTATIONS_PER_WINDOW:
        return True
    ADMIN_MUTATION_ATTEMPTS[ip].append(now)
    return False

# Token Generation and Verification with Server-Side Revocation
def generate_token(email: str) -> str:
    timestamp = str(int(time.time()))
    nonce = hashlib.sha256(os.urandom(16)).hexdigest()[:8]
    payload = f"{email}:{timestamp}:{nonce}"
    sig = hmac.new(SECRET_KEY.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{email}:{timestamp}:{nonce}:{sig}"

def verify_token(token_str: str) -> bool:
    if not token_str:
        return False
    now = time.time()
    # Check server-side revocation
    if token_str in REVOKED_TOKENS:
        return False
    parts = token_str.split(":")
    # Support 4-part tokens (with nonce) and 3-part legacy tokens
    if len(parts) == 4:
        email, timestamp, nonce, sig = parts
        payload = f"{email}:{timestamp}:{nonce}"
    elif len(parts) == 3:
        email, timestamp, sig = parts
        payload = f"{email}:{timestamp}"
    else:
        return False

    try:
        token_time = int(timestamp)
        # Token valid for 24 hours (86400 seconds)
        if now - token_time > 86400 or token_time > now + 300:
            return False
        expected_sig = hmac.new(SECRET_KEY.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return False
        return hmac.compare_digest(email.lower(), ADMIN_EMAIL.lower())
    except Exception:
        return False

def revoke_token(token_str: str):
    if not token_str:
        return
    now = time.time()
    # Prune expired revoked tokens (> 24 hours)
    expired = [t for t, ts in REVOKED_TOKENS.items() if now - ts > 86400]
    for t in expired:
        REVOKED_TOKENS.pop(t, None)
    REVOKED_TOKENS[token_str] = now

# HTTPS & Reverse Proxy Inspector
def is_request_https(headers: dict = None) -> bool:
    if not headers:
        return False
    if headers.get("X-Forwarded-Proto") == "https":
        return True
    if headers.get("X-Forwarded-SSL") == "on":
        return True
    cf = headers.get("CF-Visitor", "")
    if cf and '"scheme":"https"' in cf:
        return True
    if os.environ.get("FORCE_HTTPS", "").lower() in ("true", "1", "yes"):
        return True
    if BASE_URL and BASE_URL.startswith("https://"):
        return True
    return False

# Static File Security Guard (Disallows arbitrary source/config/database downloads)
SAFE_STATIC_EXTENSIONS = {
    ".html", ".htm", ".css", ".js", ".mjs", ".json",
    ".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".ico",
    ".mp4", ".webm", ".ogg",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".pdf", ".txt", ".xml"
}
DISALLOWED_STATIC_PREFIXES = (
    "/.", "/data", "/lib", "/__pycache__", "/node_modules", "/.venv", "/.git"
)
DISALLOWED_STATIC_FILES = {
    "server.py", "generate_pages.py", "update_projects.py",
    "procfile", "requirements.txt", "deployment.md", "project_state.md",
    "prompt_extract.txt", "vs_cranes_local.db"
}

def is_safe_static_path(path_str: str) -> bool:
    if not path_str or ".." in path_str or "//" in path_str or "\\" in path_str:
        return False
    clean_path = urlparse(path_str).path
    clean_path_lower = clean_path.lower()
    parts = [p for p in clean_path_lower.split("/") if p]
    for p in parts:
        if p.startswith("."):
            return False
    for prefix in DISALLOWED_STATIC_PREFIXES:
        if clean_path_lower == prefix or clean_path_lower.startswith(prefix + "/"):
            return False
    basename = os.path.basename(clean_path_lower)
    if basename in DISALLOWED_STATIC_FILES or basename.startswith("test_") or basename.startswith("fix_"):
        return False
    ext = os.path.splitext(clean_path_lower)[1]
    if ext in (".py", ".pyc", ".pyo", ".db", ".sqlite", ".sqlite3", ".env", ".log", ".bak", ".swp", ".sh"):
        return False
    if ext and ext not in SAFE_STATIC_EXTENSIONS:
        return False
    return True

# Safe SMTP Configuration Health Check
def check_smtp_health() -> dict:
    if not SMTP_USER or not SMTP_PASS:
        return {
            "configured": False,
            "host": SMTP_HOST,
            "port": SMTP_PORT,
            "status": "Not Configured",
            "message": "SMTP_PASS is empty in .env. Real email alerts are paused."
        }
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=5) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
        return {
            "configured": True,
            "host": SMTP_HOST,
            "port": SMTP_PORT,
            "status": "Connected & Ready",
            "sender": SMTP_USER,
            "recipient": NOTIFICATION_EMAIL
        }
    except Exception as e:
        err_msg = str(e)
        if "Username and Password not accepted" in err_msg or "Authentication" in err_msg:
            safe_msg = "SMTP authentication rejected. Check SMTP_USER and App Password in .env."
        elif "timed out" in err_msg:
            safe_msg = "SMTP connection timed out. Check SMTP_HOST and port."
        else:
            safe_msg = "SMTP service connection error. Please verify host and network settings."
        return {
            "configured": True,
            "host": SMTP_HOST,
            "port": SMTP_PORT,
            "status": "Authentication/Connection Error",
            "message": safe_msg
        }

# -------------------------------------------------------------
# 3. DATABASE MANAGER (MONGODB ATLAS + LOCAL RESILIENT MIRROR)
# -------------------------------------------------------------
class DatabaseManager:
    def __init__(self):
        self.mongo_client = None
        self.mongo_db = None
        self.mongo_connected = False
        self.mongo_error = None
        self.init_sqlite()
        self.init_mongo()

    def init_sqlite(self):
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS inquiries (
                id TEXT PRIMARY KEY,
                name TEXT,
                email TEXT,
                phone TEXT,
                company TEXT,
                subject TEXT,
                service_type TEXT,
                equipment_type TEXT,
                capacity TEXT,
                span TEXT,
                lift TEXT,
                duty_class TEXT,
                location TEXT,
                message TEXT,
                source_page TEXT,
                status TEXT,
                priority TEXT,
                admin_notes TEXT,
                follow_up_date TEXT,
                email_status TEXT DEFAULT 'Pending',
                email_sent_at TEXT DEFAULT '',
                email_error TEXT DEFAULT '',
                created_at TEXT,
                raw_data TEXT
            )
        """)
        columns = [row[1] for row in c.execute("PRAGMA table_info(inquiries)").fetchall()]
        if "priority" not in columns:
            c.execute("ALTER TABLE inquiries ADD COLUMN priority TEXT DEFAULT 'Normal'")
        if "admin_notes" not in columns:
            c.execute("ALTER TABLE inquiries ADD COLUMN admin_notes TEXT DEFAULT ''")
        if "follow_up_date" not in columns:
            c.execute("ALTER TABLE inquiries ADD COLUMN follow_up_date TEXT DEFAULT ''")
        if "location" not in columns:
            c.execute("ALTER TABLE inquiries ADD COLUMN location TEXT DEFAULT ''")
        if "email_status" not in columns:
            c.execute("ALTER TABLE inquiries ADD COLUMN email_status TEXT DEFAULT 'Pending'")
        if "email_sent_at" not in columns:
            c.execute("ALTER TABLE inquiries ADD COLUMN email_sent_at TEXT DEFAULT ''")
        if "email_error" not in columns:
            c.execute("ALTER TABLE inquiries ADD COLUMN email_error TEXT DEFAULT ''")

        # Lead Attribution & Intelligence Columns
        lead_cols = {
            "lead_source": "TEXT DEFAULT 'Direct'",
            "referrer": "TEXT DEFAULT ''",
            "landing_page": "TEXT DEFAULT ''",
            "product_context": "TEXT DEFAULT ''",
            "service_context": "TEXT DEFAULT ''",
            "utm_source": "TEXT DEFAULT ''",
            "utm_medium": "TEXT DEFAULT ''",
            "utm_campaign": "TEXT DEFAULT ''",
            "utm_term": "TEXT DEFAULT ''",
            "utm_content": "TEXT DEFAULT ''",
            "approx_geo": "TEXT DEFAULT ''",
            "approx_country": "TEXT DEFAULT ''",
            "approx_city": "TEXT DEFAULT ''",
            "device": "TEXT DEFAULT ''",
            "device_type": "TEXT DEFAULT ''",
            "browser": "TEXT DEFAULT ''",
            "os": "TEXT DEFAULT ''"
        }
        for col_name, col_def in lead_cols.items():
            if col_name not in columns:
                c.execute(f"ALTER TABLE inquiries ADD COLUMN {col_name} {col_def}")

        # Analytics Events Table
        c.execute("""
            CREATE TABLE IF NOT EXISTS analytics_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                path TEXT,
                ip_hash TEXT,
                device TEXT,
                browser TEXT,
                os TEXT,
                referrer TEXT,
                event_type TEXT DEFAULT 'page_view',
                session_id TEXT DEFAULT '',
                product_id TEXT DEFAULT '',
                product_name TEXT DEFAULT '',
                service_id TEXT DEFAULT '',
                service_name TEXT DEFAULT '',
                country TEXT DEFAULT '',
                city TEXT DEFAULT '',
                landing_page TEXT DEFAULT '',
                utm_source TEXT DEFAULT '',
                utm_medium TEXT DEFAULT '',
                utm_campaign TEXT DEFAULT '',
                source TEXT DEFAULT '',
                meta TEXT DEFAULT '',
                created_at TEXT DEFAULT ''
            )
        """)
        ae_cols = [row[1] for row in c.execute("PRAGMA table_info(analytics_events)").fetchall()]
        new_ae_cols = {
            "event_type": "TEXT DEFAULT 'page_view'",
            "session_id": "TEXT DEFAULT ''",
            "product_id": "TEXT DEFAULT ''",
            "product_name": "TEXT DEFAULT ''",
            "service_id": "TEXT DEFAULT ''",
            "service_name": "TEXT DEFAULT ''",
            "country": "TEXT DEFAULT ''",
            "city": "TEXT DEFAULT ''",
            "landing_page": "TEXT DEFAULT ''",
            "utm_source": "TEXT DEFAULT ''",
            "utm_medium": "TEXT DEFAULT ''",
            "utm_campaign": "TEXT DEFAULT ''",
            "source": "TEXT DEFAULT ''",
            "meta": "TEXT DEFAULT ''",
            "created_at": "TEXT DEFAULT ''"
        }
        for col_name, col_def in new_ae_cols.items():
            if col_name not in ae_cols:
                c.execute(f"ALTER TABLE analytics_events ADD COLUMN {col_name} {col_def}")

        # Operational Monitoring & Alerts Table
        c.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id TEXT PRIMARY KEY,
                timestamp TEXT,
                severity TEXT,
                category TEXT,
                title TEXT,
                message TEXT,
                status TEXT DEFAULT 'unresolved',
                count INTEGER DEFAULT 1,
                last_occurred TEXT,
                resolved_at TEXT DEFAULT '',
                occurrences INTEGER DEFAULT 1,
                resolved INTEGER DEFAULT 0,
                first_seen TEXT DEFAULT '',
                last_seen TEXT DEFAULT ''
            )
        """)
        alert_cols = [row[1] for row in c.execute("PRAGMA table_info(alerts)").fetchall()]
        new_alert_cols = {
            "count": "INTEGER DEFAULT 1",
            "occurrences": "INTEGER DEFAULT 1",
            "last_occurred": "TEXT DEFAULT ''",
            "resolved_at": "TEXT DEFAULT ''",
            "resolved": "INTEGER DEFAULT 0",
            "first_seen": "TEXT DEFAULT ''",
            "last_seen": "TEXT DEFAULT ''"
        }
        for col_name, col_def in new_alert_cols.items():
            if col_name not in alert_cols:
                c.execute(f"ALTER TABLE alerts ADD COLUMN {col_name} {col_def}")
        conn.commit()
        conn.close()

    def ensure_mongo_connected(self) -> bool:
        if self.mongo_connected and self.mongo_client and self.mongo_db is not None:
            return True
        if not MONGODB_URI:
            return False
        try:
            import pymongo
            if not self.mongo_client:
                self.mongo_client = pymongo.MongoClient(
                    MONGODB_URI,
                    serverSelectionTimeoutMS=3000,
                    connectTimeoutMS=3000
                )
            self.mongo_client.admin.command("ping")
            self.mongo_db = self.mongo_client[MONGODB_DB_NAME]
            self.mongo_connected = True
            self.mongo_error = None
            return True
        except Exception as e:
            self.mongo_connected = False
            sanitized_err = re.sub(r"://([^:]+):([^@]+)@", r"://\1:*****@", str(e))
            self.mongo_error = f"{type(e).__name__}: {sanitized_err}"
            return False

    def init_mongo(self):
        if not MONGODB_URI:
            self.mongo_connected = False
            self.mongo_error = "MONGODB_URI not configured in .env"
            print("[MongoDB Atlas Diagnostic] MONGODB_URI not configured in .env. Using local SQLite/JSON mirror.", flush=True)
            return

        print("[MongoDB Atlas Diagnostic] Connecting to Atlas cluster...", flush=True)
        print(f"[MongoDB Atlas Diagnostic] Target database: '{MONGODB_DB_NAME}'", flush=True)

        try:
            import pymongo
            self.mongo_client = pymongo.MongoClient(
                MONGODB_URI,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000
            )
            ping_result = self.mongo_client.admin.command("ping")
            self.mongo_db = self.mongo_client[MONGODB_DB_NAME]

            # Create Indexes safely
            self.mongo_db.inquiries.create_index([("id", pymongo.ASCENDING)], unique=True)
            self.mongo_db.inquiries.create_index([("created_at", pymongo.DESCENDING)])
            self.mongo_db.inquiries.create_index([("status", pymongo.ASCENDING)])
            self.mongo_connected = True
            self.mongo_error = None
            print(f"[MongoDB Atlas Diagnostic] SUCCESS: Connected to MongoDB Atlas. Database: '{MONGODB_DB_NAME}' (ping: {ping_result}).", flush=True)
            self.sync_mirror_to_mongo()
        except Exception as e:
            self.mongo_connected = False
            err_type = type(e).__name__
            err_msg = str(e)
            sanitized_msg = re.sub(r"://([^:]+):([^@]+)@", r"://\1:*****@", err_msg)
            self.mongo_error = f"{err_type}: {sanitized_msg}"
            print(f"[MongoDB Atlas Diagnostic] FAILED: Could not connect to Atlas [{err_type}]. Local SQLite/JSON fallback active.", flush=True)
            print(f"  → Details: {sanitized_msg[:300]}", flush=True)

    def sync_mirror_to_mongo(self):
        if not self.mongo_connected or self.mongo_db is None:
            return
        try:
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM inquiries")
            rows = [dict(r) for r in c.fetchall()]
            conn.close()
            for r in rows:
                self.mongo_db.inquiries.update_one(
                    {"id": r["id"]},
                    {"$set": r},
                    upsert=True
                )
            if os.path.exists(CMS_FILE):
                with open(CMS_FILE, "r", encoding="utf-8") as f:
                    cms_data = json.load(f)
                for sec, sec_val in cms_data.items():
                    col = self.mongo_db[f"cms_{sec}"]
                    if col.count_documents({}) == 0:
                        if isinstance(sec_val, list) and sec_val:
                            col.insert_many(sec_val)
                        elif isinstance(sec_val, dict) and sec_val:
                            col.insert_one(sec_val)
            print("MongoDB Atlas: Synchronized inquiries and CMS collections.", flush=True)
        except Exception as e:
            print(f"MongoDB Atlas Sync Note: {e}", flush=True)

    def save_inquiry(self, data: dict) -> dict:
        inquiry_id = data.get("id") or ("inq_" + uuid.uuid4().hex[:10])
        created_at = data.get("created_at") or datetime.now(timezone.utc).isoformat()
        status = data.get("status") or "New"
        priority = data.get("priority") or "Normal"
        admin_notes = data.get("admin_notes") or ""
        follow_up_date = data.get("follow_up_date") or ""
        email_status = data.get("email_status") or ("Pending" if (SMTP_USER and SMTP_PASS) else "Not Configured")

        lead_source = str(data.get("lead_source") or categorize_lead_source(
            referrer=data.get("referrer", ""),
            utm_source=data.get("utm_source", ""),
            utm_medium=data.get("utm_medium", "")
        )).strip()[:50]
        referrer = str(data.get("referrer", "")).strip()[:200]
        landing_page = str(data.get("landing_page", "")).strip()[:150]
        product_context = str(data.get("product_context", "") or data.get("equipment_type", "")).strip()[:100]
        service_context = str(data.get("service_context", "") or data.get("service_type", "")).strip()[:100]
        utm_source = str(data.get("utm_source", "")).strip()[:60]
        utm_medium = str(data.get("utm_medium", "")).strip()[:60]
        utm_campaign = str(data.get("utm_campaign", "")).strip()[:60]
        utm_term = str(data.get("utm_term", "")).strip()[:60]
        utm_content = str(data.get("utm_content", "")).strip()[:60]
        approx_country = str(data.get("approx_country", "")).strip()[:60]
        approx_city = str(data.get("approx_city", "")).strip()[:60]
        approx_geo = str(data.get("approx_geo", "")).strip()[:100]
        if not approx_geo and (approx_country or approx_city):
            approx_geo = f"{approx_city}, {approx_country}".strip(", ")
        device = str(data.get("device", "")).strip()[:40]
        device_type = str(data.get("device_type", "") or device).strip()[:40]
        browser = str(data.get("browser", "")).strip()[:40]
        os_name = str(data.get("os", "")).strip()[:40]

        inquiry_record = {
            "id": inquiry_id,
            "name": str(data.get("name", "")).strip()[:120],
            "email": str(data.get("email", "")).strip().lower()[:120],
            "phone": str(data.get("phone", "")).strip()[:30],
            "company": str(data.get("company", "")).strip()[:120],
            "subject": str(data.get("subject", "")).strip()[:150],
            "service_type": str(data.get("service_type", "")).strip()[:80],
            "equipment_type": str(data.get("equipment_type", "")).strip()[:80],
            "capacity": str(data.get("capacity", "")).strip()[:40],
            "span": str(data.get("span", "")).strip()[:40],
            "lift": str(data.get("lift", "")).strip()[:40],
            "duty_class": str(data.get("duty_class", "")).strip()[:40],
            "location": str(data.get("location", "")).strip()[:150],
            "message": str(data.get("message", "")).strip()[:3000],
            "source_page": str(data.get("source_page", "Website Form")).strip()[:100],
            "status": status,
            "priority": priority,
            "admin_notes": admin_notes,
            "follow_up_date": follow_up_date,
            "email_status": email_status,
            "created_at": created_at,
            "lead_source": lead_source,
            "referrer": referrer,
            "landing_page": landing_page,
            "product_context": product_context,
            "service_context": service_context,
            "utm_source": utm_source,
            "utm_medium": utm_medium,
            "utm_campaign": utm_campaign,
            "utm_term": utm_term,
            "utm_content": utm_content,
            "approx_geo": approx_geo,
            "approx_country": approx_country,
            "approx_city": approx_city,
            "device": device,
            "device_type": device_type,
            "browser": browser,
            "os": os_name
        }

        # 1. Primary Store: MongoDB Atlas
        if self.ensure_mongo_connected():
            try:
                self.mongo_db.inquiries.update_one(
                    {"id": inquiry_id},
                    {"$set": inquiry_record},
                    upsert=True
                )
            except Exception as e:
                self.mongo_connected = False
                print(f"[MongoDB Atlas Warning] Write error to Atlas: {e}. Preserving in local mirror.", flush=True)

        # 2. Resilient Mirror: Local SQLite
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("""
            INSERT OR REPLACE INTO inquiries (
                id, name, email, phone, company, subject, service_type,
                equipment_type, capacity, span, lift, duty_class, location,
                message, source_page, status, priority, admin_notes, follow_up_date,
                email_status, created_at, raw_data,
                lead_source, referrer, landing_page, product_context, service_context,
                utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                approx_geo, approx_country, approx_city, device, device_type, browser, os
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            inquiry_record["id"], inquiry_record["name"], inquiry_record["email"],
            inquiry_record["phone"], inquiry_record["company"], inquiry_record["subject"],
            inquiry_record["service_type"], inquiry_record["equipment_type"],
            inquiry_record["capacity"], inquiry_record["span"], inquiry_record["lift"],
            inquiry_record["duty_class"], inquiry_record["location"], inquiry_record["message"],
            inquiry_record["source_page"], inquiry_record["status"], inquiry_record["priority"],
            inquiry_record["admin_notes"], inquiry_record["follow_up_date"],
            inquiry_record["email_status"], inquiry_record["created_at"], json.dumps(data),
            inquiry_record["lead_source"], inquiry_record["referrer"], inquiry_record["landing_page"],
            inquiry_record["product_context"], inquiry_record["service_context"],
            inquiry_record["utm_source"], inquiry_record["utm_medium"], inquiry_record["utm_campaign"],
            inquiry_record["utm_term"], inquiry_record["utm_content"],
            inquiry_record["approx_geo"], inquiry_record["approx_country"], inquiry_record["approx_city"],
            inquiry_record["device"], inquiry_record["device_type"], inquiry_record["browser"], inquiry_record["os"]
        ))
        conn.commit()
        conn.close()

        # 3. Resilient Mirror: JSON Backup
        self.sync_json_backup()

        return inquiry_record

    def update_inquiry_email_status(self, inquiry_id: str, email_status: str, error_msg: str = None):
        update_fields = {"email_status": email_status}
        if email_status == "Sent":
            update_fields["email_sent_at"] = datetime.now(timezone.utc).isoformat()
        elif error_msg:
            update_fields["email_error"] = str(error_msg)[:250]

        if self.ensure_mongo_connected():
            try:
                self.mongo_db.inquiries.update_one({"id": inquiry_id}, {"$set": update_fields})
            except Exception as e:
                print(f"[Database Note] Could not update email status in Atlas: {e}", flush=True)

        try:
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("UPDATE inquiries SET email_status = ? WHERE id = ?", (email_status, inquiry_id))
            conn.commit()
            conn.close()
        except Exception:
            pass

        self.sync_json_backup()

    def get_inquiries(self, search="", filter_type="all", filter_status="all", filter_priority="all"):
        # If MongoDB is connected, query MongoDB
        if self.mongo_connected and self.mongo_db is not None:
            try:
                q = {}
                if filter_status and filter_status != "all":
                    q["status"] = {"$regex": f"^{re.escape(filter_status)}$", "$options": "i"}
                if filter_priority and filter_priority != "all":
                    q["priority"] = {"$regex": f"^{re.escape(filter_priority)}$", "$options": "i"}
                if filter_type and filter_type != "all":
                    if filter_type == "quote":
                        q["$or"] = [{"equipment_type": {"$ne": ""}}, {"subject": {"$regex": "quote", "$options": "i"}}]
                    elif filter_type == "service":
                        q["$or"] = [{"service_type": {"$ne": ""}}, {"subject": {"$regex": "service|amc", "$options": "i"}}]
                    elif filter_type == "contact":
                        q["equipment_type"] = ""
                        q["service_type"] = ""
                if search:
                    s_regex = {"$regex": re.escape(search), "$options": "i"}
                    q["$or"] = [
                        {"id": s_regex}, {"name": s_regex}, {"email": s_regex}, {"phone": s_regex},
                        {"company": s_regex}, {"message": s_regex}, {"equipment_type": s_regex},
                        {"location": s_regex}, {"admin_notes": s_regex}
                    ]

                docs = list(self.mongo_db.inquiries.find(q, {"_id": 0}).sort("created_at", -1))
                return docs
            except Exception as e:
                print(f"MongoDB query error (using local mirror fallback): {e}")

        # Local SQLite mirror query
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        query = "SELECT * FROM inquiries WHERE 1=1"
        params = []

        if filter_status and filter_status != "all":
            query += " AND LOWER(status) = LOWER(?)"
            params.append(filter_status)

        if filter_priority and filter_priority != "all":
            query += " AND LOWER(priority) = LOWER(?)"
            params.append(filter_priority)

        if filter_type and filter_type != "all":
            if filter_type == "quote":
                query += " AND (equipment_type != '' OR subject LIKE '%Quote%')"
            elif filter_type == "service":
                query += " AND (service_type != '' OR subject LIKE '%Service%' OR subject LIKE '%AMC%')"
            elif filter_type == "contact":
                query += " AND (equipment_type = '' AND service_type = '')"

        if search:
            query += " AND (id LIKE ? OR name LIKE ? OR email LIKE ? OR phone LIKE ? OR company LIKE ? OR message LIKE ? OR equipment_type LIKE ? OR location LIKE ? OR admin_notes LIKE ?)"
            s = f"%{search}%"
            params.extend([s, s, s, s, s, s, s, s, s])

        query += " ORDER BY created_at DESC"
        c.execute(query, params)
        rows = c.fetchall()
        results = [dict(row) for row in rows]
        conn.close()
        return results

    def get_inquiry_by_id(self, inquiry_id: str):
        if self.mongo_connected and self.mongo_db is not None:
            try:
                doc = self.mongo_db.inquiries.find_one({"id": inquiry_id}, {"_id": 0})
                if doc:
                    return doc
            except Exception:
                pass

        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT * FROM inquiries WHERE id = ?", (inquiry_id,))
        row = c.fetchone()
        conn.close()
        return dict(row) if row else None

    def update_inquiry(self, inquiry_id: str, updates: dict) -> bool:
        allowed_fields = ["status", "priority", "admin_notes", "follow_up_date"]
        clean_updates = {k: str(v).strip() for k, v in updates.items() if k in allowed_fields}
        if not clean_updates:
            return False

        # 1. Update SQLite
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        set_clause = ", ".join([f"{k} = ?" for k in clean_updates.keys()])
        values = list(clean_updates.values()) + [inquiry_id]
        c.execute(f"UPDATE inquiries SET {set_clause} WHERE id = ?", values)
        affected = c.rowcount
        conn.commit()
        conn.close()

        # 2. Sync JSON
        self.sync_json_backup()

        # 3. Update MongoDB
        if self.mongo_connected and self.mongo_db is not None:
            try:
                self.mongo_db.inquiries.update_one({"id": inquiry_id}, {"$set": clean_updates})
            except Exception as e:
                print(f"MongoDB update warning: {e}")

        return affected > 0

    def delete_inquiry(self, inquiry_id: str) -> bool:
        # 1. Delete from SQLite
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("DELETE FROM inquiries WHERE id = ?", (inquiry_id,))
        affected = c.rowcount
        conn.commit()
        conn.close()

        # 2. Sync JSON
        self.sync_json_backup()

        # 3. Delete from MongoDB
        if self.mongo_connected and self.mongo_db is not None:
            try:
                self.mongo_db.inquiries.delete_one({"id": inquiry_id})
            except Exception as e:
                print(f"MongoDB delete warning: {e}")

        return affected > 0

    def get_stats(self) -> dict:
        inquiries = self.get_inquiries()
        stats = {
            "total": len(inquiries),
            "new": sum(1 for i in inquiries if (i.get("status") or "").lower() == "new"),
            "contacted": sum(1 for i in inquiries if (i.get("status") or "").lower() == "contacted"),
            "quoted": sum(1 for i in inquiries if (i.get("status") or "").lower() == "quoted"),
            "in_progress": sum(1 for i in inquiries if (i.get("status") or "").lower() == "in progress"),
            "completed": sum(1 for i in inquiries if (i.get("status") or "").lower() == "completed"),
            "closed": sum(1 for i in inquiries if (i.get("status") or "").lower() == "closed"),
            "urgent": sum(1 for i in inquiries if (i.get("priority") or "").lower() == "urgent"),
            "quotes_count": sum(1 for i in inquiries if i.get("equipment_type") or "quote" in (i.get("subject") or "").lower()),
            "services_count": sum(1 for i in inquiries if i.get("service_type") or "service" in (i.get("subject") or "").lower() or "amc" in (i.get("subject") or "").lower()),
        }
        return stats

    def get_db_status(self) -> dict:
        diagnosis = None
        if not self.mongo_connected and self.mongo_error:
            err_str = str(self.mongo_error)
            if "TLSV1_ALERT_INTERNAL_ERROR" in err_str or "alert internal error" in err_str:
                diagnosis = "TLS Alert 80 (Internal Error) received from MongoDB Atlas. Outbound server IP is not authorized in Atlas Network Access. Authorize your server's outbound IP or subnet in Atlas Console -> Security -> Network Access."
            elif "Authentication failed" in err_str or "auth failed" in err_str or "OperationFailure" in err_str:
                diagnosis = "MongoDB authentication failed. Check database user credentials in MONGODB_URI in .env."
            elif "resolv.conf" in err_str or "getaddrinfo" in err_str:
                diagnosis = "DNS resolution failure reaching MongoDB Atlas cluster."
            else:
                diagnosis = err_str

        mongo_info = {
            "configured": bool(MONGODB_URI),
            "connected": self.mongo_connected,
            "target_database": MONGODB_DB_NAME,
            "error": self.mongo_error,
            "diagnosis": diagnosis,
        }
        if self.mongo_connected and self.mongo_client:
            try:
                t0 = time.time()
                self.mongo_client.admin.command("ping")
                mongo_info["latency_ms"] = round((time.time() - t0) * 1000, 1)
            except Exception as e:
                mongo_info["connected"] = False
                mongo_info["error"] = str(e)

        return {
            "database": "MongoDB Atlas" if self.mongo_connected else "Local SQLite/JSON Mirror",
            "active_database": MONGODB_DB_NAME if self.mongo_connected else "inquiries.db (SQLite)",
            "mongo": mongo_info,
            "total_inquiries": self.get_stats()["total"],
            "backend_port": PORT,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    def sync_json_backup(self):
        try:
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM inquiries ORDER BY created_at DESC")
            all_rows = [dict(r) for r in c.fetchall()]
            conn.close()
            with open(JSON_FILE, "w", encoding="utf-8") as f:
                json.dump(all_rows, f, indent=2)
        except Exception as e:
            print(f"JSON backup sync note: {e}")

    # --- Operational Alerts & Incident Monitoring ---
    def record_alert(self, severity: str, category: str, title: str, message: str) -> dict:
        now_iso = datetime.now(timezone.utc).isoformat()
        severity = severity.upper() if severity else "INFO"
        if severity not in ["CRITICAL", "HIGH", "MEDIUM", "INFO"]:
            severity = "INFO"
        category = str(category or "System").strip()[:60]
        title = sanitize_text(str(title))[:120]
        message = sanitize_text(str(message))[:500]

        # 1. Deduplication: look for matching unresolved alert within 15 minutes (900s)
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("""
            SELECT id, count, last_occurred FROM alerts 
            WHERE (status = 'unresolved' OR resolved = 0) AND category = ? AND title = ? 
            ORDER BY last_occurred DESC LIMIT 1
        """, (category, title))
        row = c.fetchone()

        dedup_window = 900  # 15 minutes
        if row:
            alert_id, count, last_occurred = row
            try:
                last_dt = datetime.fromisoformat(last_occurred.replace("Z", "+00:00"))
                if (datetime.now(timezone.utc) - last_dt).total_seconds() <= dedup_window:
                    new_count = count + 1
                    c.execute("""
                        UPDATE alerts 
                        SET count = ?, occurrences = ?, last_occurred = ?, last_seen = ?, message = ? 
                        WHERE id = ?
                    """, (new_count, new_count, now_iso, now_iso, message, alert_id))
                    conn.commit()
                    conn.close()

                    updated_alert = {
                        "id": alert_id,
                        "timestamp": last_occurred,
                        "severity": severity,
                        "category": category,
                        "title": title,
                        "message": message,
                        "status": "unresolved",
                        "count": new_count,
                        "occurrences": new_count,
                        "last_occurred": now_iso,
                        "last_seen": now_iso,
                        "first_seen": last_occurred,
                        "resolved": 0,
                        "resolved_at": ""
                    }
                    if self.ensure_mongo_connected():
                        try:
                            self.mongo_db["alerts"].update_one(
                                {"id": alert_id},
                                {"$set": {"count": new_count, "occurrences": new_count, "last_occurred": now_iso, "last_seen": now_iso, "message": message}}
                            )
                        except Exception:
                            pass
                    return updated_alert
            except Exception:
                pass

        # 2. Create new alert record
        new_id = f"alt_{uuid.uuid4().hex[:8]}"
        c.execute("""
            INSERT INTO alerts (id, timestamp, severity, category, title, message, status, count, last_occurred, resolved_at, occurrences, resolved, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, 'unresolved', 1, ?, '', 1, 0, ?, ?)
        """, (new_id, now_iso, severity, category, title, message, now_iso, now_iso, now_iso))
        conn.commit()
        conn.close()

        alert_doc = {
            "id": new_id,
            "timestamp": now_iso,
            "severity": severity,
            "category": category,
            "title": title,
            "message": message,
            "status": "unresolved",
            "count": 1,
            "occurrences": 1,
            "last_occurred": now_iso,
            "last_seen": now_iso,
            "first_seen": now_iso,
            "resolved": 0,
            "resolved_at": ""
        }

        if self.ensure_mongo_connected():
            try:
                self.mongo_db["alerts"].insert_one(dict(alert_doc))
            except Exception:
                pass

        return alert_doc

    def get_alerts(self, status: str = "all", limit: int = 50, resolved_filter: any = None) -> list:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        if resolved_filter is not None:
            if resolved_filter is False or resolved_filter == "unresolved":
                c.execute("SELECT * FROM alerts WHERE status = 'unresolved' OR resolved = 0 ORDER BY last_occurred DESC LIMIT ?", (limit,))
            elif resolved_filter is True or resolved_filter == "resolved":
                c.execute("SELECT * FROM alerts WHERE status = 'resolved' OR resolved = 1 ORDER BY last_occurred DESC LIMIT ?", (limit,))
            else:
                c.execute("SELECT * FROM alerts ORDER BY last_occurred DESC LIMIT ?", (limit,))
        elif status and status != "all":
            c.execute("SELECT * FROM alerts WHERE status = ? ORDER BY last_occurred DESC LIMIT ?", (status, limit))
        else:
            c.execute("SELECT * FROM alerts ORDER BY last_occurred DESC LIMIT ?", (limit,))
        raw_rows = [dict(r) for r in c.fetchall()]
        conn.close()
        alerts = []
        for r in raw_rows:
            r["occurrences"] = r.get("occurrences") or r.get("count", 1)
            r["count"] = r["occurrences"]
            r["resolved"] = 1 if (r.get("resolved") == 1 or r.get("status") == "resolved") else 0
            r["status"] = "resolved" if r["resolved"] == 1 else "unresolved"
            r["first_seen"] = r.get("first_seen") or r.get("timestamp", "")
            r["last_seen"] = r.get("last_seen") or r.get("last_occurred", "")
            alerts.append(r)
        return alerts

    def resolve_alert(self, alert_id: str) -> bool:
        now_iso = datetime.now(timezone.utc).isoformat()
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("UPDATE alerts SET status = 'resolved', resolved = 1, resolved_at = ? WHERE id = ?", (now_iso, alert_id))
        affected = c.rowcount
        conn.commit()
        conn.close()

        if self.ensure_mongo_connected():
            try:
                self.mongo_db["alerts"].update_one(
                    {"id": alert_id},
                    {"$set": {"status": "resolved", "resolved": 1, "resolved_at": now_iso}}
                )
            except Exception:
                pass
        return affected > 0

    def resolve_all_alerts(self) -> int:
        now_iso = datetime.now(timezone.utc).isoformat()
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("UPDATE alerts SET status = 'resolved', resolved = 1, resolved_at = ? WHERE status = 'unresolved' OR resolved = 0", (now_iso,))
        affected = c.rowcount
        conn.commit()
        conn.close()

        if self.ensure_mongo_connected():
            try:
                self.mongo_db["alerts"].update_many(
                    {"$or": [{"status": "unresolved"}, {"resolved": 0}]},
                    {"$set": {"status": "resolved", "resolved": 1, "resolved_at": now_iso}}
                )
            except Exception:
                pass
        return affected

    # --- Analytics & Server Health Monitoring ---
    def record_analytics_event(self, event_data: dict):
        try:
            path = str(event_data.get("path") or "/index.html").strip()[:150]
            event_type = str(event_data.get("event_type") or "page_view").strip()[:50]
            client_ip = str(event_data.get("client_ip") or "127.0.0.1").strip()
            ua = str(event_data.get("user_agent") or "").strip()
            referrer = str(event_data.get("referrer") or "").strip()[:200]
            session_id = str(event_data.get("session_id") or "").strip()[:64]
            product_id = str(event_data.get("product_id") or "").strip()[:64]
            product_name = str(event_data.get("product_name") or "").strip()[:100]
            service_id = str(event_data.get("service_id") or "").strip()[:64]
            service_name = str(event_data.get("service_name") or "").strip()[:100]
            landing_page = str(event_data.get("landing_page") or path).strip()[:100]
            utm_source = str(event_data.get("utm_source") or "").strip()[:60]
            utm_medium = str(event_data.get("utm_medium") or "").strip()[:60]
            utm_campaign = str(event_data.get("utm_campaign") or "").strip()[:60]
            country = str(event_data.get("country") or "Unknown").strip()[:60]
            city = str(event_data.get("city") or "Unknown").strip()[:60]
            source_tag = str(event_data.get("source") or "").strip()[:100]
            meta_val = json.dumps(event_data.get("meta", {})) if isinstance(event_data.get("meta"), dict) else str(event_data.get("meta") or "")

            device, browser, os_name = parse_user_agent(ua)
            ip_hash = hashlib.sha256((client_ip + SECRET_KEY).encode("utf-8")).hexdigest()[:16]
            now_iso = datetime.now(timezone.utc).isoformat()
            now_epoch = time.time()

            if session_id:
                with METRICS_LOCK:
                    ACTIVE_SESSIONS[session_id] = now_epoch
            else:
                with METRICS_LOCK:
                    ACTIVE_SESSIONS[ip_hash] = now_epoch

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("""
                INSERT INTO analytics_events (
                    timestamp, path, ip_hash, device, browser, os, referrer,
                    event_type, session_id, product_id, product_name,
                    service_id, service_name, country, city, landing_page,
                    utm_source, utm_medium, utm_campaign, source, meta, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                now_iso, path, ip_hash, device, browser, os_name, referrer,
                event_type, session_id, product_id, product_name,
                service_id, service_name, country, city, landing_page,
                utm_source, utm_medium, utm_campaign, source_tag, meta_val, now_iso
            ))
            conn.commit()
            conn.close()

            if self.ensure_mongo_connected():
                try:
                    self.mongo_db["analytics_events"].insert_one({
                        "timestamp": now_iso,
                        "created_at": now_iso,
                        "path": path,
                        "ip_hash": ip_hash,
                        "device": device,
                        "browser": browser,
                        "os": os_name,
                        "referrer": referrer,
                        "event_type": event_type,
                        "session_id": session_id,
                        "product_id": product_id,
                        "product_name": product_name,
                        "service_id": service_id,
                        "service_name": service_name,
                        "country": country,
                        "city": city,
                        "landing_page": landing_page,
                        "utm_source": utm_source,
                        "utm_medium": utm_medium,
                        "utm_campaign": utm_campaign,
                        "source": source_tag,
                        "meta": meta_val
                    })
                except Exception:
                    pass
        except Exception as e:
            record_app_error("/api/analytics/event", "POST", 500, e)
            print(f"Analytics event record error: {e}")

    def record_page_view(self, path: str, client_ip: str, user_agent: str, referrer: str):
        # Determine traffic source tag for filtering dev/test/admin from production
        source_tag = ""
        ua_lower = (user_agent or "").lower()
        is_loopback = client_ip in ("127.0.0.1", "::1", "0.0.0.0", "localhost")

        if is_loopback:
            source_tag = "dev_local"
        elif path == "/admin.html" or path.startswith("/admin"):
            source_tag = "admin"
        elif not user_agent or "python" in ua_lower or "curl" in ua_lower or "httpie" in ua_lower or "wget" in ua_lower:
            source_tag = "bot"

        geo = resolve_approx_geo()
        self.record_analytics_event({
            "path": "/index.html" if path in ["/", ""] else path,
            "event_type": "page_view",
            "client_ip": client_ip,
            "user_agent": user_agent,
            "referrer": referrer,
            "country": geo.get("country", "Unknown"),
            "city": geo.get("city", "Unknown"),
            "source": source_tag
        })

    def get_analytics_summary(self, period: str = "7d") -> dict:
        try:
            if period not in ["today", "7d", "30d", "all"]:
                period = "7d"

            now_utc = datetime.now(timezone.utc)
            since_iso = ""
            if period == "today":
                since_iso = now_utc.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
            elif period == "7d":
                since_iso = (now_utc - timedelta(days=7)).isoformat()
            elif period == "30d":
                since_iso = (now_utc - timedelta(days=30)).isoformat()

            # Exclude dev/test/admin/bot traffic from production analytics
            _non_prod_sources = ("dev_local", "admin", "bot", "test")
            _source_filter = " AND (source IS NULL OR source = '' OR source NOT IN ('dev_local','admin','bot','test'))"

            if since_iso:
                time_clause_ae = " WHERE timestamp >= ?" + _source_filter
            else:
                time_clause_ae = " WHERE (1=1)" + _source_filter
            params_ae = [since_iso] if since_iso else []

            # Helper prefix for subqueries needing WHERE ... AND <extra conditions>
            if since_iso:
                _where_and = "WHERE timestamp >= ?" + _source_filter + " AND"
            else:
                _where_and = "WHERE (1=1)" + _source_filter + " AND"

            time_clause_inq = " WHERE created_at >= ?" if since_iso else ""
            params_inq = [since_iso] if since_iso else []

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            # 1. Traffic Metrics
            c.execute(f"SELECT COUNT(*) FROM analytics_events {time_clause_ae}", params_ae)
            total_views = c.fetchone()[0]

            c.execute(f"SELECT COUNT(DISTINCT ip_hash) FROM analytics_events {time_clause_ae}", params_ae)
            unique_visitors = c.fetchone()[0]

            # Live active visitors in last 15 minutes (900 seconds)
            now_epoch = time.time()
            with METRICS_LOCK:
                stale_sessions = [s for s, t in ACTIVE_SESSIONS.items() if now_epoch - t > 900]
                for s in stale_sessions:
                    del ACTIVE_SESSIONS[s]
                active_visitors_mem = len(ACTIVE_SESSIONS)

            fifteen_min_ago = (now_utc - timedelta(minutes=15)).isoformat()
            c.execute("SELECT COUNT(DISTINCT ip_hash) FROM analytics_events WHERE timestamp >= ?", (fifteen_min_ago,))
            recent_db_active = c.fetchone()[0]
            active_visitors = max(active_visitors_mem, recent_db_active)

            # Device Breakdown
            c.execute(f"SELECT device, COUNT(*) FROM analytics_events {time_clause_ae} GROUP BY device", params_ae)
            device_counts = {r[0]: r[1] for r in c.fetchall() if r[0]}

            # Browser Breakdown
            c.execute(f"SELECT browser, COUNT(*) FROM analytics_events {time_clause_ae} GROUP BY browser", params_ae)
            browser_counts = {r[0]: r[1] for r in c.fetchall() if r[0]}

            # OS Breakdown
            c.execute(f"SELECT os, COUNT(*) FROM analytics_events {time_clause_ae} GROUP BY os", params_ae)
            os_counts = {r[0]: r[1] for r in c.fetchall() if r[0]}

            # Top Visited Pages
            c.execute(f"SELECT path, COUNT(*) as cnt FROM analytics_events {time_clause_ae} GROUP BY path ORDER BY cnt DESC LIMIT 8", params_ae)
            top_pages = [{"path": r[0], "views": r[1]} for r in c.fetchall()]

            # Timeline
            c.execute(f"""
                SELECT substr(timestamp, 1, 10) as day, COUNT(*) 
                FROM analytics_events 
                {time_clause_ae} 
                GROUP BY day 
                ORDER BY day DESC LIMIT 14
            """, params_ae)
            timeline = [{"date": r[0], "views": r[1]} for r in c.fetchall()]

            # Bounce Rate (sessions with single event / total sessions)
            _bounce_where = "WHERE session_id != ''" + _source_filter
            if since_iso:
                _bounce_where = "WHERE timestamp >= ? AND session_id != ''" + _source_filter
            b_query = f"""
                SELECT COUNT(*) FROM (
                    SELECT session_id, COUNT(*) as cnt 
                    FROM analytics_events 
                    {_bounce_where}
                    GROUP BY session_id 
                    HAVING cnt = 1
                )
            """
            c.execute(b_query, params_ae)
            bounced_sessions = c.fetchone()[0]

            tot_query = f"""
                SELECT COUNT(DISTINCT session_id) 
                FROM analytics_events 
                {_bounce_where}
            """
            c.execute(tot_query, params_ae)
            total_sessions = c.fetchone()[0]
            bounce_rate_pct = round((bounced_sessions / max(total_sessions, 1)) * 100, 1) if total_sessions > 0 else 0.0

            # 2. Approximate Visitor Geography
            _geo_where = "WHERE country != '' AND country != 'Unknown'" + _source_filter
            if since_iso:
                _geo_where = "WHERE timestamp >= ? AND country != '' AND country != 'Unknown'" + _source_filter
            c.execute(f"""
                SELECT country, COUNT(*) as cnt 
                FROM analytics_events 
                {_geo_where}
                GROUP BY country 
                ORDER BY cnt DESC LIMIT 10
            """, params_ae)
            geo_rows = c.fetchall()
            approx_geo = [
                {
                    "country": r[0],
                    "views": r[1],
                    "pct": round((r[1] / max(total_views, 1)) * 100, 1)
                } for r in geo_rows
            ]

            # 3. Lead Sources & Attribution
            c.execute(f"""
                SELECT referrer, utm_source, utm_medium, COUNT(*) as cnt 
                FROM analytics_events 
                {time_clause_ae} 
                GROUP BY referrer, utm_source, utm_medium
            """, params_ae)
            source_counts = {
                "Direct": 0,
                "Google Search": 0,
                "Google Ads": 0,
                "Organic Search": 0,
                "Social Media": 0,
                "Referral": 0,
                "WhatsApp": 0,
                "Campaign": 0
            }
            for ref, utm_s, utm_m, cnt in c.fetchall():
                cat = categorize_lead_source(ref, utm_s, utm_m)
                source_counts[cat] = source_counts.get(cat, 0) + cnt

            c.execute(f"SELECT lead_source, COUNT(*) FROM inquiries {time_clause_inq} GROUP BY lead_source", params_inq)
            inq_by_source = {r[0]: r[1] for r in c.fetchall()}

            lead_sources_list = []
            for cat, visits in sorted(source_counts.items(), key=lambda x: x[1], reverse=True):
                lead_sources_list.append({
                    "source": cat,
                    "visits": visits,
                    "inquiries": inq_by_source.get(cat, 0),
                    "pct_traffic": round((visits / max(total_views, 1)) * 100, 1)
                })

            # 4. Product Engagement & Conversion Rates
            catalog_products = [
                {"id": "single-girder-eot", "name": "Single Girder EOT Crane"},
                {"id": "double-girder-eot", "name": "Double Girder EOT Crane"},
                {"id": "gantry-crane", "name": "Gantry Crane"},
                {"id": "jib-crane", "name": "Jib Crane"},
                {"id": "electric-hoist", "name": "Electric Wire Rope Hoist"},
                {"id": "crane-components", "name": "Crane Kits & Components"}
            ]

            products_data = []
            for prod in catalog_products:
                p_name = prod["name"]
                p_id = prod["id"]

                # Views
                c.execute(f"""
                    SELECT COUNT(*) FROM analytics_events 
                    {_where_and}
                    (product_name LIKE ? OR product_id LIKE ? OR path LIKE ?)
                """, params_ae + [f"%{p_name}%", f"%{p_id}%", f"%{p_id}%"])
                p_views = c.fetchone()[0]

                # 360/3D Viewer Opens
                c.execute(f"""
                    SELECT COUNT(*) FROM analytics_events 
                    {_where_and}
                    event_type = 'viewer_open' AND 
                    (product_name LIKE ? OR product_id LIKE ? OR path LIKE ?)
                """, params_ae + [f"%{p_name}%", f"%{p_id}%", f"%{p_id}%"])
                p_viewers = c.fetchone()[0]

                # Brochure Downloads
                c.execute(f"""
                    SELECT COUNT(*) FROM analytics_events 
                    {_where_and}
                    event_type = 'brochure_click' AND 
                    (product_name LIKE ? OR product_id LIKE ? OR path LIKE ?)
                """, params_ae + [f"%{p_name}%", f"%{p_id}%", f"%{p_id}%"])
                p_brochures = c.fetchone()[0]

                # Quote CTA Clicks
                c.execute(f"""
                    SELECT COUNT(*) FROM analytics_events 
                    {_where_and}
                    event_type = 'quote_click' AND 
                    (product_name LIKE ? OR product_id LIKE ? OR path LIKE ?)
                """, params_ae + [f"%{p_name}%", f"%{p_id}%", f"%{p_id}%"])
                p_quotes = c.fetchone()[0]

                # Inquiries matching product
                c.execute(f"""
                    SELECT COUNT(*) FROM inquiries 
                    {"WHERE" if not time_clause_inq else "WHERE created_at >= ? AND"}
                    (equipment_type LIKE ? OR product_context LIKE ? OR subject LIKE ?)
                """, params_inq + [f"%{p_name}%", f"%{p_name}%", f"%{p_name}%"])
                p_inqs = c.fetchone()[0]

                products_data.append({
                    "id": p_id,
                    "product_id": p_id,
                    "name": p_name,
                    "product_name": p_name,
                    "views": p_views,
                    "page_views": p_views,
                    "viewer_opens": p_viewers,
                    "brochure_clicks": p_brochures,
                    "brochure_downloads": p_brochures,
                    "quote_clicks": p_quotes,
                    "quote_cta_clicks": p_quotes,
                    "inquiries": p_inqs,
                    "inquiries_generated": p_inqs,
                    "conversion_rate_pct": round((p_inqs / max(p_views, 1)) * 100, 1)
                })

            # 5. Service Engagement
            catalog_services = [
                {"id": "crane-amc", "name": "Crane Maintenance & AMC"},
                {"id": "crane-modernization", "name": "Modernization & Retrofitting"},
                {"id": "crane-fabrication", "name": "Custom Crane Fabrication"},
                {"id": "load-testing", "name": "Inspection & Load Testing"}
            ]
            services_data = []
            for srv in catalog_services:
                s_name = srv["name"]
                s_id = srv["id"]

                c.execute(f"""
                    SELECT COUNT(*) FROM analytics_events 
                    {_where_and}
                    (service_name LIKE ? OR service_id LIKE ? OR path LIKE ?)
                """, params_ae + [f"%{s_name}%", f"%{s_id}%", f"%{s_id}%"])
                s_views = c.fetchone()[0]

                c.execute(f"""
                    SELECT COUNT(*) FROM inquiries 
                    {"WHERE" if not time_clause_inq else "WHERE created_at >= ? AND"}
                    (service_type LIKE ? OR service_context LIKE ? OR subject LIKE ?)
                """, params_inq + [f"%{s_name}%", f"%{s_name}%", f"%{s_name}%"])
                s_inqs = c.fetchone()[0]

                services_data.append({
                    "id": s_id,
                    "service_id": s_id,
                    "name": s_name,
                    "service_name": s_name,
                    "views": s_views,
                    "inquiries": s_inqs,
                    "inquiries_generated": s_inqs,
                    "conversion_rate_pct": round((s_inqs / max(s_views, 1)) * 100, 1)
                })

            # 6. 9-Stage Inquiry Funnel
            c.execute(f"SELECT COUNT(*) FROM inquiries {time_clause_inq}", params_inq)
            period_inquiries = c.fetchone()[0]

            stage1_count = max(unique_visitors, period_inquiries, 1)

            c.execute(f"""
                SELECT COUNT(DISTINCT ip_hash) FROM analytics_events 
                {_where_and}
                (product_name != '' OR service_name != '' OR path LIKE '%product%' OR path LIKE '%service%')
            """, params_ae)
            stage2_count = min(stage1_count, max(c.fetchone()[0], period_inquiries))

            c.execute(f"""
                SELECT COUNT(DISTINCT ip_hash) FROM analytics_events 
                {_where_and}
                event_type IN ('quote_click', 'contact_click', 'brochure_click')
            """, params_ae)
            stage3_count = min(stage2_count, max(c.fetchone()[0], period_inquiries))

            c.execute(f"""
                SELECT COUNT(DISTINCT ip_hash) FROM analytics_events 
                {_where_and}
                event_type = 'inquiry_start'
            """, params_ae)
            stage4_count = min(stage3_count, max(c.fetchone()[0], period_inquiries))

            stage5_count = period_inquiries

            c.execute(f"""
                SELECT COUNT(*) FROM inquiries 
                {"WHERE" if not time_clause_inq else "WHERE created_at >= ? AND"}
                status IN ('Contacted', 'Quoted', 'In Progress', 'Completed', 'Closed')
            """, params_inq)
            stage6_count = c.fetchone()[0]

            c.execute(f"""
                SELECT COUNT(*) FROM inquiries 
                {"WHERE" if not time_clause_inq else "WHERE created_at >= ? AND"}
                status IN ('Quoted', 'In Progress', 'Completed', 'Closed')
            """, params_inq)
            stage7_count = c.fetchone()[0]

            c.execute(f"""
                SELECT COUNT(*) FROM inquiries 
                {"WHERE" if not time_clause_inq else "WHERE created_at >= ? AND"}
                status IN ('In Progress', 'Completed', 'Closed')
            """, params_inq)
            stage8_count = c.fetchone()[0]

            c.execute(f"""
                SELECT COUNT(*) FROM inquiries 
                {"WHERE" if not time_clause_inq else "WHERE created_at >= ? AND"}
                status IN ('Completed', 'Closed')
            """, params_inq)
            stage9_count = c.fetchone()[0]

            stages_raw = [
                (1, "Visitor", stage1_count),
                (2, "Product / Service Viewed", stage2_count),
                (3, "CTA Clicked", stage3_count),
                (4, "Inquiry Form Started", stage4_count),
                (5, "Inquiry Submitted (Lead)", stage5_count),
                (6, "Contacted", stage6_count),
                (7, "Quoted", stage7_count),
                (8, "In Progress", stage8_count),
                (9, "Completed / Closed", stage9_count)
            ]

            funnel_list = []
            prev_val = stage1_count
            for s_num, s_name, s_cnt in stages_raw:
                pct_vis = round((s_cnt / max(stage1_count, 1)) * 100, 1)
                drop = round(((prev_val - s_cnt) / max(prev_val, 1)) * 100, 1) if prev_val > 0 else 0.0
                funnel_list.append({
                    "stage": s_num,
                    "name": s_name,
                    "count": s_cnt,
                    "pct_of_visitors": pct_vis,
                    "pct_of_top": pct_vis,
                    "pct_of_prev": round((s_cnt / max(prev_val, 1)) * 100, 1),
                    "drop_off_pct": max(drop, 0.0),
                    "dropoff_pct": max(drop, 0.0)
                })
                prev_val = s_cnt

            conn.close()

            conversion_rate = round((period_inquiries / max(unique_visitors, 1)) * 100, 1)

            return {
                "success": True,
                "period": period,
                "total_views": total_views,
                "unique_visitors": unique_visitors,
                "active_visitors": active_visitors,
                "active_visitors_15m": active_visitors,
                "bounce_rate_pct": bounce_rate_pct,
                "conversion_rate_pct": conversion_rate,
                "devices": device_counts,
                "browsers": browser_counts,
                "os": os_counts,
                "operating_systems": os_counts,
                "top_pages": top_pages,
                "timeline": timeline,
                "approx_geo": approx_geo,
                "lead_sources": lead_sources_list,
                "products": products_data,
                "product_engagement": products_data,
                "services": services_data,
                "service_interest": services_data,
                "funnel": {
                    "stages": funnel_list,
                    "total_visitors": stage1_count,
                    "total_inquiries": period_inquiries,
                    "overall_conversion_pct": conversion_rate
                },
                "funnel_stages": funnel_list
            }
        except Exception as e:
            return {
                "success": False,
                "error": sanitize_text(str(e)),
                "period": period,
                "total_views": 0,
                "unique_visitors": 0,
                "active_visitors": 0,
                "bounce_rate_pct": 0,
                "conversion_rate_pct": 0,
                "devices": {},
                "browsers": {},
                "os": {},
                "top_pages": [],
                "timeline": [],
                "approx_geo": [],
                "lead_sources": [],
                "products": [],
                "services": [],
                "funnel": []
            }

    def get_analytics_health(self) -> dict:
        uptime_seconds = round(time.time() - SERVER_START_TIME, 1)
        hours = int(uptime_seconds // 3600)
        minutes = int((uptime_seconds % 3600) // 60)
        seconds = int(uptime_seconds % 60)
        uptime_str = f"{hours}h {minutes}m {seconds}s"

        db_stat = self.get_db_status()
        mongo_ping = db_stat.get("mongo", {}).get("latency_ms", "N/A")

        with METRICS_LOCK:
            samples = list(API_LATENCY_SAMPLES)
            avg_lat = round(sum(samples) / max(len(samples), 1), 1) if samples else 0.0
            sorted_samples = sorted(samples)
            p95_lat = sorted_samples[int(len(sorted_samples) * 0.95)] if sorted_samples else avg_lat
            errors_copy = list(RECENT_ERRORS)
            http_copy = dict(HTTP_METRICS)

        # Operational status: UP, DEGRADED, DOWN
        err_rate = (http_copy.get("5xx", 0) / max(TOTAL_REQUESTS, 1))
        if not self.mongo_connected or err_rate >= 0.05:
            overall_status = "DEGRADED"
        else:
            overall_status = "UP"

        alerts_all = self.get_alerts(status="all", limit=20)
        unresolved_alerts = [a for a in alerts_all if a.get("status") == "unresolved"]
        severity_counts = {
            "CRITICAL": sum(1 for a in unresolved_alerts if a.get("severity") == "CRITICAL"),
            "HIGH": sum(1 for a in unresolved_alerts if a.get("severity") == "HIGH"),
            "MEDIUM": sum(1 for a in unresolved_alerts if a.get("severity") == "MEDIUM"),
            "INFO": sum(1 for a in unresolved_alerts if a.get("severity") == "INFO"),
            "total_unresolved": len(unresolved_alerts)
        }

        return {
            "success": True,
            "status": overall_status,
            "api_health": overall_status,
            "server": {
                "status": overall_status,
                "uptime_seconds": uptime_seconds,
                "uptime_human": uptime_str,
                "total_requests": TOTAL_REQUESTS,
                "port": PORT,
                "start_time": datetime.fromtimestamp(SERVER_START_TIME, tz=timezone.utc).isoformat()
            },
            "latency": {
                "avg_ms": avg_lat,
                "p95_ms": p95_lat,
                "samples": len(samples)
            },
            "latency_ms": {
                "avg": avg_lat,
                "p95": p95_lat,
                "samples": len(samples)
            },
            "http_metrics": {
                "2xx": http_copy.get("2xx", 0),
                "3xx": http_copy.get("3xx", 0),
                "4xx": http_copy.get("4xx", 0),
                "5xx": http_copy.get("5xx", 0),
                "total": TOTAL_REQUESTS
            },
            "http_requests": {
                "2xx": http_copy.get("2xx", 0),
                "3xx": http_copy.get("3xx", 0),
                "4xx": http_copy.get("4xx", 0),
                "5xx": http_copy.get("5xx", 0),
                "total": TOTAL_REQUESTS,
                "by_status_class": {
                    "2xx": http_copy.get("2xx", 0),
                    "3xx": http_copy.get("3xx", 0),
                    "4xx": http_copy.get("4xx", 0),
                    "5xx": http_copy.get("5xx", 0)
                },
                "error_rate_pct": round(err_rate * 100, 2)
            },
            "database": {
                "primary": db_stat.get("database"),
                "status": "ONLINE" if self.mongo_connected else "FALLBACK",
                "connected": self.mongo_connected,
                "target_db": MONGODB_DB_NAME,
                "latency_ms": mongo_ping,
                "error": sanitize_text(self.mongo_error) if self.mongo_error else None
            },
            "smtp": check_smtp_health(),
            "active_alerts_count": len(unresolved_alerts),
            "recent_errors": errors_copy[-20:],
            "alerts": {
                "counts": severity_counts,
                "recent": unresolved_alerts[:10]
            }
        }

    # --- CMS Operations ---
    def get_cms_content(self, section: str = None):
        data = {}
        if os.path.exists(CMS_FILE):
            try:
                with open(CMS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}

        # If MongoDB connected, attempt to read section collection
        if self.mongo_connected and self.mongo_db is not None and section:
            col_name = f"cms_{section}"
            try:
                if col_name in self.mongo_db.list_collection_names():
                    docs = list(self.mongo_db[col_name].find({}, {"_id": 0}))
                    if docs:
                        if section in ["contact", "catalog"]:
                            return docs[0]
                        return docs
            except Exception:
                pass

        if section:
            return data.get(section, [] if section not in ["contact", "catalog"] else {})
        return data

    def update_cms_content(self, section: str, payload: any):
        data = self.get_cms_content()
        data[section] = payload
        with open(CMS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        # Sync to MongoDB collection
        if self.mongo_connected and self.mongo_db is not None:
            col_name = f"cms_{section}"
            try:
                col = self.mongo_db[col_name]
                col.delete_many({})
                if isinstance(payload, list):
                    if payload:
                        col.insert_many(payload)
                elif isinstance(payload, dict):
                    col.insert_one(payload)
            except Exception as e:
                print(f"MongoDB CMS sync note: {e}")
        return data[section]

db_manager = DatabaseManager()

# Module-level convenience wrappers for alerts
def record_alert(severity: str, category: str, title: str, message: str) -> str:
    res = db_manager.record_alert(severity, category, title, message)
    return res.get("id") if isinstance(res, dict) else str(res)

def get_alerts(status: str = "all", limit: int = 50, resolved_filter: any = None) -> list:
    return db_manager.get_alerts(status=status, limit=limit, resolved_filter=resolved_filter)

def resolve_alert(alert_id: str) -> bool:
    return db_manager.resolve_alert(alert_id)

def resolve_all_alerts() -> int:
    return db_manager.resolve_all_alerts()

# -------------------------------------------------------------
# 4. EMAIL NOTIFICATION SERVICE (SMTP)
# -------------------------------------------------------------
def send_email_notification_async(inquiry: dict):
    def _worker():
        inquiry_id = inquiry.get("id")
        if not SMTP_USER or not SMTP_PASS:
            print(f"[Email Notice] SMTP credentials not configured in .env (SMTP_PASS is empty). Email alert skipped.", flush=True)
            print(f"  → Inbound lead received & safely stored in MongoDB: {inquiry_id} — {inquiry.get('name')} ({inquiry.get('email') or inquiry.get('phone')})", flush=True)
            db_manager.update_inquiry_email_status(inquiry_id, "Not Configured")
            return

        inquiry_type = inquiry.get("equipment_type") or inquiry.get("service_type") or inquiry.get("subject") or "Website Lead"
        customer_name = inquiry.get("name") or "Prospective Client"

        try:
            msg = EmailMessage()
            msg["Subject"] = f"New Website Inquiry — {inquiry_type} — {customer_name}"
            msg["From"] = f"VS Infra Cranes System <{SMTP_USER}>"
            msg["To"] = NOTIFICATION_EMAIL

            # Plain text body
            text_body = f"""New Customer Inquiry Received on VS Infra & Cranes:

Inquiry ID: {inquiry.get('id')}
Date/Time: {inquiry.get('created_at')}
Source: {inquiry.get('source_page')}

Customer Details:
- Name: {customer_name}
- Company: {inquiry.get('company', 'N/A')}
- Email: {inquiry.get('email', 'N/A')}
- Phone: {inquiry.get('phone', 'N/A')}
- Location: {inquiry.get('location', 'N/A')}

Requirement Details:
- Equipment / Service: {inquiry_type}
- Capacity: {inquiry.get('capacity', 'N/A')}
- Span / Lift: {inquiry.get('span', 'N/A')} / {inquiry.get('lift', 'N/A')}
- Duty Class: {inquiry.get('duty_class', 'N/A')}

Message:
{inquiry.get('message', 'No message provided.')}

Open Admin Portal to manage this lead:
{BASE_URL}/admin.html
"""
            msg.set_content(text_body)

            # Rich HTML body
            html_body = f"""<!DOCTYPE html>
<html>
<head>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 20px; }}
    .box {{ max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }}
    .head {{ background: linear-gradient(135deg, #1A1A2E 0%, #2d1607 100%); color: #ffffff; padding: 24px; text-align: center; border-bottom: 3px solid #E8630A; }}
    .head h2 {{ margin: 0 0 6px 0; font-size: 20px; letter-spacing: 0.5px; }}
    .head p {{ margin: 0; font-size: 13px; opacity: 0.8; }}
    .content {{ padding: 24px; }}
    .field-table {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px; }}
    .field-table td {{ padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }}
    .field-label {{ font-weight: 600; color: #64748b; width: 35%; }}
    .field-val {{ color: #1e293b; font-weight: 500; }}
    .message-box {{ background: #f8fafc; border-left: 4px solid #E8630A; padding: 12px 16px; border-radius: 4px; font-size: 13.5px; color: #334155; margin-bottom: 24px; line-height: 1.5; }}
    .btn-wrap {{ text-align: center; padding: 12px 0 20px; }}
    .btn {{ display: inline-block; background: #E8630A; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 14px; box-shadow: 0 3px 8px rgba(232,99,10,0.3); }}
    .footer {{ font-size: 11px; color: #94a3b8; text-align: center; padding: 16px; border-top: 1px solid #f1f5f9; }}
  </style>
</head>
<body>
  <div class="box">
    <div class="head">
      <h2>VS INFRA &amp; CRANES</h2>
      <p>New Website Lead Notification</p>
    </div>
    <div class="content">
      <table class="field-table">
        <tr><td class="field-label">Customer Name</td><td class="field-val"><strong>{customer_name}</strong></td></tr>
        <tr><td class="field-label">Company</td><td class="field-val">{inquiry.get('company') or '—'}</td></tr>
        <tr><td class="field-label">Email</td><td class="field-val"><a href="mailto:{inquiry.get('email')}" style="color:#E8630A;">{inquiry.get('email') or '—'}</a></td></tr>
        <tr><td class="field-label">Phone</td><td class="field-val"><a href="tel:{inquiry.get('phone')}" style="color:#1e293b;">{inquiry.get('phone') or '—'}</a></td></tr>
        <tr><td class="field-label">Equipment / Service</td><td class="field-val" style="color:#E8630A; font-weight:700;">{inquiry_type}</td></tr>
        <tr><td class="field-label">Capacity / Specs</td><td class="field-val">Cap: {inquiry.get('capacity') or '—'} | Span: {inquiry.get('span') or '—'}</td></tr>
        <tr><td class="field-label">Location</td><td class="field-val">{inquiry.get('location') or '—'}</td></tr>
        <tr><td class="field-label">Inquiry ID</td><td class="field-val"><code>{inquiry.get('id')}</code></td></tr>
      </table>

      <div style="font-size:12px; font-weight:600; text-transform:uppercase; color:#64748b; margin-bottom:6px;">Customer Requirement / Message:</div>
      <div class="message-box">
        {inquiry.get('message') or 'No custom message provided.'}
      </div>

      <div class="btn-wrap">
        <a href="{BASE_URL}/admin.html" class="btn" target="_blank">Open Admin Portal →</a>
      </div>
    </div>
    <div class="footer">
      Automated dispatch from VS Infra &amp; Cranes Backend Engine. Data safely preserved in MongoDB Atlas.
    </div>
  </div>
</body>
</html>"""
            msg.add_alternative(html_body, subtype="html")

            # Retry logic for transient SMTP errors (up to 3 attempts with backoff)
            max_attempts = 3
            last_error = None
            for attempt in range(1, max_attempts + 1):
                try:
                    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
                        server.starttls()
                        server.login(SMTP_USER, SMTP_PASS)
                        server.send_message(msg)
                    print(f"[Email Notification] Alert sent successfully to {NOTIFICATION_EMAIL} for inquiry {inquiry_id}", flush=True)
                    db_manager.update_inquiry_email_status(inquiry_id, "Sent")
                    return
                except Exception as err:
                    last_error = err
                    print(f"[Email Notification Warning] Attempt {attempt}/{max_attempts} failed: {err}", flush=True)
                    if attempt < max_attempts:
                        time.sleep(2 * attempt)

            # All attempts failed: record Failure server-side without affecting inquiry data
            print(f"[Email Notification FAILED] Could not deliver email for inquiry {inquiry_id}: {last_error}", flush=True)
            db_manager.update_inquiry_email_status(inquiry_id, "Failed", error_msg=str(last_error))
        except Exception as outer_err:
            print(f"[Email Notification Error] Unexpected error in email worker: {outer_err}", flush=True)
            db_manager.update_inquiry_email_status(inquiry_id, "Failed", error_msg=str(outer_err))

    # Dispatch in a background daemon thread
    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()

# -------------------------------------------------------------
# 5. CSV EXPORT UTILITY
# -------------------------------------------------------------
def generate_inquiries_csv(inquiries: list) -> str:
    headers = [
        "Inquiry ID", "Date & Time", "Customer Name", "Company", "Email", "Phone",
        "Subject", "Service Type", "Equipment Type", "Capacity", "Span", "Lift",
        "Duty Class", "Location", "Message", "Status", "Priority", "Admin Notes",
        "Follow-up Date", "Source Page", "Lead Acquisition Channel", "Initial Referrer", "Landing Page",
        "UTM Source", "UTM Medium", "UTM Campaign", "Product Context", "Approx Country", "Approx City", "Approx Geo",
        "Device", "Browser", "OS"
    ]
    import io
    import csv
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    writer.writerow(headers)
    for inq in inquiries:
        writer.writerow([
            inq.get("id", ""),
            inq.get("created_at", ""),
            inq.get("name", ""),
            inq.get("company", ""),
            inq.get("email", ""),
            inq.get("phone", ""),
            inq.get("subject", ""),
            inq.get("service_type", ""),
            inq.get("equipment_type", ""),
            inq.get("capacity", ""),
            inq.get("span", ""),
            inq.get("lift", ""),
            inq.get("duty_class", ""),
            inq.get("location", ""),
            (inq.get("message", "") or "").replace("\r", " ").replace("\n", " "),
            inq.get("status", ""),
            inq.get("priority", "Normal"),
            (inq.get("admin_notes", "") or "").replace("\r", " ").replace("\n", " "),
            inq.get("follow_up_date", ""),
            inq.get("source_page", ""),
            inq.get("lead_source", "Direct"),
            inq.get("referrer", ""),
            inq.get("landing_page", ""),
            inq.get("utm_source", ""),
            inq.get("utm_medium", ""),
            inq.get("utm_campaign", ""),
            inq.get("product_context", ""),
            inq.get("approx_country", ""),
            inq.get("approx_city", ""),
            inq.get("approx_geo", ""),
            inq.get("device", ""),
            inq.get("browser", ""),
            inq.get("os", "")
        ])
    return output.getvalue()

# -------------------------------------------------------------
# 6. HTTP REQUEST HANDLER WITH HARDENED SECURITY
# -------------------------------------------------------------
class AppRequestHandler(SimpleHTTPRequestHandler):

    def send_security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        headers = getattr(self, "headers", None)
        if headers and is_request_https(headers):
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")

        # Content Security Policy configured strictly for site's dependencies
        csp = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.cartocdn.com https://server.arcgisonline.com https://*.arcgisonline.com https://raw.githubusercontent.com https://cdnjs.cloudflare.com; "
            "media-src 'self' data: blob:; "
            "connect-src 'self' https://*.tile.openstreetmap.org https://*.cartocdn.com https://server.arcgisonline.com https://*.arcgisonline.com; "
            "frame-src 'self' https://www.google.com https://maps.google.com; "
            "frame-ancestors 'self'; "
            "worker-src 'self' blob:; "
            "object-src 'none';"
        )
        self.send_header("Content-Security-Policy", csp)

    def end_headers(self):
        self.send_security_headers()
        super().end_headers()

    def do_HEAD(self):
        self._req_start_time = time.time()
        parsed = urlparse(self.path)
        path = parsed.path
        if not path.startswith("/api/") and not is_safe_static_path(path):
            self.send_error(404, "File not found")
            return
        super().do_HEAD()

    def send_json(self, status_code: int, data: dict, cookies: list = None):
        t0 = getattr(self, "_req_start_time", None)
        if t0 is not None:
            lat = (time.time() - t0) * 1000
            record_http_metric(status_code, self.path, lat)

        response_bytes = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))

        origin = self.headers.get("Origin")
        if origin and is_allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            if origin != "null":
                self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")
        elif not self.path.startswith("/api/admin/"):
            self.send_header("Access-Control-Allow-Origin", "*")

        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        if cookies:
            for cookie in cookies:
                self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(response_bytes)

    def send_error(self, code, message=None, explain=None):
        t0 = getattr(self, "_req_start_time", None)
        if t0 is not None:
            lat = (time.time() - t0) * 1000
            record_http_metric(code, self.path, lat)
        record_app_error(self.path, getattr(self, "command", "GET"), code, message or f"HTTP {code}")
        if code == 404:
            try:
                custom_404 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "404.html")
                if os.path.exists(custom_404):
                    with open(custom_404, "rb") as f:
                        content = f.read()
                    self.send_response(404)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
                    return
            except Exception:
                pass
        super().send_error(code, message, explain)

    def do_OPTIONS(self):
        self.send_response(204)
        origin = self.headers.get("Origin")
        if origin and is_allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            if origin != "null":
                self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")
        else:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def get_client_ip(self) -> str:
        # Check standard reverse proxy headers in priority order
        for h in ("CF-Connecting-IP", "X-Real-IP", "X-Forwarded-For"):
            val = self.headers.get(h)
            if val:
                raw_ip = val.split(",")[0].strip()
                clean_ip = re.sub(r"[^0-9a-fA-F:.]", "", raw_ip)
                if clean_ip:
                    return clean_ip
        return getattr(self, "client_address", ("127.0.0.1", 0))[0]

    def get_auth_token(self) -> str:
        # 1. Check Authorization Bearer header
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header[7:].strip()
        # 2. Check Cookie header
        cookie_header = self.headers.get("Cookie", "")
        if cookie_header:
            for part in cookie_header.split(";"):
                part = part.strip()
                if part.startswith("vs_admin_token="):
                    return part.split("=", 1)[1].strip()
        return ""

    def is_authenticated(self) -> bool:
        token = self.get_auth_token()
        return verify_token(token)

    # ---------------------------------------------------------
    # GET ROUTER
    # ---------------------------------------------------------
    def do_GET(self):
        self._req_start_time = time.time()

        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # Static file security guard: Block attempts to access source, config, data files, or dotfiles
        if not path.startswith("/api/") and not is_safe_static_path(path):
            self.send_error(404, "File not found")
            return

        # 1. Health & Status Check (Public, non-sensitive)
        if path == "/api/health":
            if self.is_authenticated():
                self.send_json(200, {
                    "status": "ok",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "database": db_manager.get_db_status(),
                    "smtp": {
                        "configured": bool(SMTP_USER and SMTP_PASS),
                        "host": SMTP_HOST,
                        "port": SMTP_PORT
                    }
                })
            else:
                self.send_json(200, {
                    "status": "ok",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })
            return

        # 2. Public CMS Content API
        if path == "/api/content/certificates":
            all_certs = db_manager.get_cms_content("certificates")
            if self.is_authenticated():
                self.send_json(200, {"section": "certificates", "data": all_certs})
                return
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            public_certs = []
            for c in all_certs:
                if not c.get("is_public") or not c.get("file_url") or c.get("status") != "public":
                    continue
                exp = c.get("expiry_date", "")
                if exp and exp < today:
                    continue
                pub_copy = dict(c)
                pub_copy.pop("notes", None)
                public_certs.append(pub_copy)
            self.send_json(200, {"section": "certificates", "data": public_certs})
            return

        if path.startswith("/api/content/"):
            section = path.split("/api/content/")[1].strip("/").replace("-", "_")
            if section not in ALLOWED_CMS_SECTIONS:
                self.send_json(404, {"error": "Invalid content section"})
                return
            content = db_manager.get_cms_content(section)
            self.send_json(200, {"section": section, "data": content})
            return

        # 2b. Authenticated Admin CMS Content API
        if path.startswith("/api/admin/content/"):
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            section = path.split("/api/admin/content/")[1].strip("/").replace("-", "_")
            if section not in ALLOWED_CMS_SECTIONS:
                self.send_json(404, {"error": "Invalid content section"})
                return
            content = db_manager.get_cms_content(section)
            self.send_json(200, {"section": section, "data": content})
            return

        # 3. Admin System & Database Status
        if path == "/api/admin/system-status":
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            status_data = db_manager.get_db_status()
            status_data["smtp"] = check_smtp_health()
            self.send_json(200, status_data)
            return

        # 4. Admin SMTP Test
        if path == "/api/admin/smtp-test":
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            smtp_result = check_smtp_health()
            self.send_json(200, smtp_result)
            return

        # 5. Admin Stats
        if path == "/api/admin/stats":
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            stats = db_manager.get_stats()
            self.send_json(200, stats)
            return

        # 5a. Admin Analytics Summary
        if path == "/api/admin/analytics/summary":
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            period = query.get("period", ["7d"])[0]
            summary = db_manager.get_analytics_summary(period=period)
            self.send_json(200, summary)
            return

        # 5b. Admin Server & Service Health
        if path == "/api/admin/analytics/health":
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            health = db_manager.get_analytics_health()
            self.send_json(200, health)
            return

        # 5c. Admin Operational Alerts
        if path == "/api/admin/alerts":
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            status_filter = query.get("status", ["all"])[0]
            alerts = db_manager.get_alerts(status=status_filter)
            self.send_json(200, {"success": True, "alerts": alerts})
            return

        # 6. Export Inquiries CSV
        if path == "/api/admin/inquiries/export":
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            inquiries = db_manager.get_inquiries()
            csv_data = generate_inquiries_csv(inquiries).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="vs_infra_cranes_inquiries.csv"')
            self.send_header("Content-Length", str(len(csv_data)))
            origin = self.headers.get("Origin")
            if origin and is_allowed_origin(origin):
                self.send_header("Access-Control-Allow-Origin", origin)
                if origin != "null":
                    self.send_header("Access-Control-Allow-Credentials", "true")
                self.send_header("Vary", "Origin")
            self.send_security_headers()
            self.end_headers()
            self.wfile.write(csv_data)
            return

        # 7. Admin Inquiries List
        if path == "/api/admin/inquiries":
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return

            search = query.get("search", [""])[0]
            filter_type = query.get("type", ["all"])[0]
            filter_status = query.get("status", ["all"])[0]
            filter_priority = query.get("priority", ["all"])[0]

            inquiries = db_manager.get_inquiries(
                search=search,
                filter_type=filter_type,
                filter_status=filter_status,
                filter_priority=filter_priority
            )
            self.send_json(200, {
                "total": len(inquiries),
                "inquiries": inquiries,
                "data": inquiries
            })
            return

        # 8. Single Inquiry Details
        if path.startswith("/api/admin/inquiries/") and not path.endswith("/status"):
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            inq_id = path.split("/api/admin/inquiries/")[1].strip("/")
            inq = db_manager.get_inquiry_by_id(inq_id)
            if inq:
                self.send_json(200, {"data": inq, "inquiry": inq})
            else:
                self.send_json(404, {"error": "Inquiry record not found"})
            return

        # Record anonymous page view for HTML requests (Privacy preserving)
        if not path.startswith("/api/") and (path == "/" or path.endswith(".html")):
            client_ip = self.get_client_ip()
            ua = self.headers.get("User-Agent", "")
            ref = self.headers.get("Referer", "")
            threading.Thread(
                target=db_manager.record_page_view,
                args=(path, client_ip, ua, ref),
                daemon=True
            ).start()

        # Static assets serving with latency measurement
        t0 = getattr(self, "_req_start_time", time.time())
        res = super().do_GET()
        lat = (time.time() - t0) * 1000
        record_http_metric(200, self.path, lat)
        return res


    # ---------------------------------------------------------
    # POST ROUTER
    # ---------------------------------------------------------
    def do_POST(self):
        self._req_start_time = time.time()

        parsed = urlparse(self.path)
        path = parsed.path
        client_ip = self.get_client_ip()

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > MAX_BODY_SIZE:
            self.send_json(413, {"error": "Payload too large. Maximum request size is 25 MB."})
            return

        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}

        # 0. Public Ingestion: Interaction & Analytics Event (Non-blocking & Rate-limited)
        if path == "/api/analytics/event":
            if is_analytics_rate_limited(client_ip):
                self.send_json(429, {"success": False, "error": "Analytics rate limit reached"})
                return
            try:
                geo = resolve_approx_geo(self.headers, payload)
                payload["client_ip"] = client_ip
                payload["user_agent"] = self.headers.get("User-Agent", "")
                payload["referrer"] = payload.get("referrer") or self.headers.get("Referer", "")
                payload["country"] = geo.get("country", "Unknown")
                payload["city"] = geo.get("city", "Unknown")
                threading.Thread(
                    target=db_manager.record_analytics_event,
                    args=(payload,),
                    daemon=True
                ).start()
            except Exception as e:
                pass
            self.send_json(200, {"success": True})
            return

        # CSRF check for state-changing admin POST requests
        if path.startswith("/api/admin/") and path not in ("/api/admin/login", "/api/admin/logout"):
            origin = self.headers.get("Origin")
            if origin and not is_allowed_origin(origin):
                print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Blocked cross-origin admin request from {origin} to {path}", flush=True)
                self.send_json(403, {"error": "Forbidden: Cross-origin request rejected."})
                return

        # 1. Admin Login (Timing-safe authentication & audit logging)
        if path == "/api/admin/login":
            if is_ip_rate_limited(client_ip):
                print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Rate-limited admin login attempt from IP: {client_ip}", flush=True)
                self.send_json(429, {
                    "success": False,
                    "error": f"Too many failed login attempts. Locked out for {LOGIN_LOCKOUT_MINUTES} minutes."
                })
                return

            email = str(payload.get("email", "")).strip().lower()
            password = str(payload.get("password", "")).strip()

            valid_email = hmac.compare_digest(email, ADMIN_EMAIL.lower())
            if valid_email:
                valid_pass = verify_password(password, ADMIN_PASS_HASH)
            else:
                verify_password("dummy_constant_time_comparison", ADMIN_PASS_HASH)
                valid_pass = False

            if valid_email and valid_pass:
                clear_login_attempts(client_ip)
                token = generate_token(ADMIN_EMAIL)
                is_https = is_request_https(self.headers)
                secure_flag = "; Secure" if is_https else ""
                cookie = f"vs_admin_token={token}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax{secure_flag}"
                print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Successful admin login from IP: {client_ip}", flush=True)
                self.send_json(200, {
                    "success": True,
                    "message": "Authentication successful",
                    "token": token,
                    "admin": {"role": "administrator"}
                }, cookies=[cookie])
            else:
                record_failed_login(client_ip)
                record_admin_auth_failure(client_ip)
                print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Failed admin login attempt for '{email[:3]}***' from IP: {client_ip}", flush=True)
                self.send_json(401, {"success": False, "error": "Invalid email or password."})
            return

        # 1b. Admin Bulk Alert Resolution
        if path == "/api/admin/alerts/resolve-all":
            if not self.is_authenticated():
                print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Unauthorized access blocked on {path} from IP: {client_ip}", flush=True)
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            count = db_manager.resolve_all_alerts()
            self.send_json(200, {"success": True, "resolved_count": count})
            return

        # 2. Admin Logout (Server-side session invalidation)
        if path == "/api/admin/logout":
            token = self.get_auth_token()
            if token:
                revoke_token(token)
            print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Admin logout from IP: {client_ip}", flush=True)
            cookie = "vs_admin_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
            self.send_json(200, {"success": True, "message": "Logged out successfully"}, cookies=[cookie])
            return

        # 3. Customer Inquiry / Lead Submission
        if path == "/api/inquiries":
            # API Rate-Limiting Protection (Max 10 submissions per IP per 5 min)
            if is_inquiry_rate_limited(client_ip):
                self.send_json(429, {
                    "success": False,
                    "error": "Too many requests. Please wait a few moments before submitting again."
                })
                return

            name = str(payload.get("name", "")).strip()
            email = str(payload.get("email", "")).strip().lower()
            phone = str(payload.get("phone", "")).strip()
            message = str(payload.get("message", "")).strip()

            # Server-side validation & sanitization
            if not name or len(name) < 2:
                self.send_json(400, {"success": False, "error": "Please provide a valid name (at least 2 characters)."})
                return
            if len(name) > 120:
                self.send_json(400, {"success": False, "error": "Name exceeds maximum length of 120 characters."})
                return
            if not email and not phone:
                self.send_json(400, {"success": False, "error": "Please provide either an email address or phone number."})
                return
            if email and not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", email):
                self.send_json(400, {"success": False, "error": "Please enter a valid email address."})
                return
            if phone and len(re.sub(r"[^\d+]", "", phone)) < 7:
                self.send_json(400, {"success": False, "error": "Please provide a valid phone number (at least 7 digits)."})
                return

            if len(message) > 5000:
                self.send_json(400, {"success": False, "error": "Message exceeds maximum length of 5000 characters."})
                return
            for aux_field in ("company", "location", "crane_type", "capacity", "span", "industry", "service_type"):
                if aux_field in payload:
                    val = str(payload[aux_field]).strip()
                    payload[aux_field] = val[:200]

            contact_key = email if email else phone

            # Accidental Duplicate Submission Prevention (Within 30s)
            duplicate_record = check_duplicate_submission(contact_key, message)
            if duplicate_record:
                self.send_json(200, {
                    "success": True,
                    "message": "Inquiry already received. Thank you!",
                    "inquiryId": duplicate_record["id"],
                    "inquiry": duplicate_record,
                    "data": duplicate_record
                })
                return

            record_inquiry_attempt(client_ip)

            # 1. Primary Store in Database (MongoDB Atlas primary, SQLite mirror)
            saved_record = db_manager.save_inquiry(payload)
            record_submission(contact_key, message, saved_record)

            # 2. Dispatch Asynchronous SMTP Notification with retry
            send_email_notification_async(saved_record)

            self.send_json(201, {
                "success": True,
                "message": "Inquiry successfully recorded in persistent database.",
                "inquiryId": saved_record["id"],
                "inquiry": saved_record,
                "data": saved_record
            })
            return

        # 4. Admin SMTP Test
        if path == "/api/admin/smtp-test":
            if not self.is_authenticated():
                print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Unauthorized access blocked on {path} from IP: {client_ip}", flush=True)
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            smtp_result = check_smtp_health()
            self.send_json(200, smtp_result)
            return

        # 4b. Admin Certificates & Registrations Management
        if path == "/api/admin/certificates/upload":
            if not self.is_authenticated():
                print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Unauthorized access blocked on {path} from IP: {client_ip}", flush=True)
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return

            if is_upload_rate_limited(client_ip):
                print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Upload rate limit reached for IP: {client_ip}", flush=True)
                self.send_json(429, {"error": "Upload rate limit reached. Please wait a few minutes."})
                return

            cert_id = str(payload.get("cert_id", "")).strip()
            file_name = str(payload.get("file_name", "")).strip()
            file_data = str(payload.get("file_data", "")).strip()

            if not file_name or not file_data:
                self.send_json(400, {"error": "Missing file name or file content data."})
                return

            clean_name = os.path.basename(file_name)
            ext = os.path.splitext(clean_name)[1].lower()
            allowed_exts = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}
            if ext not in allowed_exts:
                self.send_json(400, {"error": f"Invalid file extension '{ext}'. Allowed formats: PDF, JPG, JPEG, PNG, WEBP."})
                return

            if "," in file_data:
                file_data = file_data.split(",", 1)[1]

            try:
                raw_bytes = base64.b64decode(file_data)
            except Exception:
                self.send_json(400, {"error": "Corrupted or invalid base64 file data."})
                return

            MAX_CERT_SIZE = 15 * 1024 * 1024
            if len(raw_bytes) > MAX_CERT_SIZE:
                self.send_json(400, {"error": "File size exceeds 15 MB limit."})
                return
            if len(raw_bytes) < 10:
                self.send_json(400, {"error": "File content is empty or invalid."})
                return

            # Magic bytes security check
            valid_sig = False
            if ext == ".pdf" and raw_bytes.startswith(b"%PDF"):
                valid_sig = True
            elif ext in [".jpg", ".jpeg"] and raw_bytes.startswith(b"\xff\xd8\xff"):
                valid_sig = True
            elif ext == ".png" and raw_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
                valid_sig = True
            elif ext == ".webp" and raw_bytes.startswith(b"RIFF") and len(raw_bytes) >= 12 and raw_bytes[8:12] == b"WEBP":
                valid_sig = True

            if not valid_sig:
                print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Invalid file signature rejected for '{clean_name}' from IP: {client_ip}", flush=True)
                self.send_json(400, {"error": "File signature validation failed. File content does not match allowed format."})
                return

            os.makedirs(CERTIFICATES_DIR, exist_ok=True)
            safe_prefix = re.sub(r'[^a-zA-Z0-9_-]', '', cert_id) or "cert"
            file_hash = hashlib.sha256(raw_bytes).hexdigest()[:8]
            stored_filename = f"{safe_prefix}_{int(time.time())}_{file_hash}{ext}"
            dest_path = os.path.join(CERTIFICATES_DIR, stored_filename)

            # Prevent old orphan files
            certs = db_manager.get_cms_content("certificates")
            if not isinstance(certs, list):
                certs = []
            for c in certs:
                if c.get("id") == cert_id and c.get("file_url"):
                    old_path = os.path.join(ROOT_DIR, c["file_url"])
                    if os.path.exists(old_path) and CERTIFICATES_DIR in old_path:
                        try:
                            os.remove(old_path)
                        except Exception:
                            pass

            try:
                with open(dest_path, "wb") as f:
                    f.write(raw_bytes)
            except Exception as e:
                print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Storage error writing upload: {e}", flush=True)
                self.send_json(500, {"error": "Failed to save document on server due to a storage error."})
                return

            rel_url = f"assets/documents/certificates/{stored_filename}"
            updated_record = None
            for c in certs:
                if c.get("id") == cert_id:
                    c["file_url"] = rel_url
                    c["file_name"] = clean_name
                    c["file_size"] = len(raw_bytes)
                    c["file_type"] = ext.lstrip(".")
                    updated_record = c
                    break

            if not updated_record:
                updated_record = {
                    "id": cert_id or f"cert_{uuid.uuid4().hex[:8]}",
                    "doc_type": "Custom Certificate",
                    "title": clean_name,
                    "cert_number": "",
                    "issue_date": "",
                    "expiry_date": "",
                    "description": "",
                    "file_url": rel_url,
                    "file_name": clean_name,
                    "file_type": ext.lstrip("."),
                    "file_size": len(raw_bytes),
                    "status": "hidden",
                    "is_public": False,
                    "notes": ""
                }
                certs.append(updated_record)

            db_manager.update_cms_content("certificates", certs)
            self.send_json(200, {
                "success": True,
                "file_url": rel_url,
                "file_name": clean_name,
                "file_size": len(raw_bytes),
                "data": updated_record
            })
            return

        if path == "/api/admin/certificates/remove-file":
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            cert_id = payload.get("cert_id")
            certs = db_manager.get_cms_content("certificates")
            found = False
            for c in certs:
                if c.get("id") == cert_id:
                    found = True
                    if c.get("file_url"):
                        old_path = os.path.join(ROOT_DIR, c["file_url"])
                        if os.path.exists(old_path) and CERTIFICATES_DIR in old_path:
                            try:
                                os.remove(old_path)
                            except Exception:
                                pass
                    c["file_url"] = ""
                    c["file_name"] = ""
                    c["file_size"] = 0
                    c["file_type"] = ""
                    c["is_public"] = False
                    c["status"] = "hidden"
                    break
            if found:
                db_manager.update_cms_content("certificates", certs)
                self.send_json(200, {"success": True, "message": "Document file successfully removed."})
            else:
                self.send_json(404, {"error": "Certificate not found."})
            return

        if path == "/api/admin/certificates/toggle-status":
            if not self.is_authenticated():
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            cert_id = payload.get("cert_id")
            certs = db_manager.get_cms_content("certificates")
            target = None
            for c in certs:
                if c.get("id") == cert_id:
                    target = c
                    target["is_public"] = not target.get("is_public", False)
                    target["status"] = "public" if target["is_public"] else "hidden"
                    break
            if target:
                db_manager.update_cms_content("certificates", certs)
                self.send_json(200, {
                    "success": True,
                    "is_public": target["is_public"],
                    "status": target["status"]
                })
            else:
                self.send_json(404, {"error": "Certificate not found."})
            return

        # 5. CMS Add Item (/api/admin/content/<section>)
        if path.startswith("/api/admin/content/"):
            if not self.is_authenticated():
                print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Unauthorized access blocked on {path} from IP: {client_ip}", flush=True)
                self.send_json(401, {"error": "Unauthorized. Please log in."})
                return
            if is_admin_mutation_rate_limited(client_ip):
                self.send_json(429, {"error": "Admin mutation rate limit reached. Please wait."})
                return
            section = path.split("/api/admin/content/")[1].strip("/").replace("-", "_")
            if section not in ALLOWED_CMS_SECTIONS:
                self.send_json(400, {"error": "Invalid section name."})
                return
            current = db_manager.get_cms_content(section)
            if isinstance(current, list):
                if "id" not in payload:
                    payload["id"] = f"{section[:3]}_{uuid.uuid4().hex[:8]}"
                current.append(payload)
                db_manager.update_cms_content(section, current)
                self.send_json(201, {"success": True, "data": payload})
            elif isinstance(current, dict):
                current.update(payload)
                db_manager.update_cms_content(section, current)
                self.send_json(200, {"success": True, "data": current})
            else:
                self.send_json(400, {"error": "Invalid section type"})
            return

        self.send_json(404, {"error": "Endpoint not found"})

    # ---------------------------------------------------------
    # PATCH / PUT ROUTER
    # ---------------------------------------------------------
    def do_PATCH(self):
        self._handle_patch_or_put()

    def do_PUT(self):
        self._handle_patch_or_put()

    def _handle_patch_or_put(self):
        self._req_start_time = time.time()
        parsed = urlparse(self.path)
        path = parsed.path
        client_ip = self.get_client_ip()

        if not self.is_authenticated():
            print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Unauthorized access blocked on {path} from IP: {client_ip}", flush=True)
            self.send_json(401, {"error": "Unauthorized. Please log in."})
            return

        # CSRF check for state-changing admin requests
        origin = self.headers.get("Origin")
        if origin and not is_allowed_origin(origin):
            print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Blocked cross-origin admin request from {origin} to {path}", flush=True)
            self.send_json(403, {"error": "Forbidden: Cross-origin request rejected."})
            return

        if is_admin_mutation_rate_limited(client_ip):
            self.send_json(429, {"error": "Admin mutation rate limit reached. Please wait."})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > MAX_BODY_SIZE:
            self.send_json(413, {"error": "Payload too large. Maximum request size is 25 MB."})
            return

        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}

        # 1. Update Inquiry Status / Priority / Notes
        # Matches /api/admin/inquiries/<id> or /api/admin/inquiries/<id>/status
        if path.startswith("/api/admin/inquiries/"):
            clean_path = path.replace("/status", "")
            inquiry_id = clean_path.split("/api/admin/inquiries/")[1].strip("/")
            success = db_manager.update_inquiry(inquiry_id, payload)
            if success:
                self.send_json(200, {"success": True, "message": "Inquiry record updated successfully"})
            else:
                self.send_json(404, {"success": False, "error": "Inquiry not found or no valid changes"})
            return

        # 2. Update CMS Item (/api/admin/content/<section>/<id> or /api/admin/content/<section>)
        if path.startswith("/api/admin/content/"):
            parts = path.split("/api/admin/content/")[1].strip("/").split("/")
            section = parts[0].replace("-", "_")
            if section not in ALLOWED_CMS_SECTIONS:
                self.send_json(400, {"error": "Invalid section name."})
                return
            item_id = parts[1] if len(parts) > 1 else None

            current = db_manager.get_cms_content(section)
            if isinstance(current, list) and item_id:
                updated = False
                for idx, item in enumerate(current):
                    if item.get("id") == item_id:
                        current[idx].update(payload)
                        updated = True
                        break
                if updated:
                    db_manager.update_cms_content(section, current)
                    self.send_json(200, {"success": True, "message": "Content item updated"})
                else:
                    self.send_json(404, {"error": "Item not found"})
                return
            elif isinstance(current, dict):
                current.update(payload)
                db_manager.update_cms_content(section, current)
                self.send_json(200, {"success": True, "data": current})
                return

        # 3. Resolve Operational Alert (/api/admin/alerts/<id>)
        if path.startswith("/api/admin/alerts/"):
            alert_id = path.split("/api/admin/alerts/")[1].strip("/")
            success = db_manager.resolve_alert(alert_id)
            if success:
                self.send_json(200, {"success": True, "message": "Alert marked as resolved"})
            else:
                self.send_json(404, {"success": False, "error": "Alert not found or already resolved"})
            return

        self.send_json(404, {"error": "Endpoint not found"})

    # ---------------------------------------------------------
    # DELETE ROUTER
    # ---------------------------------------------------------
    def do_DELETE(self):
        self._req_start_time = time.time()
        parsed = urlparse(self.path)
        path = parsed.path
        client_ip = self.get_client_ip()

        if not self.is_authenticated():
            print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Unauthorized access blocked on {path} from IP: {client_ip}", flush=True)
            self.send_json(401, {"error": "Unauthorized. Please log in."})
            return

        # CSRF check for state-changing admin requests
        origin = self.headers.get("Origin")
        if origin and not is_allowed_origin(origin):
            print(f"[SECURITY AUDIT] [{datetime.now(timezone.utc).isoformat()}] Blocked cross-origin admin request from {origin} to {path}", flush=True)
            self.send_json(403, {"error": "Forbidden: Cross-origin request rejected."})
            return

        if is_admin_mutation_rate_limited(client_ip):
            self.send_json(429, {"error": "Admin mutation rate limit reached. Please wait."})
            return

        # 1. Delete Inquiry Record
        if path.startswith("/api/admin/inquiries/"):
            inquiry_id = path.split("/api/admin/inquiries/")[1].strip("/")
            success = db_manager.delete_inquiry(inquiry_id)
            if success:
                self.send_json(200, {"success": True, "message": "Inquiry permanently deleted"})
            else:
                self.send_json(404, {"success": False, "error": "Inquiry record not found"})
            return

        # 2. Delete CMS Item (/api/admin/content/<section>/<id>)
        if path.startswith("/api/admin/content/"):
            parts = path.split("/api/admin/content/")[1].strip("/").split("/")
            if len(parts) >= 2:
                section = parts[0].replace("-", "_")
                if section not in ALLOWED_CMS_SECTIONS:
                    self.send_json(400, {"error": "Invalid section name."})
                    return
                item_id = parts[1]
                current = db_manager.get_cms_content(section)
                if isinstance(current, list):
                    if section == "certificates":
                        for i in current:
                            if i.get("id") == item_id and i.get("file_url"):
                                fpath = os.path.join(ROOT_DIR, i["file_url"])
                                if os.path.exists(fpath) and CERTIFICATES_DIR in fpath:
                                    try:
                                        os.remove(fpath)
                                    except Exception:
                                        pass
                    filtered = [i for i in current if i.get("id") != item_id]
                    if len(filtered) < len(current):
                        db_manager.update_cms_content(section, filtered)
                        self.send_json(200, {"success": True, "message": "Item deleted"})
                        return
            self.send_json(404, {"error": "Content item not found"})
            return

        self.send_json(404, {"error": "Endpoint not found"})

# -------------------------------------------------------------
# 7. MAIN RUNNER
# -------------------------------------------------------------
if __name__ == "__main__":
    db_status = db_manager.get_db_status()
    smtp_status = check_smtp_health()
    print("============================================================", flush=True)
    print("VS INFRA & CRANES — PRODUCTION BACKEND API SERVER", flush=True)
    print("============================================================", flush=True)
    print(f"Server Status:     RUNNING on http://0.0.0.0:{PORT}", flush=True)
    print(f"MongoDB Primary:   {db_status['database']} (Target DB: '{MONGODB_DB_NAME}')", flush=True)
    print(f"SMTP Service:      {smtp_status['status']} ({SMTP_HOST}:{SMTP_PORT})", flush=True)
    print(f"Admin Security:    ACTIVE (PBKDF2-HMAC-SHA256 Auth & Rate Limiting)", flush=True)
    print("============================================================", flush=True)
    server_address = ("", PORT)
    httpd = HTTPServer(server_address, AppRequestHandler)

    def sig_handler(signum, frame):
        print(f"\nReceived signal {signum}. Shutting down server gracefully...", flush=True)
        try:
            httpd.server_close()
        except Exception:
            pass
        sys.exit(0)

    try:
        signal.signal(signal.SIGTERM, sig_handler)
        signal.signal(signal.SIGINT, sig_handler)
    except Exception:
        pass

    try:
        httpd.serve_forever()
    except (KeyboardInterrupt, SystemExit):
        print("\nServer stopped.", flush=True)
        try:
            httpd.server_close()
        except Exception:
            pass
