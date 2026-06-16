Google Sheets Sync

This project supports syncing participants from Google Sheets to MongoDB using either the public Sheets API (API key) or a Service Account (gspread) for private sheets.

Environment variables
- `GoogleSheetID`: Spreadsheet ID
- `GOOGLE_SHEET_RANGE`: Range or `SheetName!A1:L` (example: `CHUNG!A1:L`)
- `SHEET_SYNC_INTERVAL`: seconds between syncs (default 60, min 30)
- `SHEET_CACHE_FILE` (optional): path to local snapshot file (default `sheet_snapshot.json`)

Private sheets via Service Account (recommended)
Choose one of:
- `GOOGLE_CREDENTIALS_JSON`: path to Service Account JSON
- `GOOGLE_CREDENTIALS_BASE64`: base64-encoded JSON content
Optional: `GOOGLE_SHEET_TAB` if the tab is not specified in `GOOGLE_SHEET_RANGE`.

Public sheets (API key)
- `GoogleSheetAPI`: Google API key (optional when using credentials)

Schema mapping
- Headers are normalized (Vietnamese accents removed, whitespace collapsed, `đ/Đ` -> `d`).
- Supported fields: `stt`, `team_number` (Số đội), `team_id` (ID đội), `team_name` (Tên đội), `mssv`, `full_name` (Họ và tên), `facebook` (Link Facebook), `school` (Trường), `faculty` (Khoa), `email`, `phone` (Số điện thoại), `is_captain` (Đội trưởng).
- Forward-fill (fill-down) is applied for merged cells: `team_name`, `team_id`, `team_number` so all 5 members inherit the team values.

Sync strategy
- A local snapshot (`SHEET_CACHE_FILE`) is created from sheet data on each sync.
- If the new snapshot equals the previous one, DB writes are skipped.
- Otherwise only changed MSSVs are bulk upserted to MongoDB.

Notes
- Ensure `GOOGLE_SHEET_RANGE` covers all columns (for the new schema up to column L).
- Team membership is appended to the team doc; removal from the old team is not implemented by default.
