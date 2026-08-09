"""Discord resource reconciliation for PostgreSQL team payloads."""
from __future__ import annotations

from typing import Any

import discord

from .categories import get_valid_team_categories_for_guild, pick_category_for_new_channels
from .nicknames import build_nickname, try_set_nickname


def clean_team_name(name: str | None) -> str:
    cleaned = "".join(
        character for character in (name or "")
        if character.isalnum() or character in " -_"
    ).strip()
    return cleaned[:32]


def _channel_slug(name: str) -> str:
    return name.lower().replace(" ", "-")


async def _get_member(guild: discord.Guild, discord_id: int):
    member = guild.get_member(discord_id)
    if member is not None:
        return member
    try:
        return await guild.fetch_member(discord_id)
    except Exception:
        return None


async def provision_team(bot, guild: discord.Guild, payload: dict[str, Any]) -> dict[str, Any]:
    """Reconcile one PostgreSQL team with its Discord role and channels."""
    result = {
        "role_id": None,
        "text_channel_id": None,
        "voice_channel_id": None,
        "assigned": 0,
        "errors": [],
    }
    team_code = payload["code"]
    team_name = payload.get("name") or team_code
    clean_name = clean_team_name(team_name)
    if not clean_name:
        result["errors"].append("empty_team_name")
        return result

    categories = get_valid_team_categories_for_guild(bot, guild)

    role = guild.get_role(int(payload["discord_role_id"])) if payload.get("discord_role_id") else None
    role = role or discord.utils.get(guild.roles, name=clean_name)
    if role is None:
        try:
            role = await guild.create_role(
                name=clean_name,
                color=discord.Color.random(),
                reason=f"VNUTour provision {team_code}",
            )
        except Exception as error:
            result["errors"].append(f"role:{error}")
            return result
    elif role.name != clean_name:
        try:
            await role.edit(name=clean_name, reason=f"VNUTour rename {team_code}")
        except Exception as error:
            result["errors"].append(f"role_rename:{error}")
    result["role_id"] = int(role.id)

    slug = _channel_slug(clean_name)
    text_channel = guild.get_channel(int(payload["text_channel_id"])) if payload.get("text_channel_id") else None
    text_channel = text_channel or discord.utils.get(guild.text_channels, name=slug)
    target_category = None
    if text_channel is None:
        try:
            target_category = pick_category_for_new_channels(categories, needed_slots=2)
            if target_category is None:
                raise RuntimeError("no_category_capacity")
            text_channel = await target_category.create_text_channel(
                name=slug,
                topic=f"Kênh chat cho đội {team_name}",
                reason=f"VNUTour provision {team_code}",
                overwrites={
                    guild.default_role: discord.PermissionOverwrite(view_channel=False),
                    role: discord.PermissionOverwrite(
                        view_channel=True,
                        send_messages=True,
                        attach_files=True,
                        embed_links=True,
                        add_reactions=True,
                        read_message_history=True,
                    ),
                },
            )
        except Exception as error:
            result["errors"].append(f"text:{error}")
    elif text_channel.name != slug:
        try:
            await text_channel.edit(name=slug, reason=f"VNUTour rename {team_code}")
        except Exception as error:
            result["errors"].append(f"text_rename:{error}")
    if text_channel is not None:
        result["text_channel_id"] = int(text_channel.id)

    voice_channel = guild.get_channel(int(payload["voice_channel_id"])) if payload.get("voice_channel_id") else None
    voice_channel = voice_channel or discord.utils.get(guild.voice_channels, name=slug)
    if voice_channel is None:
        try:
            voice_category = getattr(text_channel, "category", None) or target_category
            voice_category = voice_category or pick_category_for_new_channels(categories, needed_slots=1)
            if voice_category is None:
                raise RuntimeError("no_category_capacity")
            voice_channel = await voice_category.create_voice_channel(
                name=slug,
                reason=f"VNUTour provision {team_code}",
                user_limit=10,
                overwrites={
                    guild.default_role: discord.PermissionOverwrite(view_channel=False, connect=False),
                    role: discord.PermissionOverwrite(view_channel=True, connect=True, speak=True, stream=True),
                },
            )
        except Exception as error:
            result["errors"].append(f"voice:{error}")
    elif voice_channel.name != slug:
        try:
            await voice_channel.edit(name=slug, reason=f"VNUTour rename {team_code}")
        except Exception as error:
            result["errors"].append(f"voice_rename:{error}")
    if voice_channel is not None:
        result["voice_channel_id"] = int(voice_channel.id)

    managed_role_ids = {int(role_id) for role_id in payload.get("managed_role_ids", []) if role_id}
    for member_payload in payload.get("members", []):
        member = await _get_member(guild, int(member_payload["discord_id"]))
        if member is None:
            continue
        stale_roles = [
            member_role for member_role in member.roles
            if member_role.id in managed_role_ids and member_role.id != role.id
        ]
        if stale_roles:
            try:
                await member.remove_roles(*stale_roles, reason="VNUTour team reconciliation")
            except Exception as error:
                result["errors"].append(f"remove_stale_role:{member.id}:{error}")
        if role not in member.roles:
            try:
                await member.add_roles(role, reason=f"VNUTour team {team_code}")
                result["assigned"] += 1
            except Exception as error:
                result["errors"].append(f"assign:{member.id}:{error}")
        await try_set_nickname(
            member,
            build_nickname(member_payload.get("full_name"), team_name),
            reason="VNUTour participant sync",
        )

    return result
