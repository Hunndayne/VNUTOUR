import { Fragment, useEffect, useState } from 'react'
import logoImage from './assets/vnutour-logo.png'
import TeamsPage from './TeamsPage.jsx'
import StationsPage from './StationsPage.jsx'
import DiscordPage from './DiscordPage.jsx'
import AccountsPage from './AccountsPage.jsx'
import EventManagementPage from './EventManagementPage.jsx'
import ScoreManagementPage from './ScoreManagementPage.jsx'
import { FIXED_PHASES, PROGRAM_STORAGE_KEY, getPhaseInfo } from './adminProgram.js'
import { apiRequest, formatDateTime, getStoredUser, logoutAndRedirect, normalizeProgramForFrontend } from './api.js'

// ─────────────────────────────────────────────────────────────────────
// Icon set — outline SVGs, no emoji
// ─────────────────────────────────────────────────────────────────────
const ICON_PATHS = {
  grid: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 8.25V6Zm9.75 0A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Zm-9.75 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25Zm9.75 0a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
  users: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z',
  flag: 'M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5',
  chat: 'M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z',
  userCircle: 'M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  clock: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  cap: 'M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5',
  link: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244',
  ticket: 'M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z',
  compass: 'M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
  pin: 'M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z',
  check: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  checkPlain: 'M4.5 12.75l6 6 9-13.5',
  xmark: 'm9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  doc: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
  userPlus: 'M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z',
  logout: 'M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25',
  star: 'M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z',
  menu: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5',
  gear: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.241.437-.613.43-.992a7.723 7.723 0 0 1 0-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
}

function Icon({ name, className = 'h-5 w-5' }) {
  const d = ICON_PATHS[name]
  if (!d) return null
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((seg, i) => <path key={i} d={i === 0 ? seg : `M${seg}`} />)}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Tổng quan', icon: 'grid' },
  { key: 'events', label: 'Quản lý sự kiện', icon: 'ticket' },
  { key: 'teams', label: 'Quản lý đội', icon: 'users' },
  { key: 'scores', label: 'Điểm & suất đi tiếp', icon: 'check' },
  { key: 'stations', label: 'Quản lý trạm', icon: 'flag' },
  { key: 'discord', label: 'Quản lý Discord', icon: 'chat' },
  { key: 'accounts', label: 'Quản lý tài khoản', icon: 'userCircle' },
]

const PHASES = FIXED_PHASES

// ─────────────────────────────────────────────────────────────────────
// Mock data (UI demo — chưa nối API)
// ─────────────────────────────────────────────────────────────────────
const DATA = {
  registration: {
    actions: [
      { tone: 'clay', icon: 'clock', value: 5, label: 'đội đang chờ duyệt', cta: 'Xem & duyệt', tab: 'teams' },
      { tone: 'sky', icon: 'chat', value: 2, label: 'đội Discord chưa tạo', cta: 'Đồng bộ ngay', tab: 'discord' },
    ],
    kpis: [
      { icon: 'users', label: 'Tổng số đội', value: 42, sub: '28 đã duyệt · 1 từ chối', tone: 'gold', tab: 'teams' },
      { icon: 'clock', label: 'Chờ duyệt', value: 5, sub: 'Cần admin xử lý', tone: 'clay', tab: 'teams' },
      { icon: 'cap', label: 'Người đã đăng ký', value: 198, sub: 'Thành viên trong các đội', tone: 'trail', tab: 'teams' },
      { icon: 'link', label: 'Đã có tài khoản web', value: 120, sub: '61% · còn 78 chưa tạo', tone: 'sky', tab: 'accounts' },
    ],
    progress: [
      { label: 'Đội đã được duyệt', value: 28, total: 42, tone: 'gold' },
      { label: 'Thành viên đã tạo tài khoản', value: 120, total: 198, tone: 'trail' },
    ],
    activity: [
      { type: 'submit', team: 'Những chiến binh', time: '14:32' },
      { type: 'approve', team: 'Những người bạn', time: '14:15' },
      { type: 'reject', team: 'Team trùng tên', time: '13:58' },
      { type: 'submit', team: 'Fire Phoenix', time: '08:45' },
      { type: 'signup', team: 'Nguyễn Văn A đã tạo tài khoản', time: '08:30' },
    ],
  },
  event: {
    kpis: [
      { icon: 'check', label: 'Đội đã check-in', value: 30, sub: '71% trên tổng 42 đội', tone: 'trail', tab: 'dashboard' },
      { icon: 'ticket', label: 'Voucher đã phát', value: 150, sub: 'Tương đương 150 người', tone: 'gold', tab: 'dashboard' },
      { icon: 'compass', label: 'Đội đang thi đấu', value: 18, sub: 'Đang ở trong các trạm', tone: 'sky', tab: 'stations' },
      { icon: 'flag', label: 'Trạm hoạt động', value: '8/10', sub: '2 trạm chưa có đội', tone: 'sand', tab: 'stations' },
    ],
    stations: [
      { name: 'Trạm 1 · UIT', current: 4, done: 22 },
      { name: 'Trạm 2 · Thư viện', current: 2, done: 18 },
      { name: 'Trạm 3 · GDQP', current: 3, done: 12 },
      { name: 'Trạm 4 · Bách Khoa', current: 1, done: 9 },
    ],
    leaderboard: [
      { rank: 1, team: 'Sky Walker', score: 980 },
      { rank: 2, team: 'Fire Phoenix', score: 940 },
      { rank: 3, team: 'Những chiến binh', score: 915 },
      { rank: 4, team: 'Ice Breaker', score: 880 },
      { rank: 5, team: 'Thunder', score: 860 },
    ],
    activity: [
      { type: 'score', team: 'Sky Walker +120đ · Trạm 3', time: '15:01' },
      { type: 'checkout', team: 'Fire Phoenix rời Trạm 2', time: '15:00' },
      { type: 'checkin', team: 'Thunder vào Trạm 5', time: '14:57' },
      { type: 'checkin', team: 'Ice Breaker vào Trạm 1', time: '14:54' },
    ],
  },
}

void DATA

// Light "field map" accents — icon/edge color per tone
const TONE = {
  gold: { chip: 'bg-gold/15 text-gold', edge: 'bg-gold', bar: 'bg-gold' },
  trail: { chip: 'bg-trail/12 text-trail', edge: 'bg-trail', bar: 'bg-trail' },
  clay: { chip: 'bg-clay/12 text-clay', edge: 'bg-clay', bar: 'bg-clay' },
  sky: { chip: 'bg-[#3E7CA8]/12 text-[#3E7CA8]', edge: 'bg-[#3E7CA8]', bar: 'bg-[#3E7CA8]' },
  sand: { chip: 'bg-[#B07D4A]/15 text-[#B07D4A]', edge: 'bg-[#B07D4A]', bar: 'bg-[#B07D4A]' },
}

const CARD = 'rounded-xl border border-stone bg-white shadow-[0_1px_3px_rgba(32,49,43,0.05)]'

function getUser() {
  return getStoredUser() || { username: 'admin', email: 'admin@vnutour.vn' }
}

function getCurrentPhaseLabel(currentPhase) {
  return getPhaseInfo(currentPhase).label
}

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    forbidden: 'Bạn không có quyền truy cập phần quản trị này.',
    invalid_json: 'Dữ liệu gửi lên không hợp lệ.',
    phase_not_found: 'Không tìm thấy phase cần thao tác.',
    not_found: 'Không tìm thấy dữ liệu cần chỉnh sửa.',
    missing_name: 'Event cần có tên trước khi lưu.',
  }
  return map[code] || 'Không thể đồng bộ dữ liệu admin.'
}

// ─────────────────────────────────────────────────────────────────────
// Ambient topographic contour (subtle, ties to the map/expedition world)
// ─────────────────────────────────────────────────────────────────────
function Contours() {
  const rings = (size, n, step) =>
    Array.from({ length: n }, (_, i) => (
      <circle key={i} cx={size / 2} cy={size / 2} r={30 + i * step} fill="none" stroke="currentColor" strokeWidth="1" />
    ))
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden text-ink/[0.05]" aria-hidden="true">
      <svg viewBox="0 0 440 440" className="absolute -right-28 -top-28 h-[440px] w-[440px]">{rings(440, 9, 34)}</svg>
      <svg viewBox="0 0 480 480" className="absolute -left-32 -bottom-28 h-[480px] w-[480px]">{rings(480, 8, 40)}</svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────
function Sidebar({ activeTab, onTabChange, open, onClose, user }) {
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm lg:hidden" onClick={onClose} />}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-stone bg-white transition-transform duration-300 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center gap-3 border-b border-stone px-5">
          <img src={logoImage} alt="VNUTour" className="h-9 w-9 object-contain" />
          <div className="leading-none">
            <p className="font-display text-base font-bold tracking-tight text-ink">VNUTour</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">Control</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map(item => {
            const active = activeTab === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onTabChange(item.key)}
                className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  active ? 'bg-gold/10 font-semibold text-ink' : 'font-medium text-ink/55 hover:bg-paper hover:text-ink'
                }`}
              >
                {active && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gold" />}
                <Icon name={item.icon} className="h-5 w-5" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="border-t border-stone p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-trail font-display text-sm font-bold text-white">
              {(user.username || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{user.username}</p>
              <p className="truncate font-mono text-[11px] text-ink/45">{user.email}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────
function Header({ title, onMenu, currentPhaseLabel, user }) {
  return (
    <header className="sticky top-0 z-30 border-b border-stone bg-paper/85 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onMenu}
            className="rounded-lg p-2 text-ink/55 transition hover:bg-white hover:text-ink lg:hidden" aria-label="Mở menu">
            <Icon name="menu" />
          </button>
          <h1 className="font-display text-lg font-bold tracking-tight text-ink">{title}</h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold">
            <span className="h-2 w-2 rounded-full bg-gold" />
            <span className="hidden sm:inline">Phase:</span> {currentPhaseLabel}
          </div>

          <button type="button" className="rounded-lg border border-stone bg-white p-2 text-ink/45 transition hover:text-ink" title="Cài đặt hệ thống">
            <Icon name="gear" />
          </button>

          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-trail font-display text-sm font-bold text-white">
            {(user.username || 'A').charAt(0).toUpperCase()}
          </div>
        </div>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Signature: expedition phase trail
// ─────────────────────────────────────────────────────────────────────
function PhaseTrail({ phase, phases, onChange }) {
  const visiblePhases = phases?.length ? phases : PHASES
  const current = visiblePhases.findIndex((p) => p.key === phase)
  return (
    <div className={`${CARD} p-5`}>
      <div className="mb-5 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">Hành trình sự kiện</p>
        <p className="text-sm text-ink/55">{visiblePhases[current]?.hint}</p>
      </div>

      <div className="flex items-start">
        {visiblePhases.map((p, i) => {
          const done = i < current
          const isCurrent = i === current
          const leftFilled = i <= current && i > 0
          const rightFilled = i < current
          return (
            <Fragment key={p.key}>
              <button type="button" onClick={() => onChange(p.key)} className="flex flex-1 flex-col items-center">
                <div className="flex w-full items-center">
                  <Segment filled={leftFilled} hidden={i === 0} />
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition ${
                      isCurrent
                        ? 'border-gold bg-gold text-white'
                        : done
                          ? 'border-trail bg-trail text-white'
                          : 'border-stone bg-white text-ink/30'
                    }`}
                  >
                    {isCurrent ? <Icon name="flag" className="h-4 w-4" />
                      : done ? <Icon name="checkPlain" className="h-4 w-4" />
                      : <span className="font-mono text-xs font-semibold">{i + 1}</span>}
                  </span>
                  <Segment filled={rightFilled} hidden={i === visiblePhases.length - 1} />
                </div>
                <span className={`mt-2 text-sm ${isCurrent ? 'font-semibold text-ink' : 'text-ink/55'}`}>{p.label}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink/35">
                  {done ? 'xong' : isCurrent ? 'hiện tại' : 'sắp tới'}
                </span>
              </button>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function Segment({ filled, hidden }) {
  if (hidden) return <span className="flex-1" />
  return filled
    ? <span className="h-[2px] flex-1 bg-trail" />
    : <span className="h-0 flex-1 border-t-2 border-dashed border-stone" />
}

// ─────────────────────────────────────────────────────────────────────
// Reusable pieces
// ─────────────────────────────────────────────────────────────────────
function SectionCard({ title, action, children }) {
  return (
    <div className={`${CARD} p-5`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

function ActionCard({ data, onNavigate }) {
  const t = TONE[data.tone]
  return (
    <button
      type="button"
      onClick={() => onNavigate(data.tab)}
      className={`group flex items-center justify-between gap-4 overflow-hidden ${CARD} pl-0 pr-5 text-left transition hover:shadow-[0_3px_10px_rgba(32,49,43,0.08)]`}
    >
      <div className="flex items-center gap-4 py-4">
        <span className={`h-12 w-1.5 rounded-r-full ${t.edge}`} />
        <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${t.chip}`}>
          <Icon name={data.icon} />
        </span>
        <div>
          <p className="font-mono text-2xl font-semibold text-ink">{data.value}</p>
          <p className="text-sm text-ink/55">{data.label}</p>
        </div>
      </div>
      <span className="shrink-0 text-sm font-semibold text-ink/60 transition group-hover:translate-x-0.5 group-hover:text-ink">
        {data.cta} →
      </span>
    </button>
  )
}

function StatCard({ data, onNavigate }) {
  const t = TONE[data.tone] || TONE.gold
  return (
    <button
      type="button"
      onClick={() => data.tab && onNavigate(data.tab)}
      className={`${CARD} p-5 text-left transition hover:shadow-[0_3px_10px_rgba(32,49,43,0.08)]`}
    >
      <div className="flex items-center justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${t.chip}`}>
          <Icon name={data.icon} />
        </span>
      </div>
      <p className="mt-4 font-mono text-3xl font-semibold leading-none text-ink">{data.value}</p>
      <p className="mt-2 text-sm font-medium text-ink/70">{data.label}</p>
      <p className="mt-1 text-xs text-ink/40">{data.sub}</p>
    </button>
  )
}

function ProgressPanel({ items }) {
  return (
    <SectionCard title="Tiến độ đăng ký">
      <div className="space-y-5">
        {items.map((p, i) => {
          const pct = Math.round((p.value / p.total) * 100)
          return (
            <div key={i}>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink/70">{p.label}</span>
                <span className="font-mono text-sm text-ink">
                  {p.value}<span className="text-ink/35">/{p.total}</span>
                  <span className="ml-2 text-xs text-ink/45">{pct}%</span>
                </span>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-paper">
                <div className={`h-full rounded-full ${TONE[p.tone].bar} transition-all duration-700`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

function StationPanel({ stations }) {
  const max = Math.max(...stations.map(s => s.done + s.current), 1)
  return (
    <SectionCard title="Tiến độ theo trạm">
      <div className="space-y-4">
        {stations.map((s, i) => (
          <div key={i}>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink/70">{s.name}</span>
              <span className="font-mono text-xs text-ink/45">
                <span className="text-[#3E7CA8]">{s.current} đang chơi</span> · {s.done} xong
              </span>
            </div>
            <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-paper">
              <div className="h-full bg-trail" style={{ width: `${(s.done / max) * 100}%` }} />
              <div className="h-full bg-[#3E7CA8]" style={{ width: `${(s.current / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

function Leaderboard({ rows }) {
  const rankStyle = (rank) => {
    if (rank === 1) return 'bg-gold/20 text-gold'
    if (rank === 2) return 'bg-ink/10 text-ink/70'
    if (rank === 3) return 'bg-[#B07D4A]/20 text-[#B07D4A]'
    return 'bg-paper text-ink/40'
  }
  return (
    <SectionCard title="Bảng xếp hạng" action={<button className="text-xs font-medium text-trail hover:underline">Xem tất cả →</button>}>
      <div className="space-y-1">
        {rows.map(r => (
          <div key={r.rank} className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-paper">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold ${rankStyle(r.rank)}`}>
              {r.rank}
            </span>
            <span className="flex-1 truncate text-sm font-medium text-ink">{r.team}</span>
            <span className="font-mono text-sm font-semibold text-ink">{r.score}</span>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

const ACTIVITY_META = {
  submit: { icon: 'doc', tone: 'sky', label: 'đã gửi duyệt' },
  approve: { icon: 'check', tone: 'trail', label: 'được duyệt' },
  reject: { icon: 'xmark', tone: 'clay', label: 'bị từ chối' },
  signup: { icon: 'userPlus', tone: 'gold', label: '' },
  checkin: { icon: 'pin', tone: 'trail', label: '' },
  checkout: { icon: 'logout', tone: 'sand', label: '' },
  score: { icon: 'star', tone: 'gold', label: '' },
}

function ActivityFeed({ items }) {
  return (
    <SectionCard title="Hoạt động gần đây">
      <div className="space-y-3.5">
        {items.map((it, i) => {
          const m = ACTIVITY_META[it.type] || ACTIVITY_META.submit
          return (
            <div key={i} className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${TONE[m.tone].chip}`}>
                <Icon name={m.icon} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink/80">
                  <span className="font-medium text-ink">{it.team}</span>
                  {m.label && <span className="text-ink/45"> {m.label}</span>}
                </p>
              </div>
              <span className="shrink-0 font-mono text-xs text-ink/35">{it.time}</span>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Dashboard content per phase
// ─────────────────────────────────────────────────────────────────────
function DashboardOverview({ phase, onNavigate, overview, activityItems, scoreboard, loading }) {
  const isEvent = phase === 'qualifying' || phase === 'final'
  const isEnded = phase === 'ended'
  const stats = overview?.stats || {}
  const phaseStats = overview?.phase_stats || {}
  const totalTeams = Number(stats.total_teams) || 0
  const approvedTeams = Number(stats.approved_teams) || 0
  const totalParticipants = Number(stats.total_participants) || 0
  const reviewCount = Math.max(totalTeams - approvedTeams, 0)
  const phaseEventCount = Object.keys(phaseStats).length

  const activity = (activityItems || []).map((item) => {
    if (item.type === 'event_checkin') {
      return {
        type: 'checkin',
        team: `${item.team_name} · ${item.event}`,
        time: formatDateTime(item.time),
      }
    }
    return {
      type: item.action === 'exit' ? 'checkout' : 'checkin',
      team: `${item.team_name} ${item.action === 'exit' ? 'rời' : 'vào'} ${item.station}`,
      time: formatDateTime(item.time),
    }
  })

  const leaderboardRows = (scoreboard?.leaderboard || [])
    .slice(0, 5)
    .map((item, index) => ({
      rank: index + 1,
      team: item.team_name || item.team_code,
      score: item.total_points || 0,
    }))

  const stationRows = Object.entries(phaseStats)
    .slice(0, 5)
    .map(([name, item]) => ({
      name,
      current: item.active_station_sessions || 0,
      done: item.checkins || 0,
    }))

  const registrationActions = [
    { tone: 'clay', icon: 'clock', value: reviewCount, label: 'đội cần xử lý', cta: 'Xem đội', tab: 'teams' },
    { tone: 'sky', icon: 'ticket', value: phaseEventCount, label: 'event trong phase', cta: 'Mở sự kiện', tab: 'events' },
  ]

  const registrationKpis = [
    { icon: 'users', label: 'Tổng số đội', value: totalTeams, sub: `${approvedTeams} đã duyệt`, tone: 'gold', tab: 'teams' },
    { icon: 'clock', label: 'Đang chờ xử lý', value: reviewCount, sub: 'Bao gồm draft và chờ duyệt', tone: 'clay', tab: 'teams' },
    { icon: 'cap', label: 'Thành viên', value: totalParticipants, sub: 'Đang có trong các đội', tone: 'trail', tab: 'teams' },
    { icon: 'ticket', label: 'Event đã tạo', value: phaseEventCount, sub: 'Trong phase đang xem', tone: 'sky', tab: 'events' },
  ]

  const eventKpis = [
    { icon: 'users', label: 'Đội trong hệ thống', value: totalTeams, sub: `${approvedTeams} đã duyệt`, tone: 'gold', tab: 'teams' },
    { icon: 'check', label: 'Đội trên bảng điểm', value: scoreboard?.roster_count || 0, sub: scoreboard?.uses_phase_roster ? 'Theo roster phase' : 'Theo đội đã duyệt', tone: 'trail', tab: 'scores' },
    { icon: 'flag', label: 'Event có dữ liệu', value: phaseEventCount, sub: 'Có activity hoặc check-in/trạm', tone: 'sky', tab: 'events' },
    { icon: 'chat', label: 'Hoạt động gần đây', value: activity.length, sub: 'Feed mới nhất', tone: 'sand', tab: 'dashboard' },
  ]

  return (
    <div className="space-y-5">
      {loading && (
        <div className={`${CARD} px-4 py-3 text-sm text-ink/45`}>
          Đang đồng bộ số liệu dashboard...
        </div>
      )}

      {phase === 'registration' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {registrationActions.map((item, index) => <ActionCard key={index} data={item} onNavigate={onNavigate} />)}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(isEvent || isEnded ? eventKpis : registrationKpis).map((item, index) => (
          <StatCard key={index} data={item} onNavigate={onNavigate} />
        ))}
      </div>

      {phase === 'registration' ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <ProgressPanel
            items={[
              { label: 'Đội đã được duyệt', value: approvedTeams, total: Math.max(totalTeams, 1), tone: 'gold' },
              { label: 'Đội đang cần xử lý', value: reviewCount, total: Math.max(totalTeams, 1), tone: 'trail' },
            ]}
          />
          <ActivityFeed items={activity} />
        </div>
      ) : isEvent ? (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <StationPanel stations={stationRows} />
            <ActivityFeed items={activity} />
          </div>
          <Leaderboard rows={leaderboardRows} />
        </>
      ) : (
        <Leaderboard rows={leaderboardRows} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Placeholder for other tabs
// ─────────────────────────────────────────────────────────────────────
function PlaceholderPage({ title, icon }) {
  return (
    <div className={`flex flex-col items-center justify-center ${CARD} border-dashed py-28 text-center`}>
      <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-paper text-ink/40">
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <h2 className="mt-4 font-display text-lg font-semibold text-ink/70">{title}</h2>
      <p className="mt-2 text-sm text-ink/40">Đang phát triển — sẽ sớm ra mắt</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [user, setUser] = useState(getUser())
  const [programState, setProgramState] = useState(() => normalizeProgramForFrontend())
  const [overview, setOverview] = useState(null)
  const [activityItems, setActivityItems] = useState([])
  const [scoreboard, setScoreboard] = useState(null)
  const [loadingProgram, setLoadingProgram] = useState(true)
  const [loadingDashboard, setLoadingDashboard] = useState(true)
  const [, setBusyAction] = useState('')
  const [apiError, setApiError] = useState('')

  const loadProgram = async () => {
    const [me, programPayload] = await Promise.all([
      apiRequest('/auth/me'),
      apiRequest('/program'),
    ])
    setUser((current) => ({ ...current, ...me }))
    setProgramState(normalizeProgramForFrontend(programPayload))
  }

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        setLoadingProgram(true)
        await loadProgram()
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError(explainApiError(error))
      } finally {
        if (!cancelled) {
          setLoadingProgram(false)
        }
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(PROGRAM_STORAGE_KEY, JSON.stringify(programState))
  }, [programState])

  const phaseOptions = PHASES
  const phase = programState.currentPhase
  const currentPhaseLabel = getCurrentPhaseLabel(phase)
  const currentPhaseEvents = programState.subEventsByPhase[phase] ?? []

  useEffect(() => {
    let cancelled = false

    const loadDashboard = async () => {
      try {
        setLoadingDashboard(true)
        const results = await Promise.allSettled([
          apiRequest(`/dashboard/overview?phase=${phase}`),
          apiRequest('/activity'),
          apiRequest(`/scores/phases/${phase}`),
        ])

        if (cancelled) return

        if (results[0].status === 'fulfilled') {
          setOverview(results[0].value)
        }
        if (results[1].status === 'fulfilled') {
          setActivityItems(results[1].value?.items || [])
        }
        if (results[2].status === 'fulfilled') {
          setScoreboard(results[2].value)
        } else {
          setScoreboard(null)
        }

        const rejected = results.find(item => item.status === 'rejected')
        if (rejected) {
          const error = rejected.reason
          if (error?.status === 401) {
            logoutAndRedirect('/')
            return
          }
          setApiError(explainApiError(error))
        }
      } finally {
        if (!cancelled) {
          setLoadingDashboard(false)
        }
      }
    }

    if (!phase) return
    loadDashboard()
    return () => {
      cancelled = true
    }
  }, [phase])

  const withBusy = async (busyKey, task) => {
    setBusyAction(busyKey)
    setApiError('')
    try {
      await task()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusyAction('')
    }
  }

  const updatePhaseSchedule = (phaseKey, patch) => withBusy(`phase:${phaseKey}`, async () => {
    await apiRequest(`/program/phases/${phaseKey}`, {
      method: 'PATCH',
      body: {
        start_date: patch.startDate || null,
        end_date: patch.endDate || null,
      },
    })
    await loadProgram()
  })

  const setCurrentPhase = (phaseKey) => withBusy(`current-phase:${phaseKey}`, async () => {
    await apiRequest('/program/current-phase', {
      method: 'PUT',
      body: { phase_key: phaseKey },
    })
    await loadProgram()
  })

  const createSubEventInPhase = (phaseKey, draft) => withBusy(`create-event:${phaseKey}`, async () => {
    await apiRequest(`/program/phases/${phaseKey}/sub-events`, {
      method: 'POST',
      body: {
        name: draft.name,
        type: draft.type,
        start_date: draft.startDate || null,
        end_date: draft.endDate || null,
        uses_stations: Boolean(draft.usesStations),
        note: draft.note || '',
        order: draft.order || 0,
      },
    })
    await loadProgram()
  })

  const updateSubEventInPhase = (phaseKey, eventId, nextEvent) => withBusy(`update-event:${eventId}`, async () => {
    await apiRequest(`/program/sub-events/${eventId}`, {
      method: 'PATCH',
      body: {
        name: nextEvent.name,
        type: nextEvent.type,
        start_date: nextEvent.startDate || null,
        end_date: nextEvent.endDate || null,
        uses_stations: Boolean(nextEvent.usesStations),
        note: nextEvent.note || '',
        order: nextEvent.order || 0,
      },
    })
    await loadProgram()
  })

  const deleteSubEventInPhase = (phaseKey, eventId) => withBusy(`delete-event:${eventId}`, async () => {
    await apiRequest(`/program/sub-events/${eventId}`, {
      method: 'DELETE',
    })
    await loadProgram()
  })

  const titles = {
    dashboard: 'Tổng quan',
    events: 'Quản lý sự kiện',
    teams: 'Quản lý đội',
    scores: 'Điểm & suất đi tiếp',
    stations: 'Quản lý trạm',
    discord: 'Quản lý Discord',
    accounts: 'Quản lý tài khoản',
  }
  const tabIcon = { events: 'ticket', teams: 'users', scores: 'check', stations: 'flag', discord: 'chat', accounts: 'userCircle' }

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <Contours />

      <div className="relative">
        <Sidebar
          activeTab={activeTab}
          onTabChange={(t) => { setActiveTab(t); setSidebarOpen(false) }}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          user={user}
        />

        <div className="lg:ml-64">
          <Header
            title={titles[activeTab]}
            onMenu={() => setSidebarOpen(true)}
            currentPhaseLabel={currentPhaseLabel}
            user={user}
          />

          <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
            {apiError && (
              <div className={`${CARD} border-clay/20 bg-clay/10 px-4 py-3 text-sm text-clay`}>
                {apiError}
              </div>
            )}

            {activeTab === 'dashboard' ? (
              <>
                <PhaseTrail
                  phase={phase}
                  phases={phaseOptions}
                  onChange={setCurrentPhase}
                />
                <DashboardOverview
                  phase={phase}
                  onNavigate={setActiveTab}
                  overview={overview}
                  activityItems={activityItems}
                  scoreboard={scoreboard}
                  loading={loadingProgram || loadingDashboard}
                />
              </>
            ) : activeTab === 'events' ? (
              <EventManagementPage
                currentPhase={programState.currentPhase}
                phaseSchedule={programState.phaseSchedule}
                subEventsByPhase={programState.subEventsByPhase}
                onSetCurrentPhase={setCurrentPhase}
                onUpdatePhaseSchedule={updatePhaseSchedule}
                onCreateSubEvent={createSubEventInPhase}
                onUpdateSubEvent={updateSubEventInPhase}
                onDeleteSubEvent={deleteSubEventInPhase}
              />
            ) : activeTab === 'teams' ? (
              <TeamsPage />
            ) : activeTab === 'scores' ? (
              <ScoreManagementPage
                phase={phase}
                phaseOptions={phaseOptions}
                phaseSchedule={programState.phaseSchedule}
                phaseEvents={currentPhaseEvents}
                onPhaseChange={setCurrentPhase}
              />
            ) : activeTab === 'stations' ? (
              <StationsPage
                phase={phase}
                phaseOptions={phaseOptions}
                phaseEvents={currentPhaseEvents}
                onPhaseChange={setCurrentPhase}
              />
            ) : activeTab === 'discord' ? (
              <DiscordPage />
            ) : activeTab === 'accounts' ? (
              <AccountsPage />
            ) : (
              <PlaceholderPage title={titles[activeTab]} icon={tabIcon[activeTab]} />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

export default AdminDashboard
