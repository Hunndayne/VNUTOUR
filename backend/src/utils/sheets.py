"""
Google Sheets fetching utilities
"""
from __future__ import annotations

import hashlib
import json
from typing import Dict, List, Tuple
import os
import base64
import urllib.parse

import aiohttp


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

# Robust header normalization (diacritics/spacing-insensitive)
def _normalize_header(text: str) -> str:
    import unicodedata, re
    s = (text or "").strip().lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = s.replace("\u0111", "d").replace("\u0110", "d")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

NORMALIZED_HEADER_MAP = {
    "stt": "stt",
    "ten doi": "team_name",
    "ten doi/nhom": "team_name",
    "team": "team_name",
    "team name": "team_name",
    "id doi": "team_id",
    "id team": "team_id",
    "so doi": "team_number",
    "mssv": "mssv",
    "ho va ten": "full_name",
    "ho ten": "full_name",
    "full name": "full_name",
    "facebook": "facebook",
    "link facebook": "facebook",
    "truong": "school",
    "khoa": "faculty",
    "email": "email",
    "so dien thoai": "phone",
    "so dt": "phone",
    "sdt": "phone",
    "doi truong": "is_captain",
}


def _canonicalize_a1_range(range_name: str) -> str:
    """Ensure sheet names with spaces/unicode are quoted for A1 notation.

    Example: Copy of TỔNG HỢP DANH SÁCH ĐỘI!A1:L -> 'Copy of TỔNG HỢP DANH SÁCH ĐỘI'!A1:L
    If already quoted, keep as-is. Also escape single quotes inside by doubling.
    """
    s = str(range_name or "")
    if "!" not in s:
        return s
    sheet, grid = s.split("!", 1)
    sheet_strip = sheet.strip()
    if not sheet_strip:
        return s
    # Already quoted with single quotes
    if sheet_strip.startswith("'") and sheet_strip.endswith("'") and len(sheet_strip) >= 2:
        return f"{sheet_strip}!{grid}"
    # Quote and escape any embedded single quotes
    sheet_escaped = sheet_strip.replace("'", "''")
    return f"'{sheet_escaped}'!{grid}"


async def fetch_sheet_values(api_key: str, sheet_id: str, range_name: str) -> Dict:
    """Fetch values from Google Sheets.

    Prefer service account (gspread) if credentials are provided via env:
    - GOOGLE_CREDENTIALS_JSON: path to service account JSON file
    - GOOGLE_CREDENTIALS_BASE64: base64-encoded JSON content

    Fallback to public API (API key) when credentials are not available.
    """
    creds_path = os.getenv("GOOGLE_CREDENTIALS_JSON")
    creds_b64 = os.getenv("GOOGLE_CREDENTIALS_BASE64")

    if creds_path or creds_b64:
        try:
            values = await _fetch_with_gspread(sheet_id, range_name, creds_path, creds_b64)
            return {"values": values}
        except Exception:
            # If gspread path fails, fall back to API key if provided
            if not api_key:
                raise
            # else continue to HTTP fetch

    # URL-encode the range for path usage (supports spaces/Unicode/tab names)
    a1 = _canonicalize_a1_range(range_name)
    encoded_range = urllib.parse.quote(str(a1), safe="!A-Za-z0-9:_'")
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{encoded_range}?key={api_key}"
    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=30) as resp:
            resp.raise_for_status()
            return await resp.json()


def _get_gspread_client(creds_path: str | None, creds_b64: str | None):
    import json
    try:
        import gspread
    except Exception as e:
        raise RuntimeError("gspread not installed. Please install requirements.") from e

    if creds_b64:
        info = json.loads(base64.b64decode(creds_b64).decode("utf-8"))
        return gspread.service_account_from_dict(info)
    if creds_path:
        return gspread.service_account(filename=creds_path)
    raise RuntimeError("Missing GOOGLE_CREDENTIALS_JSON/GOOGLE_CREDENTIALS_BASE64")


async def _fetch_with_gspread(sheet_id: str, range_name: str, creds_path: str | None, creds_b64: str | None) -> List[List[str]]:
    gc = _get_gspread_client(creds_path, creds_b64)

    sh = gc.open_by_key(sheet_id)

    tab_name = None
    grid = range_name
    if "!" in str(range_name):
        tab_name, grid = str(range_name).split("!", 1)

    # If tab_name came with single quotes (A1 notation), strip them and unescape
    if tab_name and tab_name.startswith("'") and tab_name.endswith("'") and len(tab_name) >= 2:
        inner = tab_name[1:-1]
        tab_name = inner.replace("''", "'")

    if tab_name:
        ws = sh.worksheet(tab_name)
    else:
        ws = sh.get_worksheet(0)

    # Use 'get' to fetch specific grid range; if grid empty, fallback to all values
    values = ws.get(grid) if grid else ws.get_all_values()
    return values


def values_to_rows(values: List[List[str]]) -> List[Dict[str, str]]:
    if not values:
        return []
    headers = [h.strip() for h in values[0]]

    # Pre-resolve destination key per column
    dests: List[str | None] = []
    for header in headers:
        dest = HEADER_MAP.get(header)
        if not dest:
            dest = NORMALIZED_HEADER_MAP.get(_normalize_header(header))
        dests.append(dest)

    # Columns to forward-fill (for merged cells like team name/id)
    FILL_FORWARD = {"team_name", "team_id", "team_number"}
    carry: Dict[str, str] = {}

    rows: List[Dict[str, str]] = []
    for r in values[1:]:
        mapped: Dict[str, str] = {}
        # Iterate through all headers, even if row is shorter
        for idx in range(len(headers)):
            dest = dests[idx]
            if not dest:
                continue
            cell = r[idx] if idx < len(r) else ""
            val = (cell or "").strip()

            # Forward-fill merged cells for selected fields
            if not val and dest in FILL_FORWARD and dest in carry:
                val = carry[dest]

            if val:
                mapped[dest] = val
                if dest in FILL_FORWARD:
                    carry[dest] = val
        rows.append(mapped)
    return rows


def compute_hash(values: List[List[str]]) -> str:
    # Stable hash of the values payload
    payload = json.dumps(values, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def fetch_sheet_rows_and_hash(api_key: str, sheet_id: str, range_name: str) -> Tuple[List[Dict[str, str]], str]:
    data = await fetch_sheet_values(api_key, sheet_id, range_name)
    values = data.get("values", [])
    rows = values_to_rows(values)
    h = compute_hash(values)
    return rows, h

def append_rows_to_sheet(sheet_id: str, tab_name: str | None, rows: List[List[str]]) -> None:
    creds_path = os.getenv("GOOGLE_CREDENTIALS_JSON")
    creds_b64 = os.getenv("GOOGLE_CREDENTIALS_BASE64")
    gc = _get_gspread_client(creds_path, creds_b64)

    sh = gc.open_by_key(sheet_id)
    if tab_name:
        ws = sh.worksheet(tab_name)
    else:
        ws = sh.get_worksheet(0)
    if not rows:
        return
    ws.append_rows(rows, value_input_option="USER_ENTERED")



def remove_rows_by_first_column(sheet_id: str, tab_name: str | None, first_value: str | None) -> None:
    if not first_value:
        return
    creds_path = os.getenv("GOOGLE_CREDENTIALS_JSON")
    creds_b64 = os.getenv("GOOGLE_CREDENTIALS_BASE64")
    gc = _get_gspread_client(creds_path, creds_b64)

    sh = gc.open_by_key(sheet_id)
    if tab_name:
        ws = sh.worksheet(tab_name)
    else:
        ws = sh.get_worksheet(0)

    try:
        values = ws.get_all_values()
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch values for removal: {exc}")

    target = str(first_value).strip()
    rows_to_delete: list[int] = []
    for idx, row in enumerate(values, start=1):
        if idx == 1:
            continue  # skip header row
        if row and str(row[0]).strip() == target:
            rows_to_delete.append(idx)

    for row_idx in sorted(rows_to_delete, reverse=True):
        ws.delete_rows(row_idx)
