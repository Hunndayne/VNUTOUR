# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VNUTour is a unified tour event management system for VNU students. It consists of:
- **Backend**: Discord bot + Django REST API (Python) — handles team/event management, check-ins, and integrations
- **Frontend**: React + Vite web app — QR scanning dashboard and admin panels

PostgreSQL is the single source of truth. The web API writes through Django ORM, while the Discord bot consumes provisioning and broadcast work from the same database.

## Quick Start Commands

### Backend Setup

```bash
cd backend

# Windows: Create and activate venv
python -m venv .venv
.venv\Scripts\activate

# Linux/Mac
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run (API only by default, or set RUN_DISCORD_BOT=1 for bot)
python main.py

# Run migrations only
python webapi/manage.py migrate

# Run specific test
python -m pytest webapi/api/tests/test_team_service.py -v
```

**Environment variables** (backend/.env):
- `DISCORD_TOKEN`: Bot token
- `SMTP_*`: Email configuration
- `DJANGO_AUTOSTART`: Auto-start Django API (default: 1)
- `RUN_DISCORD_BOT`: Enable Discord bot (default: 0)
- `DJANGO_HOST/PORT`: API server address

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Dev server (watch mode, HMR)
npm run dev

# Build for production
npm run build

# Lint
npm lint
```

**Environment variables** (frontend/.env):
- `VITE_API_BASE_URL`: Backend API base URL (e.g., http://localhost:8080)

## Architecture

### Backend: Services Layer Pattern

The Django API uses a service-oriented architecture in `webapi/api/`:

- **services/**: Business logic layer
  - `auth_service.py`: Authentication, account lookup, profile completion checks
  - `team_service.py`: Team CRUD, member management, team approval
  - `checkin_service.py`: Check-in/out logic per station
  - `station_service.py`: Station management within phases
  - `program_service.py`: Phase/sub-event management (registration → stations → scores)
  - `registration_service.py`: Schema-driven participant/team registration
  - `score_service.py`: Team scoring and leaderboard
  - `email_service.py`: Email notifications
  - `discord_service.py`: Discord API integration

- **models.py**: ORM models (Account, Team, Participant, Station, ProgramPhase, SystemSetting, etc.)

- **views_*.py**: HTTP handlers split by domain
  - `views_auth.py`: Login, registration endpoints
  - `views_admin.py`: Admin dashboard (team approval, scoring)
  - `views_checkin.py`: `/api/checkin` QR endpoint
  - `views_station.py`: Station CRUD and leaderboards
  - `views_program.py`: Phase/sub-event management
  - `views_participant.py`: Participant dashboards and profile
  - `views_score.py`: Team scores and rankings

### Backend: Discord Bot (src/)

- **bot/**: Core bot setup
  - `bot.py`: Main bot class with cog loading
  - `config.py`: Configuration and constants
  - `database.py`: Safe async bridge to Django ORM
  - `team_cog.py`: PostgreSQL-backed team provisioning, broadcasts, and heartbeat

- **commands/**: Command handlers
  - `slash_commands.py`: Slash commands for team/phase management
  - `admin_commands.py`: Admin utilities
  - `music_commands.py`: Music playback commands
  - `tour_commands.py`: Tour/station management
  - `qr_commands.py`: QR code generation for check-in

- **events/**: Discord event listeners
  - `member_events.py`: Join/leave role assignment
  - `message_events.py`: Message handling
  - `reaction_events.py`: Reaction-based interactions

### Frontend: Route-Driven SPA

- **App.jsx**: Main router — dispatches to pages by pathname, and redirects a
  signed-in visitor away from `/` and `/login` to their role's home. Access is
  gated per route; a wrong-role visit lands on that role's home instead.
  - `/`: `LandingPage` — public landing (guests only)
  - `/login`: `LoginPage` — Google OAuth + fallback email login
  - `/frame`: `FramePage` — public "ghép khung ảnh" photo-frame tool; listed in
    `PUBLIC_PATHS`, so it renders for everyone (guest or signed-in, any role) and
    is never redirected home. Admin uploads frames under the `frames` tab.
  - `/admin`, `/admin/<tab>`: `AdminDashboard` — tab ∈ `events`, `stations`, `teams`,
    `scores`, `accounts`, `discord`, `email`, `operations`, `frames`, `links`, `system`, `settings`; bare
    `/admin` is the overview, and unknown tabs are rewritten to it. `system` is the
    system-wide settings page (mở/đóng đăng ký, VietQR, schema đăng ký) reached from the
    sidebar, distinct from `settings` = personal account settings reached from the user menu
  - `/coop`: `CoopDashboard` — station duty, QR scanning
  - `/participant`: `ParticipantDashboard` — score view, personal info
  - `/form`: `FormResponses` — form submission (participants)
  - Legacy aliases kept alive for old links: `/checkin` → `/coop`,
    `/paticipant` → `/participant`, `/landing` → `/`
  - `RegisterPage.jsx` exists but is not routed; sign-up goes through `/login?mode=signup`

- **router.js**: the whole routing mechanism — there is no react-router.
  `navigate(to, { replace })`, `useLocation()`, `useRouteSegments()`,
  `useSearchParam(key, fallback)`, `useEnumSearchParam(key, allowed, fallback)`,
  `buildUrl(path, params)`. Screen-local state (sub-tab, open drawer, selected
  row, filters) belongs in that path's query string so a reload and the back
  button both behave: e.g. `/admin/stations?event=3&station=12`,
  `/admin/discord?view=members`, `/admin/events?phase=qualifying&event=5`.
  Use `{ replace: true }` when the page is syncing itself, a push when the user clicked.

- **drafts.jsx**: local autosave for long forms — `useDraftState(key, baseline)`
  returns `[value, setValue, draft]` and mirrors the value into localStorage
  (7-day TTL) under a stable key; `<DraftNotice draft={draft} />` renders the
  restore banner. Call `draft.clear()` after a successful save. Never persist
  passwords, `File`/`Blob` objects, or destructive-confirmation text.
  The hook reads its baseline once on mount, so remount with `key={...}` when
  the record being edited changes. Logging out wipes every stored draft.

- **api.js**: HTTP client with auth header injection, error handling, data normalization
  - `apiRequest(path, options)`: Fetch wrapper with Bearer token
  - `getStoredAuthToken()` / `getStoredUser()`: Session from localStorage
  - `roleHomePath(role)` / `redirectByRole(role)`: admin → `/admin`, collab → `/coop`,
    participant → `/participant`

- **Shared UI**: `ui.jsx` and `adminProgram.js` for reusable components and constants

Deep links depend on an SPA fallback. `frontend/nginx.conf` already serves
`try_files $uri $uri/ /index.html`; Vite's dev server does the same by default.
`/s/<code>` (short links) is the one exception — nginx and Vite's dev proxy
forward it to Django, which answers with a 302 (see `views_shortlink.py`).

## Key Data Flows

### Registration & Team Approval
1. Participant fills `RegisterPage` (schema from `SystemSetting`)
2. Data POSTed to `/api/register` → saved as `Participant` record
3. Admin reviews in `AdminDashboard` → approves via `/api/admin/teams/{id}/approve`
4. Approval triggers Discord role/channel creation (`discord_service`)

### Check-In Flow
1. Collab/Admin opens `CheckinPage` → scans QR (via qr-scanner library)
2. QR contains participant/team ID
3. POST to `/api/checkin` with station ID
4. `checkin_service` validates phase, records check-in, updates scores
5. Frontend shows success/error, leaderboard updates

### Web ↔ Discord Integration
- Web registration and admin actions write `Participant`, `Team`, and related records through Django ORM
- `discord_service.py` exposes PostgreSQL-backed provisioning and broadcast queues to the bot
- The bot stores created Discord role/channel IDs and its heartbeat back in PostgreSQL
- Check-ins, station sessions, QR tokens, and scores remain in PostgreSQL; Discord commands read the same state

## Testing

```bash
# Run all tests
cd backend && python -m pytest webapi/api/tests/ -v

# Test specific module
python -m pytest webapi/api/tests/test_team_service.py::TestTeamCreation -v

# With coverage
python -m pytest webapi/api/tests/ --cov=webapi/api
```

Test files use Django's test client and isolate Discord API calls where needed.

## Important Notes

### Frontend State Management
- Auth state stored in `localStorage` (authToken, user)
- No Redux/Context needed for current scope — pages fetch data on mount
- Use `apiRequest()` for all HTTP; it auto-injects Bearer token and handles auth errors

### Backend Database
- PostgreSQL is required for both local and production runtime
- Migrations in `webapi/api/migrations/`; run `python webapi/manage.py migrate` after pulling
- Models use Django ORM; no raw SQL queries (safer)

### Discord Bot Startup
- Set `RUN_DISCORD_BOT=1` to run bot alongside API
- Bot auto-loads cogs from `src/commands/` and `src/events/`
- Requires `DISCORD_TOKEN` env var with proper server intents

### API Authentication
- JWT tokens from `/api/auth/login` or `/api/auth/google`
- Pass as `Authorization: Bearer <token>` header (handled by `api.js`)
- Tokens expire; logout clears localStorage → redirects to `/login`

### Admin vs. Collab vs. Participant Roles
- **admin**: Full access to all dashboards, team approval, scoring
- **collab**: Check-in only (QR scanner at stations)
- **participant**: View own scores, update profile, see team info

### Registration Schema
- `SystemSetting.registration_schema` stores form fields (JSON)
- `RegisterPage` reads schema and renders dynamic form
- Supports conditional fields per registration type (individual/team)

## Common Dev Tasks

### Add a new API endpoint
1. Define view in `webapi/api/views_*.py`
2. Add URL route in `webapi/api/urls_*.py`
3. Call it from frontend via `apiRequest('/path', options)`
4. Add unit test in `webapi/api/tests/test_*.py`

### Add a Discord command
1. Create method in `src/commands/*.py` with `@app_commands.command()` decorator
2. Or add to existing cog in `src/bot/*.py`
3. Reload bot: command is auto-discovered

### Deploy
- Backend: Push to server, run migrations, set env vars, restart bot+API
- Frontend: `npm run build` → upload `dist/` to web server or CDN

## Agent skills

### Issue tracker

Issues và PRD được quản lý bằng GitHub Issues của repo. Xem `docs/agents/issue-tracker.md`.

### Triage labels

Sử dụng các nhãn `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Xem `docs/agents/triage-labels.md`.

### Domain docs

Repo dùng bố cục single-context với `CONTEXT.md` và `docs/adr/`. Xem `docs/agents/domain.md`.
