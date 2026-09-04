"""
Public views — unauthenticated config the FE needs before anyone signs in.
"""

from django.http import JsonResponse, HttpRequest

from api.services.antibot_service import antibot_config
from api.services.team_service import registration_is_open, registration_is_full


def site_config_view(request: HttpRequest):
    """GET public site config (signup switch + anti-bot widget config)."""
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    antibot = antibot_config()
    return JsonResponse({
        "allow_signup": registration_is_open(),
        "registration_full": registration_is_full(),
        # Frontend đọc site key từ đây để render Turnstile — không cần rebuild
        # mỗi lần đổi key; secret thì không bao giờ rời server.
        "antibot": {
            "enabled": antibot["enabled"],
            "site_key": antibot["site_key"],
        },
    })
