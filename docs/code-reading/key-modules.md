# VNUTour — Phân tích Module chi tiết

## Backend: Discord Bot

### `src/bot/bot.py` — VnuTourBot
- Class kế thừa `discord.ext.commands.Bot`
- Tự động tải tất cả Cog từ `src/commands/` và `src/events/`
- `run_bot()` → `bot.run(DISCORD_TOKEN)`

### `src/bot/team_cog.py` — TeamCog (quan trọng nhất)
Chứa heartbeat loop chạy mỗi N giây:
- **provision_loop**: Poll `Team` có `provision_state="pending"` → tạo Discord role + channel → `provision_state="done"`
- **broadcast_loop**: Poll `DiscordBroadcast` có `status="sending"` → gửi message → `status="sent"`
- **mssv_link_loop**: Poll `MssvLinkAudit` có `discord_notified=False` → DM thông báo
- **heartbeat**: Ghi timestamp vào DB, dùng để monitor bot còn sống không

### `src/bot/database.py` — Async Bridge
Django ORM là synchronous nhưng Discord bot chạy async event loop.  
`database.py` cung cấp helper để chạy Django DB queries trong thread pool:
```python
result = await run_sync(lambda: Team.objects.filter(...))
```

---

## Backend: Django API

### `webapi/api/models.py` — 1129 dòng
File duy nhất chứa toàn bộ 23 models. Không có model file riêng theo domain.
Các constraints quan trọng (UniqueConstraint):
- `uq_program_phase_single_current`: Chỉ 1 phase `is_current=True`
- `uq_active_session_station_team`: 1 session active/station/team
- `uq_active_session_event_team`: 1 session active/event/team (ngăn team ở 2 trạm cùng lúc)
- `uq_active_checkin_event_team`: 1 checkin active/event/team
- `uq_membership_participant`: 1 participant chỉ trong 1 team

### `webapi/api/services/registration_service.py` — 21KB
Service lớn nhất sau `discord_service`. Xử lý:
- Schema-driven form validation từ `SystemSetting.registration_schema`
- Tạo `Participant` + `Team` + `TeamMembership` + `PhaseRoster` trong 1 transaction
- Late registration support

### `webapi/api/services/discord_service.py` — 22KB
Service lớn nhất. Quản lý tất cả tương tác với Discord:
- Provision queue (tạo role/channel)
- Broadcast queue
- Fetch Discord member list
- Role assignment

### `webapi/api/services/station_service.py` — 20KB
Logic phức tạp nhất trong domain trạm:
- Session lifecycle (enter/exit)
- Capacity checking
- Replay rule (`replay_after_all`)
- Queue management khi trạm đầy

### `webapi/api/services/score_service.py` — 14KB
- Tính điểm sau mỗi session
- Leaderboard query (tổng điểm theo phase/sub-event)
- Manual score entry (bonus/penalty)
- Score lock (khóa kết quả)

---

## Frontend: Những file lớn cần chú ý

### `StationsPage.jsx` — 119KB (lớn nhất!)
Quản lý trạm trong Admin dashboard. Bao gồm:
- CRUD station + sub-event
- Xem danh sách session active
- Grading submission
- Leaderboard view
- Station assignment (phân công collab)

### `ParticipantDashboard.jsx` — 108KB
Dashboard participant. Bao gồm:
- Profile management
- Team info, thành viên
- Điểm số theo từng trạm
- Form nộp bài tích hợp
- Discord connect
- Bầu đội trưởng (CaptainVote)

### `AdminDashboard.jsx` — 54KB
Router cho tab admin. Render sub-pages theo URL tab.
```jsx
const TAB_MAP = {
  events: <EventManagementPage />,
  stations: <StationsPage />,
  teams: <TeamsPage />,
  scores: <ScoreManagementPage />,
  accounts: <AccountsPage />,
  discord: <DiscordPage />,
  email: <EmailPage />,
  // ...
}
```

### `CoopDashboard.jsx` — 50KB
Dashboard collab. Tính năng chính:
- Camera QR scanner (qr-scanner library)
- Enter/exit station session
- View station leaderboard
- StationRunPage integration

### `FormResponses.jsx` — 40KB
Form nộp bài động. Đọc `submission_config` từ API và render:
- Text input, textarea
- Multiple choice (single/multi)
- File upload (ảnh, PDF)
- Quiz với tự chấm điểm

---

## Testing

**Vị trí test:** `backend/webapi/api/tests/`

Các test file hiện có:
- `test_team_service.py` — unit test cho team creation, approval
- (thêm các file test theo domain khi cần)

**Thiếu test:** Nhiều service chưa có test coverage. Cần bổ sung trước khi thay đổi logic quan trọng.

**Run:**
```bash
python -m pytest webapi/api/tests/ -v --cov=webapi/api
```

---

## Deployment: K8s Production

**Services được deploy:**
1. `postgres` — StatefulSet với PVC
2. `migrate` — Job chạy 1 lần khi deploy mới
3. `backend` — Django API Deployment
4. `bot` — Discord Bot Deployment (tách riêng)
5. `email-worker` — Email queue worker
6. `frontend` — Nginx + React SPA
7. `backup-cronjob` — Auto backup định kỳ

**Monitoring stack:**
- Prometheus + Grafana (`k8s/11-15.monitoring.yaml`)
- django-prometheus trong `requirements.txt`
- Node exporter + kube-state-metrics

**Ingress:**
- TLS qua cert-manager
- `/s/` route forward về backend
- Mọi path khác serve React SPA

---

## Security Notes

- JWT-style token lưu trong DB (`account.token`) — không phải stateless JWT
- Token expire → cần refresh bằng cách login lại
- Antibot service (`antibot_service.py`) bảo vệ form đăng ký
- Google OAuth verify phía server (`google-auth` library)
- `master_admin_required` decorator bảo vệ các endpoint nhạy cảm
- CORS được cấu hình qua `django-cors-headers`
