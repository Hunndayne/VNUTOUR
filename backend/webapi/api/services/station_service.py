"""
Station service — configuration CRUD, occupancy, session enter/exit.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Tuple

from django.db import IntegrityError, transaction

from api.models import (
    Account, Team, Station, StationSession, SubEvent,
    ProgramPhase, ScoreEntry, PhaseRoster, StationSubmission,
)
from api.services.result_lock_service import results_are_locked
from api.services.checkin_qr_service import get_checkin_qr_state
from api.services import scan_token_service


# =====================================================================
# Station configuration CRUD
# =====================================================================

def create_station(sub_event_id: int, code: str, name: str, **kwargs) -> Station:
    """Create a station for a sub-event."""
    sub_event = SubEvent.objects.get(id=sub_event_id)
    try:
        station = Station(sub_event=sub_event, code=code, name=name, **kwargs)
        station.save()
        return station
    except IntegrityError as exc:
        raise ValueError("duplicate_station_code") from exc


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
    team_ref: str,
    station_id: int,
    phase_key: str,
    event_id: int,
    operator: Account,
    score: int = 0,
    note: str | None = None,
) -> Tuple[Optional[StationSession], Optional[str]]:
    """Record a team entering a station."""
    team, resolve_error = scan_token_service.resolve_team(team_ref)
    if team and team.approval_status != Team.APPROVAL_APPROVED:
        return None, "team_not_approved"
    if not team:
        return None, resolve_error

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

    if str(team_ref or "").strip().lower().startswith("t:"):
        qr_state = get_checkin_qr_state()
        if not qr_state["enabled"]:
            return None, "checkin_qr_disabled"
        if qr_state.get("phase_key") != phase.key:
            return None, "checkin_qr_phase_mismatch"

    if results_are_locked():
        return None, "results_locked"

    if PhaseRoster.objects.filter(phase=phase).exists() and not PhaseRoster.objects.filter(
        phase=phase,
        team=team,
    ).exists():
        return None, "team_not_in_phase"

    if station.sub_event_id != int(event_id):
        return None, "station_not_in_event"

    now = datetime.now(timezone.utc)
    try:
        with transaction.atomic():
            station = Station.objects.select_for_update().select_related(
                "sub_event__phase",
            ).get(id=station.id)
            if not station.active:
                return None, "station_inactive"
            if station.capacity_mode == Station.CAPACITY_LIMITED and station.max_concurrent_teams:
                active_count = StationSession.objects.filter(
                    station=station,
                    status=StationSession.STATUS_ACTIVE,
                ).count()
                if active_count >= station.max_concurrent_teams:
                    return None, "station_full"
            session = StationSession.objects.create(
                phase=phase, sub_event=sub_event, station=station, team=team,
                status=StationSession.STATUS_ACTIVE, entered_at=now,
                entered_by=operator, score=score, note=note,
            )
            # Retire the scanned QR inside the same transaction as the session,
            # so a re-read of the same image cannot enter the team twice.
            scan_token_service.consume(team_ref, team)
            return session, None
    except IntegrityError:
        return None, "session_already_active"


def exit_station(
    team_ref: str,
    station_id: int,
    operator: Account,
    score: int | None = None,
    note: str | None = None,
) -> Tuple[Optional[StationSession], Optional[str]]:
    """Record a team exiting a station."""
    team, resolve_error = scan_token_service.resolve_team(team_ref)
    if not team:
        return None, resolve_error

    with transaction.atomic():
        session = StationSession.objects.select_for_update().select_related(
            "phase", "sub_event", "station", "team",
        ).filter(
            station_id=station_id,
            team=team,
            status=StationSession.STATUS_ACTIVE,
        ).first()
        if not session:
            return None, "session_not_found"

        if results_are_locked():
            return None, "results_locked"

        now = datetime.now(timezone.utc)
        session.status = StationSession.STATUS_CLOSED
        session.exited_at = now
        session.exited_by = operator
        if score is not None:
            try:
                session.score = int(score)
            except (TypeError, ValueError):
                return None, "invalid_score"
        if note is not None:
            session.note = note
        session.save(update_fields=["status", "exited_at", "exited_by", "score", "note", "updated_at"])

        score_entries = ScoreEntry.objects.filter(
            station_session=session,
            kind=ScoreEntry.KIND_STATION,
        )
        if session.score:
            ScoreEntry.objects.update_or_create(
                station_session=session,
                kind=ScoreEntry.KIND_STATION,
                defaults={
                    "phase": session.phase,
                    "sub_event": session.sub_event,
                    "team": team,
                    "points": session.score,
                    "note": session.note or f"Tram {session.station.code}",
                    "created_by": operator,
                },
            )
        else:
            score_entries.delete()

        # Inside the transaction, as in enter_station: the exit and the QR going
        # stale have to land together or neither.
        scan_token_service.consume(team_ref, team)

    return session, None


def set_session_score(
    session_id: int,
    operator: Account,
    score,
    note: str | None = None,
) -> Tuple[Optional[StationSession], Optional[str]]:
    """Set/cập nhật điểm cho một phiên trạm và đồng bộ ScoreEntry tương ứng."""
    try:
        points = int(score)
    except (TypeError, ValueError):
        return None, "invalid_score"

    with transaction.atomic():
        session = StationSession.objects.select_for_update().select_related(
            "phase", "sub_event", "team", "station",
        ).filter(id=session_id).first()
        if not session:
            return None, "session_not_found"

        if results_are_locked():
            return None, "results_locked"

        session.score = points
        if note is not None:
            session.note = note
        session.save(update_fields=["score", "note", "updated_at"])

        entries = ScoreEntry.objects.filter(
            station_session=session,
            kind=ScoreEntry.KIND_STATION,
        )
        if points:
            ScoreEntry.objects.update_or_create(
                station_session=session,
                kind=ScoreEntry.KIND_STATION,
                defaults={
                    "phase": session.phase,
                    "sub_event": session.sub_event,
                    "team": session.team,
                    "points": points,
                    "note": note or f"Tram {session.station.code}",
                    "created_by": operator,
                },
            )
        else:
            entries.delete()

    return session, None


def set_submission_score(
    submission: StationSubmission,
    operator: Account,
    score,
    note: str | None = None,
) -> Optional[str]:
    """Set/cập nhật điểm cho một bài nộp và đồng bộ ScoreEntry tương ứng.

    Bài nộp gắn với phiên trạm dùng chung ScoreEntry của phiên đó (tránh cộng đôi
    với điểm coop chấm lúc checkout); bài nộp tự do khóa entry theo submission.
    """
    if results_are_locked():
        return "results_locked"

    try:
        points = int(score)
    except (TypeError, ValueError):
        return "invalid_score"

    submission.score = points
    submission.save(update_fields=["score", "updated_at"])

    session = submission.station_session
    entry = None
    if session:
        entry = ScoreEntry.objects.filter(
            station_session=session, kind=ScoreEntry.KIND_STATION,
        ).first()
    if entry is None:
        entry = ScoreEntry.objects.filter(
            submission=submission, kind=ScoreEntry.KIND_STATION,
        ).first()

    default_note = f"Bai nop tram {submission.station.code}"
    if entry:
        entry.points = points
        entry.submission = submission
        if note is not None:
            entry.note = note
        entry.save(update_fields=["points", "submission", "note", "updated_at"])
    else:
        ScoreEntry.objects.create(
            phase=submission.station.sub_event.phase,
            sub_event=submission.station.sub_event,
            station_session=session,
            submission=submission,
            team=submission.team,
            kind=ScoreEntry.KIND_STATION,
            points=points,
            note=note or default_note,
            created_by=operator,
        )

    if session:
        session.score = points
        session.save(update_fields=["score", "updated_at"])

    return None


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
