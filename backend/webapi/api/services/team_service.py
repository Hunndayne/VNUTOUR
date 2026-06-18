"""
Team service — creation, member management, approval workflow, QR tokens.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Optional, Tuple, List

from django.db import IntegrityError, transaction

from api.models import (
    Account, Participant, Team, TeamMembership, ProgramPhase, SystemSetting,
)


def _get_setting(key: str, default=None):
    try:
        s = SystemSetting.objects.filter(key=key).first()
        return s.value if s else default
    except Exception:
        return default


def create_team(
    name: str,
    owner_account: Account | None = None,
    auto_approve: bool = False,
) -> Tuple[Optional[Team], Optional[str]]:
    """Create a new team. Returns (team, None) or (None, error_code)."""
    name = (name or "").strip()
    if not name:
        return None, "missing_team_name"

    # Generate unique team code
    code = _next_team_code()

    team = Team(
        code=code,
        name=name,
        owner_account=owner_account,
        approval_status=Team.APPROVAL_APPROVED if auto_approve else Team.APPROVAL_DRAFT,
        provision_state=Team.PROVISION_PENDING if auto_approve else Team.PROVISION_NONE,
        qr_token=secrets.token_urlsafe(16),
    )

    try:
        team.save()
        return team, None
    except IntegrityError:
        return None, "team_code_conflict"
    except Exception as e:
        return None, str(e)


def _next_team_code() -> str:
    """Generate next sequential team code like T0001."""
    last = Team.objects.order_by("-code").first()
    if last and last.code.startswith("T"):
        try:
            n = int(last.code[1:])
            return f"T{n + 1:04d}"
        except ValueError:
            pass
    return "T0001"


def add_member(
    team: Team,
    mssv: str,
    full_name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    faculty: str | None = None,
    school: str | None = None,
    facebook: str | None = None,
    is_captain: bool = False,
) -> Tuple[Optional[Participant], Optional[str]]:
    """Add a participant to a team. Returns (participant, None) or (None, error_code)."""
    mssv = (mssv or "").strip()
    if not mssv:
        return None, "missing_mssv"

    # Check team limits
    max_members = _get_setting("team_max_members", 5)
    current_count = TeamMembership.objects.filter(team=team).count()
    if current_count >= max_members:
        return None, "team_full"

    # Check if participant already in another team
    existing_member = TeamMembership.objects.filter(
        participant__mssv=mssv,
    ).select_related("team").first()
    if existing_member and existing_member.team_id != team.id:
        return None, "mssv_in_other_team"

    # Get or create participant
    participant, _ = Participant.objects.update_or_create(
        mssv=mssv,
        defaults={
            "full_name": full_name or "",
            "email": email or None,
            "phone": phone or None,
            "faculty": faculty or None,
            "school": school or None,
            "facebook": facebook or None,
        },
    )

    # Create or reuse membership. We already verified the participant is not in
    # another team above, so any existing membership belongs to this team — keep
    # its captain flag instead of recreating (which would silently drop it).
    try:
        with transaction.atomic():
            membership, created = TeamMembership.objects.update_or_create(
                participant=participant,
                defaults={"team": team},
            )
            if is_captain and not membership.is_captain:
                membership.is_captain = True
                membership.save(update_fields=["is_captain", "updated_at"])
    except IntegrityError:
        return None, "already_in_team"

    return participant, None


def update_member(
    team: Team,
    mssv: str,
    full_name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    faculty: str | None = None,
    school: str | None = None,
    facebook: str | None = None,
) -> Tuple[Optional[Participant], Optional[str]]:
    """Update a participant who belongs to `team`. Returns (participant, error)."""
    mssv = (mssv or "").strip()
    membership = TeamMembership.objects.filter(
        team=team, participant__mssv=mssv,
    ).select_related("participant").first()
    if not membership:
        return None, "not_found"

    p = membership.participant
    fields = {
        "full_name": full_name, "email": email, "phone": phone,
        "faculty": faculty, "school": school, "facebook": facebook,
    }
    changed = []
    for field, value in fields.items():
        if value is not None:
            setattr(p, field, value)
            changed.append(field)
    if changed:
        p.save(update_fields=changed + ["updated_at"])
    return p, None


def remove_member(team: Team, mssv: str) -> Tuple[bool, Optional[str]]:
    """Remove a participant from a team. Returns (success, error_code)."""
    mssv = (mssv or "").strip()
    try:
        deleted, _ = TeamMembership.objects.filter(
            team=team, participant__mssv=mssv,
        ).delete()
        if deleted:
            return True, None
        return False, "not_found"
    except Exception as e:
        return False, str(e)


def submit_team(team: Team) -> Tuple[bool, Optional[str]]:
    """Submit a team for admin approval. Returns (success, error_code)."""
    # Must have at least one member
    if not TeamMembership.objects.filter(team=team).exists():
        return False, "no_members"

    if team.approval_status == Team.APPROVAL_APPROVED:
        return False, "already_approved"

    team.approval_status = Team.APPROVAL_PENDING
    team.submitted_at = datetime.now(timezone.utc)
    team.approval_note = None
    team.save(update_fields=["approval_status", "submitted_at", "approval_note", "updated_at"])
    return True, None


def approve_team(team: Team, reviewer: Account) -> Team:
    """Admin approves a team — queues Discord provisioning."""
    now = datetime.now(timezone.utc)
    team.approval_status = Team.APPROVAL_APPROVED
    team.approval_note = None
    team.reviewed_by = reviewer
    team.reviewed_at = now
    team.provision_state = Team.PROVISION_PENDING
    team.save(update_fields=[
        "approval_status", "approval_note", "reviewed_by", "reviewed_at",
        "provision_state", "updated_at",
    ])
    return team


def reject_team(team: Team, reviewer: Account, note: str | None = None) -> Team:
    """Admin rejects a team with optional note."""
    now = datetime.now(timezone.utc)
    team.approval_status = Team.APPROVAL_REJECTED
    team.approval_note = note
    team.reviewed_by = reviewer
    team.reviewed_at = now
    team.save(update_fields=[
        "approval_status", "approval_note", "reviewed_by", "reviewed_at", "updated_at",
    ])
    return team


def get_team_members(team: Team) -> list[dict]:
    """Return member details for a team."""
    memberships = TeamMembership.objects.filter(team=team).select_related("participant")
    result = []
    for m in memberships:
        p = m.participant
        has_account = Account.objects.filter(
            mssv=p.mssv, is_active=True,
        ).exists()
        result.append({
            "mssv": p.mssv,
            "full_name": p.full_name,
            "email": p.email,
            "phone": p.phone,
            "faculty": p.faculty,
            "school": p.school,
            "facebook": p.facebook,
            "discord_id": p.discord_id,
            "is_captain": m.is_captain,
            "team_number": m.team_number,
            "has_account": has_account,
        })
    return result


def link_account_profile(account: Account) -> Optional[Participant]:
    """Link Account.mssv <-> Participant.account so the FK is not left dangling.

    Used after a participant fills in their mssv (incl. the post-Google-signup
    supplementary-info page) and when an owner creates their team.
    """
    if not account or not account.mssv:
        return None
    participant = Participant.objects.filter(mssv=account.mssv).first()
    if participant and participant.account_id != account.id:
        participant.account = account
        participant.save(update_fields=["account", "updated_at"])
    return participant


def get_team_for_participant(mssv: str) -> Optional[Team]:
    """Find which team a participant belongs to."""
    membership = TeamMembership.objects.filter(
        participant__mssv=mssv,
    ).select_related("team").first()
    return membership.team if membership else None


def rotate_qr_token(team: Team) -> str:
    """Generate a new QR token for a team."""
    team.qr_token = secrets.token_urlsafe(16)
    team.save(update_fields=["qr_token", "updated_at"])
    return team.qr_token


def team_is_editable(team: Team) -> bool:
    """Check if team can be edited by owner (draft, pending, rejected)."""
    return team.approval_status in (
        Team.APPROVAL_DRAFT,
        Team.APPROVAL_PENDING,
        Team.APPROVAL_REJECTED,
    )
