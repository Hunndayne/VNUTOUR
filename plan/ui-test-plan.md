# VNUTour — UI Manual Test Plan (test trực tiếp trên giao diện)

> Kịch bản bấm-từng-bước để tự kiểm thử trên web. Mỗi ca: **Bối cảnh → Các bước → Kết quả mong đợi → [ ]**.
> Đi kèm test tự động backend (`plan/testing-plan.md`). Nhãn nút trong ngoặc kép là chữ thật trên UI.

---

## 0. Chuẩn bị

### Chạy hệ thống
```bash
# Backend (cổng 8080)
cd backend && python webapi/manage.py migrate && python main.py
# Frontend (cổng dev)
cd frontend && npm run dev
```
- `frontend/.env`: `VITE_API_BASE_URL=http://localhost:8080/api`.

### Tài khoản cần có
- **admin**: dùng admin mặc định (đã seed ở migration `0002_seed_default_admin`) — hỏi mật khẩu seed, hoặc tạo qua `python webapi/manage.py shell`.
- **collab**: tạo 1 tài khoản, rồi admin vào **"Quản lý tài khoản"** đổi role → `collab`.
- **participant**: đăng ký mới ở `/register` (2–3 đội để có dữ liệu).

### ⚠️ Routing (mới)
Dashboard hiển thị **theo role ngay tại `/`** sau khi đăng nhập (admin→Admin, collab→Coop, participant→Participant).
Các path `/admin`, `/coop`, `/participant`, `/checkin` **tự redirect về `/`**. Khi chưa đăng nhập, `/` là LandingPage.
→ Trong plan dưới, "trang admin/coop/thí sinh" nghĩa là **đăng nhập đúng role rồi xem `/`**.

### Mẹo
- Mở **2 cửa sổ ẩn danh** (1 coop A, 1 coop B) để test đồng bộ đa máy.
- Mở **DevTools → Network** để thấy request/lỗi khi nghi ngờ.

---

## A. Đăng ký & Đăng nhập

| # | Bối cảnh | Các bước | Kết quả mong đợi | [ ] |
|---|---|---|---|---|
| A1 | Trang `/register` | Chọn đăng ký **cá nhân**, điền đủ field bắt buộc, gửi | Tạo participant; báo thành công | [ ] |
| A2 | `/register` | Chọn đăng ký **đội**, nhập đội trưởng + thành viên (MSSV), gửi | Tạo đội theo MSSV đội trưởng | [ ] |
| A3 | `/login` | Đăng nhập đúng user/mật khẩu | Về `/` và **render dashboard đúng role** (admin/collab/participant) | [ ] |
| A4 | `/login` | Đăng nhập Google lần đầu (thiếu MSSV) | Hiện trang bổ sung MSSV trước khi vào | [ ] |
| A5 | `/login` | Sai mật khẩu | Báo "Tên đăng nhập hoặc mật khẩu không đúng" | [ ] |
| A6 | Đã đăng nhập | Bấm "Đăng xuất" | Về `/`; token bị xóa; vào lại trang cần auth bị đẩy ra | [ ] |
| A7 | `/login` → "Đăng ký ngay" | Điền form với **MSSV/email trùng hồ sơ đã đăng ký** → "Tiếp tục" | Sang bước **"Xác nhận thông tin"**: tự hiện hồ sơ match → "Xác nhận & tạo tài khoản" → đăng nhập được | [ ] |
| A8 | Signup, MSSV **chưa có** hồ sơ đăng ký | "Tiếp tục" | Sang bước **nhập tay** (manual) → "Tạo tài khoản" → tạo tài khoản mới thành công | [ ] |
| A9 | Signup, MSSV đã đăng ký **với email khác** | Gửi | Báo "MSSV này đã được đăng ký với email khác. Vui lòng kiểm tra lại." — không tạo tài khoản | [ ] |

---

## B. Trang thí sinh (đăng nhập participant → `/`)

| # | Bối cảnh | Các bước | Kết quả mong đợi | [ ] |
|---|---|---|---|---|
| B1 | Participant chưa có đội | Bấm "Tạo đội" | Tạo đội, hiện mã đội (Txxxx) | [ ] |
| B2 | Có đội (draft) | "Thêm thành viên" → nhập MSSV+email đã có hồ sơ | Form tự điền (resolve); lưu được | [ ] |
| B3 | Thành viên chưa đủ | Bấm "Gửi duyệt" | Bị chặn, báo cần đủ thành viên | [ ] |
| B4 | Đủ thành viên | "Gửi duyệt" | Trạng thái → "Chờ duyệt"; khóa sửa | [ ] |
| B5 | Đội bị admin từ chối | Xem dashboard | Hiện badge "Cần sửa" + lý do; mở lại để sửa | [ ] |
| B6 | Đội đã duyệt, **QR chưa mở** | Xem card "QR điểm danh" | Hiện "BTC chưa mở điểm danh" (không có QR) | [ ] |
| B7 | Đội đã duyệt, **admin đã mở QR** (xem C6) | Tải lại / chờ ~15s | Hiện **mã QR** + mã đội; ghi chú "đưa coop quét" | [ ] |
| B8 | Checklist/Tiến độ | Quan sát ProgressTrail | Các bước sáng đúng theo trạng thái đội | [ ] |
| B9 | Đội draft có thành viên | Bấm "Sửa" 1 thành viên → drawer "Sửa thông tin" | **MSSV bị khóa** không sửa được; sửa field khác → lưu OK | [ ] |
| B10 | Đội draft | Bấm nút xóa (icon "Xóa thành viên") | Thành viên biến mất khỏi danh sách đội | [ ] |
| B11 | Đội thuộc phase có form trạm đang mở (C13) | Xem card **"Form đang mở"** → bấm "Mở form" | Chuyển đến `/form?stationId=...` đúng trạm (xem mục G) | [ ] |

---

## C. Trang admin (đăng nhập admin → `/`)

| # | Tab | Các bước | Kết quả mong đợi | [ ] |
|---|---|---|---|---|
| C1 | Quản lý đội | Mở drawer 1 đội chờ duyệt | Thấy **đủ thông tin thành viên**; bấm "Duyệt" | [ ] |
| C2 | Quản lý đội | "Từ chối" + nhập lý do | Đội về "Cần sửa"; thí sinh thấy lý do (B5) | [ ] |
| C3 | Quản lý sự kiện | Đổi **phase hiện tại** sang "Vòng loại"; mở 1 event có cờ trạm | Phase/event hiện tại cập nhật | [ ] |
| C4 | Quản lý trạm | Chọn event → "Thêm trạm"; đặt policy (staff_scan), capacity (limited/unlimited); sửa/xóa | Trạm lưu vào DB (coop thấy được ở D) | [ ] |
| C5 | Quản lý trạm | Panel **"Phân công coop"** → chọn collab + trạm + ca → "Tạo phân công" | Hiện dòng phân công; tạo trùng → báo "đã được phân công" | [ ] |
| C6 | Quản lý trạm | Card **"Điểm danh bằng QR"** → "Mở điểm danh (tạo QR mới)" → xác nhận | Badge "Đang mở"; báo "Đã tạo QR mới cho N đội" (→ B7) | [ ] |
| C7 | Quản lý trạm | Bấm lại "Mở điểm danh" lần nữa | QR xoay mới → QR cũ ở B7 **hết hiệu lực** (coop quét QR cũ sẽ lỗi) | [ ] |
| C8 | Điểm & suất đi tiếp | Nhập điểm thủ công cho 1 đội | Bảng điểm phase cập nhật, sort đúng | [ ] |
| C9 | Điểm & suất đi tiếp | Đặt rule **top N** (slots) → "Publish thăng hạng" | Đội top N vào roster phase sau (origin qualified) | [ ] |
| C10 | Gửi email | Soạn + gửi email tới đội/cá nhân | Email gửi đi (kiểm hộp thư test) | [ ] |
| C11 | Quản lý Discord | Xem hàng đợi provision / retry | Trạng thái provision đúng | [ ] |
| C12 | Quản lý tài khoản | Đổi role 1 user → collab | User đăng nhập lại → `/` hiện dashboard coop | [ ] |
| C13 | Quản lý trạm | Mở trạm → **"Cấu hình bài nộp"**: nhập brief (markdown), bật form + thêm field, bật quiz + câu hỏi/đáp án, bật attachment (số file, loại file) → lưu | Overview trạm hiện đủ mode (Biểu mẫu/Quiz/Tệp); thí sinh thấy nội dung ở G2 | [ ] |
| C14 | Quản lý sự kiện | Tạo event mới trong phase (tên, loại, cờ trạm, ngày) → sửa → xóa; đặt **event hiện tại**; đặt lịch start/end phase | CRUD hoạt động; lưu event thiếu tên → báo "Event cần có tên trước khi lưu" | [ ] |
| C15 | Điểm & suất đi tiếp | Đổi rule sang chế độ **chọn tay (manual)**, tick chọn đội (≤ slots) → "Publish thăng hạng" | Chỉ các đội được tick vào roster phase sau; không tick được quá số slots | [ ] |
| C16 | Điểm & suất đi tiếp | Publish khi **chưa cấu hình phase đích** | Báo "Phase này chưa cấu hình phase đích." — không publish | [ ] |
| C17 | Quản lý tài khoản | "Tạo tài khoản" mới (role collab) → thử "Khóa" 1 tài khoản → sửa ("Lưu thay đổi") → xóa; dùng ô tìm kiếm + lọc role | Tài khoản mới đăng nhập được; tài khoản "Đã khóa" **không** đăng nhập được; tìm kiếm/lọc đúng | [ ] |
| C18 | Tổng quan | Xem tab "Tổng quan" ở từng phase; bấm đổi phase trên **PhaseTrail** | KPI/feed hoạt động/leaderboard là số liệu thật từ API (không phải mock); đổi phase → badge header cập nhật | [ ] |

---

## D. Trang coop (đăng nhập collab → `/`)

> Tiền đề: admin đã làm C3 (phase+event có trạm), C4 (trạm), C5 (phân công coop này vào trạm).

| # | Bối cảnh | Các bước | Kết quả mong đợi | [ ] |
|---|---|---|---|---|
| D1 | collab đăng nhập | Mở `/` | Header có trạm được giao; dropdown trạm **khóa** nếu chỉ 1 phân công | [ ] |
| D2 | Mode "Check-in sự kiện" | Quét QR đội (B7) hoặc nhập tay mã đội → "Xác nhận" | Báo "Đã check-in sự kiện cho..."; số liệu tăng | [ ] |
| D3 | Mode "Vào trạm" | Quét/nhập mã đội | Đội vào **Live roster**; công suất tăng | [ ] |
| D4 | Mode "Rời trạm" | Quét/nhập mã đội | Đội rời; panel "Kết quả gần nhất" hiện **ô nhập điểm** | [ ] |
| D5 | Sau D4 | Nhập điểm vào ô → "Lưu điểm" | Báo "Đã lưu N điểm"; nhật ký trạm cập nhật điểm | [ ] |
| D6 | Nhật ký trạm | Sửa điểm 1 dòng phiên → "Lưu điểm" | Điểm cập nhật; vào bảng điểm admin (C8) | [ ] |
| D7 | Trạm limited đã đầy | Vào trạm thêm đội | Báo "Trạm đã đầy công suất" | [ ] |
| D8 | Đội không thuộc phase | Vào trạm đội ngoài roster | Báo "không nằm trong roster của phase hiện tại" | [ ] |
| D9 | **Quét lặp** | Để QR trong khung hình vài giây sau khi thành công | **Không** spam lỗi "đã check-in/đang ở trạm" (dedupe 2.5s) | [ ] |
| D10 | **Đồng bộ đa máy** | Coop B mở cùng trạm; coop A cho 1 đội vào trạm | Coop B thấy đội đó trong Live roster (~3s) | [ ] |
| D11 | Chấm điểm trạm **không phụ trách** | (nếu chọn được) sửa điểm trạm ngoài phân công | Báo "Bạn không phụ trách trạm này" | [ ] |
| D12 | Đội **chưa được duyệt** (draft/chờ duyệt) | Quét/nhập mã đội đó | Báo "Đội này chưa được duyệt nên không thể scan." | [ ] |

---

## E. Hành trình end-to-end (gộp, chạy 1 lượt)

1. Thí sinh đăng ký + lập đội + gửi duyệt (A,B).
2. Admin duyệt đội (C1) → đội thấy trạng thái duyệt (B5/B6).
3. Admin set phase = Vòng loại, mở event trạm, tạo trạm, phân công coop (C3–C5).
4. Admin **mở QR điểm danh** (C6) → thí sinh thấy QR (B7).
5. Coop check-in + vào/rời trạm + **nhập điểm** (D2–D5); kiểm đồng bộ đa máy (D10).
6. Admin xem bảng điểm (C8), sửa nếu cần.
7. Admin đặt rule top N + **publish thăng hạng** (C9).
8. Admin chuyển phase = Chung kết, **mở QR** lại → **chỉ đội đi tiếp** thấy QR; đội trượt vào `/participant` **không** thấy QR (F3).
9. Admin cấu hình bài nộp cho trạm (C13) → thí sinh thấy "Form đang mở" và mở được `/form` (B11, G1–G3).

---

## F. Phân quyền & biên

| # | Thử | Kết quả mong đợi | [ ] |
|---|---|---|---|
| F1 | collab gõ URL `/admin` | Redirect về `/` → hiện dashboard **coop** (không vào được admin) | [ ] |
| F2 | participant gõ URL `/coop` | Redirect về `/` → hiện dashboard **participant** | [ ] |
| F3 | Phase = Chung kết, đội KHÔNG đi tiếp xem `/participant` | Card QR hiện "BTC chưa mở điểm danh" (không có QR) | [ ] |
| F4 | Token hết hạn / xóa localStorage giữa chừng | Mọi trang auth đẩy về `/` | [ ] |
| F5 | Quét QR **cũ** sau khi admin mở lại (C7) | Check-in/vào trạm **thất bại** (token đã xoay) | [ ] |
| F6 | Đã đăng nhập, gõ URL `/login` | Redirect về `/` (hiện dashboard theo role, không hiện form login) | [ ] |
| F7 | Gõ path không tồn tại (vd `/abc`) | Redirect về `/` | [ ] |
| F8 | **Chưa** đăng nhập, mở `/register` | Vẫn vào được (trang public) | [ ] |
| F9 | admin/collab gõ URL `/form` | Redirect về `/` (chỉ participant vào được `/form`) | [ ] |

---

## G. Biểu mẫu trạm — `/form` (participant)

> Tiền đề: admin đã cấu hình bài nộp cho trạm (C13); đội đã duyệt và thuộc roster phase hiện tại.
> ⚠️ **Trạng thái code hiện tại**: nút "Gửi bài nộp" và ô upload file **chưa nối API** — test đến mức hiển thị/nhập liệu; bổ sung ca submit khi backend sẵn sàng.

| # | Bối cảnh | Các bước | Kết quả mong đợi | [ ] |
|---|---|---|---|---|
| G1 | Participant có đội trong roster phase | Xem dashboard thí sinh | Card **"Form đang mở"** liệt kê đúng các trạm có bài nộp trong phase/event hiện tại | [ ] |
| G2 | Mở `/form?stationId=...` | Xem trang form | Render đúng cấu hình C13: brief (markdown), field nhập liệu, quiz chọn 1 đáp án, ô "Chọn tệp minh chứng" (đúng số file/loại file) | [ ] |
| G3 | Sidebar "Biểu mẫu khả dụng" | Chọn trạm khác | Nội dung form đổi theo trạm được chọn; URL param không bắt buộc | [ ] |
| G4 | Quiz | Chọn đáp án, đổi đáp án | Chỉ 1 đáp án được đánh dấu active tại một thời điểm | [ ] |
| G5 | Đội **không** thuộc roster phase / chưa có đội | Mở `/form` | Báo "Bạn chưa có đội hoặc chưa có biểu mẫu phù hợp với phase hiện tại" hoặc "Không có biểu mẫu nào khả dụng cho phase hiện tại" | [ ] |

---

## H. Cài đặt tài khoản (nút "Cài đặt" — có ở dashboard admin & thí sinh)

| # | Bối cảnh | Các bước | Kết quả mong đợi | [ ] |
|---|---|---|---|---|
| H1 | Đã đăng nhập | Mở "Cài đặt" → sửa họ tên, SĐT, trường/khoa → lưu | Cập nhật thành công, reload vẫn giữ; ô **email bị khóa** ("Email không thể thay đổi") | [ ] |
| H2 | Ảnh đại diện | "Thêm ảnh đại diện" / "Đổi ảnh đại diện" → nhập URL | Avatar hiện đúng ở trang cài đặt và header/sidebar | [ ] |
| H3 | Đổi mật khẩu đúng | Nhập mật khẩu hiện tại + mới (≥6 ký tự) + nhập lại khớp | Báo "Đã đổi mật khẩu." — logout, đăng nhập lại bằng mật khẩu **mới** OK | [ ] |
| H4 | Đổi mật khẩu sai | (a) sai mật khẩu hiện tại; (b) mật khẩu mới <6 ký tự; (c) nhập lại không khớp | Báo lỗi tương ứng từng ca; mật khẩu **không** đổi | [ ] |
| H5 | Tài khoản đăng nhập bằng Google | Mở phần đổi mật khẩu | Thông báo "Tài khoản của bạn đăng nhập qua Google, không có mật khẩu riêng" — không cho đổi | [ ] |
| H6 | Tài khoản thường | Dùng mục **liên kết Google** | Liên kết xong → đăng nhập được bằng Google | [ ] |
| H7 | Sửa MSSV | Đổi MSSV sang MSSV đã đăng ký với email khác | Báo "MSSV này đã được đăng ký với email khác. Vui lòng kiểm tra lại." | [ ] |

---

## I. Ghi chú khi test
- Lỗi camera → dùng ô "Nhập tay mã đội" (payload `t:<token>` hoặc mã đội Txxxx).
- Mỗi lần admin "Mở điểm danh" là QR mới — báo thí sinh tải lại trang.
- Nếu coop không thấy trạm: kiểm C4 (trạm đã lưu DB) + C5 (đã phân công) + C3 (đúng phase/event).
