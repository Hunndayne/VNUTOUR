"""
Team service — creation, member management, approval workflow, QR tokens.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Optional, Tuple, List

from django.db import IntegrityError, transaction

from api.models import (
    Account, Participant, Team, TeamMembership, ProgramPhase, PhaseRoster, SystemSetting,
    MssvLinkAudit,
)


def _get_setting(key: str, default=None):
    try:
        s = SystemSetting.objects.filter(key=key).first()
        return s.value if s else default
    except Exception:
        return default


def _sync_participant_from_account(participant: Participant, account: Account) -> list[str]:
    changed = []
    for participant_field, account_field in (
        ("email", "email"),
        ("full_name", "full_name"),
        ("phone", "phone"),
        ("school", "school"),
        ("faculty", "faculty"),
    ):
        value = getattr(account, account_field, None)
        if value and getattr(participant, participant_field) != value:
            setattr(participant, participant_field, value)
            changed.append(participant_field)
    return changed


def _ensure_default_qualifying_roster(team: Team) -> None:
    """Approved registration teams are placed into qualifying by default."""
    phase = ProgramPhase.objects.filter(key="qualifying").first()
    if not phase:
        return
    PhaseRoster.objects.update_or_create(
        phase=phase,
        team=team,
        defaults={
            "origin": PhaseRoster.ORIGIN_APPROVED,
            "qualified_from_phase": None,
            "note": "Auto-added when team was approved from registration.",
        },
    )


def ensure_default_phase_roster_for_team(team: Team) -> None:
    """Backfill roster defaults for already-approved legacy teams."""
    if not team or team.approval_status != Team.APPROVAL_APPROVED:
        return
    if PhaseRoster.objects.filter(team=team).exists():
        return
    _ensure_default_qualifying_roster(team)


def create_team(
    name: str,
    owner_account: Account | None = None,
    auto_approve: bool = False,
    is_late_registration: bool = False,
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
        is_late_registration=is_late_registration,
    )

    try:
        team.save()
        if auto_approve:
            _ensure_default_qualifying_roster(team)
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
    cccd: str | None = None,
    date_of_birth=None,
    extra: dict | None = None,
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

    # Check if participant is already in a submitted (pending/approved) team
    submitted_member = TeamMembership.objects.filter(
        participant__mssv=mssv,
        team__approval_status__in=[Team.APPROVAL_PENDING, Team.APPROVAL_APPROVED],
    ).select_related("team").first()
    if submitted_member:
        if submitted_member.team_id != team.id:
            return None, "mssv_in_submitted_team"
        # Same team already submitted — can't add more members
        return None, "team_locked"

    # Check if participant already in another (draft/rejected) team
    existing_member = TeamMembership.objects.filter(
        participant__mssv=mssv,
    ).select_related("team").first()
    if existing_member and existing_member.team_id != team.id:
        return None, "mssv_in_other_team"

    defaults = {}
    for key, value in {
        "full_name": full_name,
        "email": email,
        "phone": phone,
        "faculty": faculty,
        "school": school,
        "facebook": facebook,
        "cccd": cccd,
        "date_of_birth": date_of_birth,
        "extra": extra,
    }.items():
        if value is not None:
            defaults[key] = value
    if "full_name" not in defaults:
        defaults["full_name"] = ""

    # Get or create participant without clearing existing registration fields
    # when the caller only has partial account data (e.g. captain team create).
    participant, _ = Participant.objects.update_or_create(
        mssv=mssv,
        defaults=defaults,
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
    cccd: str | None = None,
    date_of_birth=None,
    extra: dict | None = None,
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
        "cccd": cccd, "date_of_birth": date_of_birth, "extra": extra,
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
    _ensure_default_qualifying_roster(team)
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
        account = Account.objects.filter(
            mssv=p.mssv, is_active=True,
        ).only("email", "full_name", "phone", "school", "faculty", "mssv").first()
        if account:
            link_account_profile(account)
            p.refresh_from_db()
        # The override replaces participant.email with the account email, so the
        # original (captain-entered) email survives only in the audit trail.
        last_override = MssvLinkAudit.objects.filter(
            mssv=p.mssv, action=MssvLinkAudit.ACTION_OVERWRITTEN,
        ).order_by("-created_at").first()
        result.append({
            "mssv": p.mssv,
            "full_name": p.full_name,
            "email": p.email,
            "phone": p.phone,
            "faculty": p.faculty,
            "school": p.school,
            "facebook": p.facebook,
            "cccd": p.cccd,
            "date_of_birth": p.date_of_birth.isoformat() if p.date_of_birth else None,
            "extra": p.extra or {},
            "discord_id": p.discord_id,
            "is_captain": m.is_captain,
            "team_number": m.team_number,
            "has_account": account is not None,
            "account_email": account.email if account else None,
            "email_mismatch": last_override is not None,
            "form_email": last_override.old_email if last_override else None,
        })
    return result


def link_account_profile(account: Account) -> Tuple[Optional[Participant], Optional[str]]:
    """Link Account.mssv <-> Participant.account so the FK is not left dangling.

    Used after a participant fills in their mssv (incl. the post-Google-signup
    supplementary-info page) and when an owner creates their team.

    When the account's email differs from the email the team captain originally
    entered into the form, the participant info is overwritten (account is the
    source of truth) and an MssvLinkAudit row is recorded for in-app + Discord
    notification. Returns (participant, status) where status is one of:
      None         — no participant for this mssv, or nothing changed
      "linked"     — first-time link, no info conflict
      "overwritten"— linked and participant info overwritten (email differed)
      "mssv_claimed_by_other" — blocked: mssv already held by another account
    """
    if not account or not account.mssv:
        return None, None

    participant = Participant.objects.filter(mssv=account.mssv).first()
    if not participant:
        return None, None

    # Already linked to this same account, but still keep account-owned fields
    # in sync because team membership views read from Participant.
    if participant.account_id == account.id:
        changed = _sync_participant_from_account(participant, account)
        if changed:
            participant.save(update_fields=changed + ["updated_at"])
        return participant, None

    # Rare: mssv previously claimed by a different account (e.g. mssv reassigned).
    # Do not silently steal the linkage — block and record for review.
    if participant.account_id and participant.account_id != account.id:
        MssvLinkAudit.objects.create(
            mssv=account.mssv,
            participant=participant,
            account=account,
            prev_account_id=participant.account_id,
            action=MssvLinkAudit.ACTION_BLOCKED,
            old_email=participant.email,
            new_email=account.email,
        )
        return participant, "mssv_claimed_by_other"

    # Fresh link. Detect whether the account contradicts the form data.
    old_email = participant.email
    email_differs = bool(
        account.email and old_email and account.email.strip().lower() != old_email.strip().lower()
    )

    with transaction.atomic():
        participant.account = account
        update_fields = ["account", "updated_at"]
        update_fields.extend(_sync_participant_from_account(participant, account))
        participant.save(update_fields=update_fields)

        if email_differs:
            MssvLinkAudit.objects.create(
                mssv=account.mssv,
                participant=participant,
                account=account,
                action=MssvLinkAudit.ACTION_OVERWRITTEN,
                old_email=old_email,
                new_email=account.email,
            )

    return participant, ("overwritten" if email_differs else "linked")


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
