"""
Check-in QR service — admin toggle + per-phase token rotation.

Mỗi đội có một qr_token dùng cho mọi trạm. Admin "bật" điểm danh sẽ xoay token
cho toàn bộ đội trong roster của phase hiện tại (mỗi lần bật là một QR khác nhau,
ảnh QR cũ hết hiệu lực). QR chỉ hiển thị cho đội thuộc phase hiện tại.
"""

from __future__ import annotations

from django.utils import timezone

from api.models import SystemSetting, PhaseRoster, Team
from api.services.program_service import get_current_phase
from api.services.team_service import rotate_qr_token

CHECKIN_QR_KEY = "checkin_qr"


def get_checkin_qr_state() -> dict:
    """Return current toggle state: {enabled, phase_key, rotated_at}."""
    setting = SystemSetting.objects.filter(key=CHECKIN_QR_KEY).first()
    value = setting.value if setting else None
    if not isinstance(value, dict):
        value = {}
    return {
        "enabled": bool(value.get("enabled")),
        "phase_key": value.get("phase_key") or None,
        "rotated_at": value.get("rotated_at") or None,
    }


def _save_state(state: dict) -> None:
    SystemSetting.objects.update_or_create(key=CHECKIN_QR_KEY, defaults={"value": state})


def set_checkin_qr(enabled: bool):
    """Toggle the team check-in QR.

    On enable: rotate qr_token for every approved team in the current phase roster.
    Returns (state, rotated_count, error_code).
    """
    if not enabled:
        state = get_checkin_qr_state()
        state["enabled"] = False
        _save_state(state)
        return state, 0, None

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
    return state, rotated, None


def team_qr_visible(team) -> bool:
    """QR is visible only when enabled AND the team is in the current phase roster."""
    state = get_checkin_qr_state()
    if not state["enabled"]:
        return False
    phase = get_current_phase()
    if not phase:
        return False
    if state.get("phase_key") and state["phase_key"] != phase.key:
        return False
    return PhaseRoster.objects.filter(phase=phase, team=team).exists()
