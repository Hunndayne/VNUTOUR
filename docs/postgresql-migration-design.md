# Thiết kế PostgreSQL cho VNUTour

## Bối cảnh

Hệ thống đang build mới hoàn toàn và chưa có dữ liệu production cần giữ lại, nên không cần thiết kế cutover phức tạp từ MongoDB. Mục tiêu là dùng PostgreSQL làm nguồn dữ liệu chính ngay từ đầu, qua Django ORM, để dữ liệu đội, thành viên, tài khoản, duyệt đội, check-in và provisioning Discord có ràng buộc rõ ràng.

Định hướng:

- PostgreSQL là database chính cho cả Django API và Discord bot.
- Không cần giữ tương thích QR Mongo `ObjectId` cũ.
- Không cần dual-write Mongo/PostgreSQL.
- Không cần migration dữ liệu cũ, chỉ cần seed dữ liệu mặc định như admin/settings nếu cần.
- Tách lớp service/repository để API và bot không phụ thuộc chi tiết ORM ở khắp nơi.
- Không bỏ qua contract API hiện có trong `backend/webapi/api/urls.py`, `docs/api-endpoints.md`, `frontend/API.md`, `backend/API.md`, `backend/API_VI.md`. Các path đang dùng như `/auth/*`, `/my-team`, `/teams`, `/checkin`, `/checkins`, `/settings` nên được giữ hoặc có alias rõ ràng khi đổi tên.

## Kiến trúc đích

```mermaid
flowchart LR
    Web["React Web"] --> API["Django API"]
    API --> Service["Tour service"]
    Bot["Discord Bot"] --> Service
    Service --> PG[("PostgreSQL")]
    API --> Sheets["Google Sheets optional"]
    Bot --> Discord["Discord Guild"]
```

Các module chính:

- `backend/webapi/api/models.py`: Django models.
- `backend/src/utils/tour_store.py`: service/repository dùng chung cho API và bot.
- `backend/webapi/api/views.py`: chỉ xử lý HTTP/auth/response, gọi service.
- `backend/src/bot/team_cog.py`: poll đội đã duyệt và gọi provisioning.
- `backend/src/utils/provisioning.py`: tạo role/kênh Discord, cập nhật trạng thái vào PostgreSQL.

## Data model đề xuất

### Account

Giữ vai trò tài khoản đăng nhập và phân quyền.

Field:

- `username`: unique.
- `email`: unique.
- `password_hash`.
- `role`: `participant`, `admin`, `collab`.
- `is_active`.
- `token`: unique nullable.
- `mssv`: unique nullable.
- `full_name`: nullable.
- `created_at`, `updated_at`, `last_login`.

Gợi ý:

- Đội trưởng không cần role riêng. Đội trưởng là `participant` sở hữu một `Team`.
- Không dùng `team_oid`. Dùng quan hệ trực tiếp từ `Team.owner`.

### Participant

Hồ sơ người tham gia tour.

Field:

- `mssv`: unique, bắt buộc.
- `full_name`.
- `email`: nullable, index.
- `phone`.
- `faculty`.
- `school`.
- `facebook`.
- `discord_id`: nullable.
- `account`: OneToOneField tới `Account`, nullable.
- `created_at`, `updated_at`.

Ràng buộc:

- unique `mssv`.
- unique `discord_id` khi khác null.

Không lưu `team_id`/`team_name` trực tiếp trong Participant. Quan hệ đội nằm ở `TeamMembership`.

### Team

Đội thi/đội tham gia.

Field:

- `code`: unique, ví dụ `T0001`. API có thể trả field này là `team_id`.
- `name`. API có thể trả field này là `team_name`.
- `owner`: ForeignKey tới `Account`, nullable.
- `approval_status`: `draft`, `pending_approval`, `approved`, `rejected`.
- `approval_note`: nullable.
- `submitted_at`, `reviewed_at`.
- `reviewed_by`: ForeignKey tới `Account`, nullable.
- `qr_token`: unique, dùng cho QR check-in.
- `checked_in_at`: nullable.
- `provision_state`: `pending`, `done`, `failed`, nullable.
- `provision_last_error`: nullable text.
- `provision_retry_count`: integer default 0.
- `last_provisioned_at`: nullable.
- `discord_role_id`, `text_channel_id`, `voice_channel_id`: nullable.
- `created_at`, `updated_at`.

Ràng buộc:

- unique `code`.
- unique `qr_token`.
- một account chỉ sở hữu tối đa một team active.
- check constraint cho `approval_status`.
- check constraint cho `provision_state`.

Index:

- `approval_status`.
- `provision_state`.
- `checked_in_at`.
- `name` nếu cần search.

### TeamMembership

Bảng nối đội và participant.

Field:

- `team`: ForeignKey tới `Team`.
- `participant`: ForeignKey tới `Participant`.
- `is_captain`: boolean default false.
- `team_number`: integer nullable.
- `created_at`, `updated_at`.

Ràng buộc:

- unique `(team, participant)`.
- nếu mỗi participant chỉ được ở một đội: unique `participant`.
- nếu mỗi đội chỉ có một captain: partial unique `team where is_captain = true`.

### CheckIn

Lịch sử check-in.

Field:

- `team`: ForeignKey tới `Team`.
- `scanner`: ForeignKey tới `Account`, nullable.
- `station`: nullable string.
- `ip`: nullable string.
- `user_agent`: nullable text.
- `meta`: JSONField default dict.
- `created_at`.

Ràng buộc:

- Nếu mỗi đội chỉ check-in một lần, đặt unique `team`.
- Khi check-in thành công, tạo `CheckIn` và set `Team.checked_in_at` trong cùng transaction.
- Khi reset check-in, xóa `CheckIn` và set `Team.checked_in_at = null`.

### SystemSetting

Thay Mongo `meta`.

Field:

- `key`: unique.
- `value`: JSONField.
- `updated_at`.

Key mặc định:

```json
{
  "registration_open": false,
  "sheet_import_enabled": false,
  "sheet_checkin_export_enabled": false,
  "team_max_members": 5
}
```

### Team code sequence

Dùng PostgreSQL sequence hoặc bảng counter trong transaction để sinh mã đội.

Ví dụ:

```sql
CREATE SEQUENCE team_code_seq START WITH 1;
```

Service sinh:

```python
n = nextval("team_code_seq")
code = f"T{n:04d}"
```

Vì build mới không có dữ liệu cũ, sequence có thể bắt đầu từ `1`.

## QR check-in

Không cần encode Mongo ObjectId.

Đề xuất:

- Khi tạo team, sinh `qr_token = secrets.token_urlsafe(16)`.
- QR payload: `t:<qr_token>`.
- Endpoint `/api/checkin` decode token, tìm `Team.qr_token`.
- Không expose primary key database trong QR.

Ưu điểm:

- Không phụ thuộc loại database.
- Có thể rotate QR token nếu bị lộ.
- Dễ giữ ổn định dù đổi ID nội bộ.

## Service/repository layer

Nên có một service dùng chung để API và bot gọi cùng logic.

Đề xuất file: `backend/src/utils/tour_store.py`.

Interface tối thiểu:

- `is_healthy()`
- `get_settings()`
- `set_settings(patch)`
- `create_team(name, owner)`
- `find_team_by_key(key)`
- `find_team_by_qr_token(token)`
- `submit_team(team, by_account)`
- `approve_team(team, reviewer)`
- `reject_team(team, reviewer, note)`
- `upsert_participant(data)`
- `add_team_member(team, participant_data)`
- `update_team_member(team, mssv, data)`
- `remove_team_member(team, mssv)`
- `assign_discord_by_mssv(mssv, discord_id)`
- `insert_checkin(team, scanner, meta)`
- `reset_checkin(team)`
- `list_checkedin_teams(filters, pagination)`
- `get_checkin_stats()`
- `get_pending_provision_teams(limit)`
- `mark_provision_done(team, result)`
- `mark_provision_failed(team, error)`

Views chỉ nên làm:

- parse request.
- auth/permission.
- gọi service.
- serialize response.

Bot chỉ nên làm:

- poll service lấy team `provision_state = pending`.
- gọi provisioning Discord.
- báo kết quả lại service.

## API shape

Để frontend dễ dùng, vẫn có thể giữ tên response hiện tại:

- `Team.code` serialize thành `team_id`.
- `Team.name` serialize thành `team_name`.
- Members lấy từ `TeamMembership`, nhưng có thể trả thêm `members_mssv` nếu frontend đang cần.
- `approval_status`, `approval_note`, `provision_state`, `checked_in_at` giữ nguyên.

Các flow chính:

1. Participant signup.
2. Participant tạo team.
3. Participant thêm/sửa/xóa member khi team còn editable.
4. Participant submit team.
5. Admin approve/reject.
6. Bot provision team sau khi approved.
7. Collab/admin check-in bằng QR.
8. Admin reset check-in nếu cần.

## PostgreSQL config

Dependency:

```txt
psycopg[binary]>=3.2
dj-database-url>=2.2
```

Env:

```env
DATABASE_URL=postgresql://vnutour:change-me@localhost:5432/vnutour
```

`docker-compose.yml` nên thêm:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: vnutour
      POSTGRES_USER: vnutour
      POSTGRES_PASSWORD: change-me
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vnutour -d vnutour"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres_data:
```

Django settings:

- Đọc `DATABASE_URL` nếu có.
- Fallback SQLite chỉ dùng local/dev nếu muốn.
- Khi deploy thật, bắt buộc dùng PostgreSQL.

## Thứ tự triển khai khuyến nghị

1. Thêm PostgreSQL dependency, env config và docker service.
2. Viết lại Django models cho `Participant`, `Team`, `TeamMembership`, `CheckIn`, `SystemSetting`.
3. Tạo migrations mới.
4. Viết serializer để response giống API hiện tại.
5. Viết `tour_store.py`.
6. Refactor endpoint settings sang service.
7. Refactor endpoint participants/teams/my-team sang service.
8. Refactor check-in sang service + transaction.
9. Refactor bot/provisioning sang service.
10. Bỏ `MongoManager`, `pymongo`, `bson` khỏi runtime chính.
11. Seed admin/settings mặc định.
12. Chạy smoke test toàn flow.

## Smoke test cần có

- `GET /api/health` báo database OK.
- Admin login.
- Participant signup khi `registration_open = true`.
- Participant tạo team nhận `team_id = T0001`.
- Participant thêm thành viên.
- Participant submit team.
- Admin duyệt team.
- Bot thấy team pending và cập nhật `provision_state`.
- QR `t:<qr_token>` check-in thành công.
- Check-in lần hai trả lỗi already checked in.
- Admin reset check-in.
- Stats trả đúng số team/thành viên đã check-in.

## Lưu ý thiết kế

- PostgreSQL không chỉ để thay Mongo, mà để bỏ các field lặp như `members_mssv`, `team_id`, `team_name` trong participant.
- Những dữ liệu phụ, ít cần query như check-in metadata hoặc system settings dùng JSONField là hợp lý.
- Những quan hệ nghiệp vụ như team-member, owner-team, check-in-team nên dùng foreign key thật.
- QR nên dùng token riêng, không dùng database primary key.
- Các thao tác check-in, approve, member edit nên nằm trong transaction để không lệch trạng thái.
