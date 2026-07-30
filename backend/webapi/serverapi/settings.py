from pathlib import Path
import os
import sys
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
    "api",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
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
R2_ENDPOINT_URL = os.getenv(
    "R2_ENDPOINT_URL",
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else "",
)
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.getenv("R2_BUCKET", "")
# Public bucket/custom domain base URL; when empty, R2 files are referenced by key only
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
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "0") == "1"

# Production transport/browser security
SECURE_SSL_REDIRECT = os.getenv(
    "DJANGO_SECURE_SSL_REDIRECT",
    "1" if IS_PRODUCTION else "0",
) == "1"
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

REPORT_TEMPLATE_PATH = os.getenv(
    "REPORT_TEMPLATE_PATH",
    str(REPO_ROOT / "assets" / "vnutour-report-template.xlsx"),
)
BACKUP_ROOT = os.getenv("BACKUP_ROOT", str(REPO_ROOT / "backups"))
BACKUP_MAX_UPLOAD_MB = int(os.getenv("BACKUP_MAX_UPLOAD_MB", "500"))
