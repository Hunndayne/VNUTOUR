"""Delete Discord team resources that no longer belong to any team.

Merging teams deletes rows from `Team`, and until recently that left the source
teams' roles and channels behind with nothing pointing at them. Provisioning
cannot clean them up on its own: it only strips a role from a member if that
role is still listed as managed, and the list is built from live `Team` rows —
so the moment a team row disappears, its role becomes permanently unremovable.

This sweep closes that loop from the other side: it walks the configured team
categories and removes what the database no longer claims.

Everything it touches has to clear three bars, because deleting a role or a
channel on a live event server is not reversible:

1.  Scope — only channels inside `team_category_ids` that carry provisioning's
    signature (a dedicated role overwrite), and only roles that such a channel
    granted access to. A hand-made channel someone filed in a team category,
    and any role that grants nothing there, are never considered.
2.  Ownership — the id must not be recorded on any team, must not already be
    queued for deprovision (that loop owns it), and the name must not match a
    team that is mid-provision and has yet to have its ids written back.
3.  Permission — never `@everyone`, never an integration-managed role, and
    never a role at or above the bot's own top role.

Deletions are capped per pass so that a bad inventory read can cost a handful
of resources rather than a category.
"""
from __future__ import annotations

from typing import Any

import discord

from .categories import get_valid_team_categories_for_guild

# Upper bound on what a single pass may delete, roles and channels counted
# separately. A real backlog drains over a few passes; a wrong answer stops
# here instead of emptying the category.
MAX_DELETIONS_PER_PASS = 10


def _is_deletable_role(role: discord.Role, guild: discord.Guild) -> str | None:
    """Return a reason the role must be left alone, or None if it may go."""
    if role.is_default():
        return "everyone"
    if role.managed:
        return "integration_managed"
    me = guild.me
    if me is None:
        return "bot_member_unavailable"
    if not me.guild_permissions.manage_roles:
        return "no_manage_roles"
    if role >= me.top_role:
        return "above_bot"
    return None


async def sweep_orphan_team_resources(
    bot,
    guild: discord.Guild,
    inventory: dict[str, Any],
) -> dict[str, Any]:
    """Remove team channels and roles the database no longer claims."""
    result: dict[str, Any] = {
        "deleted_channels": [],
        "deleted_roles": [],
        "skipped_roles": [],
        "errors": [],
    }

    categories = get_valid_team_categories_for_guild(bot, guild)
    if not categories:
        # With no configured categories there is no safe boundary for the
        # sweep, so it does nothing rather than guessing at the whole guild.
        return result

    live_channel_ids = set(inventory.get("channel_ids") or [])
    live_channel_ids.update(inventory.get("pending_channel_ids") or [])
    live_role_ids = set(inventory.get("role_ids") or [])
    live_role_ids.update(inventory.get("pending_role_ids") or [])
    expected_names = set(inventory.get("expected_names") or [])

    def claimed_by_name(name: str) -> bool:
        # Channels are slugged (spaces to hyphens) while roles keep the team
        # name, so compare both spellings against the team labels.
        candidate = (name or "").strip().lower()
        return candidate in expected_names or candidate.replace("-", " ") in expected_names

    def granted_roles(channel) -> list[discord.Role]:
        return [
            target for target in getattr(channel, "overwrites", {})
            if isinstance(target, discord.Role) and not target.is_default()
        ]

    orphan_channels: list[discord.abc.GuildChannel] = []
    candidate_roles: dict[int, discord.Role] = {}
    for category in categories:
        for channel in list(getattr(category, "channels", [])):
            if channel.id in live_channel_ids:
                continue
            if claimed_by_name(channel.name):
                continue
            # Provisioning always gives a team channel its own role overwrite.
            # Without one this is not a team channel at all — someone filed a
            # noticeboard or a lobby in the category — so leave it alone.
            roles = granted_roles(channel)
            if not roles:
                continue
            orphan_channels.append(channel)
            for role in roles:
                if role.id in live_role_ids or claimed_by_name(role.name):
                    continue
                candidate_roles[role.id] = role

    for channel in orphan_channels[:MAX_DELETIONS_PER_PASS]:
        try:
            await channel.delete(reason="VNUTour orphan cleanup: no team owns this channel")
            result["deleted_channels"].append({"id": int(channel.id), "name": channel.name})
        except Exception as error:
            result["errors"].append(f"channel:{channel.id}:{error}")

    for role in list(candidate_roles.values())[:MAX_DELETIONS_PER_PASS]:
        reason = _is_deletable_role(role, guild)
        if reason:
            result["skipped_roles"].append({"id": int(role.id), "name": role.name, "reason": reason})
            continue
        try:
            await role.delete(reason="VNUTour orphan cleanup: no team owns this role")
            result["deleted_roles"].append({"id": int(role.id), "name": role.name})
        except Exception as error:
            result["errors"].append(f"role:{role.id}:{error}")

    return result
