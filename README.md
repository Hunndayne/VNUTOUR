# VNUTour 2026

Hệ thống quản lý sự kiện tour cho sinh viên ĐHQG (VNU), gồm backend (Discord bot + API) và frontend (web quét QR điểm danh) trong một thư mục thống nhất.

## Cấu trúc

```
vnutour/
├── backend/    # Discord bot + Django API (Python) — xem backend/README.md
│   ├── main.py         # Entry point: chạy bot + Django API cùng lúc
│   ├── src/            # Mã nguồn bot (commands, events, music, utils)
│   ├── webapi/         # Django REST API
│   ├── docs/
│   └── requirements.txt
└── frontend/   # Web quét QR điểm danh (React + Vite + Tailwind) — xem frontend/README.md
    ├── src/App.jsx     # Toàn bộ UI/logic
    └── package.json
```

## Luồng tổng thể

Web đăng ký và trang quản trị ghi trực tiếp vào **PostgreSQL** qua Django ORM. Discord bot dùng cùng cơ sở dữ liệu để nhận hàng đợi tạo role/kênh, liên kết thành viên và gửi broadcast. QR, check-in, trạm và bảng điểm đều có PostgreSQL làm nguồn dữ liệu duy nhất.

## Chạy nhanh

**Backend** (chi tiết trong `backend/README.md`):
```bash
cd backend
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt
python main.py
```

**Frontend**:
```bash
cd frontend
npm install
npm run dev
```

Cấu hình `frontend/.env` → `VITE_API_BASE_URL` trỏ tới địa chỉ API của backend.

## Đóng góp

Rất hoan nghênh issue và pull request! Khi mở issue, chọn mẫu **Báo lỗi** hoặc
**Đề xuất tính năng**. Với pull request, vui lòng chạy test/lint tương ứng trước khi gửi
(backend: `pytest`; frontend: `npm run lint && npm run build`).

## Giấy phép

Phát hành theo giấy phép [MIT](LICENSE).
