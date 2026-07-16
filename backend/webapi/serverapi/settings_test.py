import os


os.environ.setdefault("DJANGO_DEBUG", "1")
os.environ.setdefault("DJANGO_SECRET_KEY", "test-secret-key")

from .settings import *  # noqa: E402,F403


DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    },
}

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
