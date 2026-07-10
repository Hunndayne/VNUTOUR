"""
Station views — config CRUD + session enter/exit (§9.5, §9.7).
"""

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt

from api.models import Account, Station, SubEvent, StationSession, StationAssignment
from api.services.station_service import (
    create_station, update_station, delete_station,
    get_stations_for_event, get_occupancy, get_station_sessions as get_sessions_history,
    enter_station, exit_station, list_recent_sessions, set_session_score,
)
from .views_shared import _json_body, _auth_or_401, _require_role


@csrf_exempt
def station_session_score_view(request: HttpRequest, session_id: int):
    """PATCH: cập nhật điểm cho phiên trạm (admin, hoặc collab được phân công trạm đó)."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    if request.method != "PATCH":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)
    if "score" not in data:
        return JsonResponse({"error": "missing_score"}, status=400)

    session = StationSession.objects.select_related("station").filter(id=session_id).first()
    if not session:
        return JsonResponse({"error": "session_not_found"}, status=404)

    if acc.role == Account.ROLE_COLLAB and not StationAssignment.objects.filter(
        collab=acc, station=session.station, active=True,
    ).exists():
        return JsonResponse({"error": "not_assigned_to_station"}, status=403)

    updated, err = set_session_score(session_id, acc, data.get("score"), data.get("note"))
    if err:
        status = 409 if err == "results_locked" else (400 if err == "invalid_score" else 404)
        return JsonResponse({"error": err}, status=status)

    return JsonResponse({
        "id": updated.id,
        "team_code": updated.team.code,
        "score": updated.score,
    })


# =====================================================================
# Station config
# =====================================================================

def stations_for_event_view(request: HttpRequest, phase_key: str, event_id: int):
    """GET: list stations for a sub-event."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    include_inactive = request.GET.get("include_inactive") in ("1", "true", "yes")
    stations = get_stations_for_event(event_id, include_inactive=include_inactive)
    return JsonResponse({
        "stations": [
            {
                "id": s.id, "code": s.code, "name": s.name,
                "location": s.location, "order": s.order,
                "active": s.active,
                "checkin_policy": s.checkin_policy,
                "capacity_mode": s.capacity_mode,
                "max_concurrent_teams": s.max_concurrent_teams,
                "submission_config": s.submission_config,
            }
            for s in stations
        ],
    })


@csrf_exempt
def station_create_view(request: HttpRequest, event_id: int):
    """POST: create station for a sub-event."""
    acc, err = _require_role(request, "admin")
    if err:
        return err

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    code = str((data.get("code") or "").strip())
    name = str((data.get("name") or "").strip())
    if not code or not name:
        return JsonResponse({"error": "missing_code_or_name"}, status=400)

    try:
        station = create_station(
            event_id, code, name,
            location=data.get("location"),
            order=data.get("order", 0),
            active=data.get("active", True),
            checkin_policy=data.get("checkin_policy", "staff_scan"),
            capacity_mode=data.get("capacity_mode", "unlimited"),
            max_concurrent_teams=data.get("max_concurrent_teams"),
            submission_config=data.get("submission_config"),
        )
    except ValueError as exc:
        if str(exc) == "duplicate_station_code":
            return JsonResponse({"error": "duplicate_station_code"}, status=409)
        raise
    return JsonResponse({
        "id": station.id, "code": station.code, "name": station.name,
    }, status=201)


@csrf_exempt
def station_detail_view(request: HttpRequest, station_id: int):
    """PATCH/DELETE a station."""
    acc, err = _require_role(request, "admin")
    if err:
        return err

    if request.method == "PATCH":
        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        kwargs = {}
        for f in ("name", "location", "order", "active", "checkin_policy",
                  "capacity_mode", "max_concurrent_teams", "submission_config"):
            if f in data:
                kwargs[f] = data[f]
        station = update_station(station_id, **kwargs)
        return JsonResponse({
            "id": station.id, "code": station.code, "name": station.name,
            "active": station.active,
        })

    if request.method == "DELETE":
        delete_station(station_id)
        return JsonResponse({"status": "deactivated"})

    return JsonResponse({"error": "method_not_allowed"}, status=405)


def occupancy_view(request: HttpRequest, station_id: int):
    """GET: current station occupancy."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err
    return JsonResponse(get_occupancy(station_id))


def station_sessions_history_view(request: HttpRequest, station_id: int):
    """GET: recent session history for a station."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err
    return JsonResponse({"sessions": get_sessions_history(station_id)})


# =====================================================================
# Station sessions (enter/exit)
# =====================================================================

@csrf_exempt
def station_enter_view(request: HttpRequest):
    """POST: team enters a station."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    team_ref = str((data.get("code") or data.get("teamCode") or data.get("team_code") or "").strip())
    station_id = data.get("stationId") or data.get("station_id")
    phase_key = str((data.get("phaseKey") or data.get("phase_key") or "").strip())
    event_id = data.get("eventId") or data.get("event_id")

    if not team_ref or not station_id or not phase_key or not event_id:
        return JsonResponse({"error": "missing_fields"}, status=400)

    session, err = enter_station(
        team_ref=team_ref,
        station_id=int(station_id),
        phase_key=phase_key,
        event_id=int(event_id),
        operator=acc,
        score=data.get("score", 0),
        note=data.get("note"),
    )
    if err:
        status_map = {
            "team_not_found": 404, "station_not_found": 404,
            "team_not_approved": 403,
            "station_inactive": 400, "policy_free_play": 400,
            "station_full": 409, "session_already_active": 409,
            "event_not_found": 404, "station_not_in_event": 400,
            "team_not_in_phase": 403,
            "results_locked": 409,
        }
        return JsonResponse({"error": err}, status=status_map.get(err, 400))

    return JsonResponse({
        "id": session.id,
        "team_code": session.team.code,
        "station_code": session.station.code,
        "status": session.status,
        "entered_at": session.entered_at.isoformat(),
    }, status=201)


@csrf_exempt
def station_exit_view(request: HttpRequest):
    """POST: team exits a station."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    team_ref = str((data.get("code") or data.get("teamCode") or data.get("team_code") or "").strip())
    station_id = data.get("stationId") or data.get("station_id")

    if not team_ref or not station_id:
        return JsonResponse({"error": "missing_fields"}, status=400)

    session, err = exit_station(
        team_ref=team_ref,
        station_id=int(station_id),
        operator=acc,
        score=data.get("score"),
        note=data.get("note"),
    )
    if err:
        status_map = {
            "team_not_found": 404,
            "session_not_found": 404,
            "results_locked": 409,
        }
        return JsonResponse({"error": err}, status=status_map.get(err, 400))

    return JsonResponse({
        "id": session.id,
        "team_code": session.team.code,
        "station_code": session.station.code,
        "status": session.status,
        "exited_at": session.exited_at.isoformat() if session.exited_at else None,
        "score": session.score,
    })


def recent_sessions_view(request: HttpRequest):
    """GET: recent station sessions."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    event_id = request.GET.get("event_id")
    if event_id:
        event_id = int(event_id)
    sessions = list_recent_sessions(event_id=event_id)
    return JsonResponse({"sessions": sessions})
