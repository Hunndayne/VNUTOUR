> ⤴️ **Đã bao trùm bởi `plan/testing-plan.md` (plan test toàn bộ codebase).** File này giữ lại
> chi tiết riêng cho tính năng coop; dùng `testing-plan.md` làm bản chính.

# Plan Testing — Tính năng Coop

> Kèm kết quả verify chức năng (2026). Công cụ thực tế: backend dùng **Django TestCase**
> chạy bằng `python webapi/manage.py test` (pytest CHƯA cấu hình pytest-django dù CLAUDE.md ghi pytest).
> Frontend **chưa có test tooling**.

---

## A. Kết quả verify — cần sửa gì?

Không có lỗi chặn. Build frontend xanh, `manage.py check` sạch, test assignment pass.
Các điểm nên sửa, theo ưu tiên:

### 1. [UX — Trung bình] QR quét lặp gây flash lỗi sau mỗi lần thành công
`CoopDashboard` không tạm dừng scanner sau khi decode. QR còn trong khung hình → ngay sau một
lần check-in/vào trạm thành công, lần decode kế tiếp chạm idempotency backend
(`already_checked_in` / `session_already_active`) → hiện flash lỗi. `CheckinPage` cũ dừng camera ~700ms.
**Sửa:** dedupe theo mã (bỏ qua cùng một code trong N giây) hoặc pause scanner ngắn sau mỗi lần quét thành công.

### 2. [Toàn vẹn dữ liệu — Trung bình] `StationAssignment` thiếu unique constraint
Admin có thể phân công trùng (cùng coop + cùng trạm). Dropdown coop tự gộp (Set) nhưng panel admin
hiện row trùng. **Sửa:** `UniqueConstraint(collab, station)` + bắt `IntegrityError` trong
`create_assignment` → trả 409.

### 3. [Dọn dẹp — Thấp] Dead code
`CheckinPage.jsx` không còn được import; `frontend/vite.err` rỗng. → Xóa.

### 4. [Nhỏ — Thấp] Lệch kiểu id event trong 1 effect
`syncPhaseAssignments`: `preferredItems[0].event.id` là int, so sánh với `stationEvents[].id` (string)
→ luôn false → nhánh auto-select đó chết. Vô hại (effect khác đã String hóa lo việc này) nhưng nên dọn.

### 5. [Cần xác nhận — Note] Coop chưa được phân công
Khi không có assignment, coop fallback chọn tự do mọi trạm. Cần chốt: đây là hành vi mong muốn hay
nên chặn coop chưa được phân công?

---

## B. Backend — test tự động (Django TestCase)

Khoảng trống lớn nhất: **luồng station enter/exit và event check-in scan đang KHÔNG có test** —
mà CoopDashboard phụ thuộc nặng vào chúng.

### B1. `test_station_session_api.py` (MỚI)
- enter thành công → tạo session `active`
- enter `team_not_found`, `team_not_approved`
- enter `station_full` (capacity limited, đủ slot)
- enter `session_already_active` (cùng đội vào 2 trạm)
- enter `team_not_in_phase` (có PhaseRoster, đội ngoài roster)
- enter `station_not_in_event`, `station_inactive`, `policy_free_play`
- exit thành công → tạo `ScoreEntry` khi score > 0
- exit `session_not_found`
- guard role: participant → 403; occupancy/sessions/recent trả đúng

### B2. `test_event_checkin_api.py` (MỚI)
- scan thành công → tạo `EventCheckIn`
- `already_checked_in`, `team_not_found`, `team_not_approved`
- `missing_phase_or_event`, `team_not_in_phase`
- `/event-checkins/stats?phase_key=&event_id=` trả đúng `checked_in_teams` / `checked_in_participants`
- reset chỉ admin (collab → 403)

### B3. `test_station_assignment_api.py` (MỞ RỘNG file hiện có)
- chặn trùng (sau khi thêm constraint) → 409
- `is_current` đúng theo cửa sổ `shift_start`/`shift_end` (trước ca / trong ca / sau ca / không khung giờ)
- collab chỉ thấy assignment của mình; lọc `phase_key`/`event_id`
- create `collab_not_found` (404) / `station_not_found` (404)
- non-admin create → 403; delete đúng/không tồn tại (404)

**Chạy:** `cd backend && python webapi/manage.py test api.tests`

---

## C. Frontend — chưa có tooling

### C1. Khuyến nghị: thêm Vitest + React Testing Library
Unit test cho hàm thuần (rủi ro logic cao, dễ test):
- `parseQrPayload` (JSON payload / chuỗi thô / rỗng)
- `explainScanError` (map code → message, fallback)
- `formatShift` (không khung giờ / chỉ start / chỉ end / cả hai)
- `buildStationView`, `sortStations`
- `normalizeProgramForFrontend` (api.js) — id String hóa, uses_stations
Smoke test component với `apiRequest` mock: render `/coop`, chọn event/trạm, mode quét.

### C2. Nếu không thêm tooling: dùng checklist E2E thủ công (mục D).

---

## D. E2E thủ công (staging, 2 vai admin + coop)

1. Admin tạo trạm qua StationsPage (vào DB); phân công coop vào trạm, có/không khung ca.
2. Coop login → redirect `/coop` → thấy trạm được giao tự chọn, dropdown khóa khi chỉ 1 trạm.
3. Check-in sự kiện: quét QR hợp lệ → success; quét lại → (sau fix #1) không spam lỗi.
4. Vào trạm → live roster + occupancy tăng; trạm đầy → bị chặn `station_full`.
5. Rời trạm → tạo điểm; feed event cập nhật.
6. **Đồng bộ đa máy:** 2 thiết bị coop thấy cùng occupancy/nhật ký (mục tiêu cốt lõi của plan).
7. Coop chưa phân công → chọn tự do mọi trạm (xác nhận policy #5).
8. Token hết hạn (401) → redirect trang chủ.
9. Empty state: phase không có event bật trạm → hiện card rỗng.

---

## G. Luồng điểm & thăng hạng (BỔ SUNG — trước đây thiếu)

### ✅ Đã chốt & triển khai (coop chấm điểm)
- Quyết định: **coop checkout → hiện ô nhập điểm cho đội đó; coop được sửa điểm ở trạm được phân công.**
- Đã làm: `PATCH /station-sessions/<id>/score` (`station_session_score_view` + `set_session_score`),
  kiểm tra collab phải có `StationAssignment` cho trạm (admin luôn được), đồng bộ `StationSession.score`
  + `ScoreEntry kind=station` (không nhân đôi). FE `CoopDashboard`: ô nhập điểm ở panel kết quả khi
  checkout + sửa điểm từng dòng nhật ký trạm. Test `test_station_session_score_api.py` (4 ca) pass.

### G1. `test_score_api.py` (MỚI)
- `create_score_entry` (kind manual/station) → `get_phase_scoreboard` tổng đúng theo đội.
- update / delete score entry → tổng + leaderboard cập nhật.
- leaderboard sort đúng (total giảm dần, tiebreak team_code).
- roster strict vs fallback: đội ngoài roster phase không lên bảng (khi có PhaseRoster).
- guard role (participant/collab không sửa được điểm → 403).

### G2. `test_advancement_api.py` (MỚI)
- `set_advancement_rule` (top N / threshold / wildcard) qua `/scores/phases/<key>/advancement`.
- `publish_advancement` → tạo `PhaseRoster` origin `qualified` cho phase kế, đúng top N.
- re-publish idempotent (`update_or_create`, không nhân đôi roster).
- chỉ admin; phase nguồn/đích hợp lệ.

### G3. E2E điểm → thăng hạng (nối D5 QR)
1. Admin nhập điểm cho đội ở event/trạm → bảng điểm phase cập nhật.
2. (Nếu bật coop scoring) Coop rời trạm + nhập điểm → điểm vào bảng.
3. Admin đặt rule top N → `publish-advancement` → đội top vào roster **final**.
4. Mở QR ở phase final → **chỉ đội vào final thấy/nhận QR**, đội trượt không thấy (xác minh D5 phase-scope).

---

## E. Regression
- StationsPage admin vẫn CRUD trạm bình thường.
- Participant/Admin dashboard không ảnh hưởng bởi đổi routing.
- `/checkin` vẫn trỏ `CoopDashboard` (back-compat).

---

## F. Thứ tự đề xuất
1. Sửa #1, #2 (và #3, #4 dọn kèm).
2. Viết B1, B2 (lấp khoảng trống nguy hiểm nhất) → B3.
3. Thêm Vitest + C1 nếu muốn an toàn dài hạn.
4. Chạy D trước khi golive.
