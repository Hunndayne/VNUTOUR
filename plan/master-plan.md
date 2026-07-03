# VNUTour — Master Plan toàn hệ thống (end-to-end)

> Bản đồ đầy đủ mọi luồng theo từng phase: đăng ký → đăng nhập → đăng ký thi → duyệt đội →
> vận hành (check-in/trạm/QR) → điểm & thăng hạng → email/Discord.
> Mỗi mục ghi rõ **[ĐÃ CÓ]** (code hiện tại) vs **[CẦN XÂY]** (chưa làm) + endpoint/service/model liên quan.
> Nguồn: khảo sát trực tiếp code (17 models, 11 services, toàn bộ urls_*.py, frontend pages, Discord cogs).

---

## 0. Bức tranh tổng & dữ liệu

### Vai trò (`Account.role`)
- **participant** — thí sinh: hồ sơ, lập/đăng ký đội, xem điểm, QR điểm danh.
- **collab (coop)** — cộng tác viên: check-in sự kiện + vào/rời trạm tại `/coop`.
- **admin** — BTC: duyệt đội, quản lý phase/trạm/điểm, email, Discord, phân công coop.

### Phase cố định (`FIXED_PHASES` / `ProgramPhase`)
`registration` → `qualifying` (vòng loại) → `final` (chung kết) → `ended`.
Mỗi phase có nhiều **SubEvent** (event con: workflow/social/station_run/quiz/submission/custom); event con có cờ `uses_stations`.
`SystemSetting` lưu `current_sub_event_id`, schema đăng ký, (sẽ thêm) cờ QR.

### 17 Models
`Account, Participant, Team, TeamMembership, ProgramPhase, SubEvent, PhaseRoster, Station, StationAssignment, EventCheckIn, StationSession, ScoreEntry, AdvancementRule, StationSubmission, DiscordBroadcast, SystemSetting, MssvLinkAudit`.

### Trục xuyên suốt: `PhaseRoster`
Bảng "đội nào thuộc phase nào" (origin: approved/qualified/wildcard/manual). Là **cơ chế phân quyền theo phase** cho check-in, form, QR, điểm. `publish_advancement` sinh roster cho phase kế.

---

## PHASE A — Đăng ký & Tài khoản

### A1. Schema đăng ký (động) — [ĐÃ CÓ]
- `SystemSetting.registration_schema` (person_fields/team_fields, conditional, allow_other).
- `GET /register/schema` (`registration_service.get_schema`, `default_schema`).
- FE: `RegisterPage.jsx` đọc schema render form; `ParticipantDashboard` dùng `SchemaField`.

### A2. Đăng ký (đăng ký thi) — [ĐÃ CÓ]
- Cá nhân: `POST /register/individual` → `register_individual` → upsert `Participant`.
- Đội: `POST /register/team` → `register_team` (neo theo MSSV đội trưởng + thành viên).
- Tra cứu: `POST /register/lookup` → `lookup_participant` (MSSV → prefill).
- Validate: `validate_person_submission`, `_apply_conditionals`, `_normalize_date`.
- **MSSV claim**: `validate_account_mssv_claim` + `MssvLinkAudit` khi email lệch (xem [[vnutour-mssv-claim-flow]]).

### A3. Đăng nhập / Tài khoản — [ĐÃ CÓ]
- `POST /auth/login` (`authenticate` + `generate_session` → token).
- `POST /auth/register` & `/auth/signup` (`register_account`).
- Google: `POST /auth/google` (`register_with_google`); link: `POST /auth/me/google`.
- `GET /auth/me` (`find_by_token`), `POST /auth/logout` (`revoke_session`), đổi mật khẩu `POST /auth/me/password`.
- Hồ sơ: `GET/PATCH /me/profile`; **profile completion** (thiếu MSSV → 409 `profile_incomplete`, FE có trang bổ sung — xem [[vnutour-google-profile-flow]]).
- FE: `LoginPage.jsx`, `SettingsPage.jsx`.

### A4. [CẦN RÀ] — đảm bảo
- Token hết hạn → FE `apiRequest` bắt 401 → `logoutAndRedirect`. ✔ (đã chuẩn ở các trang mới)
- Thông báo lỗi đăng ký/đăng nhập tiếng Việt đầy đủ.

---

## PHASE B — Lập đội & Đăng ký thi (participant)

### B1. Quản lý đội — [ĐÃ CÓ]
- `GET/POST/PATCH /my-team` (`create_team`, `_next_team_code`, `get_team_for_participant`).
- Thành viên: `POST /my-team/members`, `PATCH/DELETE /my-team/members/<mssv>`, `POST /my-team/members/resolve` (auto-ghép hồ sơ theo MSSV+email).
- `team_is_editable`, khóa sửa sau khi duyệt.
- FE: `ParticipantDashboard.jsx` (ProgressTrail 5 bước, MemberDrawer, checklist).

### B2. Gửi duyệt — [ĐÃ CÓ]
- `POST /my-team/submit` (`submit_team`): kiểm tra đủ thành viên (`team_size_mismatch`), set `pending_approval`.
- Roster mặc định: `ensure_default_phase_roster_for_team` + `_ensure_default_qualifying_roster`.

---

## PHASE C — Duyệt đội & Cấp phát (admin)

### C1. Duyệt / Từ chối — [ĐÃ CÓ]
- `GET /teams`, `GET /teams/<key>`, `POST /teams/<key>/approve` (`approve_team`), `/reject` (`reject_team`).
- FE: `AdminDashboard.jsx` (+ `TeamsPage.jsx`) — drawer duyệt phải hiện đủ thông tin TV (xem [[vnutour-frontend-approval-ux]]).
- Duyệt → vào `PhaseRoster` (origin approved) cho phase registration/qualifying.

### C2. Cấp phát Discord — [ĐÃ CÓ]
- `discord_service`: `get_provisioning_queue`, `retry_provision`, `mark_provision_done/failed`, `sync_member`.
- `POST /discord/teams/<code>/provision`, `GET /discord/status`, `/provisioning-queue`, `/members`, `/members/<mssv>/sync`.
- FE: `DiscordPage.jsx`. Tạo role + kênh đội khi duyệt (provision_state: none/pending/done/failed).

### C3. Email thông báo — [ĐÃ CÓ, mở rộng được]
- `POST /admin/send-email` (`email_service.send_email`, `send_personalized_emails`).
- FE: `EmailPage.jsx`. SMTP qua env `SMTP_*`.
- **[CẦN XÂY]** template tự động theo sự kiện (duyệt/từ chối/nhắc lịch) — hiện gửi thủ công.

---

## PHASE D — Vận hành thi đấu (qualifying / final)

### D1. Điều khiển chương trình — [ĐÃ CÓ]
- `GET /program`, `POST /program/current-phase`, `/current-sub-event`.
- Phase/sub-event CRUD: `program/phases/<key>`, `/sub-events`, `program/sub-events/<id>`.
- FE: `EventManagementPage.jsx`.

### D2. Trạm — [ĐÃ CÓ]
- CRUD: `POST /sub-events/<id>/stations`, `PATCH/DELETE /stations/<id>`, `GET .../stations`.
- `station_service`: occupancy, sessions, capacity, policy (staff_scan/free_play).
- FE: `StationsPage.jsx` (đã persist DB).

### D3. Phân công coop & màn coop — [ĐÃ CÓ — vừa làm]
- `StationAssignment` (collab×station×ca, unique collab+station, migration 0011).
- `GET /coop/me/assignments`, `GET/POST/DELETE /admin/station-assignments`.
- FE: `CoopDashboard.jsx` (đã redesign đồng bộ), `StationAssignmentsPanel.jsx`. Xem [[vnutour-coop-page-plan]].

### D4. Check-in sự kiện & phiên trạm — [ĐÃ CÓ]
- Sự kiện: `POST /event-checkins/scan`, list/stats/reset. `scan_event_checkin` chặn theo roster phase.
- Trạm: `POST /station-sessions/enter|exit` (`enter_station`/`exit_station`): capacity, roster gate, chống đội ở 2 trạm, auto `ScoreEntry` khi exit có điểm.
- Đồng bộ realtime đa máy coop (poll 3s).

### D5. ⭐ QR điểm danh đội — [ĐÃ XÂY phần web; Discord còn lại]
> Đã làm: `checkin_qr_service` (`get_checkin_qr_state`/`set_checkin_qr`/`team_qr_visible`),
> `GET/POST /admin/checkin-qr` (`checkin_qr_view`), sửa `/my-team/qr` lọc theo bật + roster phase,
> FE `TeamCheckinQrCard` (participant, `qrcode.react`) + `CheckinQrToggle` (admin, trong StationsPage).
> 4 test (`test_checkin_qr_api.py`) pass. Theo mô hình (a) QR riêng đội + (b) xoay toàn bộ token khi bật.
> CÒN: đẩy QR vào Discord (mục 6 dưới).

**Mục tiêu:** thí sinh thấy QR trên trang; admin có nút bật/tắt; mỗi lần bật xoay token (chống gian lận); 1 QR/đội dùng mọi trạm; chỉ hiện cho đội **trong phase hiện tại**; sau này gửi QR vào Discord thay lệnh gen.

**Đã có sẵn để tái dùng:**
- `Team.qr_token` (mỗi đội 1 token); `rotate_qr_token(team)`; `GET /my-team/qr` (trả `qr_payload: "t:<token>"`, chặn đội chưa duyệt).
- Check-in `_resolve_team_from_scan` bóc `t:` → 1 QR/đội dùng mọi trạm (đã đúng).
- `PhaseRoster` để lọc theo phase.

**Cần xây:**
1. Backend `SystemSetting` key `checkin_qr` = `{ enabled, phase_key, rotated_at }`.
2. `POST /admin/checkin-qr/toggle` (admin): bật → set enabled + xoay `qr_token` **tất cả đội trong roster phase hiện tại** + `rotated_at`; tắt → enabled=false.
3. Sửa `GET /my-team/qr`: chỉ trả token khi `enabled` **và** đội ∈ roster phase hiện tại; ngược lại `{ enabled:false }` / 403 `checkin_closed`.
4. FE participant: card "QR điểm danh" + thư viện tạo QR (`qrcode.react`); ẩn nếu đội không thuộc phase hiện tại.
5. FE admin: nút bật/tắt + cảnh báo "mỗi lần bật tạo QR mới, QR cũ vô hiệu".
6. **[Sau]** Discord: đẩy ảnh QR vào kênh từng đội trong phase khi bật (thay `qr_commands` gen thủ công).

**2 quyết định cần chốt (đang ghi treo):**
- (a) Mô hình QR: **QR riêng từng đội, coop quét** (khuyến nghị, đúng luồng hiện tại) hay 1 QR chung dán ở trạm để đội tự quét (đổi kiến trúc check-in).
- (b) Xoay token khi bật: **xoay toàn bộ đội trong phase mỗi lần bật** (khuyến nghị, đúng "mỗi lần bật là QR khác") / chỉ xoay khi rỗng / nút "Xoay QR" riêng.

---

## PHASE E — Điểm số & Thăng hạng

### E1. Điểm & bảng xếp hạng — [ĐÃ CÓ]
- `ScoreEntry` (kind station/manual...). `score_service`: `get_phase_scoreboard`, `create/update/delete_score_entry`.
- `GET /scores/phases/<key>`, `GET/POST/PATCH/DELETE /scores/entries`.
- FE: `ScoreManagementPage.jsx`.

### E2. Thăng hạng (qualifying → final) — [ĐÃ CÓ]
- `AdvancementRule` (top N / ngưỡng / wildcard). `get/set_advancement_rule`, `publish_advancement`.
- `GET /scores/phases/<key>/advancement`, `POST .../publish-advancement` → sinh `PhaseRoster` phase kế (origin qualified/wildcard).
- **Liên hệ D5/QR**: đội không vào chung kết → không có roster final → QR final không hiện/gửi (đúng yêu cầu).

---

## PHASE F — Email & Discord broadcast (xuyên suốt)

- Email: `POST /admin/send-email` (cá nhân hóa). **[CẦN XÂY]** trigger tự động theo sự kiện.
- Discord broadcast: `POST /discord/broadcasts`, `GET /discord/broadcasts` (`create_broadcast`).
- Discord bot (`src/`): cogs `sheet_cog` (sync Google Sheet), `team_cog`; commands slash/admin/tour/qr/music; events member/message/reaction.
- **[CẦN RÀ]** đồng bộ Sheet ↔ Mongo còn dùng tới đâu sau khi web là nguồn chính (xem [[vnutour-db-migration]]).

---

## G. Dashboard & tiện ích — [ĐÃ CÓ]
- `GET /health`, `/dashboard/overview`, `/activity`, `GET/PATCH /settings`.
- `FormResponses.jsx` (form tự do theo trạm), `AccountsPage.jsx`, `LandingPage.jsx`.

---

## H. Tổng hợp việc CẦN XÂY (ưu tiên)

1. **QR điểm danh (D5)** — toggle admin + rotate + phase-scope + render FE + (sau) Discord. ⭐ ưu tiên theo yêu cầu mới.
2. **Test backend còn thiếu** — `test_station_session_api.py`, `test_event_checkin_api.py` (xem `plan/coop-testing-plan.md`).
3. **Email tự động theo sự kiện** (duyệt/từ chối/nhắc lịch) — hiện thủ công.
4. **Rà luồng Sheet↔Mongo** — xác định còn cần không.
5. **Frontend test tooling** (Vitest+RTL) — hiện chưa có.

---

## I. Quyết định còn treo (cần BTC chốt)
- QR: mô hình (riêng-đội vs chung) + cách xoay (mục D5 a/b).
- Coop chưa phân công: cho chọn tự do mọi trạm (hiện tại) hay khóa cứng.
- Email tự động: những mốc nào cần gửi (duyệt, từ chối, nhắc check-in, công bố thăng hạng?).
