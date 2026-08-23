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


def registration_is_open() -> bool:
    """Return the admin-controlled registration state with strict bool parsing."""
    value = _get_setting("registration_open", False)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def set_registration_open(value: bool) -> bool:
    """Persist the registration switch and return the stored bool."""
    stored = bool(value)
    SystemSetting.objects.update_or_create(
        key="registration_open",
        defaults={"value": stored},
    )
    return stored


def profile_is_account_owned_by_other(
    participant: Optional[Participant],
    actor: Optional[Account],
) -> bool:
    """True when `participant` is a self-managed profile belonging to another account.

    A participant row with no linked account is captain-authored data the captain
    may freely edit. Once the member claims it with their own account, the account
    becomes the source of truth (see `_sync_participant_from_account`), so nobody
    else may overwrite its registration fields. `actor=None` means an unattributed
    write, which is treated as "not the owner".
    """
    if participant is None or not participant.account_id:
        return False
    return actor is None or participant.account_id != actor.id


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

    # Concurrent requests can calculate the same sequential code. The database
    # unique constraint remains the source of truth; a loser retries with the
    # newly committed maximum instead of surfacing an error to the participant.
    for _ in range(5):
        team = Team(
            code=_next_team_code(),
            name=name,
            owner_account=owner_account,
            approval_status=Team.APPROVAL_APPROVED if auto_approve else Team.APPROVAL_DRAFT,
            provision_state=Team.PROVISION_PENDING if auto_approve else Team.PROVISION_NONE,
            qr_token=secrets.token_urlsafe(16),
            is_late_registration=is_late_registration,
        )

        try:
            with transaction.atomic():
                team.save()
                if auto_approve:
                    _ensure_default_qualifying_roster(team)
            return team, None
        except IntegrityError:
            continue
        except Exception as e:
            return None, str(e)

    return None, "team_code_conflict"


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


@transaction.atomic
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
    actor: Optional[Account] = None,
) -> Tuple[Optional[Participant], Optional[str]]:
    """Add a participant to a team. Returns (participant, None) or (None, error_code).

    `actor` is the account performing the write. Registration fields of a profile
    already claimed by a different account are left untouched — the membership is
    still created, but the owner's own data wins.
    """
    mssv = (mssv or "").strip()
    if not mssv:
        return None, "missing_mssv"

    # Membership count is a team-level invariant. Lock the same Team row used
    # by batch merge before reading the count, so concurrent adds and merges are
    # serialized instead of both acting on a stale roster size.
    locked_team = Team.objects.select_for_update().filter(pk=team.pk).first()
    if not locked_team:
        return None, "not_found"
    team = locked_team

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

    # An MSSV identifies the student, so the same MSSV already on this team is the
    # same person entered twice — reject it instead of the old update_or_create
    # no-op that let a duplicate slip into the roster. This also covers the team
    # owner/captain, who is shown separately in the roster and may not yet hold a
    # membership row. `is_captain` adds are the owner's own creation step, so they
    # are exempt.
    if not is_captain:
        owner_mssv = ""
        if team.owner_account_id:
            owner_mssv = (team.owner_account.mssv or "").strip()
        already_on_team = bool(existing_member and existing_member.team_id == team.id)
        if already_on_team or (owner_mssv and owner_mssv == mssv):
            return None, "already_in_team"

        # Email identifies a person for the later verified-email auto-sync, so it
        # must be unique across the whole system — no two participants (any team)
        # may share it, and neither may an account belonging to someone else. The
        # MSSV dedup above misses this because the clashing rows carry different
        # MSSVs. Captain adds are the owner's own creation step and are exempt.
        normalized_email = (email or "").strip().lower()
        if normalized_email:
            # Every Participant carries a distinct MSSV, so a different MSSV using
            # this email is genuinely another person. An Account is only a clash
            # once it holds a concrete, different MSSV — an account with no MSSV
            # yet is unclaimed and may be this very member signing up early
            # (it auto-links by verified email later), so it must not block.
            clash = (
                Participant.objects.filter(email__iexact=normalized_email)
                .exclude(mssv=mssv)
                .exists()
                or Account.objects.filter(email__iexact=normalized_email)
                .exclude(mssv__isnull=True)
                .exclude(mssv="")
                .exclude(mssv=mssv)
                .exists()
            )
            if clash:
                return None, "email_in_team"

    # A profile claimed by another account is self-managed: create the membership
    # but never overwrite its registration fields with caller-supplied values.
    existing_participant = Participant.objects.filter(mssv=mssv).first()
    defaults = {}
    if not profile_is_account_owned_by_other(existing_participant, actor):
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
    # Rejecting is the organisers asking for changes, and the roster may be
    # part of those changes — the payment-confirm lock has to give way.
    team.roster_locked_at = None
    team.save(update_fields=[
        "approval_status", "approval_note", "reviewed_by", "reviewed_at",
        "roster_locked_at", "updated_at",
    ])
    return team


def get_team_members(
    team: Team,
    *,
    visibility: str = "full",
    requester: Account | None = None,
) -> list[dict]:
    """Return team members with an explicit privacy policy.

    ``full`` is reserved for admin/internal validation.
    ``basic`` exposes only name, school and student id.
    ``self`` exposes the requester's full profile and basic data for teammates.
    """
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
        basic = {
            "mssv": p.mssv,
            "full_name": p.full_name,
            "school": p.school,
        }
        can_view_full = visibility == "full" or (
            visibility == "self"
            and requester is not None
            and (
                p.account_id == requester.id
                or bool(requester.mssv and p.mssv == requester.mssv)
            )
        )
        if not can_view_full:
            result.append(basic)
            continue

        result.append({
            **basic,
            "email": p.email,
            "phone": p.phone,
            "faculty": p.faculty,
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


def auto_link_participant_by_verified_email(account: Account) -> Optional[Participant]:
    """Adopt a captain-created Participant whose email matches a Google-verified
    account email, so a pre-registered member lands in their team without ever
    typing an MSSV.

    Only the Google sign-in path should call this: it trusts `account.email`
    because Google has verified ownership of it. Acts only when the account has
    no MSSV yet and exactly one *unclaimed* Participant matches the email — zero
    matches means a brand-new person and more than one is ambiguous, both of
    which fall back to the manual MSSV supplementary form. Returns the linked
    Participant, or None when nothing was linked.
    """
    if not account or account.mssv or not account.email:
        return None

    matches = list(
        Participant.objects.filter(
            email__iexact=account.email.strip(),
            account__isnull=True,
        )[:2]
    )
    if len(matches) != 1:
        return None

    participant = matches[0]
    try:
        with transaction.atomic():
            account.mssv = participant.mssv
            account.save(update_fields=["mssv"])
            participant.account = account
            update_fields = ["account", "updated_at"]
            update_fields.extend(_sync_participant_from_account(participant, account))
            participant.save(update_fields=update_fields)
    except IntegrityError:
        # account.mssv (unique) collided with an existing row — a data
        # inconsistency we do not paper over here; leave it to the manual path.
        return None
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
