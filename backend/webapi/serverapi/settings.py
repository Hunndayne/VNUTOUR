from pathlib import Path
import os
import sys
from urllib.parse import quote
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

# Make repo root importable to access `src.*`
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Load .env from repo root
load_dotenv(REPO_ROOT / ".env")

IS_PRODUCTION = os.getenv("DJANGO_ENV", "development").lower() == "production"
DEBUG = os.getenv("DJANGO_DEBUG", "0" if IS_PRODUCTION else "1") == "1"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if IS_PRODUCTION:
        raise RuntimeError("DJANGO_SECRET_KEY is required in production")
    SECRET_KEY = "dev-secret-key-change-me"

_allowed_hosts = os.getenv("DJANGO_ALLOWED_HOSTS", "" if IS_PRODUCTION else "*")
ALLOWED_HOSTS = [host.strip() for host in _allowed_hosts.split(",") if host.strip()]
if IS_PRODUCTION and not ALLOWED_HOSTS:
    raise RuntimeError("DJANGO_ALLOWED_HOSTS is required in production")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "django_prometheus",
    "api",
]

# Optional gallery. Its tables live in a dedicated pgvector PostgreSQL
# ("photos" database, configured below), never in the event database, so
# enabling it never requires changing the main DB server or its image.
PHOTO_GALLERY_ENABLED = os.getenv("PHOTO_GALLERY_ENABLED", "0") == "1"
if PHOTO_GALLERY_ENABLED:
    INSTALLED_APPS.append("photo_gallery")
PHOTO_AI_URL = os.getenv("PHOTO_AI_URL", "http://photo-ai:8000").rstrip("/")
PHOTO_AI_TOKEN = os.getenv("PHOTO_AI_TOKEN", "")
PHOTO_AI_MODEL_DIR = os.getenv("PHOTO_AI_MODEL_DIR", "/models")
PHOTO_AI_THREADS = int(os.getenv("PHOTO_AI_THREADS", "2"))
# YuNet score for album photos. 0.9 (the OpenCV demo default) only keeps
# faces looking straight at the camera; candid event photos need 0.6.
PHOTO_DETECT_THRESHOLD = float(os.getenv("PHOTO_DETECT_THRESHOLD", "0.60"))
PHOTO_SEARCH_THRESHOLD = float(os.getenv("PHOTO_SEARCH_THRESHOLD", "0.50"))
PHOTO_SEARCH_ENABLED = os.getenv("PHOTO_SEARCH_ENABLED", "0") == "1"
PHOTO_SEARCH_TIMEOUT_SECONDS = int(os.getenv("PHOTO_SEARCH_TIMEOUT_SECONDS", "30"))
PHOTO_SEARCH_RATE_LIMIT = int(os.getenv("PHOTO_SEARCH_RATE_LIMIT", "10"))
PHOTO_SEARCH_RATE_WINDOW_SECONDS = int(os.getenv("PHOTO_SEARCH_RATE_WINDOW_SECONDS", "600"))
PHOTO_SEARCH_PAGE_RATE_LIMIT = int(os.getenv("PHOTO_SEARCH_PAGE_RATE_LIMIT", "120"))
PHOTO_SEARCH_PAGE_RATE_WINDOW_SECONDS = int(os.getenv("PHOTO_SEARCH_PAGE_RATE_WINDOW_SECONDS", "600"))
PHOTO_DRIVE_CREDENTIALS = os.getenv("PHOTO_DRIVE_CREDENTIALS", "")
# Shown to admins so they know whom to share a Drive folder with. Only the
# worker mounts the key file, so the backend gets the address as plain config.
PHOTO_DRIVE_SERVICE_EMAIL = os.getenv("PHOTO_DRIVE_SERVICE_EMAIL", "")
# Empty means use R2_BUCKET, with photo keys under event-photos/.
PHOTO_R2_BUCKET = os.getenv("PHOTO_R2_BUCKET", "")
PHOTO_MAX_IMAGE_BYTES = 30 * 1024 * 1024
PHOTO_MAX_PIXELS = 60_000_000
PHOTO_REFERENCE_MAX_BYTES = 10 * 1024 * 1024
# Let a maximum-size multipart reference reach the view, which then applies
# the tighter per-file check and returns the documented JSON error response.
DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.getenv("DATA_UPLOAD_MAX_MEMORY_SIZE", str(PHOTO_REFERENCE_MAX_BYTES + 64 * 1024)))
FILE_UPLOAD_MAX_MEMORY_SIZE = int(os.getenv("FILE_UPLOAD_MAX_MEMORY_SIZE", str(PHOTO_REFERENCE_MAX_BYTES + 64 * 1024)))
PHOTO_LEASE_SECONDS = 600
PHOTO_MAX_ATTEMPTS = 3

MIDDLEWARE = [
    # The Prometheus pair has to bracket everything else: latency is measured
    # between the two, so any middleware placed outside them is invisible to
    # the histogram.
    "django_prometheus.middleware.PrometheusBeforeMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "django_prometheus.middleware.PrometheusAfterMiddleware",
]

ROOT_URLCONF = "serverapi.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "serverapi.wsgi.application"

# PostgreSQL is the source of truth (plan §2.1)
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DB_NAME", "vnutour"),
        "USER": os.getenv("DB_USER", "vnutour"),
        "PASSWORD": os.getenv("DB_PASSWORD", "vnutour"),
        "HOST": os.getenv("DB_HOST", "localhost"),
        "PORT": os.getenv("DB_PORT", "5432"),
    }
}

if PHOTO_GALLERY_ENABLED:
    DATABASES["photos"] = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("PHOTO_DB_NAME", "vnutour_photos"),
        "USER": os.getenv("PHOTO_DB_USER", "vnutour_photos"),
        "PASSWORD": os.getenv("PHOTO_DB_PASSWORD", ""),
        "HOST": os.getenv("PHOTO_DB_HOST", "photos-db"),
        "PORT": os.getenv("PHOTO_DB_PORT", "5432"),
        # Fail fast: a gallery outage must not tie up web workers.
        "OPTIONS": {"connect_timeout": 5},
    }
    DATABASE_ROUTERS = ["photo_gallery.routers.PhotoGalleryRouter"]

LANGUAGE_CODE = "vi"
TIME_ZONE = "Asia/Ho_Chi_Minh"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Submission attachments: uploaded to Cloudflare R2 when configured,
# otherwise stored under MEDIA_ROOT on the local server.
MEDIA_URL = "/media/"
MEDIA_ROOT = os.getenv("MEDIA_ROOT", str(BASE_DIR / "media"))

R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
# S3 account endpoint only (no /bucket suffix). The storage client also strips
# an accidentally duplicated bucket path defensively.
R2_ENDPOINT_URL = os.getenv(
    "R2_ENDPOINT_URL",
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else "",
)
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.getenv("R2_BUCKET", "")
# Public bucket/custom domain base URL. Include https://; storage services also
# normalize a missing scheme defensively so browsers never treat the hostname
# as a path relative to the current frontend route.
R2_PUBLIC_BASE_URL = os.getenv("R2_PUBLIC_BASE_URL", "").rstrip("/")

# CORS is open only in development unless explicitly configured.
CORS_ALLOW_ALL_ORIGINS = os.getenv(
    "CORS_ALLOW_ALL",
    "0" if IS_PRODUCTION else "1",
) == "1"
# Allow sending/receiving cookies across origins when enabled
CORS_ALLOW_CREDENTIALS = os.getenv("CORS_ALLOW_CREDENTIALS", "0") == "1"
# Optionally limit allowed origins when using credentials
_cors_allowed = os.getenv("CORS_ALLOWED_ORIGINS", "").strip()
if _cors_allowed:
    CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors_allowed.split(",") if o.strip()]

# Authentication hardening
AUTH_TOKEN_MAX_AGE_SECONDS = int(os.getenv("AUTH_TOKEN_MAX_AGE_SECONDS", "86400"))
AUTH_MIN_PASSWORD_LENGTH = int(os.getenv("AUTH_MIN_PASSWORD_LENGTH", "8"))
AUTH_LOGIN_RATE_LIMIT = int(os.getenv("AUTH_LOGIN_RATE_LIMIT", "5"))
AUTH_LOGIN_RATE_WINDOW_SECONDS = int(os.getenv("AUTH_LOGIN_RATE_WINDOW_SECONDS", "900"))
AUTH_REGISTER_RATE_LIMIT = int(os.getenv("AUTH_REGISTER_RATE_LIMIT", "10"))
AUTH_REGISTER_RATE_WINDOW_SECONDS = int(os.getenv("AUTH_REGISTER_RATE_WINDOW_SECONDS", "3600"))
AUTH_LOOKUP_RATE_LIMIT = int(os.getenv("AUTH_LOOKUP_RATE_LIMIT", "30"))
AUTH_LOOKUP_RATE_WINDOW_SECONDS = int(os.getenv("AUTH_LOOKUP_RATE_WINDOW_SECONDS", "900"))
# Google login tạo được tài khoản participant khi đăng ký đang mở, nên chịu
# cùng mức giới hạn với signup; tải frame là POST công khai duy nhất còn lại.
AUTH_GOOGLE_RATE_LIMIT = int(os.getenv("AUTH_GOOGLE_RATE_LIMIT", "10"))
AUTH_GOOGLE_RATE_WINDOW_SECONDS = int(os.getenv("AUTH_GOOGLE_RATE_WINDOW_SECONDS", "900"))
FRAME_DOWNLOAD_RATE_LIMIT = int(os.getenv("FRAME_DOWNLOAD_RATE_LIMIT", "30"))
FRAME_DOWNLOAD_RATE_WINDOW_SECONDS = int(os.getenv("FRAME_DOWNLOAD_RATE_WINDOW_SECONDS", "600"))
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "0") == "1"

# Login/register rate-limit counters live in the shared cache. Redis is used
# whenever REDIS_URL or REDIS_HOST is configured; local/test environments keep
# the existing database cache so they do not require a Redis process.
REDIS_URL = os.getenv("REDIS_URL", "").strip()
REDIS_HOST = os.getenv("REDIS_HOST", "").strip()
# Do not use REDIS_PORT for application configuration. Kubernetes reserves that
# name for the Service link URI (for example tcp://10.43.0.10:6379), which is
# not an integer. REDIS_TCP_PORT remains stable across Docker and Kubernetes.
REDIS_PORT = int(os.getenv("REDIS_TCP_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")

if not REDIS_URL and REDIS_HOST:
    redis_auth = f":{quote(REDIS_PASSWORD, safe='')}@" if REDIS_PASSWORD else ""
    REDIS_URL = f"redis://{redis_auth}{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}"

DATABASE_CACHE = {
    "BACKEND": "django.core.cache.backends.db.DatabaseCache",
    "LOCATION": "vnutour_cache",
}

if REDIS_URL:
    DEFAULT_CACHE = {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {
            # Authentication must fail quickly instead of holding every login
            # request while Redis is unavailable. The rate limiter falls back
            # to DatabaseCache below.
            "socket_connect_timeout": float(
                os.getenv("REDIS_CONNECT_TIMEOUT_SECONDS", "0.5")
            ),
            "socket_timeout": float(os.getenv("REDIS_TIMEOUT_SECONDS", "0.5")),
            "health_check_interval": int(
                os.getenv("REDIS_HEALTH_CHECK_INTERVAL_SECONDS", "30")
            ),
        },
    }
else:
    DEFAULT_CACHE = DATABASE_CACHE

CACHES = {
    "default": DEFAULT_CACHE,
    # PostgreSQL is used only when Redis is configured but temporarily
    # unavailable. This preserves login protection without making Redis a hard
    # dependency for authentication availability.
    "rate_limit_fallback": DATABASE_CACHE,
}

# Coop operators poll a small set of shared event/station views.  A very short
# jittered TTL absorbs duplicate reads from many operators without turning the
# cache into a source of truth.  Successful writes invalidate these entries in
# transaction.on_commit callbacks (see services/coop_realtime_cache.py).
COOP_REALTIME_CACHE_ENABLED = os.getenv("COOP_REALTIME_CACHE_ENABLED", "1") == "1"
COOP_REALTIME_CACHE_TTL_MIN_SECONDS = int(
    os.getenv("COOP_REALTIME_CACHE_TTL_MIN_SECONDS", "2")
)
COOP_REALTIME_CACHE_TTL_MAX_SECONDS = int(
    os.getenv("COOP_REALTIME_CACHE_TTL_MAX_SECONDS", "5")
)

# Production transport/browser security
SECURE_SSL_REDIRECT = os.getenv(
    "DJANGO_SECURE_SSL_REDIRECT",
    "1" if IS_PRODUCTION else "0",
) == "1"
# Prometheus and the kubelet reach these two over plain HTTP on the pod IP, and
# neither follows a redirect anywhere useful: the scraper would chase the 301
# into a TLS handshake against a cleartext port, and a probe would score the
# redirect itself as success and never notice the app was broken. Nginx proxies
# only /api/ and /media/, so neither path is reachable from the public
# hostname and exempting them gives up nothing.
SECURE_REDIRECT_EXEMPT = [r"^metrics$", r"^api/health$"]
SESSION_COOKIE_SECURE = IS_PRODUCTION
CSRF_COOKIE_SECURE = IS_PRODUCTION
SECURE_HSTS_SECONDS = int(os.getenv(
    "DJANGO_HSTS_SECONDS",
    "31536000" if IS_PRODUCTION else "0",
))
SECURE_HSTS_INCLUDE_SUBDOMAINS = IS_PRODUCTION
SECURE_HSTS_PRELOAD = IS_PRODUCTION
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
if TRUST_PROXY_HEADERS:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Email / SMTP
EMAIL_HOST = os.environ.get("SMTP_HOST", "")
EMAIL_PORT = int(os.environ.get("SMTP_PORT", "587"))
EMAIL_USE_TLS = os.environ.get("SMTP_USE_TLS", "1") == "1"
EMAIL_HOST_USER = os.environ.get("SMTP_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
EMAIL_FROM = os.environ.get("SMTP_FROM", "noreply@vnutour.vn")
EMAIL_QUEUE_INTERVAL_SECONDS = int(os.getenv("EMAIL_QUEUE_INTERVAL_SECONDS", "10"))
EMAIL_QUEUE_MAX_ATTEMPTS = int(os.getenv("EMAIL_QUEUE_MAX_ATTEMPTS", "5"))
EMAIL_QUEUE_STALE_SECONDS = int(os.getenv("EMAIL_QUEUE_STALE_SECONDS", "600"))

# Public base URL of the web frontend, used to build links inside transactional
# emails (password reset, etc). Falls back to building from the request when
# unset (see views_auth.forgot_password_view).
WEB_BASE_URL = os.getenv("WEB_BASE_URL", "")
PASSWORD_RESET_TOKEN_TTL_HOURS = int(os.getenv("PASSWORD_RESET_TOKEN_TTL_HOURS", "2"))

# Shared Discord invite link used in transactional emails (e.g. team-approved
# notification). Empty until the organisers configure it.
DISCORD_INVITE_URL = os.getenv("DISCORD_INVITE_URL", "")

REPORT_TEMPLATE_PATH = os.getenv(
    "REPORT_TEMPLATE_PATH",
    str(REPO_ROOT / "assets" / "vnutour-report-template.xlsx"),
)
BACKUP_ROOT = os.getenv("BACKUP_ROOT", str(REPO_ROOT / "backups"))
BACKUP_MAX_UPLOAD_MB = int(os.getenv("BACKUP_MAX_UPLOAD_MB", "500"))
