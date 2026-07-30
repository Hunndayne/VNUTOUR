"""
Program views — phase schedule, sub-events (§9.4).
"""

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt

from api.models import ProgramPhase, SubEvent
from api.services.program_service import (
    get_program, set_current_phase, update_phase_dates,
    create_sub_event, update_sub_event, delete_sub_event, set_current_sub_event,
)
from api.services.audit_service import record_audit
from .views_shared import _json_body, _require_role


def program_view(request: HttpRequest):
    """GET: full program with phases and sub-events."""
    acc, err = _require_role(request, "admin", "collab")
    if err:
        return err
    return JsonResponse(get_program())


@csrf_exempt
def current_phase_view(request: HttpRequest):
    """PUT: set current phase."""
    acc, err = _require_role(request, "admin")
    if err:
        return err

    if request.method != "PUT":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    phase_key = str((data.get("phase_key") or data.get("current_phase") or "").strip())
    if not phase_key:
        return JsonResponse({"error": "missing_phase_key"}, status=400)

    try:
        previous = ProgramPhase.objects.filter(is_current=True).first()
        phase = set_current_phase(phase_key)
        record_audit(
            actor=acc,
            action="phase.change",
            summary=f"Chuyển phase sang {phase.label}",
            target_type="ProgramPhase",
            target_id=phase.id,
            before_data={
                "current_phase": previous.key if previous else None,
            },
            after_data={"current_phase": phase.key},
            reversible=bool(previous and previous.id != phase.id),
        )
        return JsonResponse({"current_phase": phase.key})
    except ProgramPhase.DoesNotExist:
        return JsonResponse({"error": "phase_not_found"}, status=404)
    except ValueError as exc:
        if str(exc) == "missing_name":
            return JsonResponse({"error": "missing_name"}, status=400)
        raise


@csrf_exempt
def current_sub_event_view(request: HttpRequest):
    """PUT: set current sub-event inside the current phase."""
    acc, err = _require_role(request, "admin")
    if err:
        return err

    if request.method != "PUT":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    event_id = data.get("event_id") or data.get("current_sub_event_id")
    if not event_id:
        return JsonResponse({"error": "missing_event_id"}, status=400)

    try:
        sub_event = set_current_sub_event(int(event_id))
        return JsonResponse({"current_sub_event_id": sub_event.id})
    except SubEvent.DoesNotExist:
        return JsonResponse({"error": "event_not_found"}, status=404)
    except ValueError as exc:
        if str(exc) == "event_not_in_current_phase":
            return JsonResponse({"error": "event_not_in_current_phase"}, status=409)
        raise


@csrf_exempt
def phase_detail_view(request: HttpRequest, phase_key: str):
    """PATCH: update phase dates."""
    acc, err = _require_role(request, "admin")
    if err:
        return err

    if request.method != "PATCH":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    try:
        phase = update_phase_dates(
            phase_key,
            start_date=data.get("start_date"),
            end_date=data.get("end_date"),
        )
        return JsonResponse({
            "key": phase.key,
            "start_date": phase.start_date.isoformat() if phase.start_date else None,
            "end_date": phase.end_date.isoformat() if phase.end_date else None,
        })
    except ProgramPhase.DoesNotExist:
        return JsonResponse({"error": "phase_not_found"}, status=404)


@csrf_exempt
def sub_event_create_view(request: HttpRequest, phase_key: str):
    """POST: create sub-event in a phase."""
    acc, err = _require_role(request, "admin")
    if err:
        return err

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    name = str((data.get("name") or "").strip())
    if not name:
        return JsonResponse({"error": "missing_name"}, status=400)

    try:
        se = create_sub_event(
            phase_key, name,
            type=data.get("type", "custom"),
            start_date=data.get("start_date") or None,
            end_date=data.get("end_date") or None,
            uses_stations=bool(data.get("uses_stations")),
            note=data.get("note"),
            order=data.get("order", 0),
        )
        return JsonResponse({
            "id": se.id, "phase_key": phase_key, "name": se.name,
            "type": se.type, "uses_stations": se.uses_stations,
        }, status=201)
    except ProgramPhase.DoesNotExist:
        return JsonResponse({"error": "phase_not_found"}, status=404)


@csrf_exempt
def sub_event_detail_view(request: HttpRequest, event_id: int):
    """PATCH/DELETE a sub-event."""
    acc, err = _require_role(request, "admin")
    if err:
        return err

    if request.method == "PATCH":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        try:
            kwargs = {}
            for f in ("name", "type", "start_date", "end_date", "uses_stations", "note", "order"):
                if f in data:
                    kwargs[f] = data[f]
            se = update_sub_event(event_id, **kwargs)
            return JsonResponse({
                "id": se.id, "name": se.name, "type": se.type,
                "uses_stations": se.uses_stations,
            })
        except SubEvent.DoesNotExist:
            return JsonResponse({"error": "not_found"}, status=404)
        except ValueError as exc:
            if str(exc) == "missing_name":
                return JsonResponse({"error": "missing_name"}, status=400)
            raise

    if request.method == "DELETE":
        try:
            delete_sub_event(event_id)
            return JsonResponse({"status": "deleted"})
        except SubEvent.DoesNotExist:
            return JsonResponse({"error": "not_found"}, status=404)

    return JsonResponse({"error": "method_not_allowed"}, status=405)
