"""
Event check-in views — §9.6 (canonical + legacy compat aliases).
"""

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt

from api.models import Account
from api.services.checkin_service import (
    scan_event_checkin, list_event_checkins,
    get_checkin_stats, reset_checkin,
)
from api.services.checkin_qr_service import get_checkin_qr_state, set_checkin_qr
from .views_shared import _json_body, _auth_or_401, _require_role


@csrf_exempt
def checkin_qr_view(request: HttpRequest):
    """GET: current QR check-in toggle state. POST: bật/tắt (admin) + xoay token."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method == "GET":
        return JsonResponse(get_checkin_qr_state())

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    state, rotated, err_code = set_checkin_qr(bool(data.get("enabled")))
    if err_code:
        return JsonResponse({"error": err_code}, status=400)
    return JsonResponse({**state, "rotated_teams": rotated})


# =====================================================================
# Canonical routes
# =====================================================================

@csrf_exempt
def event_checkin_scan_view(request: HttpRequest):
    """POST: scan QR for event check-in."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    qr_token = str((data.get("code") or data.get("qr_token") or "").strip())
    phase_key = str((data.get("phaseKey") or data.get("phase_key") or "").strip())
    event_id = data.get("eventId") or data.get("event_id")

    if not qr_token:
        return JsonResponse({"error": "missing_qr"}, status=400)
    if not phase_key or not event_id:
        return JsonResponse({"error": "missing_phase_or_event"}, status=400)

    ip = request.META.get("REMOTE_ADDR") or request.META.get("HTTP_X_FORWARDED_FOR")
    ua = request.META.get("HTTP_USER_AGENT")

    checkin, err = scan_event_checkin(
        qr_token=qr_token,
        phase_key=phase_key,
        event_id=int(event_id),
        scanner=acc,
        ip=ip,
        user_agent=ua,
    )
    if err:
        status_map = {
            "team_not_found": 404, "team_not_approved": 403,
            "already_checked_in": 409, "event_not_found": 404,
            "phase_not_found": 404, "team_not_in_phase": 403,
            "checkin_qr_disabled": 403, "checkin_qr_phase_mismatch": 403,
        }
        return JsonResponse({"error": err}, status=status_map.get(err, 400))

    return JsonResponse({
        "id": checkin.id,
        "team_code": checkin.team.code,
        "team_name": checkin.team.name,
        "event_name": checkin.sub_event.name,
        "status": checkin.status,
        "checked_in_at": checkin.created_at.isoformat(),
    }, status=201)


def event_checkin_list_view(request: HttpRequest):
    """GET: list event checkins."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    event_id = request.GET.get("event_id")
    phase_key = request.GET.get("phase_key")
    status = request.GET.get("status", "active")

    try:
        page = max(1, int(request.GET.get("page", "1")))
        limit = max(1, min(200, int(request.GET.get("limit", "100"))))
    except Exception:
        page, limit = 1, 100
    offset = (page - 1) * limit

    items = list_event_checkins(
        event_id=int(event_id) if event_id else None,
        phase_key=phase_key,
        status=status,
        limit=limit,
        offset=offset,
    )
    return JsonResponse({"items": items, "page": page, "limit": limit})


def event_checkin_stats_view(request: HttpRequest):
    """GET: checkin stats."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    event_id = request.GET.get("event_id")
    phase_key = request.GET.get("phase_key")
    stats = get_checkin_stats(
        event_id=int(event_id) if event_id else None,
        phase_key=phase_key or None,
    )
    return JsonResponse(stats)


@csrf_exempt
def event_checkin_reset_view(request: HttpRequest, checkin_id: int):
    """DELETE: reset a check-in."""
    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    if request.method not in ("DELETE", "POST"):
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    if reset_checkin(checkin_id):
        return JsonResponse({"status": "reset"})
    return JsonResponse({"error": "not_found"}, status=404)


# =====================================================================
# Compatibility aliases (keep FE working during transition)
# =====================================================================

@csrf_exempt
def checkin_legacy_view(request: HttpRequest):
    """Legacy POST /checkin — delegates to canonical scan."""
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    data = _json_body(request)
    if data is None:
        return JsonResponse({"error": "invalid_json"}, status=400)

    code = str((data.get("code") or "").strip())
    if not code:
        return JsonResponse({"error": "missing_code"}, status=400)

    from api.models import ProgramPhase, SubEvent
    requested_phase_key = str((data.get("phaseKey") or data.get("phase_key") or "").strip())
    requested_event_id = data.get("eventId") or data.get("event_id")

    if requested_phase_key and requested_event_id:
        phase = ProgramPhase.objects.filter(key=requested_phase_key).first()
        event = SubEvent.objects.filter(
            id=requested_event_id,
            phase=phase,
        ).first() if phase else None
    else:
        # Legacy check-in used to be global, not per-event. Keep a sensible
        # fallback until the FE is fully wired to event-specific context.
        phase = ProgramPhase.objects.filter(key="qualifying").first()
        event = SubEvent.objects.filter(
            phase=phase,
            uses_stations=True,
        ).order_by("order").first()

    if not phase or not event:
        return JsonResponse({"error": "program_not_configured"}, status=500)

    ip = request.META.get("REMOTE_ADDR") or request.META.get("HTTP_X_FORWARDED_FOR")
    ua = request.META.get("HTTP_USER_AGENT")

    checkin, err = scan_event_checkin(
        qr_token=code,
        phase_key=phase.key,
        event_id=event.id,
        scanner=acc,
        ip=ip,
        user_agent=ua,
    )
    if err:
        status_map = {
            "team_not_found": 404, "team_not_approved": 403,
            "already_checked_in": 409, "event_not_found": 404,
            "phase_not_found": 404, "team_not_in_phase": 403,
            "checkin_qr_disabled": 403, "checkin_qr_phase_mismatch": 403,
        }
        return JsonResponse({"error": err}, status=status_map.get(err, 400))

    return JsonResponse({
        "id": checkin.id,
        "team_code": checkin.team.code,
        "team_name": checkin.team.name,
        "event_name": checkin.sub_event.name,
        "status": checkin.status,
        "team": {
            "code": checkin.team.code,
            "name": checkin.team.name,
        },
        "checked_in_at": checkin.created_at.isoformat(),
    }, status=201)


def checkins_legacy_list_view(request: HttpRequest):
    """Legacy GET /checkins."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    event_id = request.GET.get("event_id")
    items = list_event_checkins(event_id=int(event_id) if event_id else None)
    return JsonResponse({"items": items})


def checkins_legacy_stats_view(request: HttpRequest):
    """Legacy GET /checkins/stats."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    phase_key = request.GET.get("phase_key")
    event_id = request.GET.get("event_id")
    stats = get_checkin_stats(
        event_id=int(event_id) if event_id else None,
        phase_key=phase_key or None,
    )
    return JsonResponse({
        "total_teams": stats["total_teams"],
        "checked_in_teams": stats["checked_in_teams"],
        "checked_in_participants": stats["checked_in_participants"],
        "latest_checkin_at": stats["latest_checkin_at"],
    })


@csrf_exempt
def checkin_legacy_reset_view(request: HttpRequest, team_key: str):
    """Legacy DELETE /checkin/:team_key — admin reset by team code."""
    if request.method not in ("DELETE", "POST"):
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    acc, err = _require_role(request, Account.ROLE_ADMIN)
    if err:
        return err

    from api.models import EventCheckIn, Team
    team = Team.objects.filter(code=team_key).first()
    if not team:
        return JsonResponse({"error": "not_found"}, status=404)

    updated = EventCheckIn.objects.filter(
        team=team, status=EventCheckIn.STATUS_ACTIVE,
    ).update(status=EventCheckIn.STATUS_REVERTED)

    return JsonResponse({
        "status": "reset",
        "team_code": team_key,
        "reverted": updated,
    })
