# VNUTour — Kiến trúc C4

## Level 1: System Context

```
┌──────────────────────────────────────────────────────────┐
│                        Internet                          │
│                                                          │
│  [Sinh viên / Participant]  [Admin/Ban tổ chức]          │
│          │                         │                     │
│          ▼                         ▼                     │
│   ┌─────────────────────────────────────────┐            │
│   │           VNUTour 2026 System           │            │
│   │  (Web + Bot + API + DB)                 │            │
│   └─────────────────────────────────────────┘            │
│          │               │          │                    │
│          ▼               ▼          ▼                    │
│  [Google OAuth]   [Discord API]  [SMTP Email]            │
│                                                          │
│          └──── [R2/S3 Object Storage] ──────┘            │
└──────────────────────────────────────────────────────────┘
```

**Người dùng:**

- **Participant** (sinh viên): Đăng ký, xem điểm, check-in, ghép khung ảnh
- **Collab** (ban hỗ trợ): Quét QR tại trạm, vận hành trạm
- **Admin**: Duyệt đội, quản lý trạm/sự kiện, broadcast Discord, gửi email
- **Master Admin**: Tất cả Admin + quyền cấu hình giai đoạn chương trình

**Hệ thống ngoài:**

- **Google OAuth** — đăng nhập nhanh bằng Google
- **Discord API** — tạo role/channel, broadcast, liên kết MSSV
- **SMTP** — gửi email thông báo
- **Cloudflare R2 / S3** — lưu file đính kèm, ảnh, khung ảnh

---

## Level 2: Containers

```
┌─────────────────────────────────────────────────────────────┐
│                    VNUTour System                           │
│                                                             │
│  ┌───────────────────┐    ┌──────────────────────────────┐  │
│  │  Frontend (Nginx) │    │      Backend (Gunicorn)      │  │
│  │  React + Vite SPA │───►│      Django REST API         │  │
│  │  :5173 (dev)      │    │      :8080 (prod/dev)        │  │
│  │  :80 (prod)       │    └──────────────────────────────┘  │
│  └───────────────────┘                  │                   │
│                                         │                   │
│  ┌───────────────────┐    ┌─────────────▼────────────────┐  │
│  │  Discord Bot      │    │         PostgreSQL 16        │  │
│  │  (discord.py)     │───►│   (nguồn dữ liệu duy nhất)  │  │
│  │  python main.py   │    └──────────────────────────────┘  │
│  └───────────────────┘                  │                   │
│                                         │                   │
│  ┌───────────────────┐    ┌─────────────▼────────────────┐  │
│  │  Email Worker     │    │     R2/Local File Storage    │  │
│  │  (management cmd) │    │  (ảnh, attachment, frames)   │  │
│  │  process_email_   │    └──────────────────────────────┘  │
│  │  queue --watch    │                                      │
│  └───────────────────┘                                      │
└─────────────────────────────────────────────────────────────┘
```

**Ghi chú triển khai:**

- Dev: `docker-compose.dev.yml` — PostgreSQL trong Docker, backend/frontend local
- Prod: `docker-compose.yml` hoặc Kubernetes (`k8s/`)
- Kubernetes có monitoring: Prometheus + Grafana + kube-state-metrics + node-exporter

---

## Level 3: Components — Backend

```
backend/
├── main.py                  ← Entry point: khởi động Django + bot
│
├── src/                     ← Discord Bot
│   ├── bot/
│   │   ├── bot.py           ← VnuTourBot class, cog loader
│   │   ├── config.py        ← Constants, env vars
│   │   ├── database.py      ← Async bridge sang Django ORM
│   │   ├── logger.py        ← Logging setup
│   │   └── team_cog.py      ← Provisioning, broadcast, heartbeat
│   ├── commands/
│   │   ├── slash_commands.py ← /team, /phase commands
│   │   ├── admin_commands.py ← Admin utilities
│   │   ├── music_commands.py ← Phát nhạc (YouTube)
│   │   ├── tour_commands.py  ← Tour/trạm management
│   │   ├── qr_commands.py    ← Tạo QR check-in
│   │   └── help_command.py   ← Help
│   ├── events/
│   │   ├── member_events.py  ← Join/leave → role assignment
│   │   ├── message_events.py ← Message handling
│   │   └── reaction_events.py← Reaction interactions
│   ├── music/               ← Music playback (yt-dlp, PyNaCl)
│   ├── tasks/               ← Background tasks
│   └── utils/               ← Bot utilities
│
└── webapi/                  ← Django REST API
    ├── serverapi/           ← Django settings, wsgi
    └── api/
        ├── models.py        ← 23 ORM models (1129 lines)
        ├── urls.py          ← Router tổng → 15 sub-routers
        ├── urls_*.py        ← Sub-routers theo domain
        ├── views_*.py       ← HTTP handlers theo domain
        └── services/        ← Business logic layer (26 services)
```

---

## Level 3: Components — Frontend

```
frontend/src/
├── main.jsx                 ← Entry point React
├── App.jsx                  ← Router chính (không dùng react-router)
├── router.js                ← Custom router: navigate, useLocation, buildUrl
├── api.js                   ← HTTP client: apiRequest, auth, session
│
├── Pages (theo role):
│   ├── LandingPage.jsx      ← Trang chủ công khai
│   ├── LoginPage.jsx        ← Google OAuth + email login
│   ├── RegisterPage.jsx     ← Đăng ký (route /login?mode=signup)
│   ├── AdminDashboard.jsx   ← Dashboard admin (54KB — nhiều tabs)
│   ├── CoopDashboard.jsx    ← Dashboard collab: QR scan (50KB)
│   ├── ParticipantDashboard.jsx ← Dashboard participant (108KB!)
│   └── FormResponses.jsx    ← Form nộp bài của participant (40KB)
│
├── Sub-pages trong Admin:
│   ├── TeamsPage.jsx        ← Quản lý đội (53KB)
│   ├── StationsPage.jsx     ← Quản lý trạm (119KB — lớn nhất!)
│   ├── ScoreManagementPage.jsx ← Quản lý điểm (44KB)
│   ├── EventManagementPage.jsx ← Quản lý sự kiện/phase (26KB)
│   ├── DiscordPage.jsx      ← Quản lý Discord (40KB)
│   ├── EmailPage.jsx        ← Gửi email hàng loạt (25KB)
│   ├── AccountsPage.jsx     ← Quản lý tài khoản (27KB)
│   ├── FramesAdminPanel.jsx ← Quản lý khung ảnh
│   ├── LinksAdminPanel.jsx  ← Quản lý short links
│   ├── SiteSettingsPage.jsx ← Cài đặt hệ thống
│   ├── OperationsPage.jsx   ← Operations panel
│   └── SettingsPage.jsx     ← Cài đặt tài khoản
│
├── Special pages:
│   ├── FramePage.jsx        ← Ghép khung ảnh (công khai)
│   ├── StationRunPage.jsx   ← Trang chạy trạm
│   └── tai-tro.jsx          ← Trang tài trợ
│
└── Utilities:
    ├── ui.jsx               ← Shared UI components
    ├── adminProgram.js      ← Constants phases + sub-events
    ├── drafts.jsx           ← Local autosave (7-day TTL localStorage)
    ├── discordConnect.js    ← Discord OAuth flow
    ├── frameApi.js          ← API calls cho photo frame
    ├── imageCompress.js     ← Client-side image compression
    ├── antibot.js/.jsx      ← Anti-bot protection
    └── index.css            ← Global CSS (Tailwind)
```

---

## Deployment: Kubernetes Production

```
k8s/
├── 00.namespace.yaml        ← Namespace: vnutour
├── 01.configmap.yaml        ← Config (DJANGO_HOST, ALLOWED_HOSTS...)
├── 02.secret.yaml           ← Secrets (DB_PASSWORD, DISCORD_TOKEN...)
├── 03.storage.yaml          ← PersistentVolumeClaims
├── 04.postgres.yaml         ← PostgreSQL StatefulSet
├── 05.migrate-job.yaml      ← Migrate Job (run once)
├── 06.backend.yaml          ← Django API Deployment
├── 07.bot.yaml              ← Discord Bot Deployment
├── 08.email-worker.yaml     ← Email Worker Deployment
├── 09.frontend.yaml         ← Nginx+React Deployment
├── 10.ingress.yaml          ← Nginx Ingress + TLS
├── 11-15.monitoring.yaml    ← Prometheus + Grafana
├── 16.backup-cronjob.yaml   ← Auto backup cronjob
└── staging/                 ← Staging environment override
```

**Domains (production):**

- Frontend: `vnutour.suctremmt.com`
- Staging: `vnutour.hunn.io.vn`
- Short links: `/s/<code>` → Django redirect
