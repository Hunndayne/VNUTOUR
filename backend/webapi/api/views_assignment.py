from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt

from api.models import Account
from api.services.assignment_service import (
    create_assignment,
    delete_assignment,
    list_assignments,
    serialize_assignment,
)
from .views_shared import _json_body, _require_role


def coop_my_assignments_view(request: HttpRequest):
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    assignments = list_assignments(
        phase_key=request.GET.get("phase_key") or None,
        event_id=int(request.GET["event_id"]) if request.GET.get("event_id") else None,
        collab_id=acc.id,
        active_only=request.GET.get("active") not in ("0", "false", "no"),
    )
    return JsonResponse({
        "items": [serialize_assignment(assignment) for assignment in assignments],
    })


@csrf_exempt
def admin_station_assignments_view(request: HttpRequest):
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        assignments = list_assignments(
            phase_key=request.GET.get("phase_key") or None,
            event_id=int(request.GET["event_id"]) if request.GET.get("event_id") else None,
            active_only=request.GET.get("active") in ("1", "true", "yes"),
        )
        return JsonResponse({
            "items": [serialize_assignment(assignment) for assignment in assignments],
        })

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    collab_username = str((data.get("collab_username") or data.get("collabUsername") or "").strip())
    station_id = data.get("station_id") or data.get("stationId")
    if not collab_username or not station_id:
        return JsonResponse({"error": "missing_fields"}, status=400)

    try:
        assignment = create_assignment(
            collab_username=collab_username,
            station_id=int(station_id),
            shift_start=data.get("shift_start") or data.get("shiftStart"),
            shift_end=data.get("shift_end") or data.get("shiftEnd"),
            note=data.get("note"),
            active=data.get("active", True),
        )
    except ValueError as exc:
        code = str(exc)
        if code in ("collab_not_found", "station_not_found"):
            return JsonResponse({"error": code}, status=404)
        if code == "duplicate_assignment":
            return JsonResponse({"error": code}, status=409)
        raise

    return JsonResponse(serialize_assignment(assignment), status=201)


@csrf_exempt
def admin_station_assignment_detail_view(request: HttpRequest, assignment_id: int):
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method != "DELETE":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    if delete_assignment(assignment_id):
        return JsonResponse({"status": "deleted"})
    return JsonResponse({"error": "not_found"}, status=404)
