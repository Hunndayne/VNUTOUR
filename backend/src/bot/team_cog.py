"""
Cog that watches MongoDB for teams needing Discord provisioning.

Replaces the Google-Sheet-driven flow: teams created/renamed via the web API are
marked `provision_state="pending"`; this cog picks them up and creates/renames the
role + channels and assigns roles/nicknames to members.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from discord.ext import commands, tasks

from ..utils.provisioning import provision_team


class TeamSyncCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.enabled = bool(getattr(bot, "mongo", None))
        try:
            self.interval = max(15, int(bot.config.__dict__.get("team_sync_interval", 30)))
        except Exception:
            self.interval = 30
        if self.enabled:
            self.team_sync_loop.change_interval(seconds=self.interval)
            self.team_sync_loop.start()

    def cog_unload(self):
        if self.team_sync_loop.is_running():
            self.team_sync_loop.cancel()

    async def _sync_once(self):
        mongo = getattr(self.bot, "mongo", None)
        if not mongo:
            return
        try:
            pending = list(mongo.teams.find({"provision_state": "pending"}))
        except Exception as e:
            print(f"[TEAM SYNC ERROR] Không thể đọc teams: {e}")
            return
        if not pending:
            return

        guilds = list(self.bot.guilds)
        if not guilds:
            return

        for team in pending:
            try:
                for guild in guilds:
                    res = await provision_team(self.bot, guild, team, mongo)
                    if res.get("errors"):
                        print(f"[TEAM SYNC] team {team.get('team_id')} @ {guild.name}: {res['errors']}")
                mongo.teams.update_one(
                    {"_id": team["_id"]},
                    {"$set": {"provision_state": "done", "last_provisioned_at": datetime.now(timezone.utc)}},
                )
            except Exception as e:
                print(f"[TEAM SYNC ERROR] team {team.get('team_id')}: {e}")

    @tasks.loop(seconds=30)  # overridden by change_interval in __init__
    async def team_sync_loop(self):
        try:
            await asyncio.wait_for(self._sync_once(), timeout=300)
        except asyncio.TimeoutError:
            print("[TEAM SYNC TIMEOUT] Provisioning took too long, cancelled")
        except Exception as e:
            print(f"[TEAM SYNC ERROR] {e}")

    @team_sync_loop.before_loop
    async def before_team_sync(self):
        await self.bot.wait_until_ready()


async def setup_team_sync(bot: commands.Bot):
    await bot.add_cog(TeamSyncCog(bot))
