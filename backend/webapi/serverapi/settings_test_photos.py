from .settings_test import *  # noqa: F403

PHOTO_GALLERY_ENABLED = True
PHOTO_SEARCH_ENABLED = True
INSTALLED_APPS = [*INSTALLED_APPS, "photo_gallery"] if "photo_gallery" not in INSTALLED_APPS else INSTALLED_APPS  # noqa: F405
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
