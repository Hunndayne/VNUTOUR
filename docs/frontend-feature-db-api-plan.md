# Plan tính năng, database và API theo frontend hiện tại

## Mục tiêu

Frontend hiện đã có nhiều màn hình ở dạng mock/localStorage. Tài liệu này chốt lại các phần cần triển khai backend trước khi nối API thật, với 3 role chính:

- `participant`: người tham gia, tự đăng ký, cập nhật hồ sơ, tạo/quản lý đội của mình.
- `admin`: toàn quyền quản trị, duyệt đội, quản lý sự kiện, trạm, điểm, tài khoản, Discord.
- `collab`: cộng tác viên vận hành, chủ yếu check-in sự kiện/trạm và xem dữ liệu cần thiết để vận hành.

Lưu ý frontend hiện còn dùng tên `member` ở một số file. Khi triển khai nên chuẩn hóa thành `participant` từ API tới localStorage/user object.

## Baseline API hiện có không được bỏ qua

Các file API/contract hiện có là đầu vào bắt buộc của thiết kế:

- `backend/webapi/api/urls.py`: danh sách route Django đang expose thật.
- `backend/webapi/api/views.py`: behavior thật của auth, account, team, participant, check-in, settings.
- `docs/api-endpoints.md`: mô tả API thật sau luồng signup/team approval.
- `frontend/API.md`: contract frontend cũ đang biết.
- `backend/API.md` và `backend/API_VI.md`: API v1 cũ hơn, có ý tưởng JWT/RBAC/idempotency/QR signed payload.
- `docs/api-qr-checkin-plan.md`: plan riêng cho event check-in và station sessions.
- `docs/frontend-event-phase-score-architecture.md`: kiến trúc phase -> sub-event -> station -> score.

Kết luận khi thiết kế API mới:

- Giữ các path đang được frontend gọi trực tiếp nếu không có lý do mạnh để đổi: `/auth/login`, `/auth/signup`, `/auth/google`, `/auth/me`, `/auth/logout`, `/checkin`, `/checkins`, `/checkins/stats`.
- Các path quản lý đội/tài khoản hiện có được giữ và mở rộng: `/teams`, `/teams/:team_key`, `/teams/:team_key/approve`, `/teams/:team_key/reject`, `/admin/accounts`.
- Đổi role `member` -> `participant` ở API response mới, nhưng khi refactor nên kiểm tra toàn bộ frontend/backend docs cũ còn nhắc `member`.
- QR mới không dùng Mongo ObjectId, nhưng vẫn giữ format prefix `t:` để frontend/bot dễ dùng.
- Với event/station mới, ưu tiên thêm namespace rõ nghĩa như `/event-checkins/*` và `/station-sessions/*`; `/checkin` có thể giữ làm alias cho check-in sự kiện để không phá `CheckinPage.jsx` hiện tại.

### Route baseline trong backend hiện tại

Các route đang tồn tại trong `backend/webapi/api/urls.py`:

| Nhóm | Route hiện có | Hướng xử lý trong thiết kế mới |
|---|---|---|
| Health | `GET /health` | Giữ, đổi health check sang PostgreSQL |
| Auth | `/auth/login`, `/auth/me`, `/auth/logout`, `/auth/register`, `/auth/signup`, `/auth/google` | Giữ path, chuẩn hóa role `participant/admin/collab` |
| Accounts | `/admin/accounts`, `/admin/accounts/:username` | Giữ path, mở rộng account participant/collab/admin |
| Settings | `/settings` | Giữ path, lưu PostgreSQL `system_settings` |
| Profile | `/me/profile` | Giữ path |
| My team | `/my-team`, `/my-team/submit`, `/my-team/members`, `/my-team/members/:mssv` | Giữ path |
| Participants | `/participants`, `/participants/:mssv` | Giữ path, chuyển từ Mongo sang PostgreSQL |
| Teams | `/teams`, `/teams/:team_key`, `/teams/:team_key/approve`, `/teams/:team_key/reject` | Giữ path |
| Event check-in | `/checkin`, `/checkin/:team_key`, `/checkins`, `/checkins/stats` | Giữ path cho event check-in; có thể thêm `/event-checkins/*` sau |

### Delta so với docs/API cũ

| Chủ đề | API cũ | API mới đề xuất |
|---|---|---|
| Database | SQLite account + Mongo participant/team/checkin | PostgreSQL cho toàn bộ nghiệp vụ |
| Role participant | `member` hoặc chưa có | `participant` |
| QR | Mongo `ObjectId` hoặc signed `team_id` | `t:<qr_token>`; không expose DB id |
| Check-in sự kiện | `/checkin` theo team | Giữ `/checkin`, nội bộ lưu `event_checkins`; có thể alias sang `/event-checkins/scan` |
| Station sessions | Chưa có trong backend thật | Thêm `/station-sessions/enter`, `/station-sessions/exit`, occupancy |
| Idempotency | Có gợi ý trong `backend/API.md` | Nên áp dụng cho check-in/station write bằng unique constraint + optional `Idempotency-Key` |
| Error envelope | Cũ đang trả `{error: "code"}` | Phase đầu giữ `{error: "code"}` để frontend không vỡ; về sau có thể thêm `detail/correlation_id` |

## Những màn hình frontend hiện có

### Public/Auth

Files:

- `frontend/src/LandingPage.jsx`
- `frontend/src/LoginPage.jsx`

Luồng cần có:

- Đăng nhập username/password.
- Đăng ký participant.
- Đăng nhập Google.
- Redirect theo role:
  - `participant` -> `/participant`
  - `admin` -> admin dashboard
  - `collab` -> `/checkin`

### Participant dashboard

File:

- `frontend/src/ParticipantDashboard.jsx`

Luồng cần có:

- Xem/sửa hồ sơ cá nhân.
- Tạo đội.
- Đổi tên đội khi còn editable.
- Thêm/sửa/xóa thành viên đội.
- Hiển thị thành viên đã có tài khoản web hay chưa.
- Submit đội cho BTC duyệt.
- Xem trạng thái duyệt: `draft`, `pending_approval`, `approved`, `rejected`.
- Xem trạng thái Discord provisioning: `none`, `pending`, `done`, `failed`.

### Admin dashboard

Files:

- `frontend/src/AdminDashboard.jsx`
- `frontend/src/EventManagementPage.jsx`
- `frontend/src/TeamsPage.jsx`
- `frontend/src/ScoreManagementPage.jsx`
- `frontend/src/StationsPage.jsx`
- `frontend/src/DiscordPage.jsx`
- `frontend/src/AccountsPage.jsx`

Các module admin:

- Tổng quan theo phase.
- Quản lý chương trình, phase, sub-event.
- Quản lý đội và duyệt đội.
- Quản lý điểm và suất đi tiếp.
- Quản lý trạm.
- Quản lý Discord/provisioning/broadcast.
- Quản lý tài khoản.

### Check-in operations

File:

- `frontend/src/CheckinPage.jsx`

Luồng cần có:

- Đăng nhập operator.
- Check-in sự kiện bằng QR.
- Xem danh sách đội đã check-in.
- Xem stats check-in.
- Admin reset check-in.
- Check-in vào trạm.
- Check-out khỏi trạm.
- Theo dõi đội đang ở trạm, đội đã hoàn thành trạm, điểm trạm.

## Phân quyền

| Feature | participant | collab | admin |
|---|---:|---:|---:|
| Đăng ký/login | Có | Có | Có |
| Xem/sửa hồ sơ cá nhân | Có | Có | Có |
| Tạo đội | Có | Không | Có |
| Sửa đội của mình khi chưa khóa | Có | Không | Có |
| Thêm/sửa/xóa thành viên đội mình | Có | Không | Có |
| Submit đội | Có | Không | Có |
| Duyệt/từ chối đội | Không | Không | Có |
| Xem danh sách đội | Chỉ đội mình | Có, read-only | Có |
| Check-in sự kiện | Không | Có | Có |
| Reset check-in | Không | Không | Có |
| Check-in/check-out trạm | Không | Có | Có |
| Quản lý phase/event/trạm | Không | Không | Có |
| Nhập/sửa điểm | Không | Có, nếu được bật | Có |
| Publish suất đi tiếp | Không | Không | Có |
| Quản lý tài khoản | Không | Không | Có |
| Đồng bộ Discord | Không | Không | Có |
| Gửi broadcast Discord | Không | Không | Có |

## Database design

### `accounts`

Tài khoản đăng nhập.

Fields:

- `id`
- `username`: unique
- `email`: unique
- `password_hash`
- `role`: `participant`, `admin`, `collab`
- `is_active`
- `token`: unique nullable
- `mssv`: unique nullable
- `full_name`
- `google_sub`: unique nullable
- `last_login`
- `created_at`, `updated_at`

Index:

- unique `username`
- unique `email`
- unique nullable `mssv`
- unique nullable `google_sub`
- index `role`, `is_active`

### `participants`

Hồ sơ người tham gia.

Fields:

- `id`
- `account_id`: OneToOne nullable
- `mssv`: unique
- `full_name`
- `email`
- `phone`
- `faculty`
- `school`
- `facebook`
- `discord_id`: unique nullable
- `created_at`, `updated_at`

Ghi chú:

- Participant là hồ sơ người, không lưu trực tiếp team.
- Một participant chỉ thuộc đội qua `team_memberships`.

### `teams`

Đội tham gia.

Fields:

- `id`
- `code`: unique, ví dụ `T0001`
- `name`
- `owner_account_id`: FK `accounts`, nullable
- `approval_status`: `draft`, `pending_approval`, `approved`, `rejected`
- `approval_note`
- `submitted_at`
- `reviewed_by_id`: FK `accounts`, nullable
- `reviewed_at`
- `qr_token`: unique
- `checked_in_at`
- `provision_state`: `none`, `pending`, `done`, `failed`
- `provision_last_error`
- `provision_retry_count`
- `last_provisioned_at`
- `discord_role_id`
- `text_channel_id`
- `voice_channel_id`
- `created_at`, `updated_at`

Ràng buộc:

- `code` unique.
- `qr_token` unique.
- Mỗi participant/account chỉ sở hữu một team active.
- Chỉ đội `approved` mới được check-in sự kiện.
- Đội `approved` bị khóa với participant, chỉ admin được sửa.

### `team_memberships`

Quan hệ team - participant.

Fields:

- `id`
- `team_id`: FK `teams`
- `participant_id`: FK `participants`
- `is_captain`: boolean
- `team_number`: integer nullable
- `created_at`, `updated_at`

Ràng buộc:

- unique `(team_id, participant_id)`
- unique `participant_id` nếu một participant chỉ được thuộc một đội
- partial unique `team_id where is_captain = true`

### `program_phases`

Các phase cố định mà frontend đang có:

- `registration`
- `qualifying`
- `final`
- `ended`

Fields:

- `id`
- `key`: unique
- `label`
- `hint`
- `start_date`
- `end_date`
- `order`
- `is_current`
- `created_at`, `updated_at`

### `sub_events`

Event con trong từng phase.

Fields:

- `id`
- `phase_id`: FK `program_phases`
- `name`
- `type`: `workflow`, `social`, `station_run`, `quiz`, `submission`, `custom`
- `start_date`
- `end_date`
- `uses_stations`
- `note`
- `order`
- `created_at`, `updated_at`

### `stations`

Trạm thuộc một sub-event có `uses_stations = true`.

Fields:

- `id`
- `sub_event_id`: FK `sub_events`
- `code`: unique trong sub-event, ví dụ `ST01`
- `name`
- `location`
- `order`
- `active`
- `checkin_policy`: `staff_scan`, `free_play`
- `capacity_mode`: `limited`, `unlimited`
- `max_concurrent_teams`
- `submission_config`: JSONB
- `created_at`, `updated_at`

`submission_config` chứa cấu hình form/quiz/attachment hiện đang nằm trong `StationsPage.jsx`.

### `event_checkins`

Check-in sự kiện chính.

Fields:

- `id`
- `team_id`: FK `teams`
- `scanner_id`: FK `accounts`
- `ip`
- `user_agent`
- `meta`: JSONB
- `created_at`

Ràng buộc:

- unique `team_id` nếu mỗi đội chỉ check-in sự kiện một lần.

### `station_visits`

Vào/rời trạm.

Fields:

- `id`
- `station_id`: FK `stations`
- `team_id`: FK `teams`
- `status`: `inside`, `completed`, `cancelled`
- `entered_at`
- `entered_by_id`: FK `accounts`
- `exited_at`
- `exited_by_id`: FK `accounts`
- `score`: integer default 0
- `note`
- `created_at`, `updated_at`

Ràng buộc:

- Một team không được có hai visit `inside` trong cùng một station.
- Nếu station capacity limited, service phải kiểm tra số visit `inside` trước khi cho enter.

### `score_entries`

Ledger điểm.

Fields:

- `id`
- `phase_id`: FK `program_phases`
- `sub_event_id`: FK `sub_events`, nullable
- `station_visit_id`: FK `station_visits`, nullable
- `team_id`: FK `teams`
- `kind`: `station`, `bonus`, `penalty`, `manual`
- `points`: integer
- `note`
- `created_by_id`: FK `accounts`
- `created_at`, `updated_at`

Ghi chú:

- Điểm trạm có thể sinh từ `station_visits.score`.
- Bonus/penalty/manual nhập trực tiếp từ màn `ScoreManagementPage`.

### `phase_rosters`

Danh sách đội tham gia từng phase.

Fields:

- `id`
- `phase_id`: FK `program_phases`
- `team_id`: FK `teams`
- `origin`: `approved`, `qualified`, `wildcard`, `manual`
- `qualified_from_phase_id`: FK `program_phases`, nullable
- `note`
- `created_at`

Ràng buộc:

- unique `(phase_id, team_id)`

### `advancement_rules`

Cấu hình suất đi tiếp.

Fields:

- `id`
- `from_phase_id`: FK `program_phases`
- `to_phase_id`: FK `program_phases`
- `mode`: `top_n`, `manual`
- `slots`
- `last_published_at`
- `published_by_id`: FK `accounts`, nullable
- `created_at`, `updated_at`

### `discord_broadcasts`

Lịch sử gửi thông báo Discord.

Fields:

- `id`
- `title`
- `message`
- `target`: `all`, `approved`, `pending`, `team_ids`
- `target_team_ids`: JSONB hoặc bảng nối nếu cần query nhiều
- `sent_by_id`: FK `accounts`
- `status`: `draft`, `sent`, `failed`
- `error`
- `sent_at`
- `created_at`

### `system_settings`

Key-value config.

Fields:

- `key`: unique
- `value`: JSONB
- `updated_at`

Settings ban đầu:

```json
{
  "registration_open": false,
  "team_max_members": 5,
  "collab_can_edit_scores": false,
  "sheet_import_enabled": false,
  "sheet_checkin_export_enabled": false
}
```

## API design

Base path: `/api`

### Auth

| Method | Path | Role | Mục đích |
|---|---|---|---|
| POST | `/auth/login` | public | Login username/password |
| POST | `/auth/signup` | public | Participant signup, gated bởi `registration_open` |
| POST | `/auth/google` | public | Google login/signup participant |
| GET | `/auth/me` | logged-in | Lấy user hiện tại |
| POST | `/auth/logout` | logged-in | Logout |

`user.role` trả về một trong: `participant`, `admin`, `collab`.

### Participant self-service

| Method | Path | Role | Mục đích |
|---|---|---|---|
| GET | `/me/profile` | participant/admin/collab | Xem hồ sơ của mình |
| PUT/PATCH | `/me/profile` | participant/admin/collab | Cập nhật hồ sơ |
| GET | `/my-team` | participant | Lấy đội của mình + members |
| POST | `/my-team` | participant | Tạo đội |
| PATCH | `/my-team` | participant | Sửa tên đội khi còn editable |
| POST | `/my-team/members` | participant | Thêm member |
| PATCH | `/my-team/members/:mssv` | participant | Sửa member |
| DELETE | `/my-team/members/:mssv` | participant | Xóa member |
| POST | `/my-team/submit` | participant | Submit đội cho admin duyệt |
| GET | `/my-team/qr` | participant | Xem QR token nếu đội đã duyệt |

### Teams/admin

| Method | Path | Role | Mục đích |
|---|---|---|---|
| GET | `/teams` | admin/collab | List teams, filter status/search/page |
| POST | `/teams` | admin | Admin tạo đội |
| GET | `/teams/:team_id` | admin/collab | Chi tiết đội |
| PATCH | `/teams/:team_id` | admin | Sửa đội |
| DELETE | `/teams/:team_id` | admin | Xóa đội |
| POST | `/teams/:team_id/approve` | admin | Duyệt đội |
| POST | `/teams/:team_id/reject` | admin | Từ chối đội |
| POST | `/teams/:team_id/members` | admin | Admin thêm member |
| PATCH | `/teams/:team_id/members/:mssv` | admin | Admin sửa member |
| DELETE | `/teams/:team_id/members/:mssv` | admin | Admin xóa member |

Filter cần hỗ trợ cho `TeamsPage.jsx`:

- `approval_status`
- `provision_state`
- `q`
- `has_account`
- `has_discord`
- `page`, `limit`

### Accounts/admin

| Method | Path | Role | Mục đích |
|---|---|---|---|
| GET | `/admin/accounts` | admin | List accounts |
| POST | `/admin/accounts` | admin | Tạo account admin/collab/participant |
| GET | `/admin/accounts/:username` | admin | Chi tiết account |
| PATCH | `/admin/accounts/:username` | admin | Sửa role, active, profile, password |
| DELETE | `/admin/accounts/:username` | admin | Deactivate hoặc xóa mềm |

Filter:

- `role`
- `is_active`
- `q`
- `page`, `limit`

### Program phases/sub-events

| Method | Path | Role | Mục đích |
|---|---|---|---|
| GET | `/program` | admin/collab | Lấy phase schedule + sub-events |
| PUT | `/program/current-phase` | admin | Set phase hiện tại |
| PATCH | `/program/phases/:phase_key` | admin | Sửa ngày/hint/label |
| POST | `/program/phases/:phase_key/sub-events` | admin | Tạo sub-event |
| PATCH | `/program/sub-events/:id` | admin | Sửa sub-event |
| DELETE | `/program/sub-events/:id` | admin | Xóa sub-event |

### Stations

| Method | Path | Role | Mục đích |
|---|---|---|---|
| GET | `/stations` | admin/collab | List stations theo phase/sub-event |
| POST | `/sub-events/:id/stations` | admin | Tạo station |
| PATCH | `/stations/:id` | admin | Sửa station |
| DELETE | `/stations/:id` | admin | Xóa station |
| POST | `/stations/:id/enter` | admin/collab | Team vào trạm bằng QR |
| POST | `/stations/:id/exit` | admin/collab | Team rời trạm |
| GET | `/stations/:id/visits` | admin/collab | Lịch sử vào/rời trạm |

Payload enter/exit:

```json
{
  "code": "t:qr_token_or_team_code",
  "score": 25,
  "note": "optional"
}
```

### Event check-in

| Method | Path | Role | Mục đích |
|---|---|---|---|
| POST | `/checkin` | admin/collab | Check-in sự kiện bằng QR |
| GET | `/checkins` | admin/collab | List đội đã check-in |
| GET | `/checkins/stats` | admin/collab | Stats check-in |
| DELETE | `/checkin/:team_id` | admin | Reset check-in |

Compatibility:

- `CheckinPage.jsx` hiện đang gọi đúng nhóm `/checkin`, `/checkins`, `/checkins/stats`, nên Phase 4 phải implement nhóm này trước.
- Có thể thêm API mới rõ nghĩa hơn:
  - `POST /event-checkins/scan`
  - `GET /event-checkins`
  - `GET /event-checkins/stats`
  - `DELETE /event-checkins/:id`
- Nếu thêm namespace mới, `/checkin` nên là wrapper/alias để giữ frontend hiện tại chạy được.

### Scores and advancement

| Method | Path | Role | Mục đích |
|---|---|---|---|
| GET | `/scores/phases/:phase_key` | admin/collab | Roster, ledger, leaderboard |
| POST | `/scores/entries` | admin hoặc collab nếu được bật | Tạo bonus/penalty/manual score |
| PATCH | `/scores/entries/:id` | admin | Sửa điểm |
| DELETE | `/scores/entries/:id` | admin | Xóa điểm |
| PUT | `/scores/phases/:phase_key/advancement` | admin | Cấu hình suất đi tiếp |
| POST | `/scores/phases/:phase_key/publish-advancement` | admin | Publish đội sang phase tiếp theo |

### Discord

| Method | Path | Role | Mục đích |
|---|---|---|---|
| GET | `/discord/status` | admin | Bot status |
| GET | `/discord/provisioning-queue` | admin | Đội pending/failed provisioning |
| POST | `/discord/teams/:team_id/provision` | admin | Ép provision/retry |
| GET | `/discord/members` | admin | List link web account - Discord |
| POST | `/discord/members/:mssv/sync` | admin | Sync lại role/nickname |
| POST | `/discord/broadcasts` | admin | Gửi broadcast |
| GET | `/discord/broadcasts` | admin | Lịch sử broadcast |

### Dashboard/settings/activity

| Method | Path | Role | Mục đích |
|---|---|---|---|
| GET | `/dashboard/overview?phase=` | admin/collab | KPI cho dashboard |
| GET | `/activity` | admin/collab | Feed hoạt động gần đây |
| GET | `/settings` | admin/collab | Xem settings |
| PUT | `/settings` | admin | Cập nhật settings |

## Thứ tự triển khai tính năng

### Phase 1: Chuẩn hóa auth, roles, routing

- Đổi backend role `member` thành `participant`.
- Đổi frontend constants/local checks từ `member` sang `participant`.
- API `/auth/me`, `/auth/login`, `/auth/signup`, `/auth/google`.
- Route guard:
  - participant chỉ vào `/participant`.
  - collab vào `/checkin`.
  - admin vào dashboard.

### Phase 2: Participant portal

- Database: `participants`, `teams`, `team_memberships`.
- API `/me/profile`, `/my-team`, `/my-team/members`, `/my-team/submit`.
- Nối `ParticipantDashboard.jsx` với API thật.
- Tạo `qr_token` khi team được tạo.

### Phase 3: Admin teams/accounts

- API teams CRUD + approve/reject.
- API accounts CRUD.
- Nối `TeamsPage.jsx`, `AccountsPage.jsx`.
- Dashboard registration KPIs lấy từ DB.

### Phase 4: Check-in sự kiện

- Database: `event_checkins`.
- API baseline: `/checkin`, `/checkins`, `/checkins/stats`, reset.
- API mở rộng sau: `/event-checkins/scan`, `/event-checkins`, `/event-checkins/stats`.
- Nối `CheckinPage.jsx` phần event mode.

### Phase 5: Program and stations

- Database: `program_phases`, `sub_events`, `stations`, `station_visits`.
- API `/program`, `/stations`, `/stations/:id/enter`, `/stations/:id/exit`.
- Thay localStorage trong `EventManagementPage.jsx`, `StationsPage.jsx`, station mode của `CheckinPage.jsx`.

### Phase 6: Scores and advancement

- Database: `score_entries`, `phase_rosters`, `advancement_rules`.
- API `/scores/...`.
- Nối `ScoreManagementPage.jsx`.

### Phase 7: Discord operations

- Dùng fields trên `teams` + `participants.discord_id`.
- API discord status/queue/retry/members/broadcast.
- Nối `DiscordPage.jsx`.

### Phase 8: Dashboard polish

- API `/dashboard/overview`, `/activity`.
- Gộp metrics thật cho dashboard theo phase.
- Bổ sung settings admin nếu cần.

## Quyết định cần chốt

1. `collab` có được nhập/sửa điểm không, hay chỉ check-in?
2. Mỗi participant chỉ được thuộc một đội trong toàn bộ mùa, hay có thể đổi đội theo phase?
3. QR của team dùng chung cho check-in sự kiện và trạm, hay trạm cần QR/session riêng?
4. Điểm trạm nhập lúc check-out hay nhập sau trong màn score?
5. Có cần upload file thật cho submission hay chỉ cấu hình yêu cầu nộp file trước?
