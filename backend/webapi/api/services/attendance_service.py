"""Personal check-in QR codes and the event's minimum attendance rule."""
from django.core import signing
from django.db.models import Q

from api.models import EventAttendance, EventCheckIn, PhaseRoster, TeamMembership
from api.services.checkin_qr_service import get_checkin_qr_state

QR_SALT = "vnutour.personal-event-checkin.v1"


def team_eligible_for_event(team, event) -> bool:
    """The one roster rule every check-in path shares.

    A phase that has a roster admits only the teams on it; a phase without one
    is open to whoever is in the current phase.  `scan_event_checkin` accepts a
    scan on exactly these terms, so the QR views must hand one out on them too
    — otherwise the backend takes a code the frontend never issues.
    """
    if PhaseRoster.objects.filter(phase=event.phase, team=team).exists():
        return True
    if PhaseRoster.objects.filter(phase=event.phase).exists():
        return False  # phase is roster-gated and this team is not on it
    from api.services.program_service import get_current_phase
    current_phase = get_current_phase()
    return bool(current_phase and event.phase_id == current_phase.id)


def recorded_checkins():
    """Headers with actual attendance; checkout alone does not prove presence."""
    team_record = Q(sub_event__checkin_mode="team") & (
        Q(meta__isnull=True) | ~Q(meta__has_key="checkout_only") | Q(meta__checkout_only=False)
    )
    individual_record = Q(sub_event__checkin_mode="individual", attendances__isnull=False)
    return EventCheckIn.objects.filter(team_record | individual_record).distinct()


def personal_qr(participant_id, team_id, event_id):
    return "p:" + signing.dumps({
        "participant_id": participant_id, "team_id": team_id, "event_id": event_id,
        "epoch": get_checkin_qr_state()["rotated_at"],
    }, salt=QR_SALT, compress=True)


def resolve_personal_qr(code, event):
    if not code.startswith("p:"):
        return None, "personal_qr_required"
    try:
        payload = signing.loads(code[2:], salt=QR_SALT, max_age=86400)
    except signing.BadSignature:
        return None, "invalid_personal_qr"
    state = get_checkin_qr_state()
    if not state["enabled"]:
        return None, "checkin_qr_disabled"
    if state["phase_key"] != event.phase.key:
        return None, "checkin_qr_phase_mismatch"
    if payload.get("event_id") != event.id:
        return None, "checkin_qr_event_mismatch"
    if payload.get("epoch") != state["rotated_at"]:
        return None, "invalid_personal_qr"
    membership = TeamMembership.objects.select_related("team", "participant").filter(
        team_id=payload.get("team_id"), participant_id=payload.get("participant_id"),
    ).first()
    return (membership, None) if membership else (None, "participant_not_in_team")


def attendance_state(team, event, participant_id=None):
    checkin = EventCheckIn.objects.filter(
        team=team, sub_event=event, status=EventCheckIn.STATUS_ACTIVE,
    ).first()
    rows = EventAttendance.objects.filter(
        checkin=checkin,
        participant_id__in=TeamMembership.objects.filter(team=team).values("participant_id"),
    ) if checkin else EventAttendance.objects.none()
    team_checked_in = bool(checkin and not (checkin.meta or {}).get("checkout_only"))
    if event.checkin_mode == event.CHECKIN_TEAM:
        count = TeamMembership.objects.filter(team=team).count() if team_checked_in else 0
    else:
        count = rows.values("participant_id").distinct().count()
    checked_out = bool(checkin and checkin.checked_out_at)
    return {
        "checked_in_count": count,
        "required_count": (
            0 if not event.require_checkin else
            event.min_checkin_members if event.checkin_mode == event.CHECKIN_INDIVIDUAL else 1
        ),
        "eligible": not checked_out and (
            not event.require_checkin or
            (team_checked_in if event.checkin_mode == event.CHECKIN_TEAM else count >= event.min_checkin_members)
        ),
        "checked_out": checked_out,
        "checked_in": (
            team_checked_in if event.checkin_mode == event.CHECKIN_TEAM else
            rows.filter(participant_id=participant_id).exists() if participant_id else False
        ),
    }


def checkin_response(result):
    """Stable scan payload for either a team-mode header or individual attendance."""
    if isinstance(result, EventAttendance):
        attendance = result
        checkin = attendance.checkin
        participant = {
            "participant_id": attendance.participant_id,
            "participant_name": attendance.participant.full_name,
            "mssv": attendance.participant.mssv,
            "checked_in_at": attendance.created_at.isoformat(),
        }
        state = attendance_state(checkin.team, checkin.sub_event, attendance.participant_id)
    else:
        checkin = result
        participant = {"checked_in_at": checkin.created_at.isoformat()}
        state = attendance_state(checkin.team, checkin.sub_event)
    return {
        "kind": "event", "id": checkin.id, "status": checkin.status,
        "team_code": checkin.team.code, "team_name": checkin.team.name,
        "event_name": checkin.sub_event.name,
        "checkin_mode": checkin.sub_event.checkin_mode,
        **participant,
        **state,
    }
