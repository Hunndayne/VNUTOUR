"""
Public views — unauthenticated config the FE needs before anyone signs in.
"""

from django.http import JsonResponse, HttpRequest

from api.services.team_service import registration_is_open


def site_config_view(request: HttpRequest):
    """GET public site config (currently just whether signup is open)."""
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    return JsonResponse({"allow_signup": registration_is_open()})
