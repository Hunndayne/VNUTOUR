"""
Shared Discord provisioning for teams.

Centralises the logic that was previously inlined in the `addallrole` command and
the Google-Sheet sync cog: create/rename a team role, its text & voice channels,
store the channel ids back to Mongo, and assign role + nickname to members who
have linked their Discord account.

Used by:
- `src/bot/team_cog.py` (watches MongoDB and provisions automatically)
- `src/commands/admin_commands.py` (`!addallrole` manual trigger)
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import discord

from .categories import get_valid_team_categories_for_guild, pick_category_for_new_channels
from .nicknames import build_nickname, try_set_nickname


def clean_team_name(name: Optional[str]) -> str:
    """Sanitise a team name for use as a Discord role/channel name (<=32 chars)."""
    n = "".join(c for c in (name or "") if c.isalnum() or c in " -_").strip()
    return n[:32]


def _channel_slug(clean_name: str) -> str:
    return clean_name.lower().replace(" ", "-")


def _team_members_with_discord(mongo, team_doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    flt = {"discord_id": {"$exists": True, "$ne": None}}
    mssv_list = team_doc.get("members_mssv")
    if isinstance(mssv_list, list) and mssv_list:
        flt["mssv"] = {"$in": list(mssv_list)}
    else:
        tid = team_doc.get("team_id")
        if tid:
            flt["team_id"] = tid
        else:
            flt["team_name"] = team_doc.get("team_name")
    try:
        return list(mongo.participants.find(flt))
    except Exception:
        return []


async def _rename_resources(guild: discord.Guild, categories, old_clean: str, new_clean: str) -> None:
    """Rename role + text/voice channels from old name to new name within a guild."""
    if not old_clean or not new_clean or old_clean == new_clean:
        return

    # Role
    try:
        role_old = discord.utils.get(guild.roles, name=old_clean)
        role_new = discord.utils.get(guild.roles, name=new_clean)
        if role_old and not role_new:
            await role_old.edit(name=new_clean, reason="Team name updated")
    except Exception as ex:
        print(f"[PROVISION] Role rename failed {old_clean}->{new_clean}: {ex}")

    old_chan = _channel_slug(old_clean)
    new_chan = _channel_slug(new_clean)

    async def _rename_in(text_pool, voice_pool):
        txt = discord.utils.get(text_pool, name=old_chan)
        if txt and not discord.utils.get(text_pool, name=new_chan):
            await txt.edit(name=new_chan, reason="Team name updated")
        vch = discord.utils.get(voice_pool, name=old_chan)
        if vch and not discord.utils.get(voice_pool, name=new_chan):
            await vch.edit(name=new_chan, reason="Team name updated")

    try:
        did = False
        for category in categories:
            if category.guild.id != guild.id:
                continue
            await _rename_in(category.text_channels, category.voice_channels)
            did = True
        if not did:
            await _rename_in(guild.text_channels, guild.voice_channels)
    except Exception as ex:
        print(f"[PROVISION] Channel rename failed {old_clean}->{new_clean}: {ex}")


async def provision_team(bot, guild: discord.Guild, team_doc: Dict[str, Any], mongo) -> Dict[str, Any]:
    """Create/sync the Discord role + channels for a single team within one guild.

    Returns a stats dict. Errors per-step are caught and collected so a single
    failing team never aborts a batch.
    """
    result = {"created_role": 0, "created_channels": 0, "assigned": 0, "renamed": False, "errors": []}

    team_id = team_doc.get("team_id")
    team_name = team_doc.get("team_name") or (f"Team {team_id}" if team_id else "Team")
    clean = clean_team_name(team_name)
    if not clean:
        result["errors"].append("empty_clean_name")
        return result

    categories = get_valid_team_categories_for_guild(bot, guild)

    # Handle rename if the team was provisioned under a different name before
    prev_clean = team_doc.get("provisioned_name")
    if prev_clean and prev_clean != clean:
        await _rename_resources(guild, categories, prev_clean, clean)
        result["renamed"] = True

    # Role
    role = discord.utils.get(guild.roles, name=clean)
    if not role:
        try:
            role = await guild.create_role(
                name=clean, color=discord.Color.random(), reason=f"Auto-provision team {team_id}"
            )
            result["created_role"] = 1
        except Exception as e:
            result["errors"].append(f"role:{e}")
            return result

    slug = _channel_slug(clean)

    # Text channel
    text_channel = discord.utils.get(guild.text_channels, name=slug)
    target_category = None
    if not text_channel:
        try:
            overwrites = {
                guild.default_role: discord.PermissionOverwrite(read_messages=False, send_messages=False, view_channel=False),
                role: discord.PermissionOverwrite(
                    read_messages=True, send_messages=True, attach_files=True, embed_links=True,
                    view_channel=True, add_reactions=True, read_message_history=True,
                ),
            }
            target_category = pick_category_for_new_channels(categories, needed_slots=2)
            if target_category is None:
                raise RuntimeError("no_category_capacity")
            text_channel = await target_category.create_text_channel(
                name=slug, topic=f"Kênh chat cho đội {team_name}",
                reason=f"Auto-provision team {team_id}", overwrites=overwrites,
            )
            result["created_channels"] += 1
        except Exception as e:
            result["errors"].append(f"text:{e}")

    # Voice channel
    voice_channel = discord.utils.get(guild.voice_channels, name=slug)
    if not voice_channel:
        try:
            overwrites = {
                guild.default_role: discord.PermissionOverwrite(connect=False, view_channel=False, speak=False, stream=False),
                role: discord.PermissionOverwrite(connect=True, view_channel=True, speak=True, stream=True),
            }
            voice_cat = getattr(text_channel, "category", None) or target_category or pick_category_for_new_channels(categories, needed_slots=1)
            if voice_cat is None:
                raise RuntimeError("no_category_capacity")
            voice_channel = await voice_cat.create_voice_channel(
                name=slug, reason=f"Auto-provision team {team_id}", overwrites=overwrites, user_limit=10,
            )
            result["created_channels"] += 1
        except Exception as e:
            result["errors"].append(f"voice:{e}")

    # Persist channel ids + the name we provisioned under (for future renames)
    try:
        updates: Dict[str, Any] = {"provisioned_name": clean}
        if text_channel:
            updates["text_channel_id"] = int(text_channel.id)
        if voice_channel:
            updates["voice_channel_id"] = int(voice_channel.id)
        mongo.teams.update_one({"_id": team_doc["_id"]}, {"$set": updates})
    except Exception as e:
        result["errors"].append(f"persist:{e}")

    # Assign role + nickname to members that linked Discord
    for member_data in _team_members_with_discord(mongo, team_doc):
        discord_id = member_data.get("discord_id")
        if not discord_id:
            continue
        member = guild.get_member(int(discord_id))
        if member is None:
            try:
                member = await guild.fetch_member(int(discord_id))
            except Exception:
                member = None
        if not member:
            continue
        try:
            nickname = build_nickname((member_data.get("full_name") or "").strip(), team_name)
            await try_set_nickname(member, nickname, reason="Auto-provision nickname")
        except Exception:
            pass
        if role and role not in member.roles:
            try:
                await member.add_roles(role, reason=f"Auto-provision team {team_id}")
                result["assigned"] += 1
            except Exception as e:
                result["errors"].append(f"assign:{e}")

    return result
