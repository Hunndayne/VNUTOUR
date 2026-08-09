"""Member lifecycle events without hard-coded event-year channel IDs."""
from __future__ import annotations

import discord


def _channel_reference(channel_id: int | None, fallback: str) -> str:
    return f"<#{channel_id}>" if channel_id else fallback


def setup_member_events(bot):
    @bot.event
    async def on_member_join(member: discord.Member):
        await bot.logger.log_member_join(member)

        if bot.config.welcome_channel_id:
            channel = bot.get_channel(bot.config.welcome_channel_id)
            if channel:
                await channel.send(
                    f"🎉 Chào mừng {member.mention} đến với VNUTour! "
                    "Hãy kiểm tra tin nhắn riêng để liên kết hồ sơ."
                )

        embed = discord.Embed(
            title="Chào mừng đến với VNUTour",
            description=(
                "Bot và trang web dùng chung dữ liệu PostgreSQL. Sau khi đăng ký trên web, "
                "hãy dùng `/assign <mssv>` để nhận đúng role và kênh của đội."
            ),
            color=discord.Color.blurple(),
        )
        embed.add_field(
            name="1. Bắt đầu",
            value=_channel_reference(bot.config.start_here_channel_id, "Xem kênh hướng dẫn của server"),
            inline=False,
        )
        embed.add_field(
            name="2. Quy định",
            value=_channel_reference(bot.config.rules_channel_id, "Đọc quy định của server"),
            inline=False,
        )
        embed.add_field(
            name="3. Liên kết MSSV",
            value="Dùng `/assign <mssv>` hoặc `!assign <mssv>` sau khi hồ sơ đã có trên web.",
            inline=False,
        )
        if bot.config.web_base_url:
            embed.add_field(name="Trang web", value=bot.config.web_base_url, inline=False)
        if bot.config.support_channel_id:
            embed.add_field(name="Hỗ trợ", value=f"<#{bot.config.support_channel_id}>", inline=False)
        try:
            await member.send(embed=embed)
        except discord.Forbidden:
            pass
        except Exception as error:
            await bot.logger.log(f"[WELCOME DM ERROR] {member.id}: {error}")

    @bot.event
    async def on_member_remove(member: discord.Member):
        await bot.logger.log_member_leave(member)

    @bot.event
    async def on_member_update(before: discord.Member, after: discord.Member):
        if before.roles != after.roles:
            added = [role.name for role in set(after.roles) - set(before.roles) if role.name != "@everyone"]
            removed = [role.name for role in set(before.roles) - set(after.roles) if role.name != "@everyone"]
            if added:
                await bot.logger.log(f"🔔 {after.mention} được thêm role: {', '.join(added)}")
            if removed:
                await bot.logger.log(f"🔔 {after.mention} bị gỡ role: {', '.join(removed)}")
