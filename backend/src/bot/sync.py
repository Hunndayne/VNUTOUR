"""
Background sync from Google Sheet to MongoDB
"""
from __future__ import annotations

import asyncio
from typing import Optional

from discord.ext import tasks

from ..utils.mongo import MongoManager
from ..utils.sheets import fetch_sheet_rows_and_hash


class SheetSyncer:
    def __init__(self, mongo: MongoManager, api_key: str, sheet_id: str, range_name: str, interval_sec: int = 60):
        self.mongo = mongo
        self.api_key = api_key
        self.sheet_id = sheet_id
        self.range_name = range_name
        self.interval_sec = max(30, interval_sec)

        self._loop_task: Optional[tasks.Loop] = None

    def start(self):
        if self._loop_task and self._loop_task.is_running():
            return

        @tasks.loop(seconds=self.interval_sec)
        async def runner():
            try:
                rows, h = await fetch_sheet_rows_and_hash(self.api_key, self.sheet_id, self.range_name)
                # Skip if unchanged
                prev = self.mongo.get_meta("sheet_hash")
                if prev == h:
                    return
                # Upsert participants and teams
                self.mongo.sync_from_rows([r for r in rows if r.get("mssv")])
                self.mongo.set_meta("sheet_hash", h)
            except Exception as e:
                # Log to console; bot logger may not be available here
                print(f"[SHEET SYNC ERROR] {e}")

        self._loop_task = runner
        self._loop_task.start()

    async def run_once(self):
        try:
            rows, h = await fetch_sheet_rows_and_hash(self.api_key, self.sheet_id, self.range_name)
            prev = self.mongo.get_meta("sheet_hash")
            if prev != h:
                self.mongo.sync_from_rows([r for r in rows if r.get("mssv")])
                self.mongo.set_meta("sheet_hash", h)
        except Exception as e:
            print(f"[SHEET SYNC ERROR] {e}")

