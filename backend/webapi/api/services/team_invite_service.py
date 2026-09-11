"""Secure team invitation links owned by captains and accepted by invitees."""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from api.models import Account, Team, TeamInviteLink, TeamMembership
from api.services.registration_service import validate_person_submission
from api.services.team_service import (
    add_member,
    link_account_profile,
    registration_capacity_remaining,
    lock_registration_capacity,
    registration_is_open,
    team_is_editable,
)


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256((raw_token or "").encode("utf-8")).hexdigest()


def _max_members() -> int:
    from api.services.registration_service import get_schema

    schema = get_schema()
    return int(schema.get("team_size_max") or schema.get("team_size") or 5)


def _record_for_token(raw_token: str, *, lock: bool = False):
    queryset = TeamInviteLink.objects.select_related("team")
    if lock:
        queryset = queryset.select_for_update()
    return queryset.filter(token_hash=_hash_token(raw_token)).first()


def account_profile_is_complete(account: Account, participant=None) -> bool:
    """Check every currently required registration field for an account."""
    if not account or not account.mssv:
        return False
    if participant is None:
        participant = account.participant_profile if hasattr(account, "participant_profile") else None
    if participant is None:
        return False

    payload = dict(participant.extra or {})
    payload.update({
        "mssv": participant.mssv or account.mssv,
        "full_name": participant.full_name or account.full_name,
        "email": participant.email or account.email,
        "phone": participant.phone or account.phone,
        "faculty": participant.faculty or account.faculty,
        "school": participant.school or account.school,
        "facebook": participant.facebook,
        "cccd": participant.cccd,
        "date_of_birth": participant.date_of_birth,
    })
    _, _, error = validate_person_submission(payload, "profile")
    return error is None


def _availability(record: TeamInviteLink | None) -> tuple[str, Team | None, int, int]:
    if record is None:
        return "invalid_invite", None, 0, _max_members()
    team = record.team
    count = TeamMembership.objects.filter(team=team).count()
    maximum = _max_members()
    if record.revoked_at is not None:
        return "invite_revoked", team, count, maximum
    if record.expires_at <= timezone.now():
        return "invite_expired", team, count, maximum
    if not registration_is_open():
        return "registration_closed", team, count, maximum
    if not team_is_editable(team) or team.roster_locked_at:
        return "team_locked", team, count, maximum
    if count >= maximum:
        return "team_full", team, count, maximum
    return "active", team, count, maximum


def issue_team_invite(team: Team, actor: Account) -> tuple[TeamInviteLink, str]:
    """Issue a three-hour invite, replacing any previous link for the team."""
    raw_token = secrets.token_urlsafe(32)
    record, _ = TeamInviteLink.objects.update_or_create(
        team=team,
        defaults={
            "token_hash": _hash_token(raw_token),
            "created_by": actor,
            "expires_at": timezone.now() + timedelta(hours=3),
            "revoked_at": None,
            "use_count": 0,
            "last_used_at": None,
        },
    )
    return record, raw_token


def revoke_team_invite(team: Team) -> bool:
    return bool(
        TeamInviteLink.objects.filter(team=team, revoked_at__isnull=True)
        .update(revoked_at=timezone.now())
    )


def inspect_team_invite(raw_token: str) -> dict:
    record = _record_for_token(raw_token)
    status, team, count, maximum = _availability(record)
    payload = {
        "status": status,
        "team": None,
        "member_count": count,
        "max_members": maximum,
        "registration_slots_remaining": registration_capacity_remaining(),
        "expires_at": record.expires_at.isoformat() if record else None,
    }
    if team is not None:
        payload["team"] = {"code": team.code, "name": team.name}
    return payload


@transaction.atomic
def accept_team_invite(raw_token: str, account: Account) -> tuple[dict, str | None]:
    if account.role != Account.ROLE_PARTICIPANT:
        return {}, "participant_required"
    if not account.mssv:
        return {}, "profile_incomplete"

    lock_registration_capacity()
    record = _record_for_token(raw_token, lock=True)
    status, team, count, maximum = _availability(record)
    if status != "active" or team is None or record is None:
        return {}, status

    team = Team.objects.select_for_update().get(pk=team.pk)
    existing = TeamMembership.objects.select_related("team").filter(
        participant__mssv=account.mssv,
    ).first()
    if existing and existing.team_id == team.id:
        return {"status": "already_joined", "team_code": team.code}, None

    participant, link_status = link_account_profile(account)
    if link_status == "mssv_claimed_by_other" or participant is None:
        return {}, "profile_conflict"
    if not account_profile_is_complete(account, participant):
        return {}, "profile_incomplete"

    participant, error = add_member(
        team,
        mssv=account.mssv,
        full_name=participant.full_name or account.full_name,
        email=account.email,
        phone=participant.phone or account.phone,
        faculty=participant.faculty or account.faculty,
        school=participant.school or account.school,
        facebook=participant.facebook,
        cccd=participant.cccd,
        date_of_birth=participant.date_of_birth,
        extra=participant.extra,
        actor=account,
    )
    if error:
        return {}, error

    now = timezone.now()
    TeamInviteLink.objects.filter(pk=record.pk).update(
        use_count=F("use_count") + 1,
        last_used_at=now,
    )
    return {
        "status": "joined",
        "team_code": team.code,
        "team_name": team.name,
        "member_count": count + 1,
        "max_members": maximum,
    }, None
