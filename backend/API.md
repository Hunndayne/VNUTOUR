## VNU Tour API (v1) – Tài liệu tiếng Việt

Base URL (dev)
- Mặc định: http://localhost:8080/api

Tài liệu này mô tả các API hiện có của dịch vụ web (Django) chạy song song với bot Discord. Toàn bộ request/response dùng JSON (UTF‑8).

Yêu cầu chung
- Header: `Content-Type: application/json`
- Nếu endpoint yêu cầu đăng nhập: header `Authorization: Bearer <token>`

Biến môi trường (env) quan trọng
- `ADMIN_REGISTER_SECRET`: chuỗi bí mật để cho phép đăng ký thêm tài khoản admin (khi đã có admin đầu tiên)
- `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS` (tùy môi trường triển khai)

———

Trạng thái hệ thống
- GET `/health`
  - 200: `{ "status": "ok" | "degraded", "time": "ISO8601" }`

Xác thực & tài khoản
- POST `/auth/login`
  - Body: `{ "username": "string", "password": "string" }`
  - 200: `{ "token": "<bearer-token>", "user": { "username": "...", "email": "...", "role": "admin|collab" } }`
  - 401: `{ "error": "invalid_credentials" }`

- GET `/auth/me`
  - Header: `Authorization: Bearer <token>`
  - 200: `{ "username": "...", "email": "...", "role": "admin|collab", "last_login": "ISO8601|null" }`
  - 401: `{ "error": "missing_token" | "invalid_token" }`
  - Cookie: nếu trình duyệt đã có cookie `token` (HttpOnly) từ `/auth/login` hoặc `/auth/register`, server sẽ tự đọc thay cho header.

- POST `/auth/register` (đăng ký admin)
  - Dùng để tạo tài khoản admin. Quy tắc an toàn:
    - Nếu CHƯA có admin nào: cho phép đăng ký admin đầu tiên mà không cần secret (bootstrap).
    - Nếu ĐÃ có admin: bắt buộc kèm secret đúng.
  - Body: `{ "username": "...", "password": "...", "email": "...", "secret": "<ADMIN_REGISTER_SECRET>" }`
    - Có thể gửi secret qua header `X-Register-Secret: <ADMIN_REGISTER_SECRET>` thay cho trường `secret`.
  - 201: `{ "token": "...", "user": { "username": "...", "email": "...", "role": "admin" } }`
  - 403: `{ "error": "forbidden", "detail": "secret_required" }` (khi thiếu hoặc sai secret)
  - 409: `{ "error": "conflict", "detail": "username_or_email_exists" }`

Quản trị tài khoản (chỉ admin)
- GET `/admin/accounts`
  - Header: `Authorization: Bearer <token_admin>`
  - Query:
    - `role=admin|collab` (lọc theo vai trò)
    - `active=1|0` (lọc theo trạng thái kích hoạt)
    - `page` (>=1), `limit` (<=200)
  - 200: `{ "items": [ { "username", "email", "role", "is_active", "last_login", "created_at", "updated_at" } ], "page", "limit", "total" }`

- POST `/admin/accounts`
  - Tạo tài khoản (mặc định role = `collab` nếu không gửi).
  - Body: `{ "username": "...", "password": "...", "email": "...", "role": "admin|collab" }`
  - 201: `{ "username", "email", "role", "is_active" }`
  - 409: `{ "error": "conflict", "detail": "username_or_email_exists" }`

- GET `/admin/accounts/{username}`
  - 200: chi tiết tài khoản
  - 404: không tìm thấy

- PATCH `/admin/accounts/{username}`
  - Cập nhật: `{ "role"?: "admin|collab", "is_active"?: true|false, "password"?: "..." }`
  - 200: thông tin mới nhất

- DELETE `/admin/accounts/{username}`
  - Vô hiệu hóa tài khoản (soft delete): `{ "status": "deactivated" }`

Thí sinh (Mongo – chỉ đọc)
- GET `/participants`
  - Header: `Authorization: Bearer <token>`
  - Query: `team_id`, `has_discord=1`, `page`, `limit`
  - 200: `{ "items": [ { ...fields từ sheet... } ], "page", "limit", "total" }`

- GET `/participants/{mssv}`
  - Header: `Authorization: Bearer <token>`
  - 200: một bản ghi tham gia viên
    - 404: `{ "error": "not_found" }`

Đội (Mongo)
- GET `/teams`
  - Header: `Authorization: Bearer <token>` (hoặc cookie `token`)
  - Query: `q` (lọc tên/ID, không phân biệt hoa thường), `has_discord=1` (chỉ đội có thành viên đã gán Discord ID), `page`, `limit`
  - 200: `{ "items": [ { ...team fields... } ], "page", "limit", "total" }`

- GET `/teams/{team_key}`
  - Header: `Authorization: Bearer <token>` (hoặc cookie `token`)
  - Query: `by=name|id` (mặc định `id`), `include_members=1` để trả danh sách thành viên rút gọn `{ mssv, full_name, faculty, school, discord_id? }`
  - 200: chi tiết đội, kèm `members` nếu yêu cầu
    - 404: `{ "error": "not_found" }`

Điểm danh QR
- QR payload do bot tạo qua lệnh `!teamqr`: dạng `t:<base64url(ObjectId(team._id))>` (không padding). Có thể gửi thẳng 24 ký tự ObjectId hex.
- POST `/checkin`
  - Header: `Authorization: Bearer <token>` (hoặc cookie `token`)
  - Body: `{ "code": "...", "scanner": "optional" }`
  - 200: `{ "team": { ... }, "members": [ { "mssv", "full_name", "faculty", "school" } ], "checked_in_at": "ISO8601", "checked_in_display": "HH:MM:SS dd/MM/YYYY GMT+0700" }`
  - 400: `{ "error": "missing_code" | "invalid_code" }`
  - 401: `{ "error": "missing_token" | "invalid_token" }`
  - 404: `{ "error": "not_found" }`
  - 409: `{ "error": "already_checked_in", "checked_in_at": "ISO8601", "checked_in_display": "HH:MM:SS dd/MM/YYYY GMT+0700" }`
  - Server lưu lịch sử vào Mongo collection `checkins`: `{ team_oid, team_id, team_name, created_at, meta: { scanner, ip, ua, by } }`, cập nhật trường `checked_in_at` trong document đội và gửi thông báo hoàn tất check-in vào text channel của đội (nếu có cấu hình `text_channel_id`).
- DELETE `/checkin/{team_key}`
  - Header: `Authorization: Bearer <token_admin>`
  - Admin-only: xóa trạng thái check-in của đội theo `_id`, `team_id` hoặc `team_name`.
  - 200: `{ "status": "reset", "team": { ... }, "affected_checkins": n, "unchecked": true|false }`
  - 403: `{ "error": "forbidden" }`
  - 404: `{ "error": "not_found" }`
- GET `/checkins`
  - Header: `Authorization: Bearer <token>`
  - Query: `q`, `page`, `limit`
  - 200: `{ "items": [ { "team", "members": [ ... ], "checked_in_at", "checked_in_display" } ], "page": n, "limit": n, "total": n }`
Ghi chú triển khai
- Nickname Discord được bot thay đổi khi assign/sync Sheet; API không thao tác nickname.
- Tất cả thời gian trả về theo ISO8601 UTC; UI có thể hiển thị GMT+7.
- Người dùng (admin/collab) được lưu chính trong SQLite (Django) và được đồng bộ bản tóm tắt sang MongoDB (`accounts`) để phục vụ phân tích/quan sát.

Ví dụ cURL
- Đăng nhập:
```
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"hunn","password":"28112005"}'
```

- Lấy danh sách tài khoản (admin):
```
curl http://localhost:8080/api/admin/accounts \
  -H "Authorization: Bearer <token>"
```
