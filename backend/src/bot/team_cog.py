"""PostgreSQL-backed Discord provisioning and broadcast worker."""
from __future__ import annotations

import asyncio

import discord
from discord.ext import commands, tasks

from .database import database_call, run_sync
from ..utils.provisioning import provision_team
from ..utils.deprovision import deprovision_team


class DiscordIntegrationCog(commands.Cog):
    # How many passes to retry a queued deprovision before giving up on it.
    MAX_DEPROVISION_ATTEMPTS = 5

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.integration_loop.change_interval(seconds=bot.config.discord_sync_interval)
        self.integration_loop.start()
        self.deprovision_loop.start()

    def cog_unload(self):
        self.integration_loop.cancel()
        self.deprovision_loop.cancel()

    def _guild(self):
        if self.bot.config.guild_id:
            return self.bot.get_guild(self.bot.config.guild_id)
        return self.bot.guilds[0] if self.bot.guilds else None

    async def _provision_pending_teams(self, guild: discord.Guild) -> None:
        from api.services.discord_service import (
            get_pending_team_payloads,
            mark_provision_done,
            mark_provision_failed,
        )

        payloads = await database_call(get_pending_team_payloads)
        for payload in payloads:
            try:
                result = await provision_team(self.bot, guild, payload)
                if result["errors"]:
                    await database_call(
                        mark_provision_failed,
                        payload["code"],
                        "; ".join(result["errors"]),
                    )
                    continue
                await database_call(
                    mark_provision_done,
                    payload["code"],
                    result["role_id"],
                    result["text_channel_id"],
                    result["voice_channel_id"],
                )
            except Exception as error:
                await database_call(mark_provision_failed, payload["code"], str(error))

    async def _send_next_broadcast(self) -> None:
        from api.services.discord_service import (
            claim_next_broadcast,
            mark_broadcast_failed,
            mark_broadcast_sent,
        )

        payload = await database_call(claim_next_broadcast)
        if payload is None:
            return
        if not payload["channel_ids"]:
            await database_call(mark_broadcast_failed, payload["id"], "no_target_channels")
            return

        errors = []
        embed = discord.Embed(
            title=payload["title"][:256],
            description=payload["message"][:4096],
            color=discord.Color.blurple(),
        )
        for channel_id in payload["channel_ids"]:
            channel = self.bot.get_channel(channel_id)
            if channel is None:
                errors.append(f"channel_not_found:{channel_id}")
                continue
            try:
                await channel.send(embed=embed)
            except Exception as error:
                errors.append(f"channel:{channel_id}:{error}")

        if errors:
            await database_call(mark_broadcast_failed, payload["id"], "; ".join(errors))
        else:
            await database_call(mark_broadcast_sent, payload["id"])

    async def _heartbeat(self) -> None:
        from api.services.discord_service import record_bot_heartbeat

        await database_call(
            record_bot_heartbeat,
            str(self.bot.user) if self.bot.user else "starting",
            [guild.id for guild in self.bot.guilds],
            self.bot.latency * 1000,
        )

    @tasks.loop(seconds=10)
    async def integration_loop(self):
        try:
            await self._heartbeat()
            guild = self._guild()
            if guild is not None:
                await self._provision_pending_teams(guild)
            await self._send_next_broadcast()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            print(f"[DISCORD SYNC ERROR] {error}")

    @integration_loop.before_loop
    async def before_integration_loop(self):
        await self.bot.wait_until_ready()

    async def _deprovision_pending_teams(self, guild: discord.Guild) -> None:
        from django.db.models import F
        from api.models import PendingDeprovision

        def get_pending():
            # FIFO so a permanently-failing head-of-line entry can't reorder
            # behind newer ones each pass; the window is bounded to 50.
            return list(
                PendingDeprovision.objects.order_by("created_at").values(
                    "id", "discord_role_id", "text_channel_id",
                    "voice_channel_id", "team_code", "attempts",
                )[:50]
            )

        def delete_pending(record_id: int):
            PendingDeprovision.objects.filter(id=record_id).delete()

        def mark_attempt(record_id: int, detail: str):
            PendingDeprovision.objects.filter(id=record_id).update(
                attempts=F("attempts") + 1, last_error=detail[:2000]
            )

        async def register_failure(record, detail: str) -> None:
            # Bounded retry: keep trying (covers a transient cache miss right
            # after reconnect), but give up after MAX so a resource we can never
            # delete — or one already gone — stops looping and spamming logs.
            attempts = record["attempts"] + 1
            code = record["team_code"]
            if attempts >= self.MAX_DEPROVISION_ATTEMPTS:
                print(f"[DEPROVISION GIVE-UP] team {code} after {attempts} tries: {detail}")
                await run_sync(delete_pending, record["id"])
            else:
                print(f"[DEPROVISION RETRY] team {code} ({attempts}/{self.MAX_DEPROVISION_ATTEMPTS}): {detail}")
                await run_sync(mark_attempt, record["id"], detail)

        records = await run_sync(get_pending)
        for record in records:
            try:
                result = await deprovision_team(
                    guild,
                    discord_role_id=record["discord_role_id"],
                    text_channel_id=record["text_channel_id"],
                    voice_channel_id=record["voice_channel_id"],
                )
            except Exception as error:
                await register_failure(record, f"exception:{error}")
                continue

            problems = result.get("errors") or []
            unresolved = result.get("unresolved") or []
            if not problems and not unresolved:
                await run_sync(delete_pending, record["id"])
            else:
                await register_failure(record, f"errors={problems} unresolved={unresolved}")

    @tasks.loop(seconds=10)
    async def deprovision_loop(self):
        try:
            guild = self._guild()
            if guild is not None:
                await self._deprovision_pending_teams(guild)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            print(f"[DISCORD DEPROVISION ERROR] {error}")

    @deprovision_loop.before_loop
    async def before_deprovision_loop(self):
        await self.bot.wait_until_ready()


async def setup_team_sync(bot: commands.Bot):
    await bot.add_cog(DiscordIntegrationCog(bot))
