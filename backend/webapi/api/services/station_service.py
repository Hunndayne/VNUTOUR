"""
Station service — configuration CRUD, occupancy, session enter/exit.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Tuple

from django.db import IntegrityError, transaction
from django.db.models import Q

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
    """Hard-delete the station and its score entries."""
    ScoreEntry.objects.filter(
        Q(station_session__station_id=station_id) |
        Q(submission__station_id=station_id)
    ).delete()
    Station.objects.filter(id=station_id).delete()


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
# Scoring — one ScoreEntry(kind=station) per (team, station), max across plays
# =====================================================================

def _derive_numeric_outcome(station: Station, points: int) -> Optional[str]:
    """Outcome implied by a plain numeric score.

    `pass_fail` stations have no number to read a verdict from — a coop states
    the outcome directly (see `set_session_score`) — so this returns None for
    that mode and the caller leaves `outcome` untouched.
    """
    if station.scoring_mode == Station.SCORING_THRESHOLD:
        return (
            StationSession.OUTCOME_PASSED if points >= station.pass_threshold
            else StationSession.OUTCOME_FAILED
        )
    if station.scoring_mode == Station.SCORING_SCORE_ONLY:
        return StationSession.OUTCOME_PASSED
    return None


def _sync_station_score_entry(team: Team, station: Station, operator: Optional[Account] = None) -> None:
    """Recompute the team's score at a station and collapse it onto one row.

    Replaying a station must never let scores stack, so exactly one
    `ScoreEntry(kind=station)` is allowed to exist per (team, station) — this
    is the only place that writes one. Called after every `exit_station`,
    `set_session_score` and `set_submission_score`, it re-derives the value
    from every non-cancelled session per `station.scoring_mode`:
      - score_only: max score across every session (a play doesn't need to
        "pass" to count).
      - threshold: max score, but only among sessions that passed; none
        passed yet is worth 0.
      - pass_fail: `pass_points` if any session passed, else 0.
    then parks the entry on whichever session earned that value and deletes
    any other station/submission-scoped entries left over from earlier plays.
    """
    sessions = list(
        StationSession.objects.filter(team=team, station=station)
        .exclude(status=StationSession.STATUS_CANCELLED)
        .order_by("-entered_at")
    )

    if station.scoring_mode == Station.SCORING_PASS_FAIL:
        passed = [s for s in sessions if s.outcome == StationSession.OUTCOME_PASSED]
        best_session = passed[0] if passed else None
        value = station.pass_points if best_session else 0
    elif station.scoring_mode == Station.SCORING_THRESHOLD:
        passed = [s for s in sessions if s.outcome == StationSession.OUTCOME_PASSED]
        best_session = max(passed, key=lambda s: s.score, default=None)
        value = best_session.score if best_session else 0
    else:  # score_only
        best_session = max(sessions, key=lambda s: s.score, default=None)
        value = best_session.score if best_session else 0

    # A team keeps at most one StationSubmission per station (the form view
    # overwrites it in place on resubmission), so this is the only submission
    # that could already own a ScoreEntry for this pair.
    submission = StationSubmission.objects.filter(
        team=team, station=station,
    ).order_by("-created_at").first()

    session_ids = [s.id for s in sessions]
    scope = Q(pk__in=[])
    if session_ids:
        scope |= Q(station_session_id__in=session_ids)
    if submission:
        scope |= Q(submission=submission)
    existing = list(ScoreEntry.objects.filter(Q(kind=ScoreEntry.KIND_STATION) & scope))

    if value <= 0 or best_session is None:
        if existing:
            ScoreEntry.objects.filter(id__in=[e.id for e in existing]).delete()
        return

    keep = existing[0] if existing else None
    if len(existing) > 1:
        ScoreEntry.objects.filter(id__in=[e.id for e in existing[1:]]).delete()

    fields = {
        "phase": best_session.phase,
        "sub_event": best_session.sub_event,
        "team": team,
        "points": value,
        "note": best_session.note or f"Tram {station.code}",
        "station_session": best_session,
        # Keep the submission link (if any) purely for traceability — grading a
        # submission still funnels through this same recompute.
        "submission": submission,
    }
    if keep:
        for field, val in fields.items():
            setattr(keep, field, val)
        if operator is not None:
            keep.created_by = operator
        keep.save()
    else:
        ScoreEntry.objects.create(kind=ScoreEntry.KIND_STATION, created_by=operator, **fields)


def replay_lock_reason(
    *, has_prior_closed: bool, all_visited: bool, has_passed: bool,
) -> Optional[str]:
    """Decide whether the qualifying-round replay rule blocks a re-entry.

    A pure function of three facts so `enter_station` (fresh, row-locked reads)
    and `/my-team/stations` (grouped, display-only reads) can never drift apart
    on what "locked" means. Returns None (allowed), "incomplete" or "passed".
    """
    if not has_prior_closed:
        return None  # the very first visit to a station is always allowed
    if not all_visited:
        return "incomplete"
    if has_passed:
        return "passed"
    return None


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

    if sub_event.replay_after_all:
        has_prior_closed = StationSession.objects.filter(
            team=team, station=station, status=StationSession.STATUS_CLOSED,
        ).exists()
        if has_prior_closed:
            active_station_ids = set(
                Station.objects.filter(sub_event=sub_event, active=True).values_list("id", flat=True)
            )
            visited_station_ids = set(
                StationSession.objects.filter(team=team, sub_event=sub_event)
                .exclude(status=StationSession.STATUS_CANCELLED)
                .values_list("station_id", flat=True)
            )
            all_visited = active_station_ids <= visited_station_ids
            has_passed = StationSession.objects.filter(
                team=team, station=station, outcome=StationSession.OUTCOME_PASSED,
            ).exists()
            reason = replay_lock_reason(
                has_prior_closed=has_prior_closed, all_visited=all_visited, has_passed=has_passed,
            )
            if reason == "incomplete":
                return None, "replay_locked_incomplete"
            if reason == "passed":
                return None, "replay_locked_passed"

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
            # threshold/score_only can read a verdict straight off the number;
            # pass_fail has none, so it stays `pending` until a coop taps the
            # dedicated Đạt/Không đạt action (`set_session_score`).
            derived = _derive_numeric_outcome(session.station, session.score)
            if derived is not None:
                session.outcome = derived
        if note is not None:
            session.note = note
        session.save(update_fields=[
            "status", "exited_at", "exited_by", "score", "outcome", "note", "updated_at",
        ])

        _sync_station_score_entry(team, session.station, operator)

        # Inside the transaction, as in enter_station: the exit and the QR going
        # stale have to land together or neither.
        scan_token_service.consume(team_ref, team)

    return session, None


def set_session_score(
    session_id: int,
    operator: Account,
    score=None,
    note: str | None = None,
    outcome: str | None = None,
) -> Tuple[Optional[StationSession], Optional[str]]:
    """Chấm điểm/kết quả một phiên trạm, đồng bộ ScoreEntry, theo `station.scoring_mode`.

    - `pass_fail`: cần `outcome` ("passed"/"failed"); điểm phiên suy ra là
      `pass_points` khi đạt, else 0 — không nhận `score` trực tiếp vì trạm này
      không có khái niệm điểm số.
    - `threshold`/`score_only`: cần `score`; outcome tự suy theo ngưỡng (hoặc
      luôn `passed` với score_only). Bất kỳ `outcome` truyền vào bị bỏ qua —
      hai mode này không cho chấm tay kết quả, tránh lệch với điểm.
    """
    with transaction.atomic():
        session = StationSession.objects.select_for_update().select_related(
            "phase", "sub_event", "team", "station",
        ).filter(id=session_id).first()
        if not session:
            return None, "session_not_found"

        if results_are_locked():
            return None, "results_locked"

        station = session.station
        if station.scoring_mode == Station.SCORING_PASS_FAIL:
            if outcome not in (StationSession.OUTCOME_PASSED, StationSession.OUTCOME_FAILED):
                return None, "missing_outcome"
            session.outcome = outcome
            session.score = station.pass_points if outcome == StationSession.OUTCOME_PASSED else 0
        else:
            if score is None:
                return None, "missing_score"
            try:
                points = int(score)
            except (TypeError, ValueError):
                return None, "invalid_score"
            session.score = points
            session.outcome = _derive_numeric_outcome(station, points)

        if note is not None:
            session.note = note
        session.save(update_fields=["score", "outcome", "note", "updated_at"])

        _sync_station_score_entry(session.team, station, operator)

    return session, None


def set_submission_score(
    submission: StationSubmission,
    operator: Account,
    score,
    note: str | None = None,
) -> Optional[str]:
    """Set/cập nhật điểm cho một bài nộp và đồng bộ ScoreEntry tương ứng.

    Bài nộp gắn với phiên trạm CHÍNH LÀ điểm của phiên đó, nên đi qua cùng luật
    tổng hợp 1-entry/trạm mà exit_station/set_session_score dùng — nếu không,
    chấm lại một bài nộp cũ (từ một lần chơi trước) có thể chồng lên điểm của
    lần chơi mới nhất. Bài nộp tự do (trạm free-play chưa từng có phiên nào)
    thì khoá entry theo submission như trước, vì không có phiên nào để tổng hợp.
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
    if session is None:
        entry = ScoreEntry.objects.filter(
            submission=submission, kind=ScoreEntry.KIND_STATION,
        ).first()
        default_note = f"Bai nop tram {submission.station.code}"
        if entry:
            entry.points = points
            if note is not None:
                entry.note = note
            entry.save(update_fields=["points", "note", "updated_at"])
        else:
            ScoreEntry.objects.create(
                phase=submission.station.sub_event.phase,
                sub_event=submission.station.sub_event,
                submission=submission,
                team=submission.team,
                kind=ScoreEntry.KIND_STATION,
                points=points,
                note=note or default_note,
                created_by=operator,
            )
        return None

    session.score = points
    update_fields = ["score", "updated_at"]
    derived = _derive_numeric_outcome(session.station, points)
    if derived is not None:
        session.outcome = derived
        update_fields.append("outcome")
    if note is not None:
        session.note = note
        update_fields.append("note")
    session.save(update_fields=update_fields)

    _sync_station_score_entry(submission.team, submission.station, operator)
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
