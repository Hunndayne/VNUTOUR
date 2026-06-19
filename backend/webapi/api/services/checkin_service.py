"""
Check-in service — event check-in scan, stats, reset.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Tuple

from django.db import IntegrityError

from api.models import (
    Account, Team, ProgramPhase, SubEvent, EventCheckIn, PhaseRoster,
    TeamMembership,
)


def _resolve_team_from_scan(raw_code: str) -> Team | None:
    """Resolve a team from QR token or a manual team code fallback."""
    clean_token = str(raw_code or "").strip()
    if not clean_token:
        return None
    if clean_token.startswith("t:") or clean_token.startswith("T:"):
        clean_token = clean_token[2:]
    return Team.objects.filter(qr_token=clean_token).first() or Team.objects.filter(code=clean_token).first()


def scan_event_checkin(
    qr_token: str,
    phase_key: str,
    event_id: int,
    scanner: Account,
    ip: str | None = None,
    user_agent: str | None = None,
) -> Tuple[Optional[EventCheckIn], Optional[str]]:
    """
    Scan a team's QR for event check-in.
    Returns (checkin, None) or (None, error_code).
    """
    team = _resolve_team_from_scan(qr_token)
    if not team:
        return None, "team_not_found"

    # Check if not already approved
    if team.approval_status != Team.APPROVAL_APPROVED:
        return None, "team_not_approved"

    # Resolve phase and event
    try:
        phase = ProgramPhase.objects.get(key=phase_key)
        sub_event = SubEvent.objects.get(id=event_id, phase=phase)
    except ProgramPhase.DoesNotExist:
        return None, "phase_not_found"
    except SubEvent.DoesNotExist:
        return None, "event_not_found"

    # Check if team is in this phase's roster (if roster exists for this phase)
    roster_exists = PhaseRoster.objects.filter(phase=phase).exists()
    if roster_exists:
        in_roster = PhaseRoster.objects.filter(phase=phase, team=team).exists()
        if not in_roster:
            return None, "team_not_in_phase"

    # Check for existing active checkin
    existing = EventCheckIn.objects.filter(
        sub_event=sub_event,
        team=team,
        status=EventCheckIn.STATUS_ACTIVE,
    ).first()
    if existing:
        return None, "already_checked_in"

    # Create checkin
    try:
        checkin = EventCheckIn.objects.create(
            phase=phase,
            sub_event=sub_event,
            team=team,
            scanner=scanner,
            status=EventCheckIn.STATUS_ACTIVE,
            ip=ip,
            user_agent=user_agent,
        )
        return checkin, None
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
    qs = EventCheckIn.objects.select_related(
        "team", "sub_event", "phase", "scanner",
    ).prefetch_related("team__memberships__participant")

    if event_id:
        qs = qs.filter(sub_event_id=event_id)
    if phase_key:
        qs = qs.filter(phase__key=phase_key)
    if status:
        qs = qs.filter(status=status)

    qs = qs.order_by("-created_at")[offset:offset + limit]

    return [
        {
            "id": c.id,
            "team_code": c.team.code,
            "team_name": c.team.name,
            "members_detail": [
                {
                    "mssv": membership.participant.mssv,
                    "full_name": membership.participant.full_name,
                }
                for membership in c.team.memberships.all()
            ],
            "phase_key": c.phase.key,
            "event_id": c.sub_event_id,
            "event_name": c.sub_event.name,
            "status": c.status,
            "scanner": c.scanner.username if c.scanner else None,
            "checked_in_at": c.created_at.isoformat(),
        }
        for c in qs
    ]


def get_checkin_stats(event_id: int | None = None, phase_key: str | None = None) -> dict:
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

    qs = EventCheckIn.objects.filter(status=EventCheckIn.STATUS_ACTIVE)
    if event_id:
        qs = qs.filter(sub_event_id=event_id)
    if phase_key:
        qs = qs.filter(phase__key=phase_key)

    checked_count = qs.count()
    latest = qs.order_by("-created_at").first()
    team_ids = list(qs.values_list("team_id", flat=True).distinct())
    checked_in_participants = TeamMembership.objects.filter(
        team_id__in=team_ids,
    ).values("participant_id").distinct().count()

    return {
        "total_teams": total_teams,
        "checked_in_teams": checked_count,
        "checked_in_participants": checked_in_participants,
        "latest_checkin_at": latest.created_at.isoformat() if latest else None,
    }


def reset_checkin(checkin_id: int) -> bool:
    """Revert a check-in record."""
    updated = EventCheckIn.objects.filter(
        id=checkin_id, status=EventCheckIn.STATUS_ACTIVE,
    ).update(
        status=EventCheckIn.STATUS_REVERTED,
        updated_at=datetime.now(timezone.utc),
    )
    return updated > 0
