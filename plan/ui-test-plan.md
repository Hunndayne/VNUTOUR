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

---

## F. Phân quyền & biên

| # | Thử | Kết quả mong đợi | [ ] |
|---|---|---|---|
| F1 | collab gõ URL `/admin` | Redirect về `/` → hiện dashboard **coop** (không vào được admin) | [ ] |
| F2 | participant gõ URL `/coop` | Redirect về `/` → hiện dashboard **participant** | [ ] |
| F3 | Phase = Chung kết, đội KHÔNG đi tiếp xem `/participant` | Card QR hiện "BTC chưa mở điểm danh" (không có QR) | [ ] |
| F4 | Token hết hạn / xóa localStorage giữa chừng | Mọi trang auth đẩy về `/` | [ ] |
| F5 | Quét QR **cũ** sau khi admin mở lại (C7) | Check-in/vào trạm **thất bại** (token đã xoay) | [ ] |

---

## G. Ghi chú khi test
- Lỗi camera → dùng ô "Nhập tay mã đội" (payload `t:<token>` hoặc mã đội Txxxx).
- Mỗi lần admin "Mở điểm danh" là QR mới — báo thí sinh tải lại trang.
- Nếu coop không thấy trạm: kiểm C4 (trạm đã lưu DB) + C5 (đã phân công) + C3 (đúng phase/event).
