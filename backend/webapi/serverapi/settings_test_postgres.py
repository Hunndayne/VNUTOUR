"""Opt-in row-lock tests: pytest --ds=serverapi.settings_test_postgres.

Uses a separate test database on local PostgreSQL by default. TEST_DB_* can
point to an isolated CI service without inheriting the application's DB_*.
"""

import os

from .settings_test import *  # noqa: F401,F403


DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "vnutour_capacity_tests",
        "USER": os.getenv("TEST_DB_USER", "vnutour"),
        "PASSWORD": os.getenv("TEST_DB_PASSWORD", "vnutour"),
        "HOST": os.getenv("TEST_DB_HOST", "127.0.0.1"),
        "PORT": os.getenv("TEST_DB_PORT", "5432"),
    },
}
