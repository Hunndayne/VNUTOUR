"""
Discord service — provisioning status, retry, broadcasts.
"""

from __future__ import annotations

from datetime import timedelta, timezone
from typing import Optional, Tuple

from django.db import transaction
from django.db.models import Q
from django.utils import timezone as django_timezone
from django.utils.dateparse import parse_datetime

from api.models import (
    Account,
    DiscordBroadcast,
    Participant,
    Station,
    StationSession,
    SystemSetting,
    Team,
    TeamMembership,
)


BOT_HEARTBEAT_KEY = "discord_bot_heartbeat"
BOT_HEARTBEAT_MAX_AGE_SECONDS = 90


def _participant_payload(participant: Participant) -> dict:
    membership = participant.memberships.select_related("team").first()
    team = membership.team if membership else None
    return {
        "mssv": participant.mssv,
        "full_name": participant.full_name,
        "email": participant.email,
        "phone": participant.phone,
        "school": participant.school,
        "faculty": participant.faculty,
        "facebook": participant.facebook,
        "discord_id": participant.discord_id,
        "discord_username": participant.discord_username,
        "team_code": team.code if team else None,
        "team_name": team.name if team else None,
        "team_role_id": team.discord_role_id if team else None,
    }


def claim_discord_identity(
    mssv: str,
    discord_id: int,
    *,
    force: bool = False,
    discord_username: str | None = None,
) -> dict:
    """Link a Discord account to a participant in PostgreSQL.

    Public self-linking never steals either side of an existing link. Admin
    commands may pass ``force=True`` to move the Discord account deliberately.
    Any affected team is queued for role/channel reconciliation by the bot.

    ``discord_username`` is an optional display handle (from the web OAuth flow)
    stored so the participant can eyeball which account they linked; the bot
    commands omit it, leaving the column untouched.
    """
    normalized_mssv = str(mssv or "").strip()
    normalized_username = (discord_username or "").strip()[:64] or None
    try:
        normalized_discord_id = int(discord_id)
    except (TypeError, ValueError):
        return {"status": "invalid_discord_id"}

    with transaction.atomic():
        participant = (
            Participant.objects.select_for_update()
            .filter(mssv=normalized_mssv)
            .first()
        )
        if not participant:
            return {"status": "member_not_found"}

        discord_owner = (
            Participant.objects.select_for_update()
            .filter(discord_id=normalized_discord_id)
            .exclude(pk=participant.pk)
            .first()
        )

        if participant.discord_id == normalized_discord_id:
            # Same link — refresh the display handle if the OAuth flow gave us one.
            if normalized_username and participant.discord_username != normalized_username:
                participant.discord_username = normalized_username
                participant.save(update_fields=["discord_username", "updated_at"])
            return {"status": "already_linked", "participant": _participant_payload(participant)}
        if participant.discord_id is not None and not force:
            return {"status": "mssv_already_linked", "participant": _participant_payload(participant)}
        if discord_owner is not None and not force:
            return {
                "status": "discord_already_linked",
                "participant": _participant_payload(discord_owner),
            }

        affected_team_ids: set[int] = set()
        membership = participant.memberships.first()
        if membership:
            affected_team_ids.add(membership.team_id)

        displaced = None
        if discord_owner is not None:
            displaced = _participant_payload(discord_owner)
            owner_membership = discord_owner.memberships.first()
            if owner_membership:
                affected_team_ids.add(owner_membership.team_id)
            discord_owner.discord_id = None
            discord_owner.save(update_fields=["discord_id", "updated_at"])

        previous_discord_id = participant.discord_id
        participant.discord_id = normalized_discord_id
        update_fields = ["discord_id", "updated_at"]
        if normalized_username:
            participant.discord_username = normalized_username
            update_fields.append("discord_username")
        participant.save(update_fields=update_fields)

        if affected_team_ids:
            Team.objects.filter(pk__in=affected_team_ids).update(
                provision_state=Team.PROVISION_PENDING,
                provision_last_error=None,
                updated_at=django_timezone.now(),
            )

    return {
        "status": "linked",
        "participant": _participant_payload(participant),
        "previous_discord_id": previous_discord_id,
        "displaced_participant": displaced,
    }


def release_discord_identity(mssv: str) -> dict:
    """Unlink a participant's Discord account and re-queue their team.

    Clearing ``discord_id`` leaves a stale role on the (now unlinked) member, so
    the team is marked pending for the bot to reconcile — same trigger the link
    path uses. No-op if the participant was never linked.
    """
    normalized_mssv = str(mssv or "").strip()
    with transaction.atomic():
        participant = (
            Participant.objects.select_for_update()
            .filter(mssv=normalized_mssv)
            .first()
        )
        if not participant:
            return {"status": "member_not_found"}
        if participant.discord_id is None:
            return {"status": "not_linked", "participant": _participant_payload(participant)}

        membership = participant.memberships.first()
        affected_team_id = membership.team_id if membership else None

        participant.discord_id = None
        participant.discord_username = None
        participant.save(update_fields=["discord_id", "discord_username", "updated_at"])

        if affected_team_id:
            Team.objects.filter(pk=affected_team_id).update(
                provision_state=Team.PROVISION_PENDING,
                provision_last_error=None,
                updated_at=django_timezone.now(),
            )

    return {"status": "unlinked", "participant": _participant_payload(participant)}


def get_participant_payload(*, mssv: str | None = None, discord_id: int | None = None) -> dict | None:
    queryset = Participant.objects.all()
    if mssv:
        participant = queryset.filter(mssv=str(mssv).strip()).first()
    elif discord_id is not None:
        participant = queryset.filter(discord_id=int(discord_id)).first()
    else:
        return None
    return _participant_payload(participant) if participant else None


def get_pending_team_payloads(limit: int = 50) -> list[dict]:
    """Return bot-ready provisioning payloads sourced only from PostgreSQL."""
    teams = (
        Team.objects.filter(provision_state=Team.PROVISION_PENDING)
        .prefetch_related("memberships__participant")
        .order_by("created_at")[:limit]
    )
    managed_role_ids = list(
        Team.objects.exclude(discord_role_id__isnull=True)
        .values_list("discord_role_id", flat=True)
    )
    payloads = []
    for team in teams:
        members = [
            {
                "mssv": membership.participant.mssv,
                "full_name": membership.participant.full_name,
                "discord_id": membership.participant.discord_id,
            }
            for membership in team.memberships.all()
            if membership.participant.discord_id is not None
        ]
        members.sort(key=lambda item: item["mssv"])
        payloads.append({
            "code": team.code,
            "name": team.name,
            "discord_role_id": team.discord_role_id,
            "text_channel_id": team.text_channel_id,
            "voice_channel_id": team.voice_channel_id,
            "managed_role_ids": managed_role_ids,
            "members": members,
        })
    return payloads


def queue_all_approved_teams() -> int:
    return Team.objects.filter(approval_status=Team.APPROVAL_APPROVED).update(
        provision_state=Team.PROVISION_PENDING,
        provision_last_error=None,
        updated_at=django_timezone.now(),
    )


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
    team.provision_last_error = None
    team.last_provisioned_at = django_timezone.now()
    if role_id is not None:
        team.discord_role_id = role_id
    if text_channel_id is not None:
        team.text_channel_id = text_channel_id
    if voice_channel_id is not None:
        team.voice_channel_id = voice_channel_id
    team.save(update_fields=[
        "provision_state", "last_provisioned_at",
        "provision_last_error",
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


def list_members(query: str = "", linked: str = "all", limit: int = 200) -> tuple[list[dict], dict[str, int]]:
    """Return the web<->Discord mapping for team members with server-side filtering."""
    memberships = TeamMembership.objects.select_related(
        "participant", "team",
    )

    query = (query or "").strip()
    if query:
        memberships = memberships.filter(
            Q(participant__mssv__icontains=query)
            | Q(participant__full_name__icontains=query)
            | Q(team__code__icontains=query)
            | Q(team__name__icontains=query)
            | Q(participant__discord_id__icontains=query)
        )

    counts = {
        "all": memberships.count(),
        "linked": memberships.exclude(participant__discord_id__isnull=True).count(),
        "unlinked": memberships.filter(participant__discord_id__isnull=True).count(),
    }

    if linked == "linked":
        memberships = memberships.exclude(participant__discord_id__isnull=True)
    elif linked == "unlinked":
        memberships = memberships.filter(participant__discord_id__isnull=True)

    memberships = memberships.order_by("team__code", "participant__mssv")[:limit]
    return ([
        {
            "mssv": m.participant.mssv,
            "full_name": m.participant.full_name,
            "team_code": m.team.code,
            "team_name": m.team.name,
            "discord_id": m.participant.discord_id,
            "linked": m.participant.discord_id is not None,
        }
        for m in memberships
    ], counts)


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
    membership = participant.memberships.first()
    if membership:
        Team.objects.filter(pk=membership.team_id).update(
            provision_state=Team.PROVISION_PENDING,
            provision_last_error=None,
            updated_at=django_timezone.now(),
        )
    return participant, None


def _broadcast_channel_ids(broadcast: DiscordBroadcast) -> list[int]:
    teams = Team.objects.exclude(text_channel_id__isnull=True)
    if broadcast.target == DiscordBroadcast.TARGET_APPROVED:
        teams = teams.filter(approval_status=Team.APPROVAL_APPROVED)
    elif broadcast.target == DiscordBroadcast.TARGET_PENDING:
        teams = teams.exclude(provision_state=Team.PROVISION_DONE)
    elif broadcast.target == DiscordBroadcast.TARGET_TEAM_IDS:
        payload = broadcast.target_payload if isinstance(broadcast.target_payload, dict) else {}
        codes = payload.get("team_codes") if isinstance(payload.get("team_codes"), list) else []
        teams = teams.filter(code__in=[str(code).strip() for code in codes if str(code).strip()])
    return sorted(set(int(channel_id) for channel_id in teams.values_list("text_channel_id", flat=True)))


def claim_next_broadcast(stale_after_seconds: int = 300) -> dict | None:
    """Atomically claim one web-created broadcast for the Discord worker."""
    stale_before = django_timezone.now() - timedelta(seconds=max(30, stale_after_seconds))
    with transaction.atomic():
        broadcast = (
            DiscordBroadcast.objects.select_for_update(skip_locked=True)
            .filter(
                Q(status=DiscordBroadcast.STATUS_DRAFT)
                | Q(status=DiscordBroadcast.STATUS_SENDING, updated_at__lt=stale_before)
            )
            .order_by("created_at")
            .first()
        )
        if not broadcast:
            return None
        broadcast.status = DiscordBroadcast.STATUS_SENDING
        broadcast.error = None
        broadcast.save(update_fields=["status", "error", "updated_at"])
        return {
            "id": broadcast.id,
            "title": broadcast.title,
            "message": broadcast.message,
            "target": broadcast.target,
            "channel_ids": _broadcast_channel_ids(broadcast),
        }


def mark_broadcast_sent(broadcast_id: int) -> None:
    DiscordBroadcast.objects.filter(pk=broadcast_id).update(
        status=DiscordBroadcast.STATUS_SENT,
        sent_at=django_timezone.now(),
        error=None,
    )


def mark_broadcast_failed(broadcast_id: int, error: str) -> None:
    DiscordBroadcast.objects.filter(pk=broadcast_id).update(
        status=DiscordBroadcast.STATUS_FAILED,
        error=str(error or "broadcast_failed")[:2000],
    )


def record_bot_heartbeat(user: str, guild_ids: list[int], latency_ms: float) -> None:
    SystemSetting.objects.update_or_create(
        key=BOT_HEARTBEAT_KEY,
        defaults={"value": {
            "user": str(user),
            "guild_ids": [int(guild_id) for guild_id in guild_ids],
            "latency_ms": round(float(latency_ms), 1),
            "timestamp": django_timezone.now().isoformat(),
        }},
    )


def get_bot_runtime_status() -> dict:
    setting = SystemSetting.objects.filter(key=BOT_HEARTBEAT_KEY).first()
    value = setting.value if setting and isinstance(setting.value, dict) else {}
    timestamp = parse_datetime(str(value.get("timestamp") or ""))
    if timestamp and django_timezone.is_naive(timestamp):
        timestamp = django_timezone.make_aware(timestamp, timezone.utc)
    online = bool(
        timestamp
        and django_timezone.now() - timestamp <= timedelta(seconds=BOT_HEARTBEAT_MAX_AGE_SECONDS)
    )
    return {
        "online": online,
        "user": value.get("user"),
        "guild_ids": value.get("guild_ids") if isinstance(value.get("guild_ids"), list) else [],
        "latency_ms": value.get("latency_ms"),
        "last_seen_at": timestamp.isoformat() if timestamp else None,
    }


def get_qr_delivery_payloads() -> dict:
    """Return QR payloads currently allowed by the web's QR toggle."""
    from api.services.checkin_qr_service import get_checkin_qr_state
    from api.services.program_service import get_current_phase

    state = get_checkin_qr_state()
    phase = get_current_phase()
    if not state["enabled"] or not phase or state.get("phase_key") != phase.key:
        return {"enabled": False, "phase_key": phase.key if phase else None, "teams": []}

    teams = (
        Team.objects.filter(
            phase_rosters__phase=phase,
            approval_status=Team.APPROVAL_APPROVED,
        )
        .exclude(qr_token__isnull=True)
        .exclude(text_channel_id__isnull=True)
        .order_by("code")
    )
    return {
        "enabled": True,
        "phase_key": phase.key,
        "teams": [
            {
                "code": team.code,
                "name": team.name,
                "text_channel_id": int(team.text_channel_id),
                "qr_payload": f"t:{team.qr_token}",
            }
            for team in teams
        ],
    }


def get_discord_tour_snapshot(discord_id: int | None = None) -> dict:
    """Read-only current event snapshot for Discord commands."""
    from api.services.program_service import get_current_phase, get_current_sub_event
    from api.services.score_service import get_phase_scoreboard

    phase = get_current_phase()
    sub_event = get_current_sub_event()
    station_items = []
    if sub_event:
        stations = Station.objects.filter(sub_event=sub_event, active=True).order_by("order", "id")
        for station in stations:
            active_count = StationSession.objects.filter(
                station=station,
                status=StationSession.STATUS_ACTIVE,
            ).count()
            station_items.append({
                "code": station.code,
                "name": station.name,
                "location": station.location,
                "active_teams": active_count,
                "capacity": station.max_concurrent_teams if station.capacity_mode == Station.CAPACITY_LIMITED else None,
            })

    participant = None
    active_session = None
    if discord_id is not None:
        participant_model = Participant.objects.filter(discord_id=int(discord_id)).first()
        participant = _participant_payload(participant_model) if participant_model else None
        if participant_model:
            membership = participant_model.memberships.first()
            if membership:
                session = (
                    StationSession.objects.filter(
                        team_id=membership.team_id,
                        status=StationSession.STATUS_ACTIVE,
                    )
                    .select_related("station", "sub_event")
                    .first()
                )
                if session:
                    active_session = {
                        "station_code": session.station.code,
                        "station_name": session.station.name,
                        "event_name": session.sub_event.name,
                        "entered_at": session.entered_at.isoformat(),
                    }

    leaderboard = []
    if phase:
        scoreboard = get_phase_scoreboard(phase.key)
        leaderboard = scoreboard.get("leaderboard", [])[:10]

    return {
        "phase": {"key": phase.key, "label": phase.label} if phase else None,
        "sub_event": {"id": sub_event.id, "name": sub_event.name} if sub_event else None,
        "stations": station_items,
        "participant": participant,
        "active_session": active_session,
        "leaderboard": leaderboard,
    }


def create_broadcast(
    title: str,
    message: str,
    target: str,
    sent_by: Account,
    target_payload: dict | None = None,
) -> DiscordBroadcast:
    """Create a draft broadcast."""
    valid_targets = {value for value, _label in DiscordBroadcast.TARGET_CHOICES}
    if target not in valid_targets:
        raise ValueError("invalid_target")

    normalized_payload = target_payload if isinstance(target_payload, dict) else None
    if target == DiscordBroadcast.TARGET_TEAM_IDS:
        team_codes = normalized_payload.get("team_codes") if normalized_payload else None
        if not isinstance(team_codes, list) or not any(str(code).strip() for code in team_codes):
            raise ValueError("missing_team_codes")

    broadcast = DiscordBroadcast.objects.create(
        title=title,
        message=message,
        target=target,
        target_payload=normalized_payload,
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
