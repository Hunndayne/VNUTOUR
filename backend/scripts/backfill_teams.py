"""
Backfill team data after migrating to a DB-as-source-of-truth model.

What it does:
- Assigns an auto-generated `team_id` to any team that is missing one.
- Ensures every team has a `members_mssv` array and a `provision_state` field.
- Optionally re-flags all teams for Discord (re)provisioning.

Usage:
  python scripts/backfill_teams.py             # safe: fills missing fields, marks existing teams as "done"
  python scripts/backfill_teams.py --reprovision  # also set provision_state="pending" for ALL teams

Requires the `MongoDB` env var (and MONGODB_DB_NAME) just like the bot/API.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))  # add project root to path

from dotenv import load_dotenv  # noqa: E402

from src.utils.mongo import MongoManager  # noqa: E402


def main() -> int:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")

    parser = argparse.ArgumentParser(description="Backfill teams for DB-driven management")
    parser.add_argument(
        "--reprovision",
        action="store_true",
        help="Mark all teams as provision_state='pending' so the bot re-creates roles/channels",
    )
    args = parser.parse_args()

    m = MongoManager()

    teams = list(m.teams.find({}))
    print(f"[BACKFILL] Found {len(teams)} team(s)")

    assigned_ids = 0
    filled_state = 0
    flagged = 0
    now = datetime.now(timezone.utc)

    for team in teams:
        updates = {}

        if not team.get("team_id"):
            updates["team_id"] = m.next_team_id()
            assigned_ids += 1

        if not isinstance(team.get("members_mssv"), list):
            updates["members_mssv"] = []

        if args.reprovision:
            updates["provision_state"] = "pending"
            flagged += 1
        elif not team.get("provision_state"):
            # Existing teams are assumed already provisioned (or will be via !addallrole)
            updates["provision_state"] = "done"
            filled_state += 1

        if "created_at" not in team:
            updates["created_at"] = team.get("updated_at") or now

        if updates:
            updates["updated_at"] = now
            m.teams.update_one({"_id": team["_id"]}, {"$set": updates})

    print(f"[BACKFILL] team_id assigned: {assigned_ids}")
    print(f"[BACKFILL] provision_state filled (->done): {filled_state}")
    if args.reprovision:
        print(f"[BACKFILL] flagged for reprovision (->pending): {flagged}")
    print("[BACKFILL] Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
