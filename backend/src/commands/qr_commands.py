"""Deliver the same team QR tokens currently exposed by the web app."""
from __future__ import annotations

import asyncio
import io

import discord
from discord.ext import commands
import qrcode

from ..bot.database import database_call


def setup_qr_commands(bot):
    @bot.command(name="teamqr")
    @commands.has_permissions(administrator=True)
    async def teamqr(ctx):
        from api.services.discord_service import get_qr_delivery_payloads

        delivery = await database_call(get_qr_delivery_payloads)
        if not delivery["enabled"]:
            await ctx.send("QR check-in đang tắt trên trang quản trị hoặc không khớp phase hiện tại.")
            return

        sent = 0
        skipped = 0
        for team in delivery["teams"]:
            channel = bot.get_channel(team["text_channel_id"])
            if channel is None:
                skipped += 1
                continue
            image = qrcode.make(team["qr_payload"])
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            buffer.seek(0)
            embed = discord.Embed(
                title=f"QR check-in · {team['name']}",
                description=(
                    f"Mã này đang có hiệu lực cho phase `{delivery['phase_key']}`. "
                    "Không chia sẻ QR cho đội khác."
                ),
                color=discord.Color.green(),
            )
            try:
                await channel.send(
                    embed=embed,
                    file=discord.File(buffer, filename=f"{team['code']}-qr.png"),
                )
                sent += 1
            except Exception:
                skipped += 1
            await asyncio.sleep(0.25)

        await ctx.send(f"Đã gửi QR cho {sent} đội; bỏ qua {skipped} đội.")
