"""
Program service — phase management, sub-events, rosters.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from api.models import ProgramPhase, SubEvent, PhaseRoster, Team


def get_program() -> dict:
    """Return the full program structure: phases + sub-events."""
    phases = ProgramPhase.objects.order_by("order")
    result = {
        "current_phase": None,
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
                    "note": se.note,
                    "order": se.order,
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
    ProgramPhase.objects.update(is_current=False)
    phase = ProgramPhase.objects.get(key=phase_key)
    phase.is_current = True
    phase.save(update_fields=["is_current", "updated_at"])
    return phase


def update_phase_dates(phase_key: str, start_date=None, end_date=None) -> ProgramPhase:
    """Update start/end dates for a fixed phase."""
    phase = ProgramPhase.objects.get(key=phase_key)
    if start_date is not None:
        phase.start_date = start_date
    if end_date is not None:
        phase.end_date = end_date
    phase.save(update_fields=["start_date", "end_date", "updated_at"])
    return phase


def get_current_phase() -> Optional[ProgramPhase]:
    """Return the currently active phase."""
    return ProgramPhase.objects.filter(is_current=True).first()


def create_sub_event(phase_key: str, name: str, **kwargs) -> SubEvent:
    """Create a sub-event within a phase."""
    phase = ProgramPhase.objects.get(key=phase_key)
    se = SubEvent(phase=phase, name=name, **kwargs)
    se.save()
    return se


def update_sub_event(event_id: int, **kwargs) -> SubEvent:
    """Update a sub-event."""
    se = SubEvent.objects.get(id=event_id)
    for field, value in kwargs.items():
        if hasattr(se, field) and value is not None:
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
