"""
Program service — phase management, sub-events, rosters.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from django.utils.dateparse import parse_date, parse_datetime
from django.db import transaction

from api.models import ProgramPhase, SubEvent, PhaseRoster, Team, SystemSetting


def get_program() -> dict:
    """Return the full program structure: phases + sub-events."""
    phases = ProgramPhase.objects.order_by("order")
    current_event = get_current_sub_event()
    result = {
        "current_phase": None,
        "current_sub_event_id": current_event.id if current_event else None,
        "phases": [],
    }
    for phase in phases:
        sub_events = SubEvent.objects.filter(phase=phase).order_by("order")
        phase_data = {
            "id": phase.id,
            "key": phase.key,
            "label": phase.label,
            "hint": phase.hint,
            "start_date": phase.start_date.isoformat() if phase.start_date else None,
            "end_date": phase.end_date.isoformat() if phase.end_date else None,
            "order": phase.order,
            "is_current": phase.is_current,
            "sub_events": [
                {
                    "id": se.id,
                    "phase_key": phase.key,
                    "name": se.name,
                    "type": se.type,
                    "start_date": se.start_date.isoformat() if se.start_date else None,
                    "end_date": se.end_date.isoformat() if se.end_date else None,
                    "uses_stations": se.uses_stations,
                    "replay_after_all": se.replay_after_all,
                    "note": se.note,
                    "order": se.order,
                    "is_current": bool(current_event and current_event.id == se.id),
                }
                for se in sub_events
            ],
        }
        if phase.is_current:
            result["current_phase"] = phase.key
        result["phases"].append(phase_data)
    return result


def set_current_phase(phase_key: str) -> ProgramPhase:
    """Set exactly one phase as current."""
    with transaction.atomic():
        # Phase changes and registration-only operations (such as team merge)
        # lock the same rows.  A phase cannot therefore advance halfway through
        # a merge, nor can two admins race while changing the active phase.
        phases = list(ProgramPhase.objects.select_for_update().order_by("id"))
        phase = next((item for item in phases if item.key == phase_key), None)
        if phase is None:
            raise ProgramPhase.DoesNotExist

        ProgramPhase.objects.exclude(id=phase.id).update(is_current=False)
        if not phase.is_current:
            phase.is_current = True
            phase.save(update_fields=["is_current", "updated_at"])

        current_event = get_current_sub_event()
        if current_event and current_event.phase_id != phase.id:
            SystemSetting.objects.filter(key="current_sub_event_id").delete()
    return phase


def update_phase_dates(phase_key: str, start_date=None, end_date=None) -> ProgramPhase:
    """Update start/end dates for a fixed phase."""
    phase = ProgramPhase.objects.get(key=phase_key)
    if start_date is not None:
        phase.start_date = _coerce_date(start_date)
    if end_date is not None:
        phase.end_date = _coerce_date(end_date)
    phase.save(update_fields=["start_date", "end_date", "updated_at"])
    return phase


def _coerce_date(value) -> Optional[date]:
    if value in ("", None):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        parsed = parse_date(value)
        if parsed:
            return parsed
    return value


def _coerce_datetime(value):
    if value in ("", None):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    if isinstance(value, str):
        parsed_datetime = parse_datetime(value)
        if parsed_datetime:
            return parsed_datetime
        parsed_date = parse_date(value)
        if parsed_date:
            return datetime.combine(parsed_date, datetime.min.time())
        return value
    return value


def get_current_phase() -> Optional[ProgramPhase]:
    """Return the currently active phase."""
    return ProgramPhase.objects.filter(is_current=True).first()


def create_sub_event(phase_key: str, name: str, **kwargs) -> SubEvent:
    """Create a sub-event within a phase."""
    name = str(name or "").strip()
    if not name:
        raise ValueError("missing_name")
    phase = ProgramPhase.objects.get(key=phase_key)
    for field in ("start_date", "end_date"):
        if field in kwargs:
            kwargs[field] = _coerce_datetime(kwargs[field])
    se = SubEvent(phase=phase, name=name, **kwargs)
    se.save()
    return se


def get_current_sub_event() -> Optional[SubEvent]:
    setting = SystemSetting.objects.filter(key="current_sub_event_id").first()
    if not setting or setting.value in (None, ""):
        return None
    try:
        event_id = int(setting.value)
    except (TypeError, ValueError):
        return None
    return SubEvent.objects.filter(id=event_id).select_related("phase").first()


def set_current_sub_event(event_id: int) -> Optional[SubEvent]:
    sub_event = SubEvent.objects.select_related("phase").get(id=event_id)
    current_phase = get_current_phase()
    if current_phase and sub_event.phase_id != current_phase.id:
      raise ValueError("event_not_in_current_phase")

    SystemSetting.objects.update_or_create(
        key="current_sub_event_id",
        defaults={"value": sub_event.id},
    )
    return sub_event


def update_sub_event(event_id: int, **kwargs) -> SubEvent:
    """Update a sub-event."""
    se = SubEvent.objects.get(id=event_id)
    for field, value in kwargs.items():
        if hasattr(se, field) and value is not None:
            if field in ("start_date", "end_date"):
                value = _coerce_datetime(value)
            if field == "name":
                value = str(value or "").strip()
                if not value:
                    raise ValueError("missing_name")
            setattr(se, field, value)
    se.save()
    return se


def delete_sub_event(event_id: int) -> None:
    """Delete a sub-event."""
    SubEvent.objects.filter(id=event_id).delete()


def is_team_in_phase(team: Team, phase_key: str) -> bool:
    """Check if a team is in the roster for a specific phase."""
    return PhaseRoster.objects.filter(
        team=team,
        phase__key=phase_key,
    ).exists()
