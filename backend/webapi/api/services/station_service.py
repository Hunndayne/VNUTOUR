"""
Station service — configuration CRUD, occupancy, session enter/exit.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Tuple

from django.db import IntegrityError, transaction

from api.models import (
    Account, Team, Station, StationSession, SubEvent,
    ProgramPhase, ScoreEntry,
)


# =====================================================================
# Station configuration CRUD
# =====================================================================

def create_station(sub_event_id: int, code: str, name: str, **kwargs) -> Station:
    """Create a station for a sub-event."""
    sub_event = SubEvent.objects.get(id=sub_event_id)
    station = Station(sub_event=sub_event, code=code, name=name, **kwargs)
    station.save()
    return station


def update_station(station_id: int, **kwargs) -> Station:
    """Update station fields."""
    station = Station.objects.get(id=station_id)
    for field, value in kwargs.items():
        if hasattr(station, field) and value is not None:
            setattr(station, field, value)
    station.save()
    return station


def delete_station(station_id: int) -> None:
    """Soft-delete: deactivate station."""
    Station.objects.filter(id=station_id).update(active=False)


def get_stations_for_event(sub_event_id: int, include_inactive: bool = False) -> list[Station]:
    """Get stations for a sub-event. Admin config views pass include_inactive=True
    so deactivated (soft-deleted) stations remain visible and can be re-enabled."""
    qs = Station.objects.filter(sub_event_id=sub_event_id)
    if not include_inactive:
        qs = qs.filter(active=True)
    return list(qs.order_by("order"))


def get_occupancy(station_id: int) -> dict:
    """Return current occupancy info for a station."""
    station = Station.objects.get(id=station_id)
    active_count = StationSession.objects.filter(
        station=station, status=StationSession.STATUS_ACTIVE,
    ).count()

    result = {
        "station_id": station.id,
        "station_code": station.code,
        "station_name": station.name,
        "active_sessions": active_count,
        "capacity_mode": station.capacity_mode,
        "max_concurrent_teams": station.max_concurrent_teams,
        "is_full": False,
    }
    if station.capacity_mode == Station.CAPACITY_LIMITED and station.max_concurrent_teams:
        result["is_full"] = active_count >= station.max_concurrent_teams
    return result


def get_station_sessions(station_id: int, limit: int = 50) -> list[dict]:
    """Return recent session history for a station."""
    sessions = StationSession.objects.filter(
        station_id=station_id,
    ).select_related("team").order_by("-entered_at")[:limit]
    return [
        {
            "id": s.id, "team_code": s.team.code, "team_name": s.team.name,
            "status": s.status,
            "entered_at": s.entered_at.isoformat(),
            "exited_at": s.exited_at.isoformat() if s.exited_at else None,
            "score": s.score, "note": s.note,
        }
        for s in sessions
    ]


# =====================================================================
# Station sessions — enter / exit
# =====================================================================

def enter_station(
    team_code: str,
    station_id: int,
    phase_key: str,
    event_id: int,
    operator: Account,
    score: int = 0,
    note: str | None = None,
) -> Tuple[Optional[StationSession], Optional[str]]:
    """Record a team entering a station."""
    team = Team.objects.filter(code=team_code, approval_status=Team.APPROVAL_APPROVED).first()
    if not team:
        return None, "team_not_found"

    station = Station.objects.select_related("sub_event__phase").filter(
        id=station_id,
    ).first()
    if not station:
        return None, "station_not_found"
    if not station.active:
        return None, "station_inactive"

    # Free-play: no scan enforced
    if station.checkin_policy == Station.POLICY_FREE_PLAY:
        return None, "policy_free_play"

    try:
        phase = ProgramPhase.objects.get(key=phase_key)
        sub_event = SubEvent.objects.get(id=event_id, phase=phase)
    except (ProgramPhase.DoesNotExist, SubEvent.DoesNotExist):
        return None, "event_not_found"

    if station.sub_event_id != int(event_id):
        return None, "station_not_in_event"

    # Capacity gate
    if station.capacity_mode == Station.CAPACITY_LIMITED and station.max_concurrent_teams:
        active_count = StationSession.objects.filter(
            station=station, status=StationSession.STATUS_ACTIVE,
        ).count()
        if active_count >= station.max_concurrent_teams:
            return None, "station_full"

    now = datetime.now(timezone.utc)
    try:
        with transaction.atomic():
            session = StationSession.objects.create(
                phase=phase, sub_event=sub_event, station=station, team=team,
                status=StationSession.STATUS_ACTIVE, entered_at=now,
                entered_by=operator, score=score, note=note,
            )
            return session, None
    except IntegrityError:
        return None, "session_already_active"


def exit_station(
    team_code: str,
    station_id: int,
    operator: Account,
    score: int | None = None,
    note: str | None = None,
) -> Tuple[Optional[StationSession], Optional[str]]:
    """Record a team exiting a station."""
    team = Team.objects.filter(code=team_code).first()
    if not team:
        return None, "team_not_found"

    session = StationSession.objects.filter(
        station_id=station_id, team=team, status=StationSession.STATUS_ACTIVE,
    ).first()
    if not session:
        return None, "session_not_found"

    now = datetime.now(timezone.utc)
    session.status = StationSession.STATUS_CLOSED
    session.exited_at = now
    session.exited_by = operator
    if score is not None:
        session.score = score
    if note is not None:
        session.note = note
    session.save(update_fields=["status", "exited_at", "exited_by", "score", "note", "updated_at"])

    # Auto-create score entry
    if session.score:
        ScoreEntry.objects.create(
            phase=session.phase, sub_event=session.sub_event,
            station_session=session, team=team,
            kind=ScoreEntry.KIND_STATION, points=session.score,
            note=f"Tram {session.station.code}", created_by=operator,
        )

    return session, None


def list_recent_sessions(event_id: int | None = None, limit: int = 50) -> list[dict]:
    """Return recent station sessions."""
    qs = StationSession.objects.select_related(
        "team", "station", "sub_event",
    ).order_by("-entered_at")
    if event_id:
        qs = qs.filter(sub_event_id=event_id)

    return [
        {
            "id": s.id, "team_code": s.team.code, "team_name": s.team.name,
            "station_code": s.station.code, "station_name": s.station.name,
            "event_name": s.sub_event.name, "status": s.status,
            "entered_at": s.entered_at.isoformat(),
            "exited_at": s.exited_at.isoformat() if s.exited_at else None,
            "score": s.score, "note": s.note,
        }
        for s in qs[:limit]
    ]
