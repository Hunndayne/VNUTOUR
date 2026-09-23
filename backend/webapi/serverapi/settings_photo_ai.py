"""Internal-only AI HTTP process. Public application URLs are never mounted."""
from .settings import *  # noqa: F403

ROOT_URLCONF = "photo_gallery.ai_urls"
SECURE_SSL_REDIRECT = False
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware"]
DATA_UPLOAD_MAX_MEMORY_SIZE = 11 * 1024 * 1024
ALLOWED_HOSTS = ["*"]  # ClusterIP + shared secret authenticates /v1/embed.
