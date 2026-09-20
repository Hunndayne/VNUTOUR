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
    ProgramPhase, ScoreEntry, PhaseRoster, StationSubmission, QuestionBankItem,
    TeamFormDraft, TeamFormSession, TeamFormVariant,
)
from api.services.submission_config_service import (
    has_items as has_submission_items,
    has_form as submission_has_form,
    references_bank as submission_references_bank,
)
from api.services.result_lock_service import results_are_locked
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
        # Only the optional limits may be cleared; null elsewhere is ignored.
        if value is None and field not in ("max_attempts", "max_concurrent_teams"):
            continue
        if hasattr(station, field):
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

    submissions = StationSubmission.objects.filter(
        station_id=station_id,
        station_session__isnull=True,
    ).select_related("team").order_by("-created_at")[:limit]

    out = []
    for s in sessions:
        out.append({
            "id": s.id, "team_code": s.team.code, "team_name": s.team.name,
            "status": s.status,
            "entered_at": s.entered_at.isoformat(),
            "exited_at": s.exited_at.isoformat() if s.exited_at else None,
            "score": s.score, "note": s.note,
        })
    for sub in submissions:
        out.append({
            "id": f"sub-{sub.id}", "team_code": sub.team.code, "team_name": sub.team.name,
            "status": "closed",
            "entered_at": sub.created_at.isoformat(),
            "exited_at": sub.submitted_at.isoformat() if sub.submitted_at else sub.created_at.isoformat(),
            "score": sub.score, "note": None,
        })
    out.sort(key=lambda x: x["entered_at"], reverse=True)
    return out[:limit]


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

    # Each attempt owns its submission; aggregate all entries for this station.
    submission = StationSubmission.objects.filter(
        team=team, station=station, station_session=best_session,
    ).order_by("-created_at").first()

    session_ids = [s.id for s in sessions]
    scope = Q(submission__team=team, submission__station=station)
    if session_ids:
        scope |= Q(station_session_id__in=session_ids)
    if submission:
        scope |= Q(submission=submission)
    # Ordered so the entry we keep (and the ones we drop) are the same on every
    # run — an unordered queryset would let two identical recomputes disagree.
    existing = list(
        ScoreEntry.objects.filter(Q(kind=ScoreEntry.KIND_STATION) & scope).order_by("id")
    )

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


def _station_has_trackable_form(station: Station, bank_counts: dict[int, int]) -> bool:
    if has_submission_items(station.submission_config):
        return True
    if not submission_references_bank(station.submission_config):
        return False
    if station.sub_event_id not in bank_counts:
        bank_counts[station.sub_event_id] = QuestionBankItem.objects.filter(
            sub_event_id=station.sub_event_id, active=True,
        ).count()
    return submission_has_form(station.submission_config, bank_counts[station.sub_event_id])


def replay_lock_reason(
    *, has_prior_closed: bool, all_visited: bool, has_passed: bool,
    attempts_used: int = 0, max_attempts: int | None = None,
    pending_result: bool = False, replay_after_all: bool = True,
    allow_replay_after_pass: bool = False,
) -> Optional[str]:
    """Return the stable public reason that a *next* attempt is unavailable.

    The optional defaults retain compatibility with older direct callers while
    keeping the precedence used by every API path: passed, exhausted, pending,
    then the event's first-loop requirement.

    `pending_result` means "an attempt is still open", not "a verdict is still
    missing": a closed attempt awaiting a manual grade no longer blocks the
    next one.
    """
    if not has_prior_closed:
        return None
    if has_passed and not allow_replay_after_pass:
        return "passed"
    if max_attempts is not None and attempts_used >= max_attempts:
        return "attempts_exhausted"
    if pending_result:
        return "pending_result"
    if replay_after_all and not all_visited:
        return "incomplete"
    return None


def _legacy_submission_outcome(station: Station, submission: StationSubmission) -> str:
    """Best available outcome for a pre-session free-play submission.

    Unknown historical verdicts stay pending.  We never reinterpret a zero
    score as failure during compatibility reads.
    """
    if station.scoring_mode == Station.SCORING_SCORE_ONLY:
        return StationSession.OUTCOME_PASSED
    if station.scoring_mode == Station.SCORING_THRESHOLD:
        if submission.score is None:
            return StationSession.OUTCOME_PENDING
        return (
            StationSession.OUTCOME_PASSED
            if submission.score >= station.pass_threshold
            else StationSession.OUTCOME_FAILED
        )
    if submission.is_correct is True:
        return StationSession.OUTCOME_PASSED
    if submission.is_correct is False:
        return StationSession.OUTCOME_FAILED
    return StationSession.OUTCOME_PENDING


def get_event_replay_states(
    teams: list[Team],
    sub_event: SubEvent,
    stations: list[Station] | None = None,
) -> dict[int, dict]:
    """Journey progress and replay eligibility for many teams at once.

    Reads a fixed three queries no matter how many teams are passed, so a
    leaderboard-shaped caller never fans out into one pair of reads per team.
    Returns {team_id: the same dict `get_event_replay_state` returns}.
    """
    if stations is None:
        stations = list(Station.objects.filter(sub_event=sub_event, active=True).order_by("order", "id"))
    # Check-in/checkout stations are gates, not part of the play journey.
    stations = [station for station in stations if station.kind == Station.KIND_PLAY]
    station_ids = [station.id for station in stations]
    team_ids = [team.id for team in teams]

    sessions_by_team: dict[int, dict[int, list[dict]]] = {team_id: {} for team_id in team_ids}
    for row in (
        StationSession.objects.filter(team_id__in=team_ids, station_id__in=station_ids)
        .exclude(status=StationSession.STATUS_CANCELLED)
        .values("id", "team_id", "station_id", "status", "score", "outcome", "entered_at", "exited_at")
        .order_by("team_id", "station_id", "entered_at", "id")
    ):
        sessions_by_team[row["team_id"]].setdefault(row["station_id"], []).append(row)

    legacy_by_team: dict[int, dict[int, StationSubmission]] = {team_id: {} for team_id in team_ids}
    for submission in (
        StationSubmission.objects.filter(
            team_id__in=team_ids,
            station_id__in=station_ids,
            station_session__isnull=True,
            status__in=[StationSubmission.STATUS_SUBMITTED, StationSubmission.STATUS_GRADED],
        ).only("id", "team_id", "station_id", "score", "is_correct", "created_at", "status")
        .order_by("team_id", "station_id", "created_at", "id")
    ):
        legacy_by_team[submission.team_id][submission.station_id] = submission

    # The required set depends only on the stations, so it is shared by every
    # team and its question-bank lookups happen at most once per sub-event.
    bank_counts: dict[int, int] = {}
    required_ids = {
        station.id for station in stations
        if station.checkin_policy != Station.POLICY_FREE_PLAY
        or _station_has_trackable_form(station, bank_counts)
    }

    return {
        team.id: _assemble_replay_state(
            stations, sub_event, required_ids,
            sessions_by_team[team.id], legacy_by_team[team.id],
        )
        for team in teams
    }


def get_event_replay_state(
    team: Team,
    sub_event: SubEvent,
    stations: list[Station] | None = None,
) -> dict:
    """Batch journey progress and replay eligibility for one team/event."""
    return get_event_replay_states([team], sub_event, stations)[team.id]


def _assemble_replay_state(
    stations: list[Station],
    sub_event: SubEvent,
    required_ids: set[int],
    session_rows: dict[int, list[dict]],
    legacy_submissions: dict[int, StationSubmission],
) -> dict:
    """Pure assembly of one team's state — no queries, so batching stays cheap."""
    visited_ids = {
        station.id for station in stations
        if session_rows.get(station.id) or legacy_submissions.get(station.id)
    }
    all_visited = required_ids <= visited_ids

    by_station: dict[int, dict] = {}
    for station in stations:
        rows = session_rows.get(station.id, [])
        # A historical no-session submission is one real play even after the
        # team later starts tracked sessions.  Keeping it in the count avoids
        # silently granting an extra attempt when migrations are deployed in
        # stages or a compatibility row is created by an older worker.
        legacy = legacy_submissions.get(station.id)
        attempts_used = len(rows) + (1 if legacy else 0)
        outcomes = [row["outcome"] for row in rows]
        if legacy:
            outcomes.insert(0, _legacy_submission_outcome(station, legacy))
        has_passed = StationSession.OUTCOME_PASSED in outcomes
        latest_outcome = outcomes[-1] if outcomes else None
        has_active = any(row["status"] == StationSession.STATUS_ACTIVE for row in rows)
        # Still reported to the UI so a team can see "đang chờ chấm", but it no
        # longer gates the next attempt — see the call below.
        pending_result = has_active or latest_outcome == StationSession.OUTCOME_PENDING
        has_prior = attempts_used > 0
        reason = replay_lock_reason(
            has_prior_closed=has_prior,
            all_visited=all_visited,
            has_passed=has_passed,
            attempts_used=attempts_used,
            max_attempts=station.max_attempts,
            # Only an attempt that is STILL OPEN blocks the next one; a closed
            # attempt waiting on a manual verdict does not. Graders lag behind
            # during an event and teams were getting stuck queueing on them.
            # `attempts_exhausted` above is what keeps replays bounded.
            pending_result=has_active,
            replay_after_all=sub_event.replay_after_all,
            allow_replay_after_pass=sub_event.replay_after_pass,
        )
        remaining = None if station.max_attempts is None else max(0, station.max_attempts - attempts_used)
        by_station[station.id] = {
            "attempts_used": attempts_used,
            "max_attempts": station.max_attempts,
            "attempts_remaining": remaining,
            "can_replay": has_prior and reason is None,
            "replay_locked": has_prior and reason is not None,
            "replay_reason": reason,
            "has_passed": has_passed,
            "has_active": has_active,
            "has_closed": has_prior and not has_active,
            "pending_result": pending_result,
            "visited": station.id in visited_ids,
        }

    return {
        "by_station": by_station,
        "all_visited": all_visited,
        "visited_count": len(required_ids & visited_ids),
        "total_stations": len(required_ids),
        "passed_count": sum(1 for item in by_station.values() if item["has_passed"]),
        "replay_after_all": bool(sub_event.replay_after_all),
        "replay_after_pass": bool(sub_event.replay_after_pass),
    }


def event_gate_error(team: Team, sub_event: SubEvent) -> Optional[str]:
    """Check-in requirement and checkout lock for entering any play station."""
    from api.models import EventAttendance, EventCheckIn, TeamMembership
    from api.services.attendance_service import required_attendance_count
    checkin = EventCheckIn.objects.filter(
        team=team, sub_event=sub_event, status=EventCheckIn.STATUS_ACTIVE,
    ).only("id", "checked_out_at", "meta").first()
    if checkin is not None and checkin.checked_out_at is not None:
        return "team_checked_out"
    if sub_event.require_checkin and sub_event.checkin_mode == SubEvent.CHECKIN_INDIVIDUAL:
        if checkin is None:
            return "event_not_checked_in"
        attendance_count = EventAttendance.objects.filter(
            checkin=checkin,
            participant_id__in=TeamMembership.objects.filter(team=team).values("participant_id"),
        ).values("participant_id").distinct().count()
        if attendance_count < required_attendance_count(team, sub_event):
            return "event_insufficient_checkin" if attendance_count else "event_not_checked_in"
    elif sub_event.require_checkin and (
        checkin is None or (checkin.meta or {}).get("checkout_only")
    ):
        return "event_not_checked_in"
    return None


def _replay_error(reason: str | None) -> str | None:
    return f"replay_locked_{reason}" if reason else None


def _reset_attempt_transients(team: Team, station: Station) -> None:
    """Start each play with a fresh timer, question draw, and shared draft."""
    TeamFormSession.objects.filter(team=team, station=station).delete()
    TeamFormVariant.objects.filter(team=team, station=station).delete()
    TeamFormDraft.objects.filter(team=team, station=station).delete()


def _materialize_legacy_attempt(team: Team, station: Station) -> None:
    """Attach old free-play answers to one historical attempt, under row locks.

    Older free-play forms overwrote their answer row, so no earlier attempt
    count can be recovered. Keep all surviving answer snapshots and score links.
    """
    submissions = list(StationSubmission.objects.filter(
        team=team, station=station, station_session__isnull=True,
        status__in=[StationSubmission.STATUS_SUBMITTED, StationSubmission.STATUS_GRADED],
    ).order_by("created_at", "id"))
    if not submissions:
        return
    latest = submissions[-1]
    session = StationSession.objects.create(
        team=team, station=station, sub_event=station.sub_event,
        phase=station.sub_event.phase, status=StationSession.STATUS_CLOSED,
        entered_at=submissions[0].submitted_at or submissions[0].created_at,
        exited_at=latest.submitted_at or latest.created_at,
        outcome=_legacy_submission_outcome(station, latest), score=latest.score or 0,
        note="Lượt chơi trước khi hỗ trợ phiên trạm tự do",
    )
    ids = [s.id for s in submissions]
    StationSubmission.objects.filter(id__in=ids).update(station_session=session)
    ScoreEntry.objects.filter(submission_id__in=ids, kind=ScoreEntry.KIND_STATION).update(station_session=session)


def _lock_attempt_scope(team_id: int, station_id: int):
    """All entry, checkout, submission and grading writes lock in this order."""
    team = Team.objects.select_for_update().get(id=team_id)
    station = Station.objects.select_for_update(of=("self",)).select_related(
        "sub_event__phase",
    ).get(id=station_id)
    return team, station


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

    # No global "BTC opens check-in" switch: in the per-station model a running
    # sub-event is the open signal, matching what the participant's QR screen now
    # shows (see `_team_qr_enabled_for_event`). Eligibility below (roster/phase,
    # station-in-event) still applies; the QR stays single-use via `consume`.

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
            # Every attempt creation for a team serializes on the team row.  A
            # pair of scanners reaching the last slot therefore cannot both
            # observe the old count and create another session.
            team, station = _lock_attempt_scope(team.id, station.id)
            if team.approval_status != Team.APPROVAL_APPROVED:
                return None, "team_not_approved"
            if not station.active:
                return None, "station_inactive"
            if station.sub_event_id != int(event_id):
                return None, "station_not_in_event"
            sub_event = station.sub_event
            if station.kind != Station.KIND_PLAY:
                return None, "station_not_playable"
            gate_error = event_gate_error(team, sub_event)
            if gate_error:
                return None, gate_error
            active = StationSession.objects.filter(
                team=team, sub_event=sub_event, status=StationSession.STATUS_ACTIVE,
            ).first()
            if active is not None:
                return None, "session_already_active"

            event_stations = list(
                Station.objects.filter(sub_event=sub_event, active=True).order_by("order", "id")
            )
            eligibility = get_event_replay_state(team, sub_event, event_stations)["by_station"][station.id]
            if eligibility["attempts_used"] > 0 and eligibility["replay_reason"]:
                return None, _replay_error(eligibility["replay_reason"])

            if station.capacity_mode == Station.CAPACITY_LIMITED and station.max_concurrent_teams:
                active_count = StationSession.objects.filter(
                    station=station,
                    status=StationSession.STATUS_ACTIVE,
                ).count()
                if active_count >= station.max_concurrent_teams:
                    return None, "station_full"
            _materialize_legacy_attempt(team, station)
            session = StationSession.objects.create(
                phase=phase, sub_event=sub_event, station=station, team=team,
                status=StationSession.STATUS_ACTIVE, entered_at=now,
                entered_by=operator, score=score, note=note,
            )
            _reset_attempt_transients(team, station)
            # Retire the scanned QR inside the same transaction as the session,
            # so a re-read of the same image cannot enter the team twice.
            scan_token_service.consume(team_ref, team)
            return session, None
    except IntegrityError:
        return None, "session_already_active"


def start_free_play_station(
    team: Team,
    station: Station,
    operator: Account,
) -> Tuple[Optional[StationSession], Optional[str]]:
    """Start or resume a participant-owned free-play attempt."""
    if station.checkin_policy != Station.POLICY_FREE_PLAY:
        return None, "policy_staff_scan"
    if results_are_locked():
        return None, "results_locked"

    now = datetime.now(timezone.utc)
    try:
        with transaction.atomic():
            team, station = _lock_attempt_scope(team.id, station.id)
            if team.approval_status != Team.APPROVAL_APPROVED:
                return None, "team_not_approved"
            if not station.active:
                return None, "station_inactive"
            if station.checkin_policy != Station.POLICY_FREE_PLAY:
                return None, "policy_staff_scan"
            if station.kind != Station.KIND_PLAY:
                return None, "station_not_playable"
            gate_error = event_gate_error(team, station.sub_event)
            if gate_error:
                return None, gate_error
            existing = StationSession.objects.filter(
                team=team, station=station, status=StationSession.STATUS_ACTIVE,
            ).first()
            if existing is not None:
                return existing, None
            if StationSession.objects.filter(
                team=team, sub_event=station.sub_event,
                status=StationSession.STATUS_ACTIVE,
            ).exists():
                return None, "session_already_active"

            event_stations = list(
                Station.objects.filter(sub_event=station.sub_event, active=True).order_by("order", "id")
            )
            eligibility = get_event_replay_state(team, station.sub_event, event_stations)["by_station"][station.id]
            if eligibility["attempts_used"] > 0 and eligibility["replay_reason"]:
                return None, _replay_error(eligibility["replay_reason"])

            if station.capacity_mode == Station.CAPACITY_LIMITED and station.max_concurrent_teams:
                active_count = StationSession.objects.filter(
                    station=station, status=StationSession.STATUS_ACTIVE,
                ).count()
                if active_count >= station.max_concurrent_teams:
                    return None, "station_full"

            _materialize_legacy_attempt(team, station)
            session = StationSession.objects.create(
                phase=station.sub_event.phase,
                sub_event=station.sub_event,
                station=station,
                team=team,
                status=StationSession.STATUS_ACTIVE,
                entered_at=now,
                entered_by=operator,
            )
            _reset_attempt_transients(team, station)
            TeamFormSession.objects.create(
                team=team, station=station, started_by=operator,
            )
            return session, None
    except IntegrityError:
        existing = StationSession.objects.filter(
            team=team, station=station, status=StationSession.STATUS_ACTIVE,
        ).first()
        return (existing, None) if existing else (None, "session_already_active")


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
        if not Station.objects.filter(id=station_id).exists():
            return None, "session_not_found"
        team, _station = _lock_attempt_scope(team.id, station_id)
        session = StationSession.objects.select_for_update(of=("self",)).select_related(
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
        if session.station.scoring_mode == Station.SCORING_SCORE_ONLY:
            session.outcome = StationSession.OUTCOME_PASSED
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
        ref = StationSession.objects.filter(id=session_id).values("team_id", "station_id").first()
        if not ref:
            return None, "session_not_found"
        _lock_attempt_scope(ref["team_id"], ref["station_id"])
        session = StationSession.objects.select_for_update(of=("self",)).select_related(
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

        StationSubmission.objects.filter(
            station_session=session,
            status__in=[StationSubmission.STATUS_SUBMITTED, StationSubmission.STATUS_GRADED],
        ).update(score=session.score, status=StationSubmission.STATUS_GRADED,
                 graded_by=operator, graded_at=datetime.now(timezone.utc))
        if station.scoring_mode == Station.SCORING_PASS_FAIL:
            StationSubmission.objects.filter(station_session=session).update(
                is_correct=session.outcome == StationSession.OUTCOME_PASSED,
            )
        _sync_station_score_entry(session.team, station, operator)

    return session, None


@transaction.atomic
def set_submission_score(
    submission: StationSubmission,
    operator: Account,
    score,
    note: str | None = None,
    final: bool = True,
) -> Optional[str]:
    """Set/cập nhật điểm cho một bài nộp và đồng bộ ScoreEntry tương ứng.

    Bài nộp gắn với phiên trạm CHÍNH LÀ điểm của phiên đó, nên đi qua cùng luật
    tổng hợp 1-entry/trạm mà exit_station/set_session_score dùng — nếu không,
    chấm lại một bài nộp cũ (từ một lần chơi trước) có thể chồng lên điểm của
    lần chơi mới nhất. Bài nộp tự do (trạm free-play chưa từng có phiên nào)
    thì khoá entry theo submission như trước, vì không có phiên nào để tổng hợp.
    """
    _lock_attempt_scope(submission.team_id, submission.station_id)
    if results_are_locked():
        return "results_locked"

    try:
        points = int(score)
    except (TypeError, ValueError):
        return "invalid_score"

    submission.score = points
    submission.save(update_fields=["score", "updated_at"])

    session = StationSession.objects.select_related("station").filter(id=submission.station_session_id).first()
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
    derived = _derive_numeric_outcome(session.station, points) if final else StationSession.OUTCOME_PENDING
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
