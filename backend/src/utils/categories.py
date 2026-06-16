"""
Helpers to work with team categories and channel capacity.
"""
from __future__ import annotations

from typing import List
import discord


def get_valid_team_categories_for_guild(bot, guild: discord.Guild) -> List[discord.CategoryChannel]:
    """Return configured team categories that belong to the given guild.

    Reads `bot.config.team_category_ids` which may contain multiple category IDs.
    """
    cat_ids = getattr(getattr(bot, "config", None), "team_category_ids", []) or []
    out: List[discord.CategoryChannel] = []
    for cid in cat_ids:
        try:
            ch = bot.get_channel(cid)
            if isinstance(ch, discord.CategoryChannel) and ch.guild.id == guild.id:
                out.append(ch)
        except Exception:
            continue
    return out


def pick_category_for_new_channels(categories: List[discord.CategoryChannel], needed_slots: int = 2) -> discord.CategoryChannel | None:
    """Pick the first category with capacity (<50 channels) for creating new channels.

    If none have capacity, return the first available category as a fallback.
    `needed_slots` should reflect number of channels to be created (e.g., 2 for text+voice).
    """
    for cat in categories:
        try:
            if len(getattr(cat, "channels", [])) + max(1, needed_slots) <= 50:
                return cat
        except Exception:
            pass
    return categories[0] if categories else None

