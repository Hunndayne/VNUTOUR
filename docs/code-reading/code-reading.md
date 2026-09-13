# VNUTour 2026 — Tài liệu đọc hiểu codebase

> **Mục tiêu**: Tư vấn, phát triển và vận hành hệ thống quản lý sự kiện tour VNU.  
> **Ngày tạo**: 2026-08-24  
> **Links**: [architecture.md](architecture.md) | [api-flow.md](api-flow.md) | [key-modules.md](key-modules.md)

---

## 1. Tổng quan hệ thống

**VNUTour 2026** là hệ thống quản lý sự kiện tour dành cho sinh viên ĐHQG Hà Nội (VNU), bao gồm:

| Thành phần       | Công nghệ           | Vai trò                                         |
| ---------------- | ------------------- | ----------------------------------------------- |
| **Backend API**  | Django 5 + Gunicorn | REST API, business logic                        |
| **Discord Bot**  | discord.py ≥2.3     | Tự động hóa Discord, broadcast                  |
| **Frontend Web** | React 19 + Vite     | UI/UX (SPA, không dùng react-router)            |
| **Database**     | PostgreSQL 16       | Nguồn dữ liệu duy nhất (single source of truth) |
| **Email Worker** | Django mgmt cmd     | Hàng đợi gửi email bất đồng bộ                  |
| **File Storage** | Cloudflare R2 / S3  | Ảnh, file đính kèm, khung ảnh                   |

**Motto kiến trúc:** _PostgreSQL là trung tâm_ — cả API và Bot đều đọc/ghi từ cùng 1 database.

---

## 2. Môi trường & Khởi chạy

### Cấu hình biến môi trường

**Backend** (`backend/.env`):

```bash
DISCORD_TOKEN=           # Token Discord Bot
RUN_DISCORD_BOT=0        # 1 để bật bot (mặc định tắt cho dev)
DJANGO_AUTOSTART=1       # Tự khởi Django khi chạy main.py
DJANGO_HOST=0.0.0.0
DJANGO_PORT=8080
DB_HOST=localhost
DB_NAME=vnutour
DB_USER=...
DB_PASSWORD=...
SMTP_HOST=...            # Cấu hình email
GOOGLE_CLIENT_ID=...     # Cho Google OAuth
```

**Frontend** (`frontend/.env`):

```bash
VITE_API_BASE_URL=http://localhost:8080
VITE_GOOGLE_CLIENT_ID=...
```

### Chạy dev nhanh

```powershell
# Bước 1: Khởi PostgreSQL
docker compose -f backend/docker-compose.dev.yml --env-file backend/.env.dev up postgres -d

# Bước 2: Backend
cd backend
.venv\Scripts\python.exe main.py   # Tự migrate + chạy API tại :8080

# Bước 3: Frontend (tab mới)
cd frontend
npm run dev                         # Dev server tại :5173
```

**URLs:**

- Frontend: http://localhost:5173
- API: http://localhost:8080/api/

### Chạy test

```bash
cd backend
python -m pytest webapi/api/tests/ -v
python -m pytest webapi/api/tests/test_team_service.py -v  # Test cụ thể
python -m pytest webapi/api/tests/ --cov=webapi/api        # Coverage
```

---

## 3. Vai trò người dùng (Roles)

| Role           | Màn hình                | Quyền                                                                     |
| -------------- | ----------------------- | ------------------------------------------------------------------------- |
| `participant`  | `/participant`, `/form` | Xem điểm, cập nhật profile, nộp form                                      |
| `collab`       | `/coop`                 | Quét QR tại trạm, vận hành trạm                                           |
| `admin`        | `/admin`                | Duyệt đội, quản lý điểm, gửi email, Discord                               |
| `master_admin` | `/admin`                | Tất cả admin + thay đổi cấu trúc chương trình (phase, sub-event, station) |

**Quan trọng:** `master_admin` là role duy nhất có thể thay đổi `ProgramPhase.is_current`, thêm/xóa `SubEvent` và `Station`. Backend enforce 403 `master_admin_required` với các endpoint nhạy cảm này.

---

## 4. Cấu trúc Database — 23 Models

### Nhóm 1: Người dùng & Đội

| Model            | Bảng              | Mô tả                                                            |
| ---------------- | ----------------- | ---------------------------------------------------------------- |
| `Account`        | `account`         | Tài khoản đăng nhập. Token-based auth (128 chars).               |
| `Participant`    | `participant`     | Thông tin sinh viên (MSSV, tên, khoa, CCCD...). 1-1 với Account. |
| `Team`           | `team`            | Đội thi. Có approval workflow và provision workflow.             |
| `TeamMembership` | `team_membership` | Liên kết Participant-Team. 1 participant chỉ trong 1 team.       |
| `CaptainVote`    | `captain_vote`    | Bầu đội trưởng sau khi merge đội. Bỏ phiếu bí mật.               |

### Nhóm 2: Chương trình thi đấu

| Model             | Bảng               | Mô tả                                                                |
| ----------------- | ------------------ | -------------------------------------------------------------------- |
| `ProgramPhase`    | `program_phase`    | Giai đoạn (đăng ký, sơ khảo, chung kết). Duy nhất 1 is_current=True. |
| `SubEvent`        | `sub_event`        | Sự kiện con trong phase (station_run, quiz, submission...).          |
| `PhaseRoster`     | `phase_roster`     | Danh sách đội được phép thi trong phase.                             |
| `AdvancementRule` | `advancement_rule` | Luật thăng hạng giữa các phase (top_n / manual).                     |

### Nhóm 3: Check-in & Trạm

| Model               | Bảng                 | Mô tả                                                  |
| ------------------- | -------------------- | ------------------------------------------------------ |
| `Station`           | `station`            | Trạm thi. Có scoring_mode, capacity, checkin_policy.   |
| `StationAssignment` | `station_assignment` | Phân công collab cho trạm.                             |
| `EventCheckIn`      | `event_checkin`      | Check-in tổng của team vào sub-event.                  |
| `StationSession`    | `station_session`    | Session của team tại trạm (entered → exited).          |
| `StationSubmission` | `station_submission` | Bài nộp của team tại trạm. Draft → Submitted → Graded. |
| `TeamFormVariant`   | `team_form_variant`  | Bộ câu hỏi ngẫu nhiên (shared giữa các thành viên).    |
| `TeamFormDraft`     | `team_form_draft`    | Bản nháp form đang điền (real-time sync qua DB).       |

### Nhóm 4: Điểm số

| Model        | Bảng          | Mô tả                                        |
| ------------ | ------------- | -------------------------------------------- |
| `ScoreEntry` | `score_entry` | Điểm của team: station/bonus/penalty/manual. |

### Nhóm 5: Discord & Thông báo

| Model              | Bảng                | Mô tả                                       |
| ------------------ | ------------------- | ------------------------------------------- |
| `DiscordBroadcast` | `discord_broadcast` | Tin nhắn broadcast Discord (queue-based).   |
| `EmailQueueItem`   | `email_queue_item`  | Hàng đợi gửi email (Email Worker poll).     |
| `MssvLinkAudit`    | `mssv_link_audit`   | Audit trail liên kết Account ↔ Participant. |

### Nhóm 6: Hệ thống & Tiện ích

| Model              | Bảng                 | Mô tả                                                                         |
| ------------------ | -------------------- | ----------------------------------------------------------------------------- |
| `SystemSetting`    | `system_setting`     | Cài đặt key-value JSON. Gồm: registration_schema, vietqr, trạng thái đăng ký. |
| `AuditLog`         | `audit_log`          | Ghi log mọi hành động admin. Có thể undo.                                     |
| `PhotoFrame`       | `photo_frame`        | Khung ảnh cho tính năng "Ghép khung".                                         |
| `FrameDownloadLog` | `frame_download_log` | Đếm số lần tải khung.                                                         |
| `ShortLink`        | `short_link`         | Short URL `/s/<code>` với thống kê click.                                     |

---

## 5. API Layer — 15 Sub-routers

| Router file           | Prefix               | Mô tả                                |
| --------------------- | -------------------- | ------------------------------------ |
| `urls_auth.py`        | `/api/auth/`         | Login, Google OAuth, đổi mật khẩu    |
| `urls_public.py`      | `/api/public/`       | Thông tin công khai (không cần auth) |
| `urls_register.py`    | `/api/register/`     | Đăng ký tham gia                     |
| `urls_participant.py` | `/api/participant/`  | Dashboard participant, profile, form |
| `urls_admin.py`       | `/api/admin/`        | Duyệt đội, cài đặt, quản lý          |
| `urls_program.py`     | `/api/program/`      | Phase, sub-event                     |
| `urls_station.py`     | `/api/stations/`     | CRUD trạm, leaderboard               |
| `urls_assignment.py`  | `/api/assignments/`  | Phân công collab                     |
| `urls_checkin.py`     | `/api/checkin/`      | Scan QR, enter/exit station          |
| `urls_score.py`       | `/api/scores/`       | Bảng điểm, ranking                   |
| `urls_discord.py`     | `/api/discord/`      | Discord broadcast, provision         |
| `urls_dashboard.py`   | `/api/dashboard/`    | Stats tổng hợp                       |
| `urls_email.py`       | `/api/email/`        | Gửi email                            |
| `urls_frame.py`       | `/api/frames/`       | Upload/quản lý khung ảnh             |
| `urls_shortlink.py`   | `/s/`, `/api/links/` | Short links                          |

---

## 6. Service Layer — 26 Services

### Core Business Logic

| Service                | File                    | Nhiệm vụ chính                            |
| ---------------------- | ----------------------- | ----------------------------------------- |
| `registration_service` | registration_service.py | Đăng ký participant/team, validate schema |
| `team_service`         | team_service.py         | CRUD đội, duyệt, merge đội                |
| `checkin_service`      | checkin_service.py      | Logic check-in/out tại trạm               |
| `station_service`      | station_service.py      | CRUD trạm, session management             |
| `score_service`        | score_service.py        | Tính điểm, leaderboard, ranking           |
| `program_service`      | program_service.py      | Quản lý phase, advancement                |

### Auth & User

| Service                 | Nhiệm vụ                          |
| ----------------------- | --------------------------------- |
| `auth_service`          | Xác thực, tạo token, Google OAuth |
| `discord_oauth_service` | Discord OAuth flow                |

### Notifications

| Service           | Nhiệm vụ                                |
| ----------------- | --------------------------------------- |
| `discord_service` | Provision role/channel, broadcast queue |
| `email_service`   | Soạn và queue email                     |

### Forms & Submissions

| Service                      | Nhiệm vụ                  |
| ---------------------------- | ------------------------- |
| `submission_config_service`  | Cấu hình form JSON schema |
| `submission_storage_service` | Lưu trữ file/attachment   |
| `team_form_variant_service`  | Quiz variant cho team     |

### Utilities

| Service               | Nhiệm vụ                  |
| --------------------- | ------------------------- |
| `audit_service`       | Ghi AuditLog              |
| `backup_service`      | Xuất backup DB            |
| `report_service`      | Tạo báo cáo               |
| `shortlink_service`   | Quản lý short links       |
| `scan_token_service`  | QR token management       |
| `antibot_service`     | Chống bot registration    |
| `payment_service`     | Xử lý thanh toán (VietQR) |
| `photo_frame_service` | Upload/serve khung ảnh    |
| `result_lock_service` | Khóa kết quả phase        |
| `team_merge_service`  | Merge 2 đội               |
| `assignment_service`  | Phân công collab          |

---

## 7. Frontend — Routing & State

### Route map

```
/              → LandingPage (guest only)
/login         → LoginPage (guest only, ?mode=signup → register)
/admin         → AdminDashboard (admin / master_admin)
/admin/<tab>   → tab: events|stations|teams|scores|accounts|
                     discord|email|operations|frames|links|system|settings
/coop          → CoopDashboard (collab)
/participant   → ParticipantDashboard (participant)
/form          → FormResponses (participant)
/frame         → FramePage (everyone, public)
/tai-tro       → TaiTro (everyone, public)
/s/<code>      → ShortLink redirect (nginx→Django)
```

### State management (không có Redux!)

- **Auth state**: `localStorage` (authToken + user JSON)
- **Draft autosave**: `useDraftState()` trong `drafts.jsx` — 7-day TTL
- **URL state**: Query params cho filter, tab, selected row (xem `router.js`)
- **Per-component**: `useState` + `useEffect` fetch on mount

### HTTP client (`api.js`)

- `apiRequest(path, options)` — Fetch wrapper tự thêm Bearer token
- Lỗi 401 `missing_token`/`invalid_token` → logout + redirect `/`
- `apiDownload(path)` — Download file với Content-Disposition

---

## 8. Luồng dữ liệu chính

### Registration & Team Approval

> Browser → `/api/register` → `registration_service` → DB → Bot provision Discord

### Check-in Flow

> Collab scan QR → `/api/checkin/station/enter/` → `checkin_service` → `StationSession` → `/exit/` → `score_service` → `ScoreEntry`

### Web ↔ Discord Integration

> Approval → provision_state="pending" → Bot polling → Discord role/channel → provision_state="done"

> Xem chi tiết: [api-flow.md](api-flow.md)

---

## 9. Thuật ngữ & Từ điển (Glossary)

### Thuật ngữ domain

| Thuật ngữ              | Tiếng Anh           | Giải thích                                                                                          |
| ---------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| **Giai đoạn**          | `ProgramPhase`      | Giai đoạn chương trình: đăng ký → sơ khảo → chung kết. Duy nhất 1 phase active (`is_current=True`). |
| **Sự kiện con**        | `SubEvent`          | Activity cụ thể trong phase: chạy trạm, quiz, nộp bài, social...                                    |
| **Trạm**               | `Station`           | Điểm hoạt động trong sự kiện Station Run. Mỗi trạm có mã (`code`), vị trí, chính sách scan QR.      |
| **Session trạm**       | `StationSession`    | Phiên team tại trạm: entered → [working] → exited.                                                  |
| **Check-in**           | `EventCheckIn`      | Xác nhận team tham gia sub-event (khác với station session).                                        |
| **Bài nộp**            | `StationSubmission` | Kết quả team nộp tại trạm: draft → submitted → graded.                                              |
| **Điểm mục**           | `ScoreEntry`        | 1 bản ghi điểm: station/bonus/penalty/manual.                                                       |
| **Danh sách thi**      | `PhaseRoster`       | Đội được phép thi trong phase nhất định.                                                            |
| **Quy tắc thăng hạng** | `AdvancementRule`   | Top N đội từ phase này → phase tiếp theo.                                                           |
| **Provision**          | provision_state     | Trạng thái tạo Discord role/channel cho đội.                                                        |
| **Broadcast**          | `DiscordBroadcast`  | Tin nhắn gửi đến nhiều kênh Discord cùng lúc.                                                       |
| **MSSV**               | —                   | Mã số sinh viên VNU. Dùng làm định danh chính của participant.                                      |
| **Collab**             | `collab` role       | Ban hỗ trợ vận hành trạm, quét QR.                                                                  |
| **Master Admin**       | `master_admin`      | Admin cấp cao, kiểm soát cấu trúc chương trình.                                                     |

### Thuật ngữ kỹ thuật

| Thuật ngữ               | Giải thích                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| **QR Token**            | `team.qr_token` — chuỗi unique 64 chars dùng để scan check-in.                                            |
| **Provision**           | Quy trình Bot tạo Discord role + text channel + voice channel cho đội.                                    |
| **Short link**          | `/s/<code>` → 302 redirect đến `target_url`. Đếm click.                                                   |
| **SystemSetting**       | Key-value store trong DB: `registration_schema`, `vietqr_enabled`, `registration_open`...                 |
| **registration_schema** | JSON định nghĩa các trường form đăng ký (dynamic form).                                                   |
| **submission_config**   | JSON định nghĩa form tại trạm: câu hỏi quiz, file upload, text...                                         |
| **Team Form Variant**   | Tập câu hỏi ngẫu nhiên được rút thăm 1 lần/team và dùng chung cho cả team.                                |
| **Draft**               | Bản nháp form được autosave mỗi keystroke, shared giữa các thành viên qua DB (`TeamFormDraft`).           |
| **Replay After All**    | Rule của `SubEvent`: team chỉ được quay lại trạm cũ sau khi đã qua tất cả trạm khác.                      |
| **Staging**             | Môi trường thử nghiệm tại `vnutour.hunn.io.vn`. Có badge "STAGING" góc trên trái.                         |
| **SPA fallback**        | Nginx `try_files → /index.html` để hỗ trợ deep links cho React SPA.                                       |
| **Email Worker**        | Tiến trình Django management command `process_email_queue --watch` poll và gửi email từ `EmailQueueItem`. |

### Trạng thái quan trọng

| Enum                       | Values                                              | Mô tả                       |
| -------------------------- | --------------------------------------------------- | --------------------------- |
| `Team.approval_status`     | `draft`, `pending_approval`, `approved`, `rejected` | Quy trình duyệt đội         |
| `Team.provision_state`     | `none`, `pending`, `done`, `failed`                 | Bot Discord provision       |
| `StationSession.status`    | `active`, `closed`, `cancelled`                     | Trạng thái session tại trạm |
| `StationSession.outcome`   | `pending`, `passed`, `failed`                       | Kết quả session             |
| `StationSubmission.status` | `draft`, `submitted`, `graded`                      | Trạng thái bài nộp          |
| `ScoreEntry.kind`          | `station`, `bonus`, `penalty`, `manual`             | Loại điểm                   |
| `Station.scoring_mode`     | `pass_fail`, `threshold`, `score_only`              | Cách tính điểm trạm         |
| `Station.checkin_policy`   | `staff_scan`, `free_play`                           | Ai scan QR                  |

---

## 10. Công việc phổ biến (Dev Tasks)

### Thêm API endpoint mới

1. Viết view trong `webapi/api/views_<domain>.py`
2. Thêm URL trong `webapi/api/urls_<domain>.py`
3. Gọi từ frontend qua `apiRequest('/path', { method, body })`
4. Viết test trong `webapi/api/tests/test_<feature>.py`

### Thêm Discord command mới

1. Thêm method vào `src/commands/<file>.py` với `@app_commands.command()`
2. Đảm bảo cog được load trong `src/bot/__init__.py`

### Thêm trường mới vào Model

1. Thêm field vào `webapi/api/models.py`
2. Chạy `python webapi/manage.py makemigrations`
3. Chạy `python webapi/manage.py migrate`
4. Cập nhật serialization trong views/services tương ứng

### Deploy

- **Backend**: Push image → `docker compose pull && up -d` → auto migrate khi start
- **Frontend**: `npm run build` → copy `dist/` → Nginx serve tĩnh
- **K8s**: Apply manifest → `kubectl rollout status deployment/backend`

---

## 11. Lưu ý vận hành

> [!IMPORTANT]
> **Chạy bot**: Mặc định `RUN_DISCORD_BOT=0`. Set `=1` và cung cấp `DISCORD_TOKEN` để bot hoạt động.

> [!WARNING]
> **Migration**: Luôn chạy `python webapi/manage.py migrate` sau khi pull code mới. Docker compose tự chạy migrate service trước khi backend start.

> [!NOTE]
> **Master Admin vs Admin**: `master_admin` mới có thể thay đổi phase hiện tại, tạo/xóa sub-event và station. `admin` bị chặn 403 nếu cố làm các việc này.

> [!NOTE]
> **Email Worker**: Phải chạy riêng (`process_email_queue --watch`). Trong Docker Compose là service `email-worker`. Không có worker thì email bị kẹt ở queue.

> [!TIP]
> **Staging detection**: Frontend tự phát hiện môi trường staging bằng `window.location.hostname === 'vnutour.hunn.io.vn'`. Không cần env var.
