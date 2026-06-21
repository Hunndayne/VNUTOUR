"""
Discord service — provisioning status, retry, broadcasts.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from api.models import Account, Team, DiscordBroadcast, Participant, TeamMembership


def get_provisioning_queue() -> list[dict]:
    """Return teams waiting for Discord provisioning."""
    teams = Team.objects.filter(
        provision_state__in=[Team.PROVISION_PENDING, Team.PROVISION_FAILED],
    ).order_by("created_at")

    return [
        {
            "code": t.code,
            "name": t.name,
            "provision_state": t.provision_state,
            "provision_last_error": t.provision_last_error,
            "provision_retry_count": t.provision_retry_count,
            "last_provisioned_at": t.last_provisioned_at.isoformat() if t.last_provisioned_at else None,
        }
        for t in teams
    ]


def retry_provision(team_code: str) -> Team:
    """Retry Discord provisioning for a team."""
    team = Team.objects.get(code=team_code)
    team.provision_state = Team.PROVISION_PENDING
    team.provision_retry_count += 1
    team.provision_last_error = None
    team.save(update_fields=[
        "provision_state", "provision_retry_count",
        "provision_last_error", "updated_at",
    ])
    return team


def mark_provision_done(team_code: str, role_id: int | None = None,
                        text_channel_id: int | None = None,
                        voice_channel_id: int | None = None) -> Team:
    """Mark a team's Discord provisioning as complete."""
    team = Team.objects.get(code=team_code)
    team.provision_state = Team.PROVISION_DONE
    team.last_provisioned_at = datetime.now(timezone.utc)
    if role_id is not None:
        team.discord_role_id = role_id
    if text_channel_id is not None:
        team.text_channel_id = text_channel_id
    if voice_channel_id is not None:
        team.voice_channel_id = voice_channel_id
    team.save(update_fields=[
        "provision_state", "last_provisioned_at",
        "discord_role_id", "text_channel_id", "voice_channel_id", "updated_at",
    ])
    return team


def mark_provision_failed(team_code: str, error: str) -> Team:
    """Mark a team's Discord provisioning as failed."""
    team = Team.objects.get(code=team_code)
    team.provision_state = Team.PROVISION_FAILED
    team.provision_last_error = error[:1000] if error else None
    team.save(update_fields=[
        "provision_state", "provision_last_error", "updated_at",
    ])
    return team


def list_members() -> list[dict]:
    """Return the web<->Discord mapping for every team member."""
    memberships = TeamMembership.objects.select_related(
        "participant", "team",
    ).order_by("team__code")
    return [
        {
            "mssv": m.participant.mssv,
            "full_name": m.participant.full_name,
            "team_code": m.team.code,
            "team_name": m.team.name,
            "discord_id": m.participant.discord_id,
            "linked": m.participant.discord_id is not None,
        }
        for m in memberships
    ]


def sync_member(mssv: str) -> Tuple[Optional[Participant], Optional[str]]:
    """
    Look up a member's current Discord linkage so the bot can (re)sync roles.

    NOTE: the actual role/channel sync is performed bot-side; this endpoint
    only validates the member and surfaces the stored mapping.
    """
    mssv = (mssv or "").strip()
    participant = Participant.objects.filter(mssv=mssv).first()
    if not participant:
        return None, "member_not_found"
    return participant, None


def create_broadcast(
    title: str,
    message: str,
    target: str,
    sent_by: Account,
    target_payload: dict | None = None,
) -> DiscordBroadcast:
    """Create a draft broadcast."""
    broadcast = DiscordBroadcast.objects.create(
        title=title,
        message=message,
        target=target,
        target_payload=target_payload,
        sent_by=sent_by,
        status=DiscordBroadcast.STATUS_DRAFT,
    )
    return broadcast


def list_broadcasts(limit: int = 50) -> list[dict]:
    """List recent broadcasts."""
    broadcasts = DiscordBroadcast.objects.select_related("sent_by").order_by("-created_at")[:limit]
    return [
        {
            "id": b.id,
            "title": b.title,
            "target": b.target,
            "target_payload": b.target_payload,
            "status": b.status,
            "sent_by": b.sent_by.username if b.sent_by else None,
            "created_at": b.created_at.isoformat(),
            "sent_at": b.sent_at.isoformat() if b.sent_at else None,
            "error": b.error,
        }
        for b in broadcasts
    ]
