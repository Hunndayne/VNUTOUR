"""Core prefix commands integrated with the Django/PostgreSQL web domain."""
from __future__ import annotations

import discord
from discord.ext import commands

from ..bot.database import database_call
from ..utils.provisioning import clean_team_name


def participant_embed(payload: dict, *, title: str = "Thông tin thí sinh") -> discord.Embed:
    embed = discord.Embed(title=title, color=discord.Color.blurple())
    embed.add_field(name="Họ và tên", value=payload.get("full_name") or "-", inline=False)
    embed.add_field(name="MSSV", value=payload.get("mssv") or "-", inline=True)
    embed.add_field(name="Đội", value=payload.get("team_name") or "Chưa có đội", inline=True)
    embed.add_field(name="Mã đội", value=payload.get("team_code") or "-", inline=True)
    embed.add_field(name="Email", value=payload.get("email") or "-", inline=False)
    embed.add_field(
        name="Discord",
        value=f"<@{payload['discord_id']}>" if payload.get("discord_id") else "Chưa liên kết",
        inline=False,
    )
    return embed


def link_result_message(result: dict) -> str:
    messages = {
        "linked": "✅ Đã liên kết Discord với hồ sơ PostgreSQL. Đội của bạn đã được đưa vào hàng đợi đồng bộ role.",
        "already_linked": "ℹ️ Discord này đã liên kết đúng với MSSV của bạn.",
        "member_not_found": "❌ Không tìm thấy MSSV trong hệ thống đăng ký VNUTour.",
        "mssv_already_linked": "❌ MSSV này đã liên kết với một tài khoản Discord khác. Hãy liên hệ quản trị viên.",
        "discord_already_linked": "❌ Discord của bạn đang liên kết với MSSV khác. Hãy liên hệ quản trị viên.",
        "invalid_discord_id": "❌ Discord ID không hợp lệ.",
    }
    return messages.get(result.get("status"), "❌ Không thể cập nhật liên kết Discord.")


def setup_admin_commands(bot):
    @bot.command(name="ping")
    async def ping(ctx):
        await ctx.send(f"Pong! {round(bot.latency * 1000)} ms")

    @bot.command(name="info")
    async def info(ctx):
        embed = discord.Embed(
            title="VNUTour Bot",
            description="Bot Discord dùng chung PostgreSQL với trang quản trị VNUTour.",
            color=discord.Color.blurple(),
        )
        embed.add_field(name="Máy chủ", value=str(len(bot.guilds)), inline=True)
        embed.add_field(name="Độ trễ", value=f"{round(bot.latency * 1000)} ms", inline=True)
        embed.add_field(name="Phiên bản", value="2.0 · PostgreSQL", inline=True)
        if bot.config.web_base_url:
            embed.add_field(name="Trang web", value=bot.config.web_base_url, inline=False)
        await ctx.send(embed=embed)

    @bot.command(name="assign")
    async def assign(ctx, mssv: str):
        from api.services.discord_service import claim_discord_identity

        result = await database_call(claim_discord_identity, mssv, ctx.author.id)
        await ctx.reply(link_result_message(result), mention_author=False)
        payload = result.get("participant")
        if payload and result.get("status") in {"linked", "already_linked"}:
            try:
                await ctx.author.send(embed=participant_embed(payload, title="Liên kết VNUTour thành công"))
            except discord.Forbidden:
                pass

    @bot.command(name="check")
    @commands.has_permissions(administrator=True)
    async def check(ctx, mssv: str | None = None):
        from api.services.discord_service import get_participant_payload

        payload = await database_call(
            get_participant_payload,
            mssv=mssv,
            discord_id=None if mssv else ctx.author.id,
        )
        if payload is None:
            await ctx.send("❌ Không tìm thấy thí sinh trong PostgreSQL.")
            return
        await ctx.send(embed=participant_embed(payload))

    @bot.command(name="editassign")
    @commands.has_permissions(administrator=True)
    async def editassign(ctx, member: discord.Member, mssv: str):
        from api.services.discord_service import claim_discord_identity

        result = await database_call(claim_discord_identity, mssv, member.id, force=True)
        await ctx.send(link_result_message(result))

    @bot.command(name="addallrole")
    @commands.has_permissions(administrator=True)
    async def addallrole(ctx):
        from api.services.discord_service import queue_all_approved_teams

        count = await database_call(queue_all_approved_teams)
        await ctx.send(f"✅ Đã đưa {count} đội đã duyệt vào hàng đợi provision PostgreSQL.")

    @bot.command(name="checkteamconfig")
    @commands.has_permissions(administrator=True)
    async def checkteamconfig(ctx):
        from api.services.discord_service import get_bot_runtime_status, get_provisioning_queue

        runtime = await database_call(get_bot_runtime_status)
        queue = await database_call(get_provisioning_queue)
        embed = discord.Embed(title="Cấu hình tích hợp Discord", color=discord.Color.blurple())
        embed.add_field(name="Database", value="PostgreSQL / Django ORM", inline=False)
        embed.add_field(name="Bot heartbeat", value="Online" if runtime["online"] else "Chưa có", inline=True)
        embed.add_field(name="Đội chờ/lỗi", value=str(len(queue)), inline=True)
        embed.add_field(
            name="Category đội",
            value=", ".join(str(value) for value in bot.config.team_category_ids) or "Chưa cấu hình",
            inline=False,
        )
        await ctx.send(embed=embed)

    @bot.command(name="checkteampermissions")
    @commands.has_permissions(administrator=True)
    async def checkteampermissions(ctx, *, team_name: str):
        clean_name = clean_team_name(team_name)
        role = discord.utils.get(ctx.guild.roles, name=clean_name)
        slug = clean_name.lower().replace(" ", "-")
        text_channel = discord.utils.get(ctx.guild.text_channels, name=slug)
        voice_channel = discord.utils.get(ctx.guild.voice_channels, name=slug)
        await ctx.send(
            f"Role: {'✅' if role else '❌'} · Text: {'✅' if text_channel else '❌'} · Voice: {'✅' if voice_channel else '❌'}"
        )

    @bot.command(name="clear")
    @commands.has_permissions(manage_messages=True)
    async def clear(ctx, amount: int = 5):
        deleted = await ctx.channel.purge(limit=max(1, min(amount, 100)) + 1)
        message = await ctx.send(f"Đã xóa {max(0, len(deleted) - 1)} tin nhắn.")
        await message.delete(delay=3)

    @bot.command(name="kick")
    @commands.has_permissions(kick_members=True)
    async def kick(ctx, member: discord.Member, *, reason: str = "Không có lý do"):
        await member.kick(reason=reason)
        await ctx.send(f"Đã kick {member.mention}.")

    @bot.command(name="ban")
    @commands.has_permissions(ban_members=True)
    async def ban(ctx, member: discord.Member, *, reason: str = "Không có lý do"):
        await member.ban(reason=reason)
        await ctx.send(f"Đã ban {member.mention}.")

    @bot.command(name="unban")
    @commands.has_permissions(ban_members=True)
    async def unban(ctx, user_id: int):
        user = await bot.fetch_user(user_id)
        await ctx.guild.unban(user)
        await ctx.send(f"Đã unban {user}.")
