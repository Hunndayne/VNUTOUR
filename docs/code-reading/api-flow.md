# VNUTour — Luồng thực thi (API Flow Tracing)

## 1. Luồng Đăng ký & Duyệt đội (Registration & Team Approval)

```
[Browser] POST /api/register
    │
    ▼
views_register.py::register_view()
    │  • Đọc registration_schema từ SystemSetting
    │  • Validate required fields
    │
    ▼
registration_service.py::create_registration()
    │  • Tạo Participant record
    │  • Tạo Team record (approval_status = "pending_approval")
    │  • Tạo TeamMembership cho captain
    │  • Thêm đội vào PhaseRoster của phase hiện tại
    │
    ▼
[DB] Lưu: participant, team, team_membership, phase_roster
    │
    ▼
[Admin] GET /api/admin/teams/ → AdminDashboard::TeamsPage
    │  • Xem danh sách đội pending
    │
    ▼
[Admin] POST /api/admin/teams/{id}/approve/
    │
    ▼
views_admin.py → team_service.py::approve_team()
    │  • approval_status → "approved"
    │  • provision_state → "pending"
    │  • Ghi AuditLog
    │
    ▼
[Discord Bot] team_cog.py (heartbeat loop, mỗi ~10s)
    │  • Poll DB: teams WHERE provision_state="pending"
    │  • Tạo Discord role + text/voice channel
    │  • Lưu discord_role_id, text_channel_id, voice_channel_id
    │  • provision_state → "done"
    │
    ▼
[Email Worker] email_service.py
    │  • Gửi email xác nhận cho captain
    └─►[SMTP]
```

---

## 2. Luồng Check-in tại Trạm (QR Scan Check-in)

```
[Collab Browser] CoopDashboard.jsx
    │  • Mở camera (qr-scanner library)
    │  • Scan QR code → decode payload
    │
    ▼
POST /api/checkin/station/enter/
    body: { qr_token, station_id }
    header: Authorization: Bearer <collab_token>
    │
    ▼
views_checkin.py::station_enter_view()
    │  • Xác thực collab token
    │  • Kiểm tra assignment: collab có được phân vào station này không?
    │
    ▼
checkin_service.py::station_enter()
    │  • Validate phase hiện tại (từ ProgramPhase.is_current)
    │  • Lookup Team qua qr_token
    │  • Check capacity: station.max_concurrent_teams
    │  • Check replay rule: SubEvent.replay_after_all
    │  • Kiểm tra StationSession active (UniqueConstraint: 1 active/station/team)
    │
    ▼
[DB] INSERT StationSession (status="active", entered_at=now)
    │
    ▼
[API Response] → Frontend cập nhật UI (team đã vào trạm)

    ... [Team hoàn thành nhiệm vụ] ...

[Collab] POST /api/checkin/station/exit/
    body: { session_id, score, outcome }
    │
    ▼
checkin_service.py::station_exit()
    │  • Update StationSession: status="closed", exited_at=now
    │  • outcome = "passed"/"failed"/"pending"
    │
    ▼
score_service.py::record_station_score()
    │  • INSERT ScoreEntry (kind="station", points=score)
    │  • Tính tổng điểm team cho phase
    │
    ▼
[DB] UPDATE station_session + INSERT score_entry
    │
    ▼
[Frontend] Leaderboard tự refresh → hiển thị điểm mới
```

---

## 3. Luồng Xác thực (Authentication)

```
[Browser] POST /api/auth/login
    body: { email, password }
    │
    ▼
views_auth.py::login_view()
    │
    ▼
auth_service.py::authenticate()
    │  • Lookup Account by email
    │  • Verify password_hash (bcrypt/similar)
    │  • Generate token (random 128 chars), lưu token_created_at
    │
    ▼
[DB] UPDATE account SET token=..., token_created_at=...
    │
    ▼
[Response] { token, user: {id, role, username, ...} }
    │
    ▼
[Frontend api.js]
    │  • localStorage.setItem('authToken', token)
    │  • localStorage.setItem('user', JSON.stringify(user))
    │  • redirect theo role: /admin, /coop, /participant
```

**Google OAuth:**

```
[Browser] → Google OAuth Popup
    │  • Google trả về id_token
    │
    ▼
POST /api/auth/google/
    body: { id_token }
    │
    ▼
auth_service.py + google-auth library
    │  • Verify id_token với Google
    │  • Lookup/tạo Account theo google_sub
    │  • Trả về token như login thường
```

---

## 4. Luồng Liên kết Discord (Discord Connect)

```
[Participant] → Frontend DiscordConnectCard.jsx
    │  • Click "Liên kết Discord"
    │
    ▼
discordConnect.js::startDiscordOAuth()
    │  • Mở Discord OAuth popup (scope: identify)
    │
    ▼
discord_oauth_service.py::handle_callback()
    │  • Exchange code → Discord access token
    │  • Fetch Discord user (id, username)
    │  • Link Participant.discord_id = discord_id
    │  • Ghi MssvLinkAudit
    │
    ▼
[Discord Bot] team_cog.py (polling MssvLinkAudit)
    │  • Phát hiện discord_notified = False
    │  • Gửi DM thông báo cho user Discord
    │  • Assign Discord role cho team
    │  • discord_notified → True
```

---

## 5. Luồng Broadcast Discord

```
[Admin] EmailPage.jsx / DiscordPage.jsx
    │  • Soạn tin nhắn, chọn target (all/approved/pending/team_ids)
    │
    ▼
POST /api/discord/broadcast/
    │
    ▼
discord_service.py::create_broadcast()
    │  • INSERT DiscordBroadcast (status="draft")
    │
    ▼
POST /api/discord/broadcast/{id}/send/
    │
    ▼
discord_service.py::queue_broadcast()
    │  • status → "sending"
    │
    ▼
[Discord Bot] team_cog.py (heartbeat)
    │  • Poll DiscordBroadcast WHERE status="sending"
    │  • Resolve target → list of Discord channel/user IDs
    │  • Gửi message đến từng channel
    │  • status → "sent", sent_at = now
```

---

## 6. Luồng Nộp bài tại Trạm (Station Submission)

```
[Participant] FormResponses.jsx / StationRunPage.jsx
    │  • Mở form submission của trạm
    │  • station.submission_config = JSON schema của form
    │
    ▼
GET /api/participant/station/{id}/form/
    │  • Trả về form config + variant (random questions)
    │
    ▼
[Frontend] Render form động từ submission_config
    │  • Text, multiple choice, file upload, quiz
    │  • TeamFormVariant: nếu quiz có randomCount → lấy variant đã lưu
    │  • TeamFormDraft: autosave câu trả lời (shared giữa các thành viên)
    │
    ▼
POST /api/participant/station/{id}/submit/
    │
    ▼
submission_storage_service.py → StationSubmission
    │  • status = "submitted"
    │  • response_payload = JSON câu trả lời
    │  • attachment_payload = {files: [...]}
    │  • Nếu quiz: tự chấm is_correct
    │
    ▼
[Admin] StationsPage.jsx → Xem danh sách submission
    │  • Chấm điểm thủ công (nếu không tự chấm)
    │
    ▼
PATCH /api/admin/submission/{id}/grade/
    │  • StationSubmission.score = N, status="graded"
    │  • INSERT ScoreEntry (kind="station")
```

---

## 7. Short Link Redirect

```
[User] Browser → /s/<code>
    │
    ▼
[Nginx] try_files → Forward to Django (nginx.conf proxy rule)
    │
    ▼
views_shortlink.py
    │  • Lookup ShortLink by code
    │  • Tăng click_count
    │  • Response: HTTP 302 → target_url
```

---

## Entry Points tóm tắt

| Entry Point   | File                            | Mô tả              |
| ------------- | ------------------------------- | ------------------ |
| Backend start | `backend/main.py::main()`       | Khởi Django + Bot  |
| Django WSGI   | `webapi/serverapi/wsgi.py`      | Production entry   |
| Bot start     | `src/bot/bot.py::VnuTourBot`    | Discord bot        |
| Email worker  | `manage.py process_email_queue` | Management command |
| Frontend      | `frontend/src/main.jsx`         | React mount        |
| Router        | `frontend/src/App.jsx`          | Route dispatch     |
