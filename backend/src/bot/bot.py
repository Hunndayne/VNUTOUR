"""Main Discord bot backed by the same PostgreSQL database as the web app."""
from __future__ import annotations

import traceback

import discord
from discord.ext import commands

from .config import BotConfig
from .database import setup_django
from .logger import BotLogger


class VnuTourBot(commands.Bot):
    def __init__(self):
        setup_django()
        config = BotConfig()
        super().__init__(
            command_prefix=config.prefix,
            intents=config.get_intents(),
            help_command=None,
        )
        self.config = config
        self.logger = BotLogger(self)
        self.prefix = config.prefix

        self._setup_events()
        self._setup_commands()
        print("[DB] Bot uses Django ORM / PostgreSQL")

    def _setup_events(self):
        from ..events import setup_events

        setup_events(self)

    def _setup_commands(self):
        from ..commands import setup_commands, setup_slash_commands

        setup_commands(self)
        setup_slash_commands(self)

    async def setup_hook(self):
        await self.logger.log("Bot đang khởi động...")

        try:
            from .team_cog import setup_team_sync

            await setup_team_sync(self)
        except Exception as error:
            print(f"[DISCORD SYNC] Không thể khởi tạo worker: {error}")

        try:
            synced = await self.tree.sync()
            await self.logger.log(f"Đã đồng bộ {len(synced)} slash command(s)")
            print(f"[BOT] Synced {len(synced)} slash command(s)")
        except Exception as error:
            await self.logger.log(f"Lỗi đồng bộ slash commands: {error}")
            print(f"[BOT ERROR] Slash command sync failed: {error}")

    async def on_ready(self):
        await self.logger.log(f"Bot đã sẵn sàng: {self.user}")
        print(f"[BOT] Logged in as {self.user}")
        await self.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.watching,
                name="VNUTour web + !help",
            )
        )

    async def on_command_error(self, ctx, error):
        if isinstance(error, commands.CommandNotFound):
            return
        if isinstance(error, commands.MissingPermissions):
            await ctx.send("❌ Bạn không có quyền sử dụng lệnh này.")
            return
        if isinstance(error, commands.UserInputError):
            await ctx.send(f"❌ Dữ liệu đầu vào không hợp lệ: {error}")
            return

        error_message = f"Lỗi trong lệnh {ctx.command}: {error}"
        await self.logger.log(error_message)
        print(f"[COMMAND ERROR] {error_message}")
        await ctx.send("❌ Đã xảy ra lỗi. Vui lòng thử lại sau.")

    async def on_error(self, event_method: str, *args, **kwargs):
        error_message = f"Lỗi trong event {event_method}: {traceback.format_exc()}"
        await self.logger.log(error_message)
        print(f"[ERROR] {error_message}")

    def run_bot(self):
        self.run(self.config.token)
