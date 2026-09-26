"""
Check-in service — event check-in scan, stats, reset.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Tuple

from django.db import IntegrityError, transaction
from django.db.models import Count

from api.models import (
    Account, Team, ProgramPhase, SubEvent, EventCheckIn, EventAttendance,
    PhaseRoster, TeamMembership,
)
from api.services.attendance_service import recorded_checkins, resolve_personal_qr, team_eligible_for_event
from api.services.program_service import get_current_sub_event
from api.services import scan_token_service
from api.services.coop_realtime_cache import (
    checkin_stats_key,
    get_or_load,
    schedule_checkin_invalidation,
)




@transaction.atomic
def scan_event_checkin(
    qr_token: str,
    phase_key: str,
    event_id: int,
    scanner: Account,
    ip: str | None = None,
    user_agent: str | None = None,
) -> Tuple[Optional[EventAttendance | EventCheckIn], Optional[str]]:
    """Record a team or one member according to the event's check-in mode."""
    try:
        phase = ProgramPhase.objects.get(key=phase_key)
        sub_event = SubEvent.objects.get(id=event_id, phase=phase)
    except ProgramPhase.DoesNotExist:
        return None, "phase_not_found"
    except SubEvent.DoesNotExist:
        return None, "event_not_found"

    current_event = get_current_sub_event()
    if current_event is None:
        return None, "no_current_event"
    if current_event.id != sub_event.id:
        return None, "checkin_qr_event_mismatch"

    if sub_event.checkin_mode == SubEvent.CHECKIN_TEAM:
        if str(qr_token).startswith("p:"):
            return None, "team_qr_required"
        team, resolve_error = scan_token_service.resolve_team(qr_token)
        if not team:
            return None, resolve_error
        membership = None
    else:
        membership, resolve_error = resolve_personal_qr(str(qr_token or "").strip(), sub_event)
        if not membership:
            return None, resolve_error
        team = membership.team
    team = Team.objects.select_for_update().get(id=team.id)
    if membership is not None and not TeamMembership.objects.filter(
        team=team, participant=membership.participant,
    ).exists():
        return None, "participant_not_in_team"
    if membership is None and scan_token_service.looks_like_qr(qr_token) and (
        scan_token_service.strip_prefix(qr_token) != team.qr_token
    ):
        return None, "qr_already_used"
    if team.approval_status != Team.APPROVAL_APPROVED:
        return None, "team_not_approved"

    if not team_eligible_for_event(team, sub_event):
        return None, "team_not_in_phase"

    if sub_event.checkin_mode == SubEvent.CHECKIN_TEAM:
        existing = EventCheckIn.objects.filter(
            sub_event=sub_event, team=team, status=EventCheckIn.STATUS_ACTIVE,
        ).first()
        if existing:
            if existing.checked_out_at:
                return None, "team_checked_out"
            if not (existing.meta or {}).get("checkout_only"):
                return None, "already_checked_in"
            existing.meta = {**(existing.meta or {}), "checkout_only": False}
            existing.scanner = scanner
            existing.created_at = datetime.now(timezone.utc)
            existing.save(update_fields=["meta", "scanner", "created_at", "updated_at"])
            scan_token_service.consume(qr_token, team)
            schedule_checkin_invalidation(sub_event.id, phase.key)
            return existing, None
        try:
            with transaction.atomic():
                checkin = EventCheckIn.objects.create(
                    phase=phase, sub_event=sub_event, team=team, scanner=scanner,
                    status=EventCheckIn.STATUS_ACTIVE, ip=ip, user_agent=user_agent,
                )
                scan_token_service.consume(qr_token, team)
                schedule_checkin_invalidation(sub_event.id, phase.key)
                return checkin, None
        except IntegrityError:
            return None, "already_checked_in"

    try:
        with transaction.atomic():
            team = Team.objects.select_for_update().get(id=team.id)
            checkin = EventCheckIn.objects.select_for_update().filter(
                sub_event=sub_event, team=team, status=EventCheckIn.STATUS_ACTIVE,
            ).first()
            if checkin is None:
                checkin = EventCheckIn.objects.create(
                    phase=phase, sub_event=sub_event, team=team, scanner=scanner,
                    status=EventCheckIn.STATUS_ACTIVE, ip=ip, user_agent=user_agent,
                )
            if checkin.checked_out_at is not None:
                return None, "team_checked_out"
            if (checkin.meta or {}).get("checkout_only"):
                checkin.meta = {**checkin.meta, "checkout_only": False}
                checkin.save(update_fields=["meta", "updated_at"])
            attendance = EventAttendance.objects.create(
                checkin=checkin, participant=membership.participant, scanner=scanner,
            )
            schedule_checkin_invalidation(sub_event.id, phase.key)
            return attendance, None
    except IntegrityError:
        return None, "already_checked_in"


def list_event_checkins(
    event_id: int | None = None,
    phase_key: str | None = None,
    status: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """List check-ins with optional filters."""
    qs = recorded_checkins().select_related(
        "team", "sub_event", "phase", "scanner",
    ).prefetch_related(
        "team__memberships__participant", "attendances__participant", "attendances__scanner",
    )

    if event_id:
        qs = qs.filter(sub_event_id=event_id)
    if phase_key:
        qs = qs.filter(phase__key=phase_key)
    if status:
        qs = qs.filter(status=status)

    qs = qs.order_by("-created_at")[offset:offset + limit]

    items = []
    for c in qs:
        attendance_by_participant = {a.participant_id: a for a in c.attendances.all()}
        members_detail = []
        for membership in c.team.memberships.all():
            team_mode_checked = (
                c.sub_event.checkin_mode == SubEvent.CHECKIN_TEAM and
                not (c.meta or {}).get("checkout_only")
            )
            attendance = attendance_by_participant.get(membership.participant_id)
            members_detail.append({
                "mssv": membership.participant.mssv,
                "full_name": membership.participant.full_name,
                "school": membership.participant.school,
                "checked_in": team_mode_checked or attendance is not None,
                "checked_in_at": (
                    c.created_at.isoformat() if team_mode_checked else
                    attendance.created_at.isoformat() if attendance else None
                ),
                "scanner": (
                    c.scanner.username if team_mode_checked and c.scanner else
                    attendance.scanner.username if attendance and attendance.scanner else None
                ),
            })
        checked_members = [member for member in members_detail if member["checked_in"]]
        items.append({
            "id": c.id,
            "team_code": c.team.code,
            "team_name": c.team.name,
            "members_detail": members_detail,
            "checked_in_count": len(checked_members),
            "phase_key": c.phase.key,
            "event_id": c.sub_event_id,
            "event_name": c.sub_event.name,
            "status": c.status,
            "scanner": c.scanner.username if c.scanner else None,
            "checked_in_at": min((member["checked_in_at"] for member in checked_members), default=c.created_at.isoformat()),
        })
    return items


def get_checkin_stats(event_id: int | None = None, phase_key: str | None = None) -> dict:
    """Get short-lived shared check-in stats for the Coop dashboard."""
    key = checkin_stats_key(event_id, phase_key)
    return get_or_load(key, lambda: _load_checkin_stats(event_id, phase_key))


def _load_checkin_stats(event_id: int | None = None, phase_key: str | None = None) -> dict:
    """Get check-in stats for an event or globally."""
    phase = None
    if phase_key:
        phase = ProgramPhase.objects.filter(key=phase_key).first()
    elif event_id:
        phase = ProgramPhase.objects.filter(sub_events__id=event_id).distinct().first()

    if phase and PhaseRoster.objects.filter(phase=phase).exists():
        total_teams = PhaseRoster.objects.filter(phase=phase).count()
    else:
        total_teams = Team.objects.filter(
            approval_status=Team.APPROVAL_APPROVED,
        ).count()

    attendance_qs = EventAttendance.objects.filter(
        checkin__status=EventCheckIn.STATUS_ACTIVE,
        checkin__sub_event__checkin_mode=SubEvent.CHECKIN_INDIVIDUAL,
    )
    team_qs = recorded_checkins().filter(
        status=EventCheckIn.STATUS_ACTIVE,
        sub_event__checkin_mode=SubEvent.CHECKIN_TEAM,
    )
    if event_id:
        attendance_qs = attendance_qs.filter(checkin__sub_event_id=event_id)
        team_qs = team_qs.filter(sub_event_id=event_id)
    if phase_key:
        attendance_qs = attendance_qs.filter(checkin__phase__key=phase_key)
        team_qs = team_qs.filter(phase__key=phase_key)

    # `checked_in_teams` counts a team as soon as anyone on it is present.
    # That is NOT the same question as "may this team enter a station": in
    # individual mode with check-in required, `event_gate_error` keeps turning
    # the team away until `min_checkin_members` have scanned. Report both, so
    # nobody reads the arrival count as a readiness count.
    individual_rows = list(attendance_qs.values(
        "checkin__team_id",
        "checkin__sub_event__require_checkin",
        "checkin__sub_event__min_checkin_members",
    ).annotate(present=Count("participant_id", distinct=True)))
    individual_team_ids = {row["checkin__team_id"] for row in individual_rows}
    eligible_team_ids = {
        row["checkin__team_id"] for row in individual_rows
        if row["present"] >= (
            row["checkin__sub_event__min_checkin_members"]
            if row["checkin__sub_event__require_checkin"] else 1
        )
    }
    team_ids = set(team_qs.values_list("team_id", flat=True))
    checked_count = len(individual_team_ids | team_ids)
    eligible_count = len(eligible_team_ids | team_ids)
    individual_participant_ids = set(attendance_qs.values_list("participant_id", flat=True))
    team_participant_ids = set(TeamMembership.objects.filter(
        team_id__in=team_ids,
    ).values_list("participant_id", flat=True))
    checked_in_participants = len(individual_participant_ids | team_participant_ids)
    latest_individual = attendance_qs.order_by("-created_at").values_list("created_at", flat=True).first()
    latest_team = team_qs.order_by("-created_at").values_list("created_at", flat=True).first()
    latest = max((value for value in (latest_individual, latest_team) if value), default=None)

    return {
        "total_teams": total_teams,
        "checked_in_teams": checked_count,
        # Teams that clear the event gate right now — what BTC needs before
        # telling a team to go play. Equal to checked_in_teams unless the event
        # requires several members to check in individually.
        "eligible_teams": eligible_count,
        "checked_in_participants": checked_in_participants,
        "latest_checkin_at": latest.isoformat() if latest else None,
    }


def reset_checkin(checkin_id: int) -> bool:
    """Revert a check-in record."""
    target = EventCheckIn.objects.filter(
        id=checkin_id, status=EventCheckIn.STATUS_ACTIVE,
    ).values("sub_event_id", "phase__key").first()
    if target is None:
        return False
    updated = EventCheckIn.objects.filter(
        id=checkin_id, status=EventCheckIn.STATUS_ACTIVE,
    ).update(
        status=EventCheckIn.STATUS_REVERTED,
        updated_at=datetime.now(timezone.utc),
    )
    if updated:
        schedule_checkin_invalidation(target["sub_event_id"], target["phase__key"])
    return updated > 0


def checkout_event(
    qr_token: str,
    station,
    scanner: Account,
    *, sub_event=None,
) -> Tuple[Optional[EventCheckIn], Optional[str]]:
    """Record that a team finished its journey at a checkout station.

    Checkout ends play: `enter_station` refuses a checked-out team. When the
    event does not require check-in, the checkout creates the attendance row.
    """
    from api.models import StationSession

    team, resolve_error = scan_token_service.resolve_team(qr_token)
    if not team:
        return None, resolve_error
    if team.approval_status != Team.APPROVAL_APPROVED:
        return None, "team_not_approved"

    sub_event = station.sub_event if station is not None else sub_event
    if sub_event is None:
        return None, "event_not_found"
    phase = sub_event.phase
    if PhaseRoster.objects.filter(phase=phase).exists() and not PhaseRoster.objects.filter(
        phase=phase, team=team,
    ).exists():
        return None, "team_not_in_phase"

    now = datetime.now(timezone.utc)
    with transaction.atomic():
        # Same first lock as station entry, so a checkout cannot race an entry.
        team = Team.objects.select_for_update().get(id=team.id)
        if StationSession.objects.filter(
            team=team, sub_event=sub_event, status=StationSession.STATUS_ACTIVE,
        ).exists():
            return None, "session_already_active"
        checkin = EventCheckIn.objects.select_for_update().filter(
            sub_event=sub_event, team=team, status=EventCheckIn.STATUS_ACTIVE,
        ).first()
        if checkin is None:
            checkin = EventCheckIn.objects.create(
                phase=phase, sub_event=sub_event, team=team, scanner=scanner,
                status=EventCheckIn.STATUS_ACTIVE, meta={"checkout_only": True},
            )
        if checkin.checked_out_at is not None:
            return None, "already_checked_out"
        checkin.checked_out_at = now
        checkin.checked_out_by = scanner
        checkin.checkout_station = station
        checkin.save(update_fields=["checked_out_at", "checked_out_by", "checkout_station", "updated_at"])
        scan_token_service.consume(qr_token, team)
        schedule_checkin_invalidation(sub_event.id, phase.key)
    return checkin, None


def undo_checkout(checkin_id: int) -> bool:
    """Clear a mistaken checkout; the team may play again."""
    target = EventCheckIn.objects.filter(
        id=checkin_id,
        status=EventCheckIn.STATUS_ACTIVE,
        checked_out_at__isnull=False,
    ).values("sub_event_id", "phase__key").first()
    if target is None:
        return False
    updated = EventCheckIn.objects.filter(
        id=checkin_id, status=EventCheckIn.STATUS_ACTIVE, checked_out_at__isnull=False,
    ).update(
        checked_out_at=None, checked_out_by=None, checkout_station=None,
        updated_at=datetime.now(timezone.utc),
    )
    if updated:
        schedule_checkin_invalidation(target["sub_event_id"], target["phase__key"])
    return updated > 0


def list_checkouts(event_id: int) -> list[dict]:
    """Checkout order for tie-breaking: time, then passed stations, then attempts."""
    from api.services.station_service import get_event_replay_states
    from api.models import Station

    sub_event = SubEvent.objects.get(id=event_id)
    stations = list(Station.objects.filter(
        sub_event=sub_event, active=True, kind=Station.KIND_PLAY,
    ).order_by("order", "id"))
    checkins = list(
        EventCheckIn.objects.filter(
            sub_event=sub_event, status=EventCheckIn.STATUS_ACTIVE, checked_out_at__isnull=False,
        ).select_related("team", "checkout_station", "checked_out_by").order_by("checked_out_at", "id")
    )
    # One batched read for the whole board: this endpoint is polled every 15s
    # while an event runs, so a per-team lookup here would scale with entrants.
    states = get_event_replay_states([checkin.team for checkin in checkins], sub_event, stations)
    rows = []
    for checkin in checkins:
        state = states[checkin.team_id]
        rows.append({
            "id": checkin.id,
            "rank": len(rows) + 1,
            "team_code": checkin.team.code,
            "team_name": checkin.team.name,
            "checked_in_at": checkin.created_at.isoformat(),
            "checked_out_at": checkin.checked_out_at.isoformat(),
            "checkout_station": checkin.checkout_station.name if checkin.checkout_station else None,
            "checked_out_by": checkin.checked_out_by.username if checkin.checked_out_by else None,
            "passed_count": state["passed_count"],
            "total_attempts": sum(item["attempts_used"] for item in state["by_station"].values()),
        })
    return rows
