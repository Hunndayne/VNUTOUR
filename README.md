# VNUTour 2025

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

Google Sheet (đăng ký) → đồng bộ vào **MongoDB** → Discord bot tạo đội/role/kênh và phát QR → web app quét QR gọi `/api/checkin` → ghi check-in về MongoDB (và xuất ngược ra Google Sheet check-in).

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
