"""
Cog chạy đồng bộ Google Sheet -> MongoDB định kỳ
"""
from __future__ import annotations

import discord
from discord.ext import commands, tasks
from datetime import datetime, timezone

from ..utils.sheets import fetch_sheet_rows_and_hash
from ..utils.nicknames import build_nickname, try_set_nickname


class SheetSyncCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        # Enabled if Mongo present, sheet id configured, AND either API key or service account credentials available
        self.enabled = bool(
            getattr(bot, "mongo", None)
            and bot.config.google_sheet_id
            and (
                bot.config.google_sheet_api_key
                or bot.config.google_credentials_json
                or bot.config.google_credentials_base64
            )
        )
        self.interval = bot.config.sheet_sync_interval
        if self.enabled:
            # Bind the loop with dynamic interval
            self.sheet_sync_loop.change_interval(seconds=max(30, self.interval))
            self.sheet_sync_loop.start()

    def cog_unload(self):
        if self.sheet_sync_loop.is_running():
            self.sheet_sync_loop.cancel()

    async def _sync_once(self):
        mongo = getattr(self.bot, "mongo", None)
        if not mongo:
            return
        # Log start
        try:
            print("Dang dong bo Google Sheet -> MongoDB...")
        except Exception:
            pass
        try:
            # Fetch data with timeout
            rows, h = await fetch_sheet_rows_and_hash(
                self.bot.config.google_sheet_api_key,
                self.bot.config.google_sheet_id,
                # If tab name configured and not already in range, prefix it
                (
                    f"{self.bot.config.google_sheet_tab}!{self.bot.config.google_sheet_range}"
                    if self.bot.config.google_sheet_tab and "!" not in str(self.bot.config.google_sheet_range)
                    else self.bot.config.google_sheet_range
                ),
            )

            # Filter valid rows (has MSSV)
            filtered_rows = [r for r in rows if r.get("mssv")]
            total_rows = len(filtered_rows)
            print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Dang xu ly {total_rows} rows...")
            if total_rows == 0:
                mongo.set_meta("sheet_hash", h)
                mongo.set_meta("sheet_last_sync_at", datetime.now(timezone.utc).isoformat())
                mongo.set_meta("sheet_last_result", {"created": 0, "updated": 0})
                return

            # Build snapshot for diff and caching
            import os, json, re

            def digits(x):
                return re.sub(r"\D+", "", str(x)) or None

            def to_int(x):
                s = str(x).strip()
                return int(s) if s.isdigit() else None

            def to_bool(x):
                s = str(x).strip().lower()
                return s in ("true", "1", "yes", "y", "x")

            def norm_row_for_snapshot(r: dict) -> dict:
                return {
                    "full_name": (r.get("full_name") or "").strip(),
                    "email": (r.get("email") or "").strip() or None,
                    "phone": digits(r.get("phone")),
                    "faculty": (r.get("faculty") or "").strip() or None,
                    "school": (r.get("school") or "").strip() or None,
                    "facebook": (r.get("facebook") or "").strip() or None,
                    "team_id": (str(r.get("team_id")).strip() if r.get("team_id") not in (None, "") else None),
                    "team_name": (r.get("team_name") or "").strip() or None,
                    "team_number": to_int(r.get("team_number")),
                    "is_captain": (to_bool(r.get("is_captain")) if r.get("is_captain") is not None else None),
                }

            new_snapshot = { str(r.get("mssv")).strip(): norm_row_for_snapshot(r) for r in filtered_rows }
            cache_path = os.getenv("SHEET_CACHE_FILE") or "sheet_snapshot.json"
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    old_snapshot = json.load(f)
            except Exception:
                old_snapshot = {}

            prev_hash = mongo.get_meta("sheet_hash")
            if prev_hash == h and old_snapshot == new_snapshot:
                mongo.set_meta("sheet_last_sync_at", datetime.now(timezone.utc).isoformat())
                print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Khong co thay doi (hash & snapshot match)")
                return

            # Diff against snapshot to minimize DB writes
            changed_keys = [k for k, v in new_snapshot.items() if old_snapshot.get(k) != v]
            changed_set = set(changed_keys)
            changed_rows = [r for r in filtered_rows if str(r.get("mssv")).strip() in changed_set]

            print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Thay doi: {len(changed_rows)} dong")
            # Run blocking DB operations in background threads to avoid blocking gateway heartbeats
            import asyncio as _asyncio
            result = await _asyncio.to_thread(mongo.bulk_upsert_sheet_rows, changed_rows)
            await _asyncio.to_thread(mongo.bulk_upsert_teams_and_members, changed_rows)

            # Detect team name changes for renaming resources (role/channels)
            def clean_name(name: str) -> str:
                n = "".join(c for c in (name or "") if c.isalnum() or c in " -_").strip()
                return n[:32] if len(n) > 32 else n

            renames = {}
            for mssv in changed_keys:
                old = old_snapshot.get(mssv)
                new = new_snapshot.get(mssv)
                if not new:
                    continue
                old_team = (old or {}).get("team_name")
                new_team = new.get("team_name")
                old_id = (old or {}).get("team_id")
                new_id = new.get("team_id")
                if (old_team != new_team) or (old_id != new_id):
                    key = (new_id or old_id) or new_team or old_team
                    if not key:
                        continue
                    # Preserve the first seen old->new to avoid overwriting with identical values
                    if key not in renames and old_team and new_team and old_team != new_team:
                        renames[key] = {
                            "old": old_team,
                            "new": new_team,
                            "team_id": new_id or old_id,
                        }

            # Apply renames per guild/category
            if renames:
                try:
                    categories = []
                    try:
                        from ..utils.categories import get_valid_team_categories_for_guild
                        # Will filter by guild below before using
                    except Exception:
                        pass

                    for guild in self.bot.guilds:
                        for info in renames.values():
                            old_team = info.get("old")
                            new_team = info.get("new")
                            if not new_team or not old_team or new_team == old_team:
                                continue
                            old_clean = clean_name(old_team)
                            new_clean = clean_name(new_team)
                            if not old_clean or not new_clean or old_clean == new_clean:
                                continue

                            # Rename role if exists and target name free
                            try:
                                role_old = discord.utils.get(guild.roles, name=old_clean)
                                role_new = discord.utils.get(guild.roles, name=new_clean)
                                if role_old and not role_new:
                                    print(f"[RENAME] Role: '{old_clean}' -> '{new_clean}' (guild: {guild.name})")
                                    await role_old.edit(name=new_clean, reason="Team name updated from Sheet")
                            except Exception as ex:
                                print(f"[RENAME WARN] Role rename failed {old_clean}->{new_clean}: {ex}")

                            # Rename channels under configured categories, else fallback to whole guild
                            try:
                                cats = []
                                try:
                                    from ..utils.categories import get_valid_team_categories_for_guild
                                    cats = get_valid_team_categories_for_guild(self.bot, guild)
                                except Exception:
                                    cats = []
                                old_chan = old_clean.lower().replace(' ', '-')
                                new_chan = new_clean.lower().replace(' ', '-')
                                did = False
                                for category in cats:
                                    if category.guild.id != guild.id:
                                        continue
                                    # Text channel in this category
                                    txt = discord.utils.get(category.text_channels, name=old_chan)
                                    if txt and not discord.utils.get(category.text_channels, name=new_chan):
                                        print(f"[RENAME] Text channel: '{old_chan}' -> '{new_chan}' (guild: {guild.name})")
                                        await txt.edit(name=new_chan, reason="Team name updated from Sheet")
                                        did = True
                                    # Voice channel in this category
                                    vch = discord.utils.get(category.voice_channels, name=old_chan)
                                    if vch and not discord.utils.get(category.voice_channels, name=new_chan):
                                        print(f"[RENAME] Voice channel: '{old_chan}' -> '{new_chan}' (guild: {guild.name})")
                                        await vch.edit(name=new_chan, reason="Team name updated from Sheet")
                                        did = True
                                if not cats or not did:
                                    # Fallback: try rename by searching entire guild if category not configured
                                    txt = discord.utils.get(guild.text_channels, name=old_chan)
                                    if txt and not discord.utils.get(guild.text_channels, name=new_chan):
                                        print(f"[RENAME] Text channel (fallback): '{old_chan}' -> '{new_chan}' (guild: {guild.name})")
                                        await txt.edit(name=new_chan, reason="Team name updated from Sheet")
                                    vch = discord.utils.get(guild.voice_channels, name=old_chan)
                                    if vch and not discord.utils.get(guild.voice_channels, name=new_chan):
                                        print(f"[RENAME] Voice channel (fallback): '{old_chan}' -> '{new_chan}' (guild: {guild.name})")
                                        await vch.edit(name=new_chan, reason="Team name updated from Sheet")
                            except Exception as ex:
                                print(f"[RENAME WARN] Channel rename failed {old_clean}->{new_clean}: {ex}")
                except Exception:
                    # Do not fail the sync because of rename errors
                    pass

            # Update member nicknames if full_name or team changed
            try:
                to_update = []
                for mssv in changed_keys:
                    old = old_snapshot.get(mssv) or {}
                    new = new_snapshot.get(mssv) or {}
                    if (old.get("full_name") != new.get("full_name")) or (
                        old.get("team_name") != new.get("team_name") or old.get("team_id") != new.get("team_id")
                    ):
                        doc = mongo.participants.find_one({"mssv": mssv}, {"discord_id": 1, "full_name": 1, "team_name": 1, "team_id": 1})
                        if doc and doc.get("discord_id"):
                            full_name = doc.get("full_name")
                            team_label = doc.get("team_name") or (f"Team {doc.get('team_id')}" if doc.get("team_id") else None)
                            nickname = build_nickname(full_name, team_label)
                            to_update.append((int(doc["discord_id"]), nickname))

                if to_update:
                    # Deduplicate by discord_id keeping the last computed nickname
                    latest = {uid: nick for uid, nick in to_update}
                    for guild in self.bot.guilds:
                        for uid, nick in latest.items():
                            member = guild.get_member(uid)
                            if member is None:
                                try:
                                    member = await guild.fetch_member(uid)
                                except Exception:
                                    member = None
                            if not member:
                                continue
                            try:
                                await try_set_nickname(member, nick, reason="Nickname updated from Sheet")
                            except Exception:
                                pass
            except Exception as ex:
                print(f"[NICK WARN] Failed to update some nicknames: {ex}")

            # Persist new snapshot and metadata
            try:
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(new_snapshot, f, ensure_ascii=False, separators=(",", ":"))
            except Exception as ex:
                print(f"[SHEET SNAPSHOT WARN] Khong the luu snapshot: {ex}")

            mongo.set_meta("sheet_hash", h)
            mongo.set_meta("sheet_last_sync_at", datetime.now(timezone.utc).isoformat())
            mongo.set_meta("sheet_last_result", result)

            print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Dong bo xong: tao {result['created']}, cap nhat {result['updated']}")

        except Exception as e:
            error_msg = f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] [SHEET SYNC ERROR] {e}"
            print(error_msg)

            # Update error metadata
            try:
                mongo.set_meta("sheet_last_error", str(e))
                mongo.set_meta("sheet_last_error_at", datetime.now(timezone.utc).isoformat())
            except:
                pass

    @tasks.loop(seconds=60)  # This will be overridden by change_interval in __init__
    async def sheet_sync_loop(self):
        try:
            # Add timeout to prevent blocking
            import asyncio
            await asyncio.wait_for(self._sync_once(), timeout=300)  # 5 minutes timeout
        except asyncio.TimeoutError:
            print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] [SHEET SYNC TIMEOUT] Sync took too long, cancelled")
        except Exception as e:
            print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] [SHEET SYNC ERROR] {e}")

    @sheet_sync_loop.before_loop
    async def before_sheet_sync(self):
        # Wait for bot ready, then run an immediate sync before entering the interval loop
        await self.bot.wait_until_ready()
        try:
            # Add timeout to prevent blocking
            import asyncio
            await asyncio.wait_for(self._sync_once(), timeout=300)  # 5 minutes timeout
        except asyncio.TimeoutError:
            print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] [SHEET SYNC TIMEOUT] Initial sync took too long, cancelled")
        except Exception as e:
            print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] [SHEET SYNC ERROR] {e}")


async def setup_sheet_sync(bot: commands.Bot):
    await bot.add_cog(SheetSyncCog(bot))
