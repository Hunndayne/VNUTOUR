# Plan: Chuyển nguồn dữ liệu từ Google Sheet → Database + Quản lý toàn diện trên Web

## Context

Hiện tại **Google Sheet là nguồn dữ liệu chính**: `SheetSyncCog` (`backend/src/bot/sheet_cog.py`) poll Sheet mỗi N giây để upsert `participants`/`teams` vào MongoDB, đồng thời đổi tên role/kênh Discord và nickname theo thay đổi. Web (`frontend/src/App.jsx`) chỉ làm **2 việc**: đăng nhập admin/collab và quét QR điểm danh.

Mục tiêu: **MongoDB trở thành nguồn dữ liệu duy nhất**, mọi quản lý làm trên web, và **đội trưởng tự đăng nhập để đăng ký/quản lý đội của mình**. Quyết định đã chốt:
- Đăng ký đội qua **tài khoản đội trưởng** (role mới `captain`), có cơ chế login.
- Bot Discord **tự động watch DB** để tạo/đổi role + kênh + nickname (thay cho watch Sheet).
- Google Sheet (import & export check-in) trở thành **tùy chọn trong System Settings**.
- `team_id` **tự động sinh**.

## Kiến trúc thay đổi (tổng quan)

```
Đội trưởng → Web (đăng ký/login) → tạo team + members → MongoDB (nguồn chính)
                                                              │
Admin/Collab → Web quản lý (CRUD + settings + check-in) ─────┤
                                                              ▼
                                       Bot watch `teams` → tạo role/kênh/nickname Discord
                                       Google Sheet: chỉ chạy nếu bật trong Settings
```

---

## Phase 1 — Data model & roles (nền tảng)

**1.1 Thêm role `captain`** — `backend/webapi/api/models.py`
- Thêm `ROLE_CAPTAIN = "captain"` vào `Account.ROLE_CHOICES`.
- Thêm field `team_oid = CharField(null=True, blank=True)` (lưu `_id` team mà captain sở hữu, dạng hex string) để map nhanh account ↔ team.
- Tạo migration mới trong `backend/webapi/api/migrations/`.

**1.2 `team_id` tự sinh + ownership** — `backend/src/utils/mongo.py`
- Thêm `next_team_id()` dùng `meta.find_one_and_update({"key":"team_seq"}, {"$inc":{"value":1}}, upsert=True, return_after)` → format ví dụ `f"T{n:04d}"` (atomic, chống trùng).
- Thêm `create_team(team_name, owner_username) -> doc`: sinh team_id, set `owner_username`, `members_mssv=[]`, `created_at/updated_at`, đánh dấu `provision_state="pending"` (xem Phase 3).
- Mở rộng `upsert_participant` để dùng được khi tạo member từ web (đã hỗ trợ sẵn các field; chỉ cần đảm bảo gắn `team_id`/`team_name` của team đang tạo).

**1.3 System Settings** — reuse collection `meta` (đã có `get_meta`/`set_meta`)
- Một key `system_settings` chứa dict: `{ registration_open: bool, sheet_import_enabled: bool, sheet_checkin_export_enabled: bool, team_max_members: int }`.
- Thêm helper `get_settings()` trả default an toàn (registration_open=False, sheet_*_enabled=False) khi chưa có.

---

## Phase 2 — Backend API (Django) — `backend/webapi/api/views.py` + `urls.py`

Tái dùng helper sẵn có: `_get_mongo`, `_auth_account`, `_extract_token`, `_to_public`, `_set_auth_cookie`, `make_password/check_password`, `_sync_account_to_mongo`.

**2.1 Đăng ký & quản lý của đội trưởng (captain)**
- `POST /api/auth/register-captain` (mở, **không cần secret**, nhưng chặn nếu `registration_open == False`): tạo `Account(role=captain)`, trả token + set cookie. (Tách khỏi `register()` hiện đang ép `ROLE_ADMIN`.)
- `POST /api/teams` (captain, yêu cầu `registration_open`): tạo team qua `mongo.create_team(name, owner_username=me.username)`, lưu `team_oid` vào `Account`. Mỗi captain **1 team** (chặn nếu đã có).
- `GET /api/my-team` (captain): trả team của mình + members.
- `POST /api/my-team/members` / `PATCH /api/my-team/members/<mssv>` / `DELETE` (captain): thêm/sửa/xóa member của team mình (gọi `upsert_participant` + cập nhật `members_mssv`), kiểm tra `team_max_members`. Mọi thao tác **scope theo ownership** (so khớp `owner_username`).

**2.2 Quản lý của admin/collab (CRUD đầy đủ)**
- Participants: `POST /api/participants`, `PATCH/PUT /api/participants/<mssv>`, `DELETE /api/participants/<mssv>`. (GET đã có.)
- Teams: `POST/PATCH/DELETE /api/teams/<key>` cho admin (GET đã có ở `teams_list`/`team_detail`).
- Accounts: đã có (`admin_accounts`, `admin_account_detail`) — chỉ cần cho phép set `role=captain`.
- Check-in: giữ nguyên (`checkin_team`, `list_checkedin_teams`, `checkin_stats`, `delete_checkin`).

**2.3 Settings API**
- `GET /api/settings` (admin/collab đọc), `PUT /api/settings` (admin ghi) → đọc/ghi `mongo` settings (Phase 1.3).

**2.4 Phân quyền**
- Thêm helper `_require_role(request, *roles)`; áp dụng: captain chỉ chạm team mình; participants/teams/settings CRUD yêu cầu admin (collab vẫn check-in được như cũ).

---

## Phase 3 — Bot Discord: thay SheetSyncCog bằng watcher DB

**3.1 Trích logic provisioning thành hàm dùng chung** — file mới `backend/src/utils/provisioning.py`
- `async def provision_team(bot, guild, team_doc) -> dict`: gom logic chuẩn đang nằm inline ở `backend/src/commands/admin_commands.py:556` (`addallrole`): tạo role `clean_team_name`, tạo text/voice channel với overwrites dưới category hợp lệ (`get_valid_team_categories_for_guild`, `pick_category_for_new_channels` trong `src/utils/categories.py`), lưu `text_channel_id`/`voice_channel_id` về Mongo, gán role + nickname (`build_nickname`, `try_set_nickname` trong `src/utils/nicknames.py`) cho member có `discord_id`.
- `async def rename_team_resources(...)`: gom logic đổi tên role/kênh từ `sheet_cog.py` (dòng ~122–217).
- Refactor `admin_commands.addallrole` + xóa bản **dead-code** `addallrole_slash` trong `slash_commands.py` (nằm sau `return embed`, không bao giờ chạy) để cùng gọi `provision_team`.

**3.2 `TeamSyncCog`** — file mới `backend/src/bot/team_cog.py` (thay vai trò watch của sheet_cog)
- `tasks.loop` mỗi ~30–60s: query teams có `provision_state == "pending"` hoặc `updated_at > last_provisioned_at`, gọi `provision_team`/`rename_team_resources`, rồi set `provision_state="done"` + `last_provisioned_at`.
- Đăng ký trong `bot.setup_hook` (`backend/src/bot/bot.py`) thay cho `setup_sheet_sync`.
- (Tùy chọn nâng cao: MongoDB Change Streams nếu dùng replica set — mặc định dùng polling cho đơn giản, khớp pattern hiện tại.)

**3.3 Google Sheet thành tùy chọn**
- `SheetSyncCog` (`sheet_cog.py`) chỉ `start()` khi `get_settings().sheet_import_enabled` (đọc lúc khởi động; có thể re-check theo chu kỳ). Mặc định **tắt**.
- Trong `views.checkin_team`, bọc đoạn `append_rows_to_sheet(...)` bằng cờ `sheet_checkin_export_enabled`. Tương tự `delete_checkin` với `remove_rows_by_first_column`.

---

## Phase 4 — Frontend (React) — `frontend/`

**4.1 Hạ tầng**
- Thêm `react-router-dom`. Tách `src/App.jsx` (~800 dòng) thành:
  - `src/api.js` — client gọi API + xử lý token (reuse pattern `localStorage` + `Authorization: Bearer`).
  - `src/pages/Login.jsx`, `Register.jsx` (đăng ký captain), `CaptainDashboard.jsx`, `AdminDashboard.jsx`, `CheckinScanner.jsx` (tách phần QR hiện có), `Settings.jsx`.
  - `src/components/` cho bảng/CRUD modal dùng lại.
- Route guard theo `user.role` (admin / collab / captain).

**4.2 Trang theo role**
- **Captain**: form tạo đội (chỉ tên — team_id hiện sau khi tạo) + bảng quản lý members (thêm/sửa/xóa, hiển thị trạng thái liên kết Discord).
- **Admin**: dashboard thống kê (dùng `/api/checkins/stats`) + tabs Participants / Teams / Accounts / Settings + Check-in scanner.
- **Collab**: chủ yếu Check-in scanner (giữ nguyên trải nghiệm hiện tại).
- Giữ `CheckinResultModal` và logic quét QR hiện có trong `CheckinScanner.jsx`.

---

## Phase 5 — Migration & dọn dẹp

- Dữ liệu participants/teams cũ đã nằm sẵn trong Mongo (từ các lần sync trước) → chỉ cần **đặt `sheet_import_enabled=False`** trong Settings.
- Script một lần (`backend/scripts/`): backfill `team_id` (cho team thiếu) và `provision_state` cho team hiện có; gắn `owner_username` nếu cần.
- Cập nhật `backend/README.md`, `API.md`/`API_VI.md` cho endpoint mới; cập nhật `.env.docker.example` (bỏ Sheet khỏi mục bắt buộc).

---

## Các file chính sẽ sửa/thêm

| Loại | File |
|---|---|
| Model + migration | `backend/webapi/api/models.py`, `backend/webapi/api/migrations/000X_*.py` |
| API | `backend/webapi/api/views.py`, `backend/webapi/api/urls.py` |
| Mongo helpers | `backend/src/utils/mongo.py` |
| Bot watcher | `backend/src/bot/team_cog.py` (mới), `backend/src/bot/bot.py` |
| Provisioning dùng chung | `backend/src/utils/provisioning.py` (mới), refactor `backend/src/commands/admin_commands.py`, dọn dead-code `slash_commands.py` |
| Sheet optional | `backend/src/bot/sheet_cog.py`, `backend/webapi/api/views.py` (checkin export) |
| Frontend | `frontend/package.json`, `frontend/src/*` (tách trang + api client) |

## Lưu ý an toàn / rủi ro

- **Đăng ký captain mở** → cần cờ `registration_open` (đóng khi hết hạn) và cân nhắc rate-limit/chống spam tài khoản.
- Hiện token lưu `localStorage` + cookie HttpOnly song song; giữ nguyên cơ chế, nhưng cần `CORS_ALLOW_CREDENTIALS` đúng khi deploy khác origin.
- Provisioning Discord cần bot có quyền Manage Roles/Channels/Nicknames và `team_category_ids` được cấu hình — watcher phải nuốt lỗi từng đội, không làm hỏng cả vòng lặp (giữ pattern try/except hiện có).
- Thao tác đổi tên đội sau khi đã tạo resource phải đồng bộ tên role/kênh (đã có logic ở sheet_cog để tái dùng).

## Verification (kiểm thử đầu-cuối)

1. **Backend**: `cd backend && python manage.py migrate` (qua `webapi/manage.py`) rồi `python main.py` (chạy bot + API). Kiểm tra `GET /api/health` OK.
2. **Frontend**: `cd frontend && npm install && npm run dev`; chỉnh `frontend/.env` → `VITE_API_BASE_URL`.
3. **Luồng captain**: đăng ký captain → login → tạo đội (thấy `team_id` tự sinh) → thêm members.
4. **Bot**: xác nhận `TeamSyncCog` tạo role + text/voice channel cho đội mới trong Discord; đổi tên đội → role/kênh đổi theo.
5. **Admin**: đăng nhập admin → thấy đội/participant trong trang quản lý; sửa/xóa; bật/tắt Google Sheet trong Settings và xác nhận sync dừng/chạy đúng.
6. **Check-in**: quét QR đội (lệnh `!teamqr` vẫn tạo QR) → `/api/checkin` ghi nhận, modal hiện đúng, không phụ thuộc Sheet khi tắt export.
7. **Regression**: với `sheet_import_enabled=False`, đảm bảo không còn ghi đè dữ liệu từ Sheet.

---

## CẬP NHẬT FLOW (chốt sau khi trao đổi) — đã triển khai ở backend

Flow đăng ký đội được làm rõ thêm, khác với mô tả ban đầu ở trên:

- **Không có role `captain` riêng.** Roles = `admin`, `collab`, `member`. Đội trưởng = một `member` sở hữu đội (`team.owner_username`). `Account` thêm `mssv` (unique) + `full_name`. (Migration `0004_account_member_role_profile`.)
- **Định danh email + MSSV.** Self-registration qua `POST /api/auth/signup` (thay cho `register-captain`); có thể kèm hồ sơ → tạo participant để auto-fill về sau. Member sửa hồ sơ mình qua `GET/PUT /api/me/profile`.
- **Captain nhập hết thông tin thành viên**; nếu email/MSSV đã có account/hồ sơ thì **auto-fill** (`_autofill_member`).
- **Bước duyệt:** `team.approval_status` = `draft → pending_approval → approved | rejected`.
  - Captain `POST /api/my-team/submit` → `pending_approval`.
  - Admin `POST /api/teams/<key>/approve` (→ `approved` + `provision_state="pending"`) hoặc `POST /api/teams/<key>/reject` (`{note}`).
  - **Bot CHỈ tạo role/kênh Discord sau khi duyệt** (không provisioning lúc tạo/sửa đội).
  - Đội `approved` thì captain không sửa được (chỉ admin); đội `rejected` mà sửa lại sẽ tự về `draft`.
- **Thông báo thành viên tạo tài khoản:** web hiển thị `has_account` per member; captain tự chia sẻ link đăng ký (không gửi email tự động).
- Admin liệt kê đội chờ duyệt: `GET /api/teams?approval_status=pending_approval`.

Tài liệu endpoint thực tế: `docs/api-endpoints.md`.
