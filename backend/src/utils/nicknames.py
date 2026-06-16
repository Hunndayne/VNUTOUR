"""
Helpers for formatting and setting Discord nicknames.
"""
from __future__ import annotations

import re
from typing import Optional, Tuple


def _norm_space(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def build_nickname(full_name: Optional[str], team_name: Optional[str], max_len: int = 32) -> str:
    """Build nickname using only the participant's full name.

    - Team prefix is intentionally omitted to keep names readable.
    - Trims/collapses whitespace and truncates to Discord's 32-char limit.
    """
    name = _norm_space(full_name or "")
    return name[:max_len]


async def try_set_nickname(member, nickname: str, reason: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """Attempt to set a member's nickname, returning (ok, error_message).

    Handles common permission errors gracefully.
    """
    try:
        import discord  # local import to avoid hard dependency at module import time
    except Exception:  # pragma: no cover
        return False, "discord.py not available"

    if not getattr(member, "guild", None) or not nickname:
        return False, "missing member or nickname"

    # Avoid needless API calls
    try:
        if getattr(member, "nick", None) == nickname:
            return True, None
    except Exception:
        pass

    # Permission and hierarchy checks
    guild = member.guild
    me = getattr(guild, "me", None)
    if me is None:
        try:
            me = await guild.fetch_member(guild._state.self_id)  # type: ignore[attr-defined]
        except Exception:
            me = None
    if me is None:
        return False, "me-unavailable"

    if not me.guild_permissions.manage_nicknames:
        return False, "no_permission"

    # Owner cannot be changed
    try:
        if getattr(guild, "owner_id", None) == member.id:
            return False, "target_owner"
    except Exception:
        pass

    # Role position check
    try:
        if me.top_role <= member.top_role:
            return False, "lower_role"
    except Exception:
        # If roles cannot be compared, continue to try
        pass

    try:
        await member.edit(nick=nickname, reason=reason)
        return True, None
    except discord.Forbidden:
        return False, "forbidden"
    except discord.HTTPException as e:
        return False, str(e)
    except Exception as e:  # Unexpected
        return False, str(e)
