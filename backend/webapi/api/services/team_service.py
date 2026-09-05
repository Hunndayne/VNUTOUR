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
from api.services import registration_emails


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


def get_max_registrations() -> int:
    """Return the max allowed registrations (0 = unlimited)."""
    val = _get_setting("max_registrations", 0)
    try:
        stored = int(val)
        return max(0, stored)
    except (TypeError, ValueError):
        return 0


def set_max_registrations(value: int) -> int:
    """Persist the max allowed registrations (0 = unlimited)."""
    try:
        stored = max(0, int(value))
    except (TypeError, ValueError):
        stored = 0
    SystemSetting.objects.update_or_create(
        key="max_registrations",
        defaults={"value": stored},
    )
    return stored


def get_current_registrations() -> int:
    """Number of people registered through a team that was sent for approval.

    Only members of *submitted* teams count toward the cap — pending, approved,
    and rejected teams all count (a rejected team still consumed a slot), but
    draft teams that were never submitted, and participants not yet on any team,
    do not. Membership is unique per participant, so counting membership rows in
    submitted teams counts each registered person exactly once.
    """
    return TeamMembership.objects.filter(
        team__approval_status__in=[
            Team.APPROVAL_PENDING,
            Team.APPROVAL_APPROVED,
            Team.APPROVAL_REJECTED,
        ],
    ).count()


def registration_capacity_remaining() -> Optional[int]:
    """Return the number of remaining spots, or None if unlimited."""
    max_reg = get_max_registrations()
    if max_reg <= 0:
        return None
    current = get_current_registrations()
    return max(0, max_reg - current)


def registration_is_full() -> bool:
    """Return True if registration has reached or exceeded max capacity."""
    max_reg = get_max_registrations()
    if max_reg <= 0:
        return False
    return get_current_registrations() >= max_reg


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

    # A submitted team (pending/approved) has a final roster: the member is
    # locked to it and cannot be pulled into another team.
    submitted_member = TeamMembership.objects.filter(
        participant__mssv=mssv,
        team__approval_status__in=[Team.APPROVAL_PENDING, Team.APPROVAL_APPROVED],
    ).select_related("team").first()
    if submitted_member:
        if submitted_member.team_id != team.id:
            return None, "mssv_in_submitted_team"
        # Same team already submitted — can't add more members
        return None, "team_locked"

    # The participant may still sit in another team that has NOT been submitted
    # (draft/rejected). Registration is not final there, so rather than reject
    # the add we move them out of the stale team. Capture what to dissolve now,
    # while the membership row still points at the old team, but defer the
    # destructive delete until every validation below has passed and the move
    # has committed (see the cleanup after membership creation).
    existing_member = (
        TeamMembership.objects.filter(participant__mssv=mssv)
        .select_related("team", "team__owner_account")
        .first()
    )
    release_old_team = None
    if existing_member and existing_member.team_id != team.id:
        old_team = existing_member.team
        old_owner_mssv = ""
        if old_team.owner_account_id and old_team.owner_account:
            old_owner_mssv = (old_team.owner_account.mssv or "").strip()
        # B owns the stale team when they captain it or their account created it.
        b_owns_old_team = bool(
            existing_member.is_captain
            or (old_owner_mssv and old_owner_mssv == mssv)
        )
        # A team B leads is only a movable stand-in while B is its sole occupant
        # — the empty shell every signup auto-creates. Once other people joined
        # it, B is a real captain, and pulling B out would silently dissolve a
        # team those members chose. Refuse instead, so B (or a member) has to
        # dismantle it deliberately before B can join someone else's team.
        if b_owns_old_team:
            has_other_members = (
                TeamMembership.objects.filter(team=old_team)
                .exclude(participant__mssv=mssv)
                .exists()
            )
            if has_other_members:
                return None, "mssv_leads_other_team"
        # Owner of a solo shell => dissolve it after the move; plain member =>
        # just detach B and leave the old team to its captain.
        release_old_team = (old_team, b_owns_old_team)

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

    # Create or move the membership. Membership is unique per participant, so
    # update_or_create moves an existing row from a stale draft/rejected team
    # onto this one in place. When moving in from another team, decide captaincy
    # solely from the caller's intent and set it in the SAME update — inheriting
    # a stale is_captain would violate the one-captain-per-team constraint.
    move_defaults = {"team": team}
    if release_old_team is not None:
        move_defaults["is_captain"] = bool(is_captain)
    try:
        with transaction.atomic():
            membership, created = TeamMembership.objects.update_or_create(
                participant=participant,
                defaults=move_defaults,
            )
            if release_old_team is None and is_captain and not membership.is_captain:
                # Same-team re-add: keep an existing captain flag, only ever raise.
                membership.is_captain = True
                membership.save(update_fields=["is_captain", "updated_at"])
    except IntegrityError:
        return None, "already_in_team"

    # The move committed. Dissolve/clean the stale team B came from:
    #   - B owned it     -> delete the whole team (remaining members go teamless)
    #   - B was a member -> the row already moved out; delete it if now empty
    if release_old_team is not None:
        old_team, b_owns_old_team = release_old_team
        if b_owns_old_team or not TeamMembership.objects.filter(team=old_team).exists():
            Team.objects.filter(pk=old_team.pk).delete()

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
    """Update a participant who belongs to `team`. Returns (participant, error).

    `mssv` and `email` are identity/reconciliation references and are never
    overwritten here, even if the caller passes new values — remove the
    member and add a new one instead if they must change.
    """
    mssv = (mssv or "").strip()
    membership = TeamMembership.objects.filter(
        team=team, participant__mssv=mssv,
    ).select_related("participant").first()
    if not membership:
        return None, "not_found"

    p = membership.participant
    fields = {
        "full_name": full_name, "phone": phone,
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
    # Email 1 ("registration received"): the dashboard submit flow routes here,
    # not through registration_service.register_team, so fire it from this choke
    # point too. Enqueue failures are swallowed inside the helper.
    registration_emails.send_registration_received_team(team)
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
    registration_emails.send_team_approved_email(team, created_by=reviewer)
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
        # No Participant row exists yet — create one from the Account data so
        # that school, faculty, etc. collected during signup are immediately
        # available in the registration profile without waiting for the captain
        # profile-save step.
        participant = Participant.objects.create(
            account=account,
            mssv=account.mssv,
            full_name=account.full_name or "",
            email=account.email or "",
            phone=account.phone or "",
            school=account.school or "",
            faculty=account.faculty or "",
        )
        return participant, "linked"

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
