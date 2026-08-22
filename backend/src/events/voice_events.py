"""Tự động rời voice channel khi không còn người ở lại."""
from __future__ import annotations

import asyncio

import discord

from ..music.player import (
    force_cleanup_ffmpeg_source,
    get_player,
    remove_player,
)

IDLE_TIMEOUT_SECONDS = 2 * 60


def _human_members(channel: discord.VoiceChannel | None) -> list[discord.Member]:
    """Danh sách thành viên thật (không tính bot) trong kênh voice"""
    if channel is None:
        return []
    return [member for member in channel.members if not member.bot]


def setup_voice_events(bot):
    """Setup voice state event handlers"""

    # Bộ đếm giờ rời kênh theo guild, chỉ chạy khi kênh trống người
    idle_tasks: dict[int, asyncio.Task] = {}

    def cancel_idle_disconnect(guild_id: int) -> None:
        task = idle_tasks.pop(guild_id, None)
        if task is not None:
            task.cancel()

    async def idle_disconnect(guild_id: int) -> None:
        """Rời voice channel sau khi hết thời gian chờ"""
        await asyncio.sleep(IDLE_TIMEOUT_SECONDS)
        idle_tasks.pop(guild_id, None)

        guild = bot.get_guild(guild_id)
        vc = guild.voice_client if guild else None
        if vc is None or not vc.is_connected():
            return

        # Có người quay lại trước khi hết 2 phút thì bỏ lệnh thoát
        if _human_members(vc.channel):
            return

        # Dọn dẹp player như lệnh !exit
        player = get_player(guild_id)
        player.clear_queue()
        player.skip_current()
        force_cleanup_ffmpeg_source(player.current_source)
        if vc.is_playing() or vc.is_paused():
            vc.stop()
        text_channel_id = player.text_channel_id
        voice_channel = vc.channel
        remove_player(guild_id)

        await vc.disconnect()

        await bot.logger.log(
            f"Bot tự động rời voice <#{voice_channel.id if voice_channel else '?'}> "
            f"sau {IDLE_TIMEOUT_SECONDS // 60} phút không có người"
        )
        text_channel = guild.get_channel(text_channel_id) if guild else None
        if isinstance(text_channel, discord.TextChannel):
            try:
                await text_channel.send(
                    f"👋 Không có ai trong voice channel sau {IDLE_TIMEOUT_SECONDS // 60} phút, "
                    f"bot tự động thoát. Dùng `{bot.prefix}play` để mời bot vào lại nhé!"
                )
            except discord.HTTPException:
                pass

    @bot.event
    async def on_voice_state_update(
        member: discord.Member,
        before: discord.VoiceState,
        after: discord.VoiceState,
    ):
        guild = member.guild

        # Bot vừa di chuyển / bị kick: hủy bộ đếm cũ rồi xét lại kênh mới
        if member.id == bot.user.id:
            cancel_idle_disconnect(guild.id)
            vc = guild.voice_client
            if vc is not None and vc.is_connected() and not _human_members(vc.channel):
                idle_tasks[guild.id] = asyncio.create_task(idle_disconnect(guild.id))
            return

        vc = guild.voice_client
        if vc is None or not vc.is_connected():
            return

        if _human_members(vc.channel):
            cancel_idle_disconnect(guild.id)
        elif guild.id not in idle_tasks:
            idle_tasks[guild.id] = asyncio.create_task(idle_disconnect(guild.id))
