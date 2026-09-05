"""Discord resource cleanup for deleted teams."""
from __future__ import annotations

from typing import Any

import discord


async def deprovision_team(
    guild: discord.Guild,
    discord_role_id: int | None,
    text_channel_id: int | None,
    voice_channel_id: int | None,
) -> dict[str, Any]:
    """Remove Discord role and channels that belonged to a deleted team.

    A non-null id that does not resolve to a live object is reported in
    ``unresolved`` rather than being treated as a successful cleanup: the guild
    cache may not be populated yet (e.g. right after a reconnect), so the caller
    retries a bounded number of times before giving up instead of orphaning the
    resource on the first cache miss.
    """
    result = {
        "deleted_role": False,
        "deleted_text": False,
        "deleted_voice": False,
        "errors": [],
        "unresolved": [],
    }

    if discord_role_id:
        role = guild.get_role(discord_role_id)
        if role:
            try:
                await role.delete(reason="VNUTour team deleted")
                result["deleted_role"] = True
            except Exception as error:
                result["errors"].append(f"role:{error}")
        else:
            result["unresolved"].append("role")

    if text_channel_id:
        channel = guild.get_channel(text_channel_id)
        if channel:
            try:
                await channel.delete(reason="VNUTour team deleted")
                result["deleted_text"] = True
            except Exception as error:
                result["errors"].append(f"text:{error}")
        else:
            result["unresolved"].append("text")

    if voice_channel_id:
        channel = guild.get_channel(voice_channel_id)
        if channel:
            try:
                await channel.delete(reason="VNUTour team deleted")
                result["deleted_voice"] = True
            except Exception as error:
                result["errors"].append(f"voice:{error}")
        else:
            result["unresolved"].append("voice")

    return result
