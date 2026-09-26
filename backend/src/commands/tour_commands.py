"""Read-only event commands backed by the current PostgreSQL programme state."""
from __future__ import annotations

import discord
from discord.ext import commands

from ..bot.database import database_call


def setup_tour_commands(bot):
    @bot.command(name="stations")
    async def stations(ctx):
        from api.services.discord_service import get_discord_tour_snapshot

        snapshot = await database_call(get_discord_tour_snapshot)
        if not snapshot["sub_event"]:
            await ctx.send("Chưa chọn event hiện tại trên trang quản trị.")
            return
        embed = discord.Embed(
            title=f"Các trạm · {snapshot['sub_event']['name']}",
            description=f"Phase: {snapshot['phase']['label'] if snapshot['phase'] else '-'}",
            color=discord.Color.blurple(),
        )
        for station in snapshot["stations"][:25]:
            capacity = f"/{station['capacity']}" if station["capacity"] else ""
            embed.add_field(
                name=f"{station['code']} · {station['name']}",
                value=f"Đang hoạt động: {station['active_teams']}{capacity} đội"
                + (f"\n{station['location']}" if station["location"] else ""),
                inline=False,
            )
        if not snapshot["stations"]:
            embed.description = (embed.description or "") + "\nChưa có trạm đang bật."
        await ctx.send(embed=embed)

    @bot.command(name="mystation")
    async def mystation(ctx):
        from api.services.discord_service import get_discord_tour_snapshot

        snapshot = await database_call(get_discord_tour_snapshot, ctx.author.id)
        if snapshot["participant"] is None:
            await ctx.send("Bạn chưa liên kết MSSV. Dùng `!assign <mssv>` trước.")
            return
        session = snapshot["active_session"]
        if session is None:
            await ctx.send("Đội của bạn hiện không ở trạm nào.")
            return
        await ctx.send(
            f"📍 Đội bạn đang ở **{session['station_code']} · {session['station_name']}** "
            f"trong event **{session['event_name']}**."
        )

    # Thí sinh tuyệt đối không được xem bảng điểm: chỉ admin server gọi được, và
    # kết quả gửi qua tin nhắn riêng để không lộ ra kênh chung.
    @bot.command(name="leaderboard")
    @commands.has_permissions(administrator=True)
    async def leaderboard(ctx):
        from api.services.discord_service import get_discord_tour_snapshot

        snapshot = await database_call(get_discord_tour_snapshot)
        if not snapshot["phase"]:
            await ctx.send("Chưa có phase hiện tại.")
            return
        embed = discord.Embed(
            title=f"Bảng xếp hạng · {snapshot['phase']['label']}",
            color=discord.Color.gold(),
        )
        for index, team in enumerate(snapshot["leaderboard"], 1):
            embed.add_field(
                name=f"#{index} {team['team_name']} ({team['team_code']})",
                value=f"{team['total_points']} điểm",
                inline=False,
            )
        if not snapshot["leaderboard"]:
            embed.description = "Chưa có dữ liệu xếp hạng."
        try:
            await ctx.author.send(embed=embed)
        except discord.Forbidden:
            await ctx.send("Không gửi được tin nhắn riêng. Hãy mở DM từ thành viên server rồi thử lại.")
            return
        if ctx.guild is not None:
            await ctx.send("Đã gửi bảng xếp hạng qua tin nhắn riêng.")
