"""
Public registration views — schema-driven individual & team signup.

These endpoints are intentionally unauthenticated: registration happens before
anyone has an account. Identity is anchored on MSSV.
"""

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

from api.services import registration_service
from api.services.team_service import registration_is_open
from .views_shared import _json_body, _consume_rate_limit, _require_antibot


def _registration_closed_response():
    return JsonResponse({"error": "registration_closed"}, status=403)


# Errors that mean "this identity is already spoken for" rather than "your form
# is malformed". They deserve 409 so a caller can tell the two apart.
_CONFLICT_CODES = frozenset({
    "mssv_in_other_team",
    "mssv_email_mismatch",
    "duplicate_mssv_in_team",
})


def _registration_error_response(err: str):
    code = str(err).split(":", 1)[0]
    status = 409 if code in _CONFLICT_CODES else 400
    return JsonResponse({"error": err}, status=status)


def schema_view(request: HttpRequest):
    """GET the active registration form schema so the FE can render fields."""
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    return JsonResponse(registration_service.get_schema())


@csrf_exempt
def register_individual_view(request: HttpRequest):
    """POST a single participant registration."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    if not registration_is_open():
        return _registration_closed_response()
    limited, _ = _consume_rate_limit(
        request,
        scope="register-individual",
        limit=settings.AUTH_REGISTER_RATE_LIMIT,
        window_seconds=settings.AUTH_REGISTER_RATE_WINDOW_SECONDS,
    )
    if limited:
        return limited
    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)
    blocked = _require_antibot(request, data, form_signals=True)
    if blocked:
        return blocked

    participant, err = registration_service.register_individual(data)
    if err:
        return _registration_error_response(err)
    return JsonResponse({"mssv": participant.mssv, "mode": "individual"}, status=201)


@csrf_exempt
def lookup_view(request: HttpRequest):
    """POST {mssv, email} → privacy-safe basic info for the signup page."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    limited, _ = _consume_rate_limit(
        request,
        scope="participant-lookup",
        limit=settings.AUTH_LOOKUP_RATE_LIMIT,
        window_seconds=settings.AUTH_LOOKUP_RATE_WINDOW_SECONDS,
    )
    if limited:
        return limited
    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)
    blocked = _require_antibot(request, data, form_signals=True)
    if blocked:
        return blocked
    result = registration_service.lookup_participant(
        data.get("mssv", ""), data.get("email", ""),
    )
    return JsonResponse(result)


@csrf_exempt
def register_team_view(request: HttpRequest):
    """POST a full team registration (captain + members)."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    if not registration_is_open():
        return _registration_closed_response()
    limited, _ = _consume_rate_limit(
        request,
        scope="register-team",
        limit=settings.AUTH_REGISTER_RATE_LIMIT,
        window_seconds=settings.AUTH_REGISTER_RATE_WINDOW_SECONDS,
    )
    if limited:
        return limited
    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)
    blocked = _require_antibot(request, data, form_signals=True)
    if blocked:
        return blocked

    team, err = registration_service.register_team(data)
    if err:
        return _registration_error_response(err)
    return JsonResponse({
        "code": team.code,
        "name": team.name,
        "approval_status": team.approval_status,
        "is_late_registration": team.is_late_registration,
        "mode": "team",
    }, status=201)
