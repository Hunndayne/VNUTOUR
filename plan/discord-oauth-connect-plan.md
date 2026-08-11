# Kế hoạch: nút "Kết nối Discord" bằng OAuth (thay cho gõ `!assign`)

## Bối cảnh & mục tiêu

Hiện thí sinh phải gõ `!assign <mssv>` (hoặc `/assign`) trong Discord để gắn tài
khoản Discord với hồ sơ web. Cả hai lệnh đều gọi
`claim_discord_identity(mssv, discord_id)` (`webapi/api/services/discord_service.py`).

Vấn đề gặp năm ngoái: phía Discord thì được xác thực (ai gõ lệnh), nhưng **MSSV là
chữ gõ tay** → không có gì đảm bảo tài khoản Discord đó thật sự là chủ MSSV. Web-account
và Discord-account dễ "lệch" mà không ai phát hiện.

Mục tiêu: thêm nút **"Kết nối Discord"** trên web (cổng thí sinh). Vì người dùng đã
đăng nhập web (danh tính thật đã biết qua `account.mssv`), OAuth chỉ cần lấy thêm danh
tính Discord đã xác thực → gắn hai đầu đều đã xác thực, **không phải gõ MSSV**.

## Quyết định thiết kế (đã chốt với chủ dự án)

1. **Bắt buộc vào server Discord trước**, rồi mới kết nối. Dùng scope `identify` (KHÔNG
   dùng `guilds.join` — không tự kéo vào server).
2. **Giữ song song** cả `!assign`/`/assign` lẫn nút OAuth. OAuth là cách khuyến nghị,
   lệnh là dự phòng.
3. Sau khi kết nối, hiển thị **tên tài khoản Discord** để thí sinh tự đối chiếu đúng
   tài khoản của mình.
4. Phát hiện trạng thái **"đã kết nối nhưng chưa thấy trong server"**. Khi ở trạng thái
   này **vẫn hiển thị đủ quy trình** (các bước join + kết nối) như lúc chưa kết nối —
   không coi là hoàn tất cho tới khi bot thấy họ trong guild.

Lý do (2): `claim_discord_identity` đã chống-cướp (không `force` thì không ghi đè liên
kết đã có), nên đường OAuth an toàn; đường lệnh chỉ còn rủi ro với ai *chỉ* dùng lệnh.

Lý do (4): `provision_team` bỏ qua **im lặng** người chưa ở trong guild
(`src/utils/provisioning.py:136` — `if member is None: continue`). Nếu không báo trạng
thái, thí sinh sẽ tưởng đã xong mà thực ra bot không cấp được role/kênh.

## Luồng

```
Thí sinh (đã đăng nhập web) đã join server
   │  bấm "Kết nối Discord"
   ▼
FE tạo state ngẫu nhiên (sessionStorage) → redirect tới
   discord.com/oauth2/authorize?client_id=…&scope=identify&state=…&redirect_uri=<origin>/participant
   │  thí sinh Authorize
   ▼
Discord redirect về <origin>/participant?code=…&state=…
   │  FE kiểm tra state khớp → POST /api/auth/me/discord {code, redirect_uri} (kèm Bearer JWT)
   ▼
BE đổi code→token → GET /users/@me → lấy discord_id + username
   → resolve participant qua account.mssv của người đang đăng nhập
   → claim_discord_identity(mssv, discord_id, discord_username=…)
   ▼
BE trả trạng thái; FE gọi lại /auth/me/discord/status để hiển thị (in_server?, username)
```

CSRF: `state` sinh và kiểm ở phía FE (sessionStorage). Lệnh POST đã được xác thực bằng
JWT của chính thí sinh nên BE luôn gắn vào đúng account đang đăng nhập.

## Backend

### Model
- `Participant.discord_username = CharField(max_length=64, null=True, blank=True)` — lưu
  handle Discord lúc kết nối để web hiển thị đối chiếu. Migration `0026`.

### `discord_service.py`
- `claim_discord_identity(..., discord_username=None)` — thêm tham số tuỳ chọn; khi có
  thì lưu `discord_username`. Giữ nguyên chữ ký cũ cho bot (đang gọi không kèm username).
- `release_discord_identity(mssv)` — gỡ liên kết (xoá `discord_id`/`discord_username`) và
  đặt lại team về `PROVISION_PENDING` để bot gỡ role.

### `services/discord_oauth_service.py` (mới, dùng `requests`)
- `oauth_config()` → `{configured, client_id, scope, invite_url}`.
- `exchange_code(code, redirect_uri)` → đổi authorization code lấy access token.
- `fetch_discord_user(access_token)` → `GET /users/@me`.
- `lookup_guild_member(discord_id)` → dùng `DISCORD_TOKEN` (Bot) +
  `DISCORD_GUILD_ID` gọi `GET /guilds/{guild}/members/{user}`; 200→trong server (kèm
  nick/username mới nhất), 404→không; None nếu thiếu cấu hình (không chặn luồng).

### Views (`views_auth.py`) + URLs (`urls_auth.py`)
- `POST /api/auth/me/discord` — link (đổi code → @me → claim). Validate `redirect_uri`
  theo allowlist. Yêu cầu account có `mssv` + có `Participant`.
- `DELETE /api/auth/me/discord` — unlink (`release_discord_identity`).
- `GET /api/auth/me/discord/status` — trả:
  `{ oauth:{configured,client_id,scope}, invite_url, linked, discord_id,
     discord_username, in_server: true|false|null, provisioned }`.

### Env mới (tài liệu ở `.env` examples + k8s)
- `DISCORD_CLIENT_ID` (không bí mật), `DISCORD_CLIENT_SECRET` (→ `backend-secret`),
  `DISCORD_OAUTH_REDIRECT_URIS` (allowlist, phẩy ngăn cách: prod + `http://localhost:5173/participant`),
  `DISCORD_INVITE_URL` (link mời server cho bước "vào server").
- Dùng lại `DISCORD_TOKEN`, `DISCORD_GUILD_ID` cho phần kiểm tra thành viên (đảm bảo
  deployment của API cũng có 2 biến này).

## Frontend

- `DiscordConnectCard.jsx` (mới, tự chứa): mount → gọi `/auth/me/discord/status`; bắt
  callback (`code`+`state` trên URL) → đổi qua BE → dọn URL bằng `navigate(replace)`.
  Ba trạng thái:
  - **Chưa kết nối**: bước 1 "Vào máy chủ" (invite) → bước 2 nút "Kết nối Discord".
  - **Đã kết nối nhưng chưa vào server**: hiện `@username` để đối chiếu + nút "Kết nối
    lại bằng tài khoản khác"; cảnh báo chưa thấy trong server; **vẫn hiện đủ quy trình**.
  - **Đã kết nối & đã vào server**: trạng thái hoàn tất, kèm `@username`.
- Nhúng vào `ParticipantDashboard` (1 import + đặt card). Không thêm route mới:
  `redirect_uri = <origin>/participant`.

## Bot
- Không đổi. `!assign`/`/assign` giữ nguyên làm dự phòng.

## Test
- `tests/test_discord_oauth_api.py`: mock `requests` cho exchange/@me/guild-member;
  kiểm tra link gọi `claim_discord_identity` + lưu username; unlink; status ba nhánh
  (in_server true/false/None).

## Phụ thuộc chỉ chủ dự án làm được
- Tạo OAuth2 credentials + redirect URI trong **Discord Developer Portal**
  (`CLIENT_ID`, `CLIENT_SECRET`), thêm redirect `…/participant` cho cả prod và dev.
- Trên k8s: thêm `DISCORD_CLIENT_SECRET` vào `backend-secret`; các biến còn lại vào
  `backend-config`.

## Ngoài phạm vi (đợt sau)
- Tự kéo vào server bằng scope `guilds.join`.
- UI `editassign` (admin ép chuyển liên kết) trên web.
