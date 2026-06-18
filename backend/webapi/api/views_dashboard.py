"""
Dashboard, settings & health views — §9.11.
"""

from datetime import datetime, timezone

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt

from api.models import (
    Account, Team, TeamMembership, ProgramPhase,
    SubEvent, EventCheckIn, StationSession, ScoreEntry,
    SystemSetting,
)
from .views_shared import _json_body, _auth_or_401, _require_role


# =====================================================================
# Health
# =====================================================================

def health(request: HttpRequest):
    """Simple health check."""
    try:
        # Verify DB connectivity
        Account.objects.first()
        return JsonResponse({
            "status": "ok",
            "time": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        return JsonResponse({"status": "error", "error": str(e)}, status=500)


# =====================================================================
# Dashboard
# =====================================================================

def overview_view(request: HttpRequest):
    """GET: KPI overview for admin/collab."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    phase_key = request.GET.get("phase")
    current_phase = ProgramPhase.objects.filter(is_current=True).first()

    total_teams = Team.objects.count()
    approved_teams = Team.objects.filter(approval_status=Team.APPROVAL_APPROVED).count()
    total_participants = TeamMembership.objects.count()

    # Current phase event stats
    phase_stats = {}
    if phase_key:
        try:
            phase = ProgramPhase.objects.get(key=phase_key)
            events = SubEvent.objects.filter(phase=phase)
            for event in events:
                checkins = EventCheckIn.objects.filter(
                    sub_event=event, status=EventCheckIn.STATUS_ACTIVE,
                ).count()
                sessions = StationSession.objects.filter(
                    sub_event=event, status=StationSession.STATUS_ACTIVE,
                ).count()
                phase_stats[event.name] = {
                    "checkins": checkins,
                    "active_station_sessions": sessions,
                }
        except ProgramPhase.DoesNotExist:
            pass

    return JsonResponse({
        "current_phase": current_phase.key if current_phase else None,
        "stats": {
            "total_teams": total_teams,
            "approved_teams": approved_teams,
            "total_participants": total_participants,
        },
        "phase_stats": phase_stats,
    })


def activity_view(request: HttpRequest):
    """GET: recent activity feed."""
    acc, err = _require_role(request, Account.ROLE_ADMIN, Account.ROLE_COLLAB)
    if err:
        return err

    # Recent checkins
    recent_checkins = EventCheckIn.objects.select_related("team", "sub_event").order_by(
        "-created_at",
    )[:10]

    # Recent station sessions
    recent_sessions = StationSession.objects.select_related(
        "team", "station",
    ).order_by("-entered_at")[:10]

    feed = []

    for c in recent_checkins:
        feed.append({
            "type": "event_checkin",
            "team_code": c.team.code,
            "team_name": c.team.name,
            "event": c.sub_event.name,
            "time": c.created_at.isoformat(),
        })

    for s in recent_sessions:
        feed.append({
            "type": "station_session",
            "team_code": s.team.code,
            "team_name": s.team.name,
            "station": s.station.code,
            "action": "enter" if s.status == "active" else "exit",
            "time": s.entered_at.isoformat(),
        })

    # Sort merged feed by time, newest first
    feed.sort(key=lambda x: x["time"], reverse=True)
    feed = feed[:20]

    return JsonResponse({"items": feed})


# =====================================================================
# Settings
# =====================================================================

@csrf_exempt
def settings_view(request: HttpRequest):
    """GET: read settings. PUT/PATCH: update settings (admin)."""
    acc, err = _auth_or_401(request)
    if err:
        return err

    if request.method == "GET":
        settings = {
            "registration_open": False,
            "team_max_members": 5,
            "collab_can_edit_scores": False,
            "sheet_import_enabled": False,
            "sheet_checkin_export_enabled": False,
        }
        for key in settings:
            s = SystemSetting.objects.filter(key=key).first()
            if s:
                settings[key] = s.value
        return JsonResponse(settings)

    if request.method in ("PUT", "PATCH"):
        if acc.role != Account.ROLE_ADMIN:
            return JsonResponse({"error": "forbidden"}, status=403)

        data = _json_body(request)
        if data is None:
            return JsonResponse({"error": "invalid_json"}, status=400)

        default_settings = {
            "registration_open": False,
            "team_max_members": 5,
            "collab_can_edit_scores": False,
            "sheet_import_enabled": False,
            "sheet_checkin_export_enabled": False,
        }

        for key, default in default_settings.items():
            if key in data:
                value = data[key]
                if isinstance(default, bool):
                    value = bool(value)
                elif isinstance(default, int):
                    value = int(value)
                SystemSetting.objects.update_or_create(
                    key=key, defaults={"value": value},
                )

        return JsonResponse({key: SystemSetting.objects.filter(key=key).first().value
                            for key in default_settings})

    return JsonResponse({"error": "method_not_allowed"}, status=405)
