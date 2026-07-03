# VNUTour — Testing Plan toàn bộ codebase

> Plan test đầy đủ cho cả hệ thống (backend + frontend + E2E), bám theo `plan/master-plan.md`.
> Đánh dấu [ĐÃ CÓ] (test hiện tại) vs [CẦN THÊM]. Thay thế & bao trùm `plan/coop-testing-plan.md`.
> 👉 **Test tay trên giao diện:** xem `plan/ui-test-plan.md` (kịch bản bấm-từng-bước theo từng trang/role).
> ✅ **P0 automated đã viết xong** (46 test backend pass): station enter/exit, event check-in, scoring, advancement.

---

## 0. Công cụ & quy ước

- **Backend:** Django `TestCase`. Chạy: `python webapi/manage.py test api.tests.<module>` (từ `backend/`).
  - ⚠️ KHÔNG chạy label `api.tests` trống → lỗi discovery (`__file__` None). Phải **liệt kê module**.
  - pytest CHƯA cấu hình `pytest-django` (dù CLAUDE.md ghi pytest) → dùng Django runner.
- **Frontend:** CHƯA có tooling. Đề xuất **Vitest + React Testing Library + jsdom**.
- **Mock bắt buộc:** SMTP (email), Discord API, Google OAuth — không gọi mạng thật trong test.
- **Mục tiêu coverage:** services (business logic) ≥ 80%; mọi endpoint có ít nhất 1 ca thành công + 1 ca lỗi + 1 ca phân quyền.

---

## 1. Coverage hiện tại (18 test)

| Module test | Đang cover |
|---|---|
| `test_team_service.py` (3) | get_team_members sync, link_account_profile sync |
| `test_program_service.py` (1) | update_phase_dates normalize |
| `test_participant_member_submission.py` (4) | member resolve + xử lý CCCD |
| `test_station_assignment_api.py` (2) | tạo/xóa assignment, collab xem assignment |
| `test_checkin_qr_api.py` (4) | QR toggle, rotate, phase-scope, guard |
| `test_station_session_score_api.py` (4) | coop chấm điểm phiên trạm + phân quyền |

**Gap lớn (chưa có test nào):** auth, registration, team approval/submit, program/sub-event,
station enter/exit, event check-in scan, scoring/leaderboard, advancement, email, Discord, dashboard,
**toàn bộ frontend**.

---

## 2. Backend — kế hoạch theo domain

### 2.1 Auth & Session — `test_auth_api.py` [CẦN THÊM]
- login đúng / sai mật khẩu / tài khoản `is_active=False`.
- register & signup: username/email trùng → `conflict`; secret sai → `forbidden`.
- google signup/link; `profile_incomplete` → 409 khi thiếu MSSV.
- `/auth/me` theo token; token sai/thiếu → 401; logout → revoke (token cũ vô hiệu).
- đổi mật khẩu `/auth/me/password` (sai mật khẩu cũ).

### 2.2 Registration — `test_register_api.py` [CẦN THÊM]
- `GET /register/schema` (default + custom từ SystemSetting).
- `register/individual`: thiếu field required, conditional ẩn/hiện, date không hợp lệ, upsert participant.
- `register/team`: neo MSSV đội trưởng + thành viên, kiểm tra team_size.
- `register/lookup` (MSSV → prefill).
- `validate_account_mssv_claim`: email khớp vs lệch → ghi `MssvLinkAudit`, `mssv_taken`.

### 2.3 Team & Approval — `test_team_api.py` [CẦN THÊM] (mở rộng `test_team_service.py`)
- `create_team`: cấp `_next_team_code`, `already_has_team` (1 đội/tài khoản).
- member: add/update/remove — `team_full`, `mssv_in_other_team`, `mssv_in_submitted_team`, không xóa đội trưởng.
- `submit_team`: `team_size_mismatch`, `no_members`, set `pending_approval`.
- `approve_team` → tạo `PhaseRoster` (approved) + trigger provision; `reject_team` (+ approval_note).
- `team_is_editable` khóa sau khi duyệt.

### 2.4 Program & Phase — mở rộng `test_program_service.py` [CẦN THÊM]
- `set_current_phase`; `set_current_sub_event` → `event_not_in_current_phase` (409).
- create/update/delete sub_event; cờ `uses_stations`.
- `get_program` shape (current_phase, current_sub_event_id, phases[].sub_events[]).

### 2.5 Station & Check-in — `test_station_session_api.py` + `test_event_checkin_api.py` [CẦN THÊM] ⭐P0
**Station session (enter/exit):**
- enter: success; `team_not_found` / `team_not_approved`; `station_full` (limited đủ slot);
  `session_already_active` (đội ở 2 trạm); `team_not_in_phase` (ngoài roster); `station_not_in_event`;
  `station_inactive`; `policy_free_play`.
- exit: success → auto `ScoreEntry` khi score>0; `session_not_found`.
- occupancy / sessions / recent đúng số liệu.
**Event check-in scan:**
- success → `EventCheckIn`; `already_checked_in`; `team_not_found/approved`;
  `missing_phase_or_event`; `team_not_in_phase`.
- `/event-checkins/stats` → đúng `checked_in_teams` / `checked_in_participants`.
- reset chỉ admin (collab → 403).
- [ĐÃ CÓ] `station_session_score` (4), `station_assignment` (2).

### 2.6 QR điểm danh — [ĐÃ CÓ 4] · thêm: toggle OFF ẩn lại; `no_current_phase` khi bật mà chưa set phase.

### 2.7 Coop assignment — [ĐÃ CÓ 2] · thêm: trùng → 409 (`duplicate_assignment`);
`is_current` theo cửa sổ ca (trước/trong/sau/không khung giờ); lọc `phase_key`/`event_id`.

### 2.8 Scoring & Leaderboard — `test_score_api.py` [CẦN THÊM] ⭐P0
- create/update/delete entry (manual/station/bonus/penalty); `_normalize_points` (penalty âm).
- `get_phase_scoreboard`: tổng theo đội + sort (total desc, tiebreak team_code) + breakdown theo event.
- roster strict (đội ngoài roster không lên bảng) vs fallback (chưa có roster → đội approved).
- guard: participant/collab không sửa điểm tổng (admin-only ở `/scores/entries`).

### 2.9 Advancement (duyệt vô vòng sau) — `test_advancement_api.py` [CẦN THÊM] ⭐P0
- `set_advancement_rule` (top N / threshold / wildcard) qua `/scores/phases/<key>/advancement`.
- `publish_advancement` → `PhaseRoster` origin `qualified` cho phase kế, đúng top N.
- re-publish idempotent (`update_or_create`, không nhân đôi).
- admin-only; phase nguồn/đích hợp lệ.

### 2.10 Email — `test_email_api.py` [CẦN THÊM] (MOCK SMTP)
- `send_email` / `send_personalized_emails`: mock `smtplib`, kiểm tra recipient/subject/body cá nhân hóa.
- admin-only; xử lý lỗi SMTP không làm sập request.

### 2.11 Discord — `test_discord_api.py` [CẦN THÊM] (MOCK network)
- provisioning queue, retry, mark done/failed, sync_member, broadcast — mock `discord_service` gọi mạng.
- provision_state chuyển trạng thái đúng (none→pending→done/failed).

### 2.12 Dashboard & Settings — `test_dashboard_api.py` [CẦN THÊM]
- `/health`, `/dashboard/overview`, `/activity`, `GET/PATCH /settings` + guard role.

---

## 3. Frontend

### 3.1 Tooling [CẦN THÊM]
Cài `vitest @testing-library/react @testing-library/jest-dom jsdom`; script `"test": "vitest"`.

### 3.2 Unit — hàm thuần (ưu tiên, rẻ & giá trị cao)
- `CoopDashboard`: `parseQrPayload`, `explainScanError`, `formatShift`, `buildStationView`, `sortStations`.
- `api.js`: `normalizeProgramForFrontend` (String hóa id, uses_stations), `redirectByRole`,
  `apiRequest` (mock fetch: 401 → throw có `.status`, parse error shape, gắn Bearer).
- `ParticipantDashboard`: `explainApiError`, `getStepState`, `getNextAction`, `buildSchemaPatch`.

### 3.3 Component (mock `apiRequest`)
- `CoopDashboard`: auto-chọn event/trạm theo assignment, đổi mode, **dedupe scan** (cùng code <2.5s),
  ô nhập điểm khi checkout, sửa điểm nhật ký trạm.
- `CheckinQrToggle` (bật/tắt + confirm), `TeamCheckinQrCard` (enabled vs đóng).
- `StationAssignmentsPanel` (tạo/gỡ, lỗi duplicate), `ParticipantDashboard` (ProgressTrail, MemberDrawer).

---

## 4. E2E thủ công (staging) — hành trình trọn mùa

1. Thí sinh đăng ký (cá nhân/đội) → đăng nhập (password/Google + bổ sung MSSV).
2. Lập đội, thêm thành viên, gửi duyệt.
3. Admin duyệt → tạo `PhaseRoster` + Discord role/kênh → email thông báo.
4. Admin set phase = vòng loại, mở event có trạm, tạo trạm, phân công coop.
5. Admin **mở QR điểm danh** → token vòng loại xoay mới → thí sinh thấy QR (đội trong vòng loại).
6. Coop `/coop`: check-in sự kiện → vào trạm → rời trạm → **nhập điểm** → đồng bộ đa máy.
7. Bảng điểm vòng loại cập nhật; admin sửa điểm nếu cần.
8. Admin đặt rule top N → **publish thăng hạng** → roster chung kết.
9. Admin chuyển phase = chung kết, **mở QR** → **chỉ đội đi tiếp** thấy/nhận QR; đội trượt không thấy.
10. Kết thúc: khóa kết quả; email tổng kết.

---

## 5. Cross-cutting (bắt buộc kiểm)

- **Ma trận phân quyền** (role × endpoint): participant/collab/admin → 401/403 đúng cho mọi route admin/coop.
- **401 → FE `logoutAndRedirect('/')`** ở mọi trang.
- **Idempotency:** scan QR lặp (dedupe FE + idempotency BE), publish thăng hạng lặp, sửa điểm lại không nhân đôi `ScoreEntry`.
- **Phase-scope:** roster quyết định check-in/QR/điểm — đội ngoài roster bị chặn nhất quán.
- **Mock:** SMTP / Discord / Google không gọi thật.

---

## 6. Ưu tiên

- **P0 (nguy hiểm, chưa có test):** station enter/exit (2.5), event check-in scan (2.5), scoring (2.8), advancement (2.9), auth (2.1), team approval (2.3).
- **P1:** registration (2.2), program (2.4), email mock (2.10), discord mock (2.11), assignment mở rộng (2.7).
- **P2:** frontend tooling + unit (3.1–3.2), dashboard (2.12).
- **P3:** component test (3.3), E2E full (mục 4).

---

## 7. Cách chạy

```bash
cd backend
# Chạy theo module (KHÔNG dùng label api.tests trống):
python webapi/manage.py test api.tests.test_checkin_qr_api api.tests.test_station_session_score_api \
  api.tests.test_station_assignment_api api.tests.test_team_service \
  api.tests.test_program_service api.tests.test_participant_member_submission
```
Đề xuất thêm: cấu hình `coverage.py` (`coverage run --source=webapi/api ...`) để đo độ phủ;
hoặc cài `pytest-django` để dùng `pytest` như CLAUDE.md mô tả.

Frontend (sau khi thêm Vitest): `cd frontend && npm test`.
