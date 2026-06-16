# API Tour VNU (v1)

Base URL
- Production: https://api.vnutour.hunn.io.vn/v1

Tài liệu này mô tả HTTP API phục vụ webapp/staff và dịch vụ liên quan. Mục tiêu: đơn giản, an toàn, mở rộng tốt cho ~500 người (~100 đội).

Nguyên tắc
- JSON thuần: request/response là JSON UTF-8
- Xác thực JWT: access token ngắn hạn + refresh token
- RBAC: admin, coordinator, station_staff, viewer
- Ghi idempotent: tránh trùng bằng Idempotency-Key hoặc khóa duy nhất logic
- Múi giờ: server lưu UTC; client hiển thị GMT+7

Xác thực
- POST /auth/login
  - Body: { "username": "string", "password": "string" }
  - 200: { "access_token", "refresh_token", "expires_in", "user": { "id", "role", "station_ids": ["S1", ...] } }
- GET /auth/me — trả thông tin người dùng/role/quyền
- POST /auth/refresh (tuỳ chọn) — cấp access token mới
- Vai trò
  - admin: toàn quyền
  - coordinator: quản lý cộng tác viên, trạm; xem tất cả
  - station_staff: được ghi checkin/checkout/rollcall cho các trạm được gán
  - viewer: chỉ đọc

Headers chuẩn
- Authorization: Bearer <access_token>
- Content-Type: application/json
- Idempotency-Key: <uuid> (khuyến nghị cho các endpoint ghi)

Mẫu lỗi (Error envelope)
- Với mọi phản hồi không phải 2xx:
  { "error": { "code": "string", "message": "diễn giải", "details": {..} }, "correlation_id": "uuid" }
- Ví dụ code: invalid_credentials, permission_denied, not_found, conflict, validation_error

Thực thể (Entities)
- Participant (đồng bộ từ Google Sheet)
  - mssv, full_name, email, phone, faculty, school, facebook, team_id, team_name, team_number, is_captain, discord_id?
- Team
  - team_id, team_name, role_id?, text_channel_id?, voice_channel_id?
- Contributor (staff)
  - id, name, email, role, station_ids[]
- Station
  - station_id, name, location?, active?, order?
- Bản ghi sự kiện (Records)
  - id, team_id, station_id, type: (checkin|checkout|rollcall), score?, note?, created_at (UTC), window?

QR định danh theo đội
- Bot tạo QR theo đội và đăng trong kênh đội. Payload QR là chuỗi tĩnh có chữ ký.
- Định dạng: "v=1;tid=<team_id>;sig=<sig>"
  - sig = base64url( HMAC-SHA256(TEAM_QR_SECRET, bytes("team:" + team_id)) )[0:16]
  - TEAM_QR_SECRET: bí mật dùng chung giữa Bot và Backend
- Kiểm tra chữ ký (giả mã Python):
  - Parse các cặp khoá: v, tid, sig
  - expected = base64url(hmac_sha256(secret, f"team:{tid}")[0:16])
  - so sánh constant-time expected == sig

Các endpoint đọc (GET)
- GET /health
  - 200 { status: "ok" }
- GET /participants
  - Query: q (tìm kiếm), team_id, page, page_size
  - 200 { data: [Participant], meta: { total, page, page_size, page_count } }
- GET /participants/{mssv}
  - 200 { data: Participant }
- GET /teams
  - Query: q, page, page_size
  - 200 { data: [Team], meta: {...} }
- GET /teams/{team_id}
  - 200 { data: Team }
- GET /teams/{team_id}/members
  - 200 { data: [Participant] }
- GET /teams/{team_id}/status
  - 200 { data: { checkins: [Record], checkouts: [Record], rollcalls: [Record] } }
- GET /stations
  - 200 { data: [Station] }
- GET /stations/{station_id}
  - 200 { data: Station }
- GET /contributors (admin, coordinator)
  - 200 { data: [Contributor] }
- GET /contributors/{id}
  - 200 { data: Contributor }

Các endpoint ghi (POST/PATCH)
- POST /checkins
  - Quyền: station_staff (được gán trạm) hoặc admin
  - Headers: Idempotency-Key khuyến nghị
  - Body: { team_id: "2548", station_id: "S4", qr_payload: "v=1;tid=2548;sig=..." }
  - Server: verify QR, kiểm tra quyền trạm, enforce idempotency với khoá duy nhất (team_id, station_id, window=ngày), set created_at=UTC
  - 201 { data: Record } — 200 nếu idempotent duplicate; 409 nếu duplicate không idempotent
- POST /rollcalls (tuỳ chọn; nếu muốn tách khỏi checkin)
  - Body: { team_id, station_id, qr_payload }
  - Idempotency tương tự checkins
- POST /checkouts
  - Quyền: station_staff hoặc admin
  - Body: { team_id, station_id, score?: number, note?: string }
  - 201 { data: Record }
- POST /contributors (admin)
  - Tạo tài khoản staff: { name, email, role, station_ids?: [] }
- PATCH /contributors/{id} (admin)
  - Cập nhật role/stations: { role?: "station_staff"|"coordinator"|"admin", station_ids?: [] }
- POST /auth/login — xem phần Xác thực
- POST /auth/refresh (tuỳ chọn)

Chiến lược idempotency
- Dùng Idempotency-Key (UUID) trong header cho /checkins, /rollcalls, /checkouts
- Hoặc dùng unique index theo logic, ví dụ:
  - checkins: unique(team_id, station_id, yyyymmdd)
  - rollcalls: unique(team_id, station_id, yyyymmdd)
  - checkouts: unique(team_id, station_id, round?) hoặc yyyymmdd tuỳ luật chơi
- Khi trùng: trả 200 với bản ghi cũ (idempotent) hoặc 409 (conflict) — chọn một cách nhất quán

Bảo mật
- HTTPS bắt buộc, CORS whitelist theo domain nội bộ/staff
- Rate-limit: ví dụ 60 req/phút/người dùng và 120 req/phút/IP cho endpoint ghi
- Audit log mọi thao tác ghi: actor_id, role, station_id, ip, user_agent, ts, action, payload_hash
- Bí mật: lưu TEAM_QR_SECRET và JWT secret trong secret manager/env

Ví dụ
- POST /checkins
  - Request
    {
      "team_id": "2548",
      "station_id": "S4",
      "qr_payload": "v=1;tid=2548;sig=HuP1_1o0Q2m2o6kY2gkJtA"
    }
  - Response 201
    {
      "data": {
        "id": "ck_01j23...",
        "type": "checkin",
        "team_id": "2548",
        "station_id": "S4",
        "created_at": "2025-09-14T03:12:45Z"
      }
    }
- PATCH /contributors/{id}
  - Request
    { "role": "station_staff", "station_ids": ["S3","S4"] }

Phân trang & lọc
- Query: page (bắt đầu từ 1), page_size (<=100), q (tìm kiếm), sort (VD: -updated_at)
- meta: { total, page, page_size, page_count }

Leaderboard (tuỳ chọn)
- GET /leaderboard?by=stations|score
  - 200 { data: [ { team_id, team_name, value } ] }

OpenAPI
- Có thể sinh OpenAPI 3.1 từ tài liệu này; giữ operationIds và securitySchemes(JWT) nhất quán với danh sách endpoint trên.

Ghi chú
- Lưu toàn bộ thời gian ở server theo UTC. UI hiển thị GMT+7.
- Bot và API nên dùng chung TEAM_QR_SECRET để verify QR nhất quán.
- Nếu webapp đọc cùng MongoDB với bot, nên cấp account chỉ đọc; ghi nên đi qua API hoặc user có quyền hạn chế.
