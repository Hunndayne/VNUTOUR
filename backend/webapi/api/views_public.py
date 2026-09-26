"""
Public views — unauthenticated config the FE needs before anyone signs in.
"""

from django.conf import settings
from django.http import JsonResponse, HttpRequest

from api.services.antibot_service import antibot_config
from api.services.read_mostly_cache import SITE_CONFIG_KEY, get_or_load
from api.services.team_service import get_public_registration_status


def _load_site_config() -> dict:
    """Build the public payload from PostgreSQL and environment settings."""
    antibot = antibot_config()
    return {
        **get_public_registration_status(),
        # Frontend reads the site key from here; the secret never leaves the
        # server.
        "antibot": {
            "enabled": antibot["enabled"],
            "site_key": antibot["site_key"],
        },
        # One frontend build serves every environment.
        "photo_gallery": settings.PHOTO_GALLERY_ENABLED,
    }


def site_config_view(request: HttpRequest):
    """GET public site config (signup switch + anti-bot widget config)."""
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    payload = get_or_load(
        cache_name="site_config",
        key=SITE_CONFIG_KEY,
        ttl_seconds=settings.SITE_CONFIG_CACHE_TTL_SECONDS,
        loader=_load_site_config,
    )
    return JsonResponse(payload)
