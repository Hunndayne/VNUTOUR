"""Slash commands for the PostgreSQL-backed VNUTour integration."""
from __future__ import annotations

import discord
from discord import app_commands

from ..bot.database import database_call
from .admin_commands import link_result_message, participant_embed


def setup_slash_commands(bot):
    @bot.tree.command(name="ping", description="Kiểm tra trạng thái VNUTour bot")
    async def ping_slash(interaction: discord.Interaction):
        await interaction.response.send_message(
            f"Pong! {round(bot.latency * 1000)} ms · PostgreSQL",
            ephemeral=True,
        )

    @bot.tree.command(name="assign", description="Liên kết Discord của bạn với MSSV trên VNUTour")
    @app_commands.describe(mssv="Mã số sinh viên đã đăng ký trên web")
    async def assign_slash(interaction: discord.Interaction, mssv: str):
        from api.services.discord_service import claim_discord_identity

        await interaction.response.defer(ephemeral=True)
        result = await database_call(claim_discord_identity, mssv, interaction.user.id)
        payload = result.get("participant")
        await interaction.followup.send(
            content=link_result_message(result),
            embed=participant_embed(payload) if payload and result.get("status") in {"linked", "already_linked"} else None,
            ephemeral=True,
        )

    @bot.tree.command(name="check", description="Admin: xem hồ sơ thí sinh từ PostgreSQL")
    @app_commands.describe(mssv="MSSV cần tra cứu; bỏ trống để tra theo Discord của bạn")
    @app_commands.checks.has_permissions(administrator=True)
    async def check_slash(interaction: discord.Interaction, mssv: str | None = None):
        from api.services.discord_service import get_participant_payload

        await interaction.response.defer(ephemeral=True)
        payload = await database_call(
            get_participant_payload,
            mssv=mssv,
            discord_id=None if mssv else interaction.user.id,
        )
        if payload is None:
            await interaction.followup.send("Không tìm thấy thí sinh.", ephemeral=True)
            return
        await interaction.followup.send(embed=participant_embed(payload), ephemeral=True)

    @bot.tree.command(name="editassign", description="Admin: chuyển liên kết Discord sang một MSSV")
    @app_commands.describe(user="Tài khoản Discord", mssv="MSSV đích")
    @app_commands.checks.has_permissions(administrator=True)
    async def editassign_slash(interaction: discord.Interaction, user: discord.Member, mssv: str):
        from api.services.discord_service import claim_discord_identity

        await interaction.response.defer(ephemeral=True)
        result = await database_call(claim_discord_identity, mssv, user.id, force=True)
        await interaction.followup.send(link_result_message(result), ephemeral=True)

    @bot.tree.command(name="help", description="Hướng dẫn VNUTour bot")
    async def help_slash(interaction: discord.Interaction):
        web_line = f"\nTrang web: {bot.config.web_base_url}" if bot.config.web_base_url else ""
        await interaction.response.send_message(
            "`/assign` liên kết MSSV · `/check` dành cho admin · "
            "role/channel và broadcast được đồng bộ từ trang quản trị."
            + web_line,
            ephemeral=True,
        )
