"""
Public registration views — schema-driven individual & team signup.

These endpoints are intentionally unauthenticated: registration happens before
anyone has an account. Identity is anchored on MSSV.
"""

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt

from api.services import registration_service
from .views_shared import _json_body


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
    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    participant, err = registration_service.register_individual(data)
    if err:
        return JsonResponse({"error": err}, status=400)
    return JsonResponse({"mssv": participant.mssv, "mode": "individual"}, status=201)


@csrf_exempt
def lookup_view(request: HttpRequest):
    """POST {mssv, email} → privacy-safe basic info for the signup page."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)
    result = registration_service.lookup_participant(
        data.get("mssv", ""), data.get("email", ""),
    )
    return JsonResponse(result)


@csrf_exempt
def register_team_view(request: HttpRequest):
    """POST a full team registration (captain + members)."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    team, err = registration_service.register_team(data)
    if err:
        return JsonResponse({"error": err}, status=400)
    return JsonResponse({
        "code": team.code,
        "name": team.name,
        "approval_status": team.approval_status,
        "mode": "team",
    }, status=201)
