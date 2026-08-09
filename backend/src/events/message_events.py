"""Message logging and prefix-command dispatch."""
from __future__ import annotations

from datetime import datetime, timezone

import discord


def setup_message_events(bot):
    @bot.event
    async def on_message(message: discord.Message):
        if message.author.bot:
            return
        await bot.process_commands(message)

    @bot.event
    async def on_message_edit(before: discord.Message, after: discord.Message):
        if before.author.bot or before.content == after.content:
            return
        await bot.logger.log_message_edit(before, after)

    @bot.event
    async def on_message_delete(message: discord.Message):
        if message.author.bot:
            return
        await bot.logger.log_message_delete(message)

    @bot.event
    async def on_bulk_message_delete(messages: list[discord.Message]):
        if not messages:
            return
        channel = messages[0].channel
        await bot.logger.log(
            f"🗑️ Đã xóa {len(messages)} tin nhắn tại {channel.mention} · "
            f"{datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M:%S')}"
        )
