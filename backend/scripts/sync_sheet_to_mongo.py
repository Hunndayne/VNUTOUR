"""
Sync Google Sheet CSV export into MongoDB.

Usage:
  python scripts/sync_sheet_to_mongo.py path/to/export.csv

The CSV is expected to have headers (Vietnamese sample):
STT, Tên đội, ID đội, MSSV, Họ và tên, Link Facebook, Trường, Khoa, Email, Số điện thoại
"""
from __future__ import annotations

import csv
import os
import sys
from pathlib import Path
from typing import Dict

sys.path.append(str(Path(__file__).resolve().parents[1]))  # add project root to path

from src.utils.mongo import MongoManager  # noqa: E402


HEADER_MAP = {
    "STT": "stt",
    "Tên đội": "team_name",
    "ID đội": "team_id",
    "MSSV": "mssv",
    "Họ và tên": "full_name",
    "Link Facebook": "facebook",
    "Trường": "school",
    "Khoa": "faculty",
    "Email": "email",
    "Số điện thoại": "phone",
}


def read_csv(path: Path) -> list[Dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = []
        for row in reader:
            mapped: Dict[str, str] = {}
            for k, v in row.items():
                key = k.strip()
                dest = HEADER_MAP.get(key)
                if dest:
                    mapped[dest] = (v or "").strip()
            rows.append(mapped)
        return rows


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/sync_sheet_to_mongo.py <path_to_csv>")
        sys.exit(1)

    csv_path = Path(sys.argv[1]).resolve()
    if not csv_path.exists():
        print(f"CSV not found: {csv_path}")
        sys.exit(1)

    # Init Mongo from env
    mongo = MongoManager(os.getenv("MongoDB"), os.getenv("MONGODB_DB_NAME", "vnutour"))

    rows = read_csv(csv_path)
    # Filter invalid rows (no MSSV)
    rows = [r for r in rows if r.get("mssv")]

    result = mongo.sync_from_rows(rows)
    print(f"Done. Created: {result['created']}, Updated: {result['updated']}")


if __name__ == "__main__":
    main()

