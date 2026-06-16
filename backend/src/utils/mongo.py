"""
MongoDB manager and sync utilities
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from dotenv import load_dotenv

try:
    from pymongo import MongoClient, UpdateOne, ReturnDocument
    from pymongo.collection import Collection
    from pymongo.errors import DuplicateKeyError
except Exception:  # pragma: no cover
    # Allow import of this file even if pymongo not installed yet
    MongoClient = None  # type: ignore
    UpdateOne = None  # type: ignore
    ReturnDocument = None  # type: ignore
    Collection = None  # type: ignore
    DuplicateKeyError = Exception  # type: ignore


# Default system settings used when nothing has been configured yet.
# MongoDB is the source of truth, so Google Sheet integrations default to OFF.
DEFAULT_SYSTEM_SETTINGS: Dict[str, Any] = {
    "registration_open": False,
    "sheet_import_enabled": False,
    "sheet_checkin_export_enabled": False,
    "team_max_members": 5,
}


class MongoManager:
    """MongoDB manager for participants and teams.

    Collections:
    - participants: one per MSSV, optional discord_id mapping
    - teams: team info aggregated by team_id
    """

    def __init__(self, uri: Optional[str] = None, db_name: Optional[str] = None):
        # Use provided URI or get from environment (already loaded by config.py)
        self.uri = uri or os.getenv("MongoDB")
        self.db_name = db_name or os.getenv("MONGODB_DB_NAME", "vnutour")

        if not self.uri:
            raise RuntimeError("Thiếu biến môi trường MongoDB (URI) trong .env")

        if MongoClient is None:
            raise RuntimeError("Thiếu thư viện pymongo. Vui lòng `pip install -r requirements.txt`.")

        # Add connection timeout and server selection timeout
        self.client = MongoClient(
            self.uri,
            serverSelectionTimeoutMS=10000,  # 10 seconds timeout
            connectTimeoutMS=10000,          # 10 seconds connection timeout
            socketTimeoutMS=30000,           # 30 seconds socket timeout
            maxPoolSize=10,                  # Limit connection pool
            minPoolSize=1,                   # Minimum connections
            maxIdleTimeMS=30000,             # Close idle connections after 30s
            waitQueueTimeoutMS=5000,         # Wait queue timeout
            retryWrites=True,                # Enable retry for writes
            retryReads=True                  # Enable retry for reads
        )
        self.db = self.client[self.db_name]
        self.participants: Collection = self.db["participants"]
        self.teams: Collection = self.db["teams"]
        self.meta: Collection = self.db["meta"]
        self.accounts: Collection = self.db["accounts"]
        self.checkins: Collection = self.db["checkins"]

        # Test connection
        try:
            self.client.admin.command('ping')
            print("[DB] Kết nối MongoDB thành công")
        except Exception as e:
            print(f"[DB] Lỗi kết nối MongoDB: {e}")
            raise

        self._ensure_indexes()

    def is_healthy(self) -> bool:
        """Check if MongoDB connection is healthy"""
        try:
            self.client.admin.command('ping')
            return True
        except Exception:
            return False

    def close(self):
        """Close MongoDB connection"""
        if hasattr(self, 'client'):
            self.client.close()

    def get_teams_with_members(self) -> list[Dict[str, Any]]:
        """Get all teams that have at least one member with assigned Discord ID"""
        try:
            # Get teams that have members with discord_id
            teams_with_members = []
            
            # Get all teams
            all_teams = list(self.teams.find({}))
            
            for team in all_teams:
                team_id = team.get("team_id")
                if not team_id:
                    continue
                
                # Find participants in this team who have discord_id assigned
                members_with_discord = list(self.participants.find({
                    "team_id": team_id,
                    "discord_id": {"$exists": True, "$ne": None}
                }))
                
                if members_with_discord:  # At least 1 member with Discord ID
                    team["members_with_discord"] = members_with_discord
                    teams_with_members.append(team)
            
            return teams_with_members
            
        except Exception as e:
            print(f"[DB ERROR] Lỗi khi lấy teams có thành viên: {e}")
            return []

    # ----- Indexes -----
    def _ensure_indexes(self):
        self.participants.create_index("mssv", unique=True)
        self.participants.create_index("discord_id", unique=True, sparse=True)
        self.teams.create_index("team_id", unique=True, sparse=True)
        self.teams.create_index("team_name")
        self.meta.create_index("key", unique=True)
        # Accounts
        try:
            self.accounts.create_index("username", unique=True)
            self.accounts.create_index("email", unique=True, sparse=True)
        except Exception:
            pass
        # Checkins
        try:
            self.checkins.create_index([("team_oid", 1), ("created_at", -1)])
        except Exception:
            pass

    # ----- QR encode/decode -----
    @staticmethod
    def encode_team_oid(oid_str: str) -> str:
        """Return base64url-encoded bytes of a 24-hex ObjectId string.

        Accepts hex ObjectId string and returns base64url without padding.
        """
        try:
            from bson import ObjectId
            import base64
            oid = ObjectId(oid_str)
            raw = oid.binary  # 12 bytes
            b64 = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
            return b64
        except Exception:
            return ""

    @staticmethod
    def decode_team_code(code: str) -> Optional[str]:
        """Decode code into ObjectId hex string.

        Supports:
        - raw 24-hex ObjectId
        - base64url (no padding) of 12 raw ObjectId bytes
        Optional prefixes like 'TEAM:' or 't:' are tolerated.
        """
        import re, base64
        from bson import ObjectId

        if not code:
            return None
        s = str(code).strip()
        # Strip prefix
        m = re.match(r"^(?:(?:team|t)[:|/])?(?P<val>.+)$", s, flags=re.IGNORECASE)
        if m:
            s = m.group("val")
        # Hex form
        if re.fullmatch(r"[0-9a-fA-F]{24}", s):
            try:
                _ = ObjectId(s)
                return str(_)
            except Exception:
                return None
        # Base64url of 12 bytes
        try:
            pad = "=" * (-len(s) % 4)
            raw = base64.urlsafe_b64decode(s + pad)
            if len(raw) == 12:
                oid = ObjectId(raw)
                return str(oid)
        except Exception:
            pass
        return None

    # ----- Check-ins -----
    def insert_checkin(self, team_doc: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Insert a check-in record for the given team document.

        `meta` may include scanner info, ip, user_agent, station, etc.
        """
        from bson import ObjectId
        now = datetime.now(timezone.utc)
        payload: Dict[str, Any] = {
            "team_oid": team_doc.get("_id"),
            "team_id": team_doc.get("team_id"),
            "team_name": team_doc.get("team_name"),
            "created_at": now,
        }
        if isinstance(payload["team_oid"], str):
            try:
                payload["team_oid"] = ObjectId(payload["team_oid"])
            except Exception:
                pass
        if meta:
            payload["meta"] = dict(meta)
        self.checkins.insert_one(payload)
        return payload

    # ----- Normalizers -----
    @staticmethod
    def _norm_mssv(mssv: Any) -> str:
        return str(mssv).strip()

    @staticmethod
    def _digits(value: Any) -> Optional[str]:
        if value is None:
            return None
        s = re.sub(r"\D+", "", str(value))
        return s or None

    # ----- Participants -----
    def upsert_participant(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Upsert participant by MSSV.

        Expected keys: mssv, full_name, email, phone, faculty, school, facebook, team_id, team_name
        """
        mssv = self._norm_mssv(data.get("mssv"))
        if not mssv:
            raise ValueError("Thiếu MSSV")

        # Parse helpers
        def _to_int(v):
            try:
                s = str(v).strip()
                return int(s) if s and s.isdigit() else None
            except Exception:
                return None
        def _to_bool(v):
            s = str(v).strip().lower()
            return s in ("true", "1", "yes", "y", "x")

        doc = {
            "mssv": mssv,
            "full_name": (data.get("full_name") or "").strip(),
            "email": (data.get("email") or "").strip() or None,
            "phone": self._digits(data.get("phone")),
            "faculty": (data.get("faculty") or "").strip() or None,
            "school": (data.get("school") or "").strip() or None,
            "facebook": (data.get("facebook") or "").strip() or None,
            "team_id": (str(data.get("team_id")).strip() if data.get("team_id") not in (None, "") else None),
            "team_name": (data.get("team_name") or "").strip() or None,
            "team_number": _to_int(data.get("team_number")),
            "is_captain": _to_bool(data.get("is_captain")) if data.get("is_captain") is not None else None,
            "updated_at": datetime.now(timezone.utc),
        }

        # Preserve existing discord_id if present
        existing = self.participants.find_one({"mssv": mssv}, {"discord_id": 1})
        if existing and existing.get("discord_id"):
            doc["discord_id"] = existing["discord_id"]

        self.participants.update_one({"mssv": mssv}, {"$set": doc}, upsert=True)
        return self.participants.find_one({"mssv": mssv}) or doc

    def bulk_upsert_sheet_rows(self, rows: list[Dict[str, Any]]) -> Dict[str, int]:
        """Bulk upsert participants using only sheet-derived fields.

        This avoids per-row reads and preserves existing fields like discord_id.
        Returns summary counts.
        """
        if UpdateOne is None:
            raise RuntimeError("pymongo not installed")

        def _to_int(v):
            try:
                s = str(v).strip()
                return int(s) if s and s.isdigit() else None
            except Exception:
                return None
        def _to_bool(v):
            s = str(v).strip().lower()
            return s in ("true", "1", "yes", "y", "x")

        ops = []
        for r in rows:
            mssv = self._norm_mssv(r.get("mssv"))
            if not mssv:
                continue
            payload = {
                "mssv": mssv,
                "full_name": (r.get("full_name") or "").strip(),
                "email": (r.get("email") or "").strip() or None,
                "phone": self._digits(r.get("phone")),
                "faculty": (r.get("faculty") or "").strip() or None,
                "school": (r.get("school") or "").strip() or None,
                "facebook": (r.get("facebook") or "").strip() or None,
                "team_id": (str(r.get("team_id")).strip() if r.get("team_id") not in (None, "") else None),
                "team_name": (r.get("team_name") or "").strip() or None,
                "team_number": _to_int(r.get("team_number")),
                "is_captain": _to_bool(r.get("is_captain")) if r.get("is_captain") is not None else None,
                "updated_at": datetime.now(timezone.utc),
            }
            ops.append(UpdateOne({"mssv": mssv}, {"$set": payload}, upsert=True))

        if not ops:
            return {"created": 0, "updated": 0}

        res = self.participants.bulk_write(ops, ordered=False)
        created = getattr(res, 'upserted_count', 0) or 0
        updated = getattr(res, 'modified_count', 0) or 0
        return {"created": int(created), "updated": int(updated)}

    def assign_discord_by_mssv(self, mssv: str, discord_id: int) -> Tuple[str, str]:
        """Assign discord_id to a participant by MSSV.

        Returns (status, message) where status in {ok, not_found, already_assigned, already_linked, discord_already_used}.
        """
        mssv = self._norm_mssv(mssv)
        user = self.participants.find_one({"mssv": mssv})
        if not user:
            return ("not_found", f"Không tìm thấy MSSV {mssv} trong hệ thống.")

        # Check if this Discord ID is already used by another MSSV
        existing_discord_user = self.participants.find_one({"discord_id": int(discord_id)})
        if existing_discord_user and existing_discord_user.get("mssv") != mssv:
            return (
                "discord_already_used", 
                f"Discord ID của bạn đã được sử dụng bởi MSSV {existing_discord_user.get('mssv')} ({existing_discord_user.get('full_name', 'Không có tên')})."
            )

        current = user.get("discord_id")
        if current is None:
            try:
                self.participants.update_one(
                    {"mssv": mssv},
                    {"$set": {"discord_id": int(discord_id), "updated_at": datetime.now(timezone.utc)}},
                )
                return ("ok", f"Đã gán Discord cho MSSV {mssv}.")
            except Exception as e:
                if "E11000" in str(e):  # Duplicate key error
                    return (
                        "discord_already_used", 
                        f"Discord ID của bạn đã được sử dụng bởi MSSV khác. Vui lòng liên hệ admin để được hỗ trợ."
                    )
                return ("error", f"Lỗi khi gán Discord ID: {e}")

        if int(current) == int(discord_id):
            return ("already_linked", f"MSSV {mssv} đã liên kết với Discord của bạn.")

        return (
            "already_assigned",
            f"MSSV {mssv} đã được liên kết với tài khoản Discord khác.",
        )

    # ----- Teams -----
    def upsert_team(self, team_id: Optional[str], team_name: Optional[str]) -> Optional[Dict[str, Any]]:
        if not team_id and not team_name:
            return None
        payload = {
            "team_id": (str(team_id).strip() if team_id not in (None, "") else None),
            "team_name": (team_name or "").strip() or None,
            "updated_at": datetime.now(timezone.utc),
        }
        key = {"team_id": payload["team_id"]} if payload["team_id"] else {"team_name": payload["team_name"]}
        self.teams.update_one(key, {"$set": payload}, upsert=True)
        return self.teams.find_one(key)

    def bulk_upsert_teams_and_members(self, rows: list[Dict[str, Any]]) -> Dict[str, int]:
        """Bulk upsert teams and add members in one operation per team.

        Groups rows by team key and uses $addToSet with $each to add member MSSVs.
        """
        if UpdateOne is None:
            raise RuntimeError("pymongo not installed")

        def _team_key_and_payload(team_id, team_name):
            tid = (str(team_id).strip() if team_id not in (None, "") else None)
            tname = (team_name or "").strip() or None
            payload = {
                "team_id": tid,
                "team_name": tname,
                "updated_at": datetime.now(timezone.utc),
            }
            key = {"team_id": tid} if tid else {"team_name": tname}
            return key, payload

        grouped: Dict[tuple, Dict[str, Any]] = {}
        for r in rows:
            mssv = self._norm_mssv(r.get("mssv"))
            if not mssv:
                continue
            team_id = r.get("team_id")
            team_name = r.get("team_name")
            # Skip rows without any team info
            if (team_id in (None, "")) and (not (team_name or "").strip()):
                continue
            key, payload = _team_key_and_payload(team_id, team_name)
            # Use tuple key for dict
            dict_key = (key.get("team_id"), key.get("team_name"))
            g = grouped.get(dict_key)
            if not g:
                g = {"key": key, "payload": payload, "members": set()}
                grouped[dict_key] = g
            g["members"].add(mssv)

        if not grouped:
            return {"upserted": 0, "modified": 0}

        ops = []
        for g in grouped.values():
            key = g["key"]
            payload = g["payload"]
            members = sorted(g["members"])  # deterministic
            update = {
                "$set": payload,
                "$addToSet": {"members_mssv": {"$each": members}},
            }
            ops.append(UpdateOne(key, update, upsert=True))

        res = self.teams.bulk_write(ops, ordered=False)
        upserted = getattr(res, 'upserted_count', 0) or 0
        modified = getattr(res, 'modified_count', 0) or 0
        return {"upserted": int(upserted), "modified": int(modified)}

    # ----- Bulk sync from rows -----
    async def sync_from_rows_async(self, rows: list[Dict[str, Any]]) -> Dict[str, Any]:
        """Sync many rows from a sheet-exported dataset asynchronously.

        Returns a summary dict.
        """
        import asyncio
        from concurrent.futures import ThreadPoolExecutor
        
        updated = 0
        created = 0
        errors = 0
        
        # Use ThreadPoolExecutor to run MongoDB operations in background
        executor = ThreadPoolExecutor(max_workers=1)
        
        def sync_single_row(row_data):
            try:
                mssv = self._norm_mssv(row_data.get("mssv"))
                if not mssv:
                    return None, None
                    
                before = self.participants.find_one({"mssv": mssv})
                self.upsert_participant(row_data)
                
                # Upsert team and member mapping
                team_doc = self.upsert_team(row_data.get("team_id"), row_data.get("team_name"))
                if team_doc and mssv:
                    self.teams.update_one(
                        {"_id": team_doc["_id"]},
                        {"$addToSet": {"members_mssv": mssv}},
                    )
                    
                return before, None
                
            except Exception as e:
                return None, str(e)
        
        # Process rows in batches to avoid overwhelming the thread pool
        batch_size = 10
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            
            # Submit batch to thread pool
            loop = asyncio.get_event_loop()
            futures = [
                loop.run_in_executor(executor, sync_single_row, row)
                for row in batch
            ]
            
            # Wait for batch to complete
            batch_results = await asyncio.gather(*futures, return_exceptions=True)
            
            # Process results
            for j, result in enumerate(batch_results):
                if isinstance(result, Exception):
                    errors += 1
                    print(f"[SYNC ERROR] Row {i+j}: {result}")
                    continue
                    
                before, error = result
                if error:
                    errors += 1
                    print(f"[SYNC ERROR] Row {i+j}: {error}")
                    continue
                    
                if before:
                    updated += 1
                else:
                    created += 1
            
            # Small delay between batches to prevent overwhelming
            await asyncio.sleep(0.1)
        
        executor.shutdown(wait=False)
        return {"created": created, "updated": updated, "errors": errors}

    def sync_from_rows(self, rows: list[Dict[str, Any]]) -> Dict[str, Any]:
        """Sync many rows from a sheet-exported dataset (synchronous version).

        Returns a summary dict.
        """
        updated = 0
        created = 0
        errors = 0
        
        for i, r in enumerate(rows):
            try:
                mssv = self._norm_mssv(r.get("mssv"))
                if not mssv:
                    continue
                    
                before = self.participants.find_one({"mssv": mssv})
                self.upsert_participant(r)
                if before:
                    updated += 1
                else:
                    created += 1

                # Upsert team and member mapping
                team_doc = self.upsert_team(r.get("team_id"), r.get("team_name"))
                if team_doc and mssv:
                    self.teams.update_one(
                        {"_id": team_doc["_id"]},
                        {"$addToSet": {"members_mssv": mssv}},
                    )
                    
            except Exception as e:
                errors += 1
                print(f"[SYNC ERROR] Row {i}: {e}")
                # Continue with next row instead of failing completely
                continue

        return {"created": created, "updated": updated, "errors": errors}

    # ----- Meta helpers -----
    def get_meta(self, key: str) -> Optional[Any]:
        doc = self.meta.find_one({"key": key})
        return doc.get("value") if doc else None

    def set_meta(self, key: str, value: Any) -> None:
        self.meta.update_one({"key": key}, {"$set": {"key": key, "value": value}}, upsert=True)

    # ----- System settings -----
    def get_settings(self) -> Dict[str, Any]:
        """Return system settings merged over safe defaults."""
        stored = self.get_meta("system_settings")
        settings = dict(DEFAULT_SYSTEM_SETTINGS)
        if isinstance(stored, dict):
            settings.update(stored)
        return settings

    def set_settings(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        """Merge `patch` into stored settings, validating known keys, and return the result."""
        current = self.get_settings()
        for key, value in (patch or {}).items():
            if key not in DEFAULT_SYSTEM_SETTINGS:
                continue
            default = DEFAULT_SYSTEM_SETTINGS[key]
            if isinstance(default, bool):
                current[key] = bool(value)
            elif isinstance(default, int):
                try:
                    current[key] = int(value)
                except (TypeError, ValueError):
                    pass
            else:
                current[key] = value
        self.set_meta("system_settings", current)
        return current

    # ----- Team id generation / creation -----
    def next_team_id(self) -> str:
        """Atomically generate a unique sequential team id like 'T0001'."""
        doc = self.meta.find_one_and_update(
            {"key": "team_seq"},
            {"$inc": {"value": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        n = int(doc.get("value", 1)) if doc else 1
        return f"T{n:04d}"

    def create_team(self, team_name: str, owner_username: Optional[str] = None) -> Dict[str, Any]:
        """Create a new team with an auto-generated team_id.

        Marks the team as pending Discord provisioning so the bot watcher can
        create role/channels. Returns the inserted document.
        """
        name = (team_name or "").strip()
        if not name:
            raise ValueError("Thiếu tên đội")

        now = datetime.now(timezone.utc)
        # Retry a few times in case of a rare team_id collision with legacy data
        last_err: Optional[Exception] = None
        for _ in range(5):
            team_id = self.next_team_id()
            doc = {
                "team_id": team_id,
                "team_name": name,
                "owner_username": (owner_username or None),
                "members_mssv": [],
                # Approval workflow: draft -> pending_approval -> approved/rejected.
                # Discord provisioning is only triggered after admin approval.
                "approval_status": "draft",
                "approval_note": None,
                "submitted_at": None,
                "reviewed_at": None,
                "reviewed_by": None,
                "provision_state": None,
                "created_at": now,
                "updated_at": now,
            }
            try:
                res = self.teams.insert_one(doc)
                doc["_id"] = res.inserted_id
                return doc
            except DuplicateKeyError as e:  # team_id unique index collision
                last_err = e
                continue
        raise RuntimeError(f"Không thể tạo đội (team_id trùng lặp): {last_err}")

    def mark_team_dirty(self, team_oid: Any) -> None:
        """Flag a team for (re)provisioning by the Discord watcher."""
        from bson import ObjectId
        oid = team_oid
        if isinstance(oid, str):
            try:
                oid = ObjectId(oid)
            except Exception:
                return
        self.teams.update_one(
            {"_id": oid},
            {"$set": {"provision_state": "pending", "updated_at": datetime.now(timezone.utc)}},
        )
