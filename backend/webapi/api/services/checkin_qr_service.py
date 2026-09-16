"""
Check-in QR availability follows the running event.

The legacy admin endpoint can still rotate tokens, but its saved enabled/phase
flags no longer control attendance.
"""

from __future__ import annotations

from django.utils import timezone

from api.models import SystemSetting, PhaseRoster, Team
from api.services.program_service import get_current_phase, get_current_sub_event
from api.services.team_service import rotate_qr_token

CHECKIN_QR_KEY = "checkin_qr"


def get_checkin_qr_state() -> dict:
    """Return event availability and the optional token rotation epoch."""
    setting = SystemSetting.objects.filter(key=CHECKIN_QR_KEY).first()
    value = setting.value if setting else None
    if not isinstance(value, dict):
        value = {}
    event = get_current_sub_event()
    return {
        "enabled": event is not None,
        "phase_key": event.phase.key if event else None,
        "rotated_at": value.get("rotated_at") or None,
    }


def _save_state(state: dict) -> None:
    SystemSetting.objects.update_or_create(key=CHECKIN_QR_KEY, defaults={"value": state})


def set_checkin_qr(enabled: bool):
    """Compatibility endpoint for optional token rotation.

    On enable: rotate qr_token for every approved team in the current phase roster.
    Disabling is a no-op: only closing the event closes attendance.
    Returns (state, rotated_count, error_code).
    """
    if not enabled:
        return get_checkin_qr_state(), 0, None

    phase = get_current_phase()
    if not phase:
        return None, 0, "no_current_phase"

    rosters = PhaseRoster.objects.filter(phase=phase).select_related("team")
    rotated = 0
    for roster in rosters:
        team = roster.team
        if team and team.approval_status == Team.APPROVAL_APPROVED:
            rotate_qr_token(team)
            rotated += 1

    state = {
        "enabled": True,
        "phase_key": phase.key,
        "rotated_at": timezone.now().isoformat(),
    }
    _save_state(state)
    return get_checkin_qr_state(), rotated, None


def team_qr_visible(team) -> bool:
    """Use the running event and the same roster rule as attendance scans."""
    from api.services.attendance_service import team_eligible_for_event

    event = get_current_sub_event()
    return bool(event and team_eligible_for_event(team, event))
