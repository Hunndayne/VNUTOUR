# VNUTour API — endpoints thực tế (sau khi chuyển sang DB + duyệt đội)

> Mô tả **API đang chạy thật** trong `backend/webapi/api/`. Base path: `/api`.

## Vai trò & flow đăng ký đội

Roles (`Account.role`): `admin`, `collab`, `member`. **"Đội trưởng" = một `member` sở hữu một đội** (`team.owner_username` = họ; `Account.team_oid` trỏ tới đội).

**Flow đăng ký đội:**
1. Người dùng (đội trưởng hoặc thành viên) **tự đăng ký tài khoản** (`POST /api/auth/signup`) — định danh bằng **email + MSSV** (gated bởi `registration_open`).
2. Một người **tạo đội** (`POST /api/teams`) → trở thành captain. `team_id` tự sinh (`T0001…`), trạng thái `draft`.
3. Captain **nhập thông tin thành viên** (`POST /api/my-team/members`) — nếu email/MSSV đã có tài khoản/hồ sơ thì **auto-fill**.
4. Captain **submit** (`POST /api/my-team/submit`) → trạng thái `pending_approval`.
5. **Admin duyệt** (`POST /api/teams/<key>/approve`) → `approved` + bot bắt đầu tạo role/kênh Discord; hoặc **từ chối** (`/reject`) → `rejected` (kèm lý do).
6. Web hiển thị thành viên nào **chưa có tài khoản** (`has_account=false`) để captain tự chia sẻ link đăng ký.

`approval_status`: `draft → pending_approval → approved | rejected`. Khi `rejected` mà captain sửa lại thì tự về `draft` để submit lại. Đội đã `approved` thì captain không sửa được nữa (chỉ admin).

## Xác thực & tài khoản

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| POST | `/api/auth/login` | public | `{username, password}` → `{token, user}` |
| POST | `/api/auth/signup` | public* | **MỚI** — tự đăng ký `member` `{username, password, email, mssv?, full_name?, ...}` |
| POST | `/api/auth/register` | bootstrap/secret | tạo **admin** (cần `ADMIN_REGISTER_SECRET`) |
| GET | `/api/auth/me` · POST `/api/auth/logout` | đã login | thông tin / đăng xuất |
| GET/PUT | `/api/me/profile` | đã login (member) | **MỚI** — xem/sửa hồ sơ participant của chính mình (theo MSSV) |
| GET/POST | `/api/admin/accounts` · GET/PATCH/DELETE `/api/admin/accounts/<username>` | admin | quản lý tài khoản |

\* gated bởi System Settings `registration_open`.

## Đội trưởng (captain) — quản lý đội của mình

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| POST | `/api/teams` | member | tạo đội của mình (`team_id` tự sinh, `draft`). Mỗi member 1 đội. Cần `registration_open`. |
| GET | `/api/my-team` | member | trả `{team, members[], approval_status, approval_note, editable}`; mỗi member có `has_account` |
| POST | `/api/my-team/members` | captain | thêm thành viên (auto-fill theo email/MSSV; chặn nếu vượt `team_max_members` / MSSV ở đội khác) |
| PATCH | `/api/my-team/members/<mssv>` | captain | sửa thành viên |
| DELETE | `/api/my-team/members/<mssv>` | captain | xoá thành viên |
| POST | `/api/my-team/submit` | captain | gửi đội cho admin duyệt (`pending_approval`); cần ≥1 thành viên |

> Sửa/thêm/xoá thành viên chỉ cho phép khi đội ở `draft/pending_approval/rejected` (đã duyệt thì khoá).

## Admin

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/api/teams?approval_status=pending_approval` | đã login | **MỚI** — lọc đội chờ duyệt |
| POST | `/api/teams` | admin | admin tạo đội → tự `approved` + provisioning |
| PATCH | `/api/teams/<key>` | admin / captain (khi chưa duyệt) | đổi tên đội (admin rename đội đã duyệt → bot rename Discord) |
| DELETE | `/api/teams/<key>` | admin | xoá đội + checkins + gỡ liên kết |
| POST | `/api/teams/<key>/approve` | admin | **MỚI** — duyệt → queue provisioning Discord |
| POST | `/api/teams/<key>/reject` | admin | **MỚI** — từ chối `{note?}` |
| POST | `/api/participants` · PATCH/DELETE `/api/participants/<mssv>` | admin | **MỚI** — CRUD participant |
| GET | `/api/participants` · `/api/participants/<mssv>` | đã login | xem (sẵn có) |

## System Settings

| Method | Path | Quyền |
|---|---|---|
| GET | `/api/settings` | đã login |
| PUT | `/api/settings` | admin |

```json
{
  "registration_open": false,             // mở/đóng đăng ký + tạo đội
  "sheet_import_enabled": false,          // bật đồng bộ từ Google Sheet (SheetSyncCog)
  "sheet_checkin_export_enabled": false,  // ghi check-in ngược ra Google Sheet
  "team_max_members": 5
}
```
Lưu trong Mongo `meta.system_settings`, mặc định an toàn (Sheet tắt, đăng ký đóng).

## Check-in (giữ nguyên)

| Method | Path | Quyền |
|---|---|---|
| POST | `/api/checkin` | đã login |
| GET | `/api/checkins` · `/api/checkins/stats` | đã login |
| DELETE | `/api/checkin/<key>` | admin |

Ghi ra Google Sheet **chỉ khi** `sheet_checkin_export_enabled=true`.

## Đồng bộ Discord (bot)

- Chỉ khi đội **được duyệt** (`approve`) → `provision_state="pending"`.
- `TeamSyncCog` (`backend/src/bot/team_cog.py`) poll ~30s → `provision_team()` (`backend/src/utils/provisioning.py`) tạo/đổi role + text/voice channel + gán role/nickname cho thành viên đã liên kết Discord → đặt `provision_state="done"`.
- `SheetSyncCog` chỉ chạy khi `sheet_import_enabled=true`.

## Backfill khi chuyển đổi

```bash
cd backend
python scripts/backfill_teams.py               # gán team_id còn thiếu, provision_state="done"
python scripts/backfill_teams.py --reprovision  # ép bot tạo lại role/kênh cho tất cả đội
```
