"""
Station views — config CRUD + session enter/exit (§9.5, §9.7).
"""

from django.db.models import F
from django.http import JsonResponse, HttpRequest
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from api.models import Account, Station, SubEvent, StationSession, StationAssignment, StationSubmission
from api.services.station_service import (
    create_station, update_station, delete_station,
    get_stations_for_event, get_occupancy, get_station_sessions as get_sessions_history,
    enter_station, exit_station, list_recent_sessions, set_session_score,
    set_submission_score,
)
from api.services.submission_storage_service import presigned_url, STORAGE_R2
from api.services.submission_config_service import normalize_config, public_config
from api.services.audit_service import record_audit
from api.services import scan_token_service
from api.services.assignment_service import is_collab_assigned
from api.services.checkin_service import scan_event_checkin
from api.services.program_service import get_current_sub_event
from .views_shared import _json_body, _auth_or_401, _require_role, _require_master_admin, is_admin


def _stored_submission_config(config):
    """Persist the canonical item-list shape, converting legacy section configs.

    Keeps `None` as-is so "station has no form" stays distinct from an empty form.
    """
    if config is None:
        return None
    return normalize_config(config)


_SCORING_MODES = {Station.SCORING_PASS_FAIL, Station.SCORING_THRESHOLD, Station.SCORING_SCORE_ONLY}


def _clean_scoring_kwargs(data: dict, require_defaults: bool) -> tuple[dict, str | None]:
    """Validate scoring_mode/pass_threshold/pass_points from a request body.

    `require_defaults=True` (station creation) always resolves the three
    fields, falling back to the model defaults when absent, matching how the
    other station fields are given a default on create. `require_defaults=False`
    (station update) only touches fields the caller actually sent, matching the
    partial-update behaviour of every other station field.

    A negative threshold/points is never satisfiable / never worth anything,
    so it is clamped to 0 rather than rejected — a stray minus sign shouldn't
    block the whole save.
    """
    out: dict = {}
    if require_defaults or "scoring_mode" in data:
        mode = data.get("scoring_mode", Station.SCORING_SCORE_ONLY)
        if mode not in _SCORING_MODES:
            return {}, "invalid_scoring_mode"
        out["scoring_mode"] = mode
    if require_defaults or "pass_threshold" in data:
        try:
            out["pass_threshold"] = max(0, int(data.get("pass_threshold") or 0))
        except (TypeError, ValueError):
            return {}, "invalid_pass_threshold"
    if require_defaults or "pass_points" in data:
        try:
            out["pass_points"] = max(0, int(data.get("pass_points") or 0))
        except (TypeError, ValueError):
            return {}, "invalid_pass_points"
    return out, None


def _station_scoring_dict(s: Station) -> dict:
    return {
        "scoring_mode": s.scoring_mode,
        "pass_threshold": s.pass_threshold,
        "pass_points": s.pass_points,
    }


@csrf_exempt
def station_session_score_view(request: HttpRequest, session_id: int):
    """PATCH: cập nhật điểm/kết quả cho phiên trạm (admin, hoặc collab được phân công trạm đó).

    Body phụ thuộc `station.scoring_mode`: `pass_fail` nhận `{"outcome": "passed"|"failed"}`
    (không cần điểm số); `threshold`/`score_only` nhận `{"score": N}` (outcome tự suy).
    """
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    if request.method != "PATCH":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    session = StationSession.objects.select_related("station").filter(id=session_id).first()
    if not session:
        return JsonResponse({"error": "session_not_found"}, status=404)

    if acc.role == Account.ROLE_COLLAB and not StationAssignment.objects.filter(
        collab=acc, station=session.station, active=True,
    ).exists():
        return JsonResponse({"error": "not_assigned_to_station"}, status=403)

    if session.station.scoring_mode == Station.SCORING_PASS_FAIL:
        updated, err = set_session_score(
            session_id, acc, score=None, note=data.get("note"), outcome=data.get("outcome"),
        )
    else:
        if "score" not in data:
            return JsonResponse({"error": "missing_score"}, status=400)
        updated, err = set_session_score(session_id, acc, score=data.get("score"), note=data.get("note"))

    if err:
        status = (
            409 if err == "results_locked"
            else (400 if err in ("invalid_score", "missing_score", "missing_outcome") else 404)
        )
        return JsonResponse({"error": err}, status=status)

    return JsonResponse({
        "id": updated.id,
        "team_code": updated.team.code,
        "score": updated.score,
        "outcome": updated.outcome,
    })


# =====================================================================
# Station submissions (view + grade)
# =====================================================================

def _serialize_submission(sub: StationSubmission, presign: bool = True) -> dict:
    """Chuyển StationSubmission thành dict JSON; presign=True để sinh URL R2 tạm."""
    files = []
    attachment = sub.attachment_payload or {}
    for f in (attachment.get("files") or []):
        entry = dict(f)
        if presign and entry.get("storage") == STORAGE_R2 and not entry.get("url"):
            entry["url"] = presigned_url(entry.get("key"))
        files.append(entry)

    return {
        "id": sub.id,
        "team_code": sub.team.code,
        "team_name": sub.team.name,
        "status": sub.status,
        "is_correct": sub.is_correct,
        "score": sub.score,
        "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
        "graded_at": sub.graded_at.isoformat() if sub.graded_at else None,
        "graded_by": sub.graded_by.username if sub.graded_by else None,
        "response_payload": sub.response_payload,
        "files": files,
    }


def station_submissions_view(request: HttpRequest, station_id: int):
    """GET: danh sách bài nộp của một trạm (admin, hoặc collab được phân công trạm đó)."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    station = Station.objects.filter(id=station_id).first()
    if not station:
        return JsonResponse({"error": "station_not_found"}, status=404)

    if acc.role == Account.ROLE_COLLAB and not StationAssignment.objects.filter(
        collab=acc, station=station, active=True,
    ).exists():
        return JsonResponse({"error": "not_assigned_to_station"}, status=403)

    submissions = StationSubmission.objects.select_related("team", "graded_by").filter(
        station=station,
    ).order_by(F("submitted_at").desc(nulls_last=True))

    return JsonResponse({
        "station_id": station.id,
        "station_name": station.name,
        "submissions": [_serialize_submission(sub) for sub in submissions],
    })


@csrf_exempt
def submission_grade_view(request: HttpRequest, submission_id: int):
    """PATCH: chấm bài nộp (admin, hoặc collab được phân công trạm của bài nộp đó)."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    if request.method != "PATCH":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    submission = StationSubmission.objects.select_related(
        "team", "station__sub_event__phase", "station_session", "graded_by",
    ).filter(id=submission_id).first()
    if not submission:
        return JsonResponse({"error": "submission_not_found"}, status=404)

    if acc.role == Account.ROLE_COLLAB and not StationAssignment.objects.filter(
        collab=acc, station=submission.station, active=True,
    ).exists():
        return JsonResponse({"error": "not_assigned_to_station"}, status=403)

    if "is_correct" in data and not isinstance(data.get("is_correct"), (bool, type(None))):
        return JsonResponse({"error": "invalid_is_correct"}, status=400)

    if "score" in data:
        err = set_submission_score(submission, acc, data.get("score"), data.get("note"))
        if err:
            status = 409 if err == "results_locked" else 400
            return JsonResponse({"error": err}, status=status)

    submission.status = StationSubmission.STATUS_GRADED
    submission.graded_at = timezone.now()
    submission.graded_by = acc
    if "is_correct" in data:
        submission.is_correct = data.get("is_correct")
    submission.save()

    return JsonResponse(_serialize_submission(submission, presign=False))


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

    # Collabs run the stations but never need the answer key: grading reads the
    # server-computed `quiz_result` on each submission. Admins edit the forms
    # here, so they keep the config exactly as stored.
    hide_answers = acc.role == Account.ROLE_COLLAB

    def station_config(station):
        if hide_answers:
            return public_config(station.submission_config)
        return station.submission_config

    return JsonResponse({
        "stations": [
            {
                "id": s.id, "code": s.code, "name": s.name,
                "location": s.location, "order": s.order,
                "active": s.active,
                "checkin_policy": s.checkin_policy,
                "capacity_mode": s.capacity_mode,
                "max_concurrent_teams": s.max_concurrent_teams,
                "submission_config": station_config(s),
                **_station_scoring_dict(s),
            }
            for s in stations
        ],
    })


@csrf_exempt
def station_create_view(request: HttpRequest, event_id: int):
    """POST: create station for a sub-event."""
    acc, err = _require_master_admin(request)
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

    scoring_kwargs, err = _clean_scoring_kwargs(data, require_defaults=True)
    if err:
        return JsonResponse({"error": err}, status=400)

    try:
        station = create_station(
            event_id, code, name,
            location=data.get("location"),
            order=data.get("order", 0),
            active=data.get("active", True),
            checkin_policy=data.get("checkin_policy", "staff_scan"),
            capacity_mode=data.get("capacity_mode", "unlimited"),
            max_concurrent_teams=data.get("max_concurrent_teams"),
            submission_config=_stored_submission_config(data.get("submission_config")),
            **scoring_kwargs,
        )
    except ValueError as exc:
        if str(exc) == "duplicate_station_code":
            return JsonResponse({"error": "duplicate_station_code"}, status=409)
        raise
    return JsonResponse({
        "id": station.id, "code": station.code, "name": station.name,
        **_station_scoring_dict(station),
    }, status=201)


@csrf_exempt
def station_detail_view(request: HttpRequest, station_id: int):
    """PATCH/DELETE a station."""
    acc, err = _require_master_admin(request)
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
        if "submission_config" in kwargs:
            kwargs["submission_config"] = _stored_submission_config(kwargs["submission_config"])
        scoring_kwargs, err = _clean_scoring_kwargs(data, require_defaults=False)
        if err:
            return JsonResponse({"error": err}, status=400)
        kwargs.update(scoring_kwargs)
        station = update_station(station_id, **kwargs)
        return JsonResponse({
            "id": station.id, "code": station.code, "name": station.name,
            "active": station.active,
            **_station_scoring_dict(station),
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
            "team_not_found": 404, "qr_already_used": 409, "station_not_found": 404,
            "team_not_approved": 403,
            "station_inactive": 400, "policy_free_play": 400,
            "station_full": 409, "session_already_active": 409,
            "event_not_found": 404, "station_not_in_event": 400,
            "team_not_in_phase": 403,
            "results_locked": 409,
            "checkin_qr_disabled": 403,
            "checkin_qr_phase_mismatch": 403,
            "replay_locked_incomplete": 409,
            "replay_locked_passed": 409,
        }
        return JsonResponse({"error": err}, status=status_map.get(err, 400))

    record_audit(
        actor=acc,
        action="station.enter",
        summary=f"Đội {session.team.code} vào trạm {session.station.code}",
        target_type="StationSession",
        target_id=session.id,
        after_data={"status": session.status, "score": session.score},
        reversible=False,
    )
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
            "team_not_found": 404, "qr_already_used": 409,
            "session_not_found": 404,
            "results_locked": 409,
        }
        return JsonResponse({"error": err}, status=status_map.get(err, 400))

    record_audit(
        actor=acc,
        action="station.exit",
        summary=f"Đội {session.team.code} rời trạm {session.station.code}",
        target_type="StationSession",
        target_id=session.id,
        after_data={"status": session.status, "score": session.score},
        reversible=False,
    )
    return JsonResponse({
        "id": session.id,
        "team_code": session.team.code,
        "station_code": session.station.code,
        "status": session.status,
        "exited_at": session.exited_at.isoformat() if session.exited_at else None,
        "score": session.score,
    })


@csrf_exempt
def station_scan_view(request: HttpRequest):
    """POST: one scan does everything.

    The QR carries the team, the station and the direction, so a coop just points
    the camera — there is no station dropdown and no enter/exit toggle to get
    wrong. A station QR (`t:<token>|s:<id>|d:in|out`) checks the team in or out at
    that station, and only a coop assigned there (or an admin) may do it. A bare
    event QR (`t:<token>`) checks the team into the running sub-event at the gate.
    """
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    raw_code = str((data.get("code") or "").strip())
    if not raw_code:
        return JsonResponse({"error": "missing_fields"}, status=400)

    token, station_id, direction = scan_token_service.parse_scan(raw_code)

    # ── Event-gate QR: no station named in the code ──────────────────────
    if station_id is None:
        sub_event = get_current_sub_event()
        if not sub_event:
            return JsonResponse({"error": "no_current_event"}, status=409)
        checkin, err = scan_event_checkin(
            qr_token=token,
            phase_key=sub_event.phase.key,
            event_id=sub_event.id,
            scanner=acc,
            ip=request.META.get("REMOTE_ADDR"),
            user_agent=request.META.get("HTTP_USER_AGENT"),
        )
        if err:
            status_map = {
                "team_not_found": 404, "qr_already_used": 409, "team_not_approved": 403,
                "already_checked_in": 409, "event_not_found": 404,
                "phase_not_found": 404, "team_not_in_phase": 403,
                "checkin_qr_disabled": 403, "checkin_qr_phase_mismatch": 403,
            }
            return JsonResponse({"error": err}, status=status_map.get(err, 400))
        return JsonResponse({
            "kind": "event",
            "id": checkin.id,
            "team_code": checkin.team.code,
            "team_name": checkin.team.name,
            "event_name": checkin.sub_event.name,
            "checked_in_at": checkin.created_at.isoformat(),
        }, status=201)

    # ── Station QR: the code names the station and the direction ─────────
    station = Station.objects.select_related("sub_event__phase").filter(id=station_id).first()
    if not station:
        return JsonResponse({"error": "station_not_found"}, status=404)

    # Only a coop posted to this station may scan it; admins scan anywhere.
    if not is_admin(acc) and not is_collab_assigned(acc.id, station.id):
        return JsonResponse({"error": "not_assigned_to_station"}, status=403)

    is_exit = direction == "out"
    if is_exit:
        session, err = exit_station(
            team_ref=token,
            station_id=station.id,
            operator=acc,
        )
    else:
        # A missing direction is read as check-in: the entry QR is the first a
        # team shows, and enter_station refuses a duplicate active session anyway.
        session, err = enter_station(
            team_ref=token,
            station_id=station.id,
            phase_key=station.sub_event.phase.key,
            event_id=station.sub_event_id,
            operator=acc,
        )
    if err:
        status_map = {
            "team_not_found": 404, "qr_already_used": 409, "station_not_found": 404,
            "team_not_approved": 403, "station_inactive": 400, "policy_free_play": 400,
            "station_full": 409, "session_already_active": 409,
            "event_not_found": 404, "station_not_in_event": 400,
            "team_not_in_phase": 403, "results_locked": 409,
            "checkin_qr_disabled": 403, "checkin_qr_phase_mismatch": 403,
            "session_not_found": 404,
            "replay_locked_incomplete": 409, "replay_locked_passed": 409,
        }
        return JsonResponse({"error": err}, status=status_map.get(err, 400))

    record_audit(
        actor=acc,
        action="station.exit" if is_exit else "station.enter",
        summary=f"Đội {session.team.code} {'rời' if is_exit else 'vào'} trạm {session.station.code}",
        target_type="StationSession",
        target_id=session.id,
        after_data={"status": session.status, "score": session.score},
        reversible=False,
    )
    return JsonResponse({
        "kind": "exit" if is_exit else "enter",
        "id": session.id,
        "team_code": session.team.code,
        "team_name": session.team.name,
        "station_code": session.station.code,
        "station_name": session.station.name,
        "status": session.status,
        "entered_at": session.entered_at.isoformat() if session.entered_at else None,
        "exited_at": session.exited_at.isoformat() if session.exited_at else None,
        "score": session.score,
        **_station_scoring_dict(session.station),
    }, status=200 if is_exit else 201)


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
