// Màn hình "chạy trạm" của thí sinh trong phase vòng loại.
//
// Thí sinh mở danh sách trạm của event đang chạy, bấm vào một trạm rồi đưa
// điện thoại cho CTV quét. Không có websocket, nên khi một trạm đang mở thì
// màn hình poll `/my-team/station-state` mỗi 2 giây để biết CTV đã quét chưa.
//
// Hai điều dễ sai đã được vá cứng ở đây:
//   1. QR xoay sau mỗi lần quét thành công (mã cũ bị backend trả 409), nên
//      payload luôn được render thẳng từ kết quả poll mới nhất, không lưu ra
//      state riêng để "giữ cho đỡ nháy".
//   2. Máy CTV từng quét trúng cùng một ảnh QR hai lần. Sau khi vào trạm không
//      có form, QR rời trạm bị khoá 10 giây — tính từ `entered_at` chứ không
//      phải từ lúc component mount, để tải lại trang không làm đồng hồ chạy lại.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Badge, Icon } from './ui.jsx'
import { apiRequest, logoutAndRedirect } from './api.js'
import { MarkdownBlock } from './FormResponses.jsx'

const POLL_MS = 2000
const EXIT_LOCK_MS = 10000
const CLOCK_TICK_MS = 250
// Khi trạm đang mở mà đội chưa có phiên ở đây, cứ 3 nhịp poll (~6 giây) mới hỏi
// thêm một lần "đội đang mở phiên ở trạm nào" — đủ nhanh để cảnh báo, không
// nhân đôi số request suốt cả buổi.
const GLOBAL_CHECK_EVERY = 3
// Một lần rớt mạng giữa sân là chuyện thường; chỉ báo khi hỏng liên tiếp.
const ERROR_AFTER_FAILURES = 2

const COLORS = {
  paper: '#F3F4F1',
  ink: '#20312B',
  stone: '#DCD8CC',
  gold: '#E0A23A',
  trail: '#1F7A6B',
  clay: '#D6492B',
}

const STATION_CARD = 'rounded-xl border border-[#DCD8CC] bg-white shadow-[0_1px_3px_rgba(32,49,43,0.05)]'
const PRIMARY_BUTTON = 'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[#20312B] px-5 py-3 text-base font-semibold text-white transition hover:bg-[#20312B]/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45'
const SECONDARY_BUTTON = 'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-[#DCD8CC] bg-white px-5 py-3 text-base font-semibold text-[#20312B]/70 transition hover:bg-[#F3F4F1] hover:text-[#20312B] disabled:cursor-not-allowed disabled:opacity-45'
const TRAIL_BUTTON = 'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[#1F7A6B] px-5 py-3 text-base font-semibold text-white transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45'

const TONES = {
  neutral: { chip: 'bg-[#20312B]/[0.07] text-[#20312B]/55' },
  gold: { chip: 'bg-[#E0A23A]/20 text-[#9A6B12]' },
  trail: { chip: 'bg-[#1F7A6B]/14 text-[#1F7A6B]' },
  clay: { chip: 'bg-[#D6492B]/14 text-[#D6492B]' },
}

const SUBMITTED_STATUSES = ['submitted', 'graded']

function hasSubmitted(submission) {
  return Boolean(submission && SUBMITTED_STATUSES.includes(submission.status))
}

function parseStamp(value) {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function explainError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    no_team: 'Bạn chưa thuộc đội nào nên chưa vào trạm được.',
    forbidden: 'Tài khoản này không phải tài khoản thí sinh.',
    invalid_station_id: 'Mã trạm không hợp lệ.',
    method_not_allowed: 'Yêu cầu không hợp lệ.',
    not_found: 'Không tìm thấy dữ liệu của trạm này.',
    // Luật chơi lại (bật theo event): quét vào trạm bị chặn ở hai lý do này.
    replay_locked_incomplete: explainReplayLock('incomplete'),
    replay_locked_passed: explainReplayLock('passed'),
  }
  if (code && map[code]) return map[code]
  if (typeof code === 'string' && code.startsWith('request_failed_')) {
    return 'Máy chủ đang bận. Sẽ tự thử lại sau ít giây.'
  }
  return 'Mất kết nối với máy chủ. Sẽ tự thử lại sau ít giây.'
}

function capacityLabel(capacity) {
  const max = capacity?.max_concurrent_teams
  const current = capacity?.current_teams ?? 0
  // Không giới hạn (max = 0/None): chỉ hiện số đội đang chơi, bỏ hẳn phần sức chứa.
  if (!max) return `${current} đội đang chơi`
  return `${current}/${max} đội`
}

function isStationFull(station) {
  const max = station?.capacity?.max_concurrent_teams
  if (!max) return false
  if (station?.my_session?.status === 'active') return false
  return (station?.capacity?.current_teams ?? 0) >= max
}

function listStatusBadge(station) {
  // `status` là trạng thái hành trình suy trên server (not_visited/active/passed/failed).
  // Payload cũ (backend chưa deploy luật chơi lại) sẽ thiếu field này — rơi xuống suy
  // từ my_session/my_submission như trước để giao diện không vỡ.
  const status = station?.status
  if (status === 'active') return { label: 'Đang ở đây', cls: 'bg-[#1F7A6B]/14 text-[#1F7A6B]' }
  if (status === 'passed') {
    const score = Number(station?.best_score) || 0
    return {
      label: score > 0 ? `Đã qua · ${score} điểm` : 'Đã qua',
      cls: 'bg-[#3E7CA8]/14 text-[#3E7CA8]',
    }
  }
  if (status === 'failed') return { label: 'Chưa qua', cls: 'bg-[#D6492B]/14 text-[#D6492B]' }
  if (status === 'not_visited') return { label: 'Chưa ghé', cls: 'bg-[#20312B]/[0.06] text-[#20312B]/45' }

  const sessionStatus = station?.my_session?.status
  if (sessionStatus === 'active') return { label: 'Đang ở trạm', cls: 'bg-[#1F7A6B]/14 text-[#1F7A6B]' }
  if (sessionStatus === 'closed') return { label: 'Đã hoàn thành', cls: 'bg-[#20312B]/[0.07] text-[#20312B]/55' }
  if (hasSubmitted(station?.my_submission)) return { label: 'Đã nộp bài', cls: 'bg-[#E0A23A]/20 text-[#9A6B12]' }
  return { label: 'Chưa vào', cls: 'bg-[#20312B]/[0.06] text-[#20312B]/45' }
}

/** Câu giải thích khi một trạm đang bị khoá chơi lại (luật bật, xem plan/qualifying-journey-and-replay.md). */
function explainReplayLock(reason) {
  if (reason === 'passed') return 'Đội đã qua trạm này rồi nên không cần vào lại.'
  if (reason === 'incomplete') return 'Đội phải đi hết tất cả các trạm khác rồi mới được quay lại trạm này.'
  return 'Trạm này hiện đang khoá lượt chơi lại.'
}

/**
 * Máy trạng thái của một trạm đang mở.
 *
 * `lockRemaining` được truyền từ ngoài vào (đã tính từ `entered_at`) để hàm này
 * thuần tuý và không phụ thuộc đồng hồ.
 */
function deriveStep({ station, state, blockedStationId, lockRemaining }) {
  if (!station) return 'station_gone'
  if (!state) return 'loading'

  const session = state.session
  const status = session?.status || null
  const qrReady = Boolean(state.qr?.enabled && state.qr?.payload)

  if (status === 'active') {
    if (station.has_form) {
      if (!hasSubmitted(state.submission)) return 'form'
      if (!station.checkout_after_submit) return 'done_no_checkout'
      return qrReady ? 'exit_qr' : 'exit_disabled'
    }
    if (lockRemaining > 0) return 'exit_lock'
    return qrReady ? 'exit_qr' : 'exit_disabled'
  }

  if (status === 'closed') return 'closed'

  // `null` (chưa vào) hoặc `cancelled` (CTV đã huỷ phiên): đội đang đứng ngoài.
  if (blockedStationId != null) return 'blocked'
  // Luật chơi lại chặn NGAY TỪ LÚC quét (server sẽ trả 409), nhưng cờ này đã có
  // sẵn trong `/my-team/stations` nên báo trước cho đội khỏi mất công quét hụt.
  if (station.replay_locked) return 'replay_locked'
  if (station.checkin_policy === 'free_play') {
    if (station.has_form && !hasSubmitted(state.submission)) return 'form'
    return 'closed'
  }

  return qrReady ? 'entry_qr' : 'entry_disabled'
}

function Contours() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 opacity-60"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg width='520' height='520' viewBox='0 0 520 520' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23DCD8CC' stroke-width='1'%3E%3Cpath d='M62 80c64-48 142-56 212-24 80 37 132 22 182-6'/%3E%3Cpath d='M30 166c70-58 154-68 236-32 78 34 132 24 218-20'/%3E%3Cpath d='M18 252c78-44 142-52 214-22 90 38 168 32 252-22'/%3E%3Cpath d='M44 338c72-35 130-42 196-18 88 32 164 22 238-28'/%3E%3Cpath d='M92 428c72-42 146-48 220-18 60 24 118 16 166-20'/%3E%3C/g%3E%3C/svg%3E\")",
        backgroundSize: '520px 520px',
      }}
    />
  )
}

function ConnectionNote({ message }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[#E0A23A]/40 bg-[#E0A23A]/[0.09] px-4 py-3 text-sm leading-6 text-[#9A6B12]">
      <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function SessionExpiredCard() {
  return (
    <div className={`${STATION_CARD} px-5 py-10 text-center`}>
      <h2 className="font-display text-2xl font-bold text-ink">Phiên đăng nhập đã hết hạn</h2>
      <p className="mx-auto mt-3 max-w-sm text-base leading-7 text-ink/60">
        Đăng nhập lại để tiếp tục chạy trạm. Tiến độ của đội vẫn được giữ nguyên trên hệ thống.
      </p>
      <button type="button" className={`mt-6 w-full ${PRIMARY_BUTTON}`} onClick={() => logoutAndRedirect('/login')}>
        Đăng nhập lại
      </button>
    </div>
  )
}

function StatusPanel({ tone = 'neutral', eyebrow, title, body, children }) {
  const toneStyle = TONES[tone] || TONES.neutral
  return (
    <section className={STATION_CARD}>
      <div className="px-5 py-7 text-center sm:px-7">
        {eyebrow && (
          <span className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] ${toneStyle.chip}`}>
            {eyebrow}
          </span>
        )}
        <h2 className="mt-3 font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">{title}</h2>
        {body && <p className="mx-auto mt-3 max-w-md text-base leading-7 text-ink/60">{body}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </section>
  )
}

/**
 * Ô QR to nhất có thể trên điện thoại. `payload` luôn là giá trị vừa poll về —
 * component này cố tình không giữ state để không bao giờ vẽ lại mã đã bị xoay.
 */
function QrBlock({ payload, teamCode, hint }) {
  const [time, setTime] = useState(new Date())
  
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex flex-col items-center">
      <div className="mb-3 flex items-center gap-2 rounded-full bg-[#D6492B]/10 px-3 py-1.5 font-mono text-sm font-semibold text-[#D6492B]">
        <div className="h-2 w-2 animate-pulse rounded-full bg-[#D6492B]" />
        {time.toLocaleTimeString('vi-VN', { hour12: false })}
      </div>
      <div className="relative overflow-hidden rounded-2xl border-2 border-[#20312B]/10 bg-white p-4 shadow-[0_2px_12px_rgba(32,49,43,0.10)]">
        <QRCodeSVG value={payload} size={280} level="M" className="h-auto w-full max-w-[280px]" />
        
        {/* Anti-screenshot scanner line */}
        <div 
          className="absolute left-0 top-0 h-1 w-full bg-[#1F7A6B]/50 shadow-[0_0_8px_2px_rgba(31,122,107,0.4)]"
          style={{
            animation: 'scan 2.5s cubic-bezier(0.4, 0, 0.2, 1) infinite',
          }}
        />
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes scan {
            0% { transform: translateY(0); }
            50% { transform: translateY(310px); }
            100% { transform: translateY(0); }
          }
        `}} />
      </div>
      {teamCode && (
        <span className="mt-4 inline-flex rounded-full bg-[#1F7A6B]/12 px-4 py-1.5 font-mono text-base font-bold tracking-wider text-[#1F7A6B]">
          {teamCode}
        </span>
      )}
      {hint && <p className="mt-3 max-w-sm text-sm leading-6 text-ink/45">{hint}</p>}
    </div>
  )
}

function QrDisabledBlock() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center rounded-2xl border-2 border-dashed border-[#DCD8CC] bg-[#F3F4F1] px-5 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E0A23A]/20 text-[#9A6B12]">
        <Icon name="clock" className="h-6 w-6" />
      </span>
      <p className="mt-4 text-base font-semibold text-ink">BTC chưa mở điểm danh</p>
      <p className="mt-2 text-sm leading-6 text-ink/50">
        Mã QR sẽ tự hiện ở đây ngay khi BTC bật điểm danh. Cứ để nguyên màn hình này, không cần tải lại trang.
      </p>
    </div>
  )
}

function CountdownBlock({ remaining }) {
  const seconds = Math.ceil(remaining / 1000)
  const progress = Math.max(0, Math.min(100, ((EXIT_LOCK_MS - remaining) / EXIT_LOCK_MS) * 100))
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center">
      <div
        className="flex h-40 w-40 items-center justify-center rounded-full border-4 bg-white"
        style={{ borderColor: COLORS.gold }}
      >
        <span className="font-mono text-6xl font-bold tabular-nums text-ink">{seconds}</span>
      </div>
      <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-white">
        <div className="h-full transition-[width] duration-200" style={{ width: `${progress}%`, backgroundColor: COLORS.gold }} />
      </div>
      <p className="mt-4 text-sm leading-6 text-ink/50">
        Chờ hết {Math.ceil(EXIT_LOCK_MS / 1000)} giây rồi QR rời trạm mới hiện. Khoảng chờ này để máy của CTV không
        quét nhầm hai lần liên tiếp vào cùng một mã.
      </p>
    </div>
  )
}

function ElsewhereBanner({ station, stationId, onGo }) {
  const name = station?.station_name || `trạm #${stationId}`
  return (
    <div className="rounded-xl border border-[#1F7A6B]/35 bg-[#1F7A6B]/[0.08] px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1F7A6B]/15 text-[#1F7A6B]">
          <Icon name="pin" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink">Đội đang ở {name}</p>
          <p className="mt-1 text-sm leading-6 text-ink/55">
            Mỗi đội chỉ mở được một trạm cùng lúc. Hoàn thành và rời {name} xong thì mới vào được trạm khác.
          </p>
          {onGo && (
            <button type="button" onClick={onGo} className={`mt-3 w-full ${TRAIL_BUTTON} sm:w-auto`}>
              <Icon name="chevronR" className="h-4 w-4" />
              Về {name}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StationRow({ station, onOpen }) {
  const badge = listStatusBadge(station)
  const full = isStationFull(station)
  const staffScan = station.checkin_policy === 'staff_scan'
  const visitCount = Number(station?.visit_count) || 0
  const replayNote = station?.replay_locked ? explainReplayLock(station.replay_reason) : ''

  return (
    <button
      type="button"
      onClick={() => onOpen(station.station_id)}
      className={`${STATION_CARD} w-full px-4 py-4 text-left transition hover:bg-[#F3F4F1] active:scale-[0.995] sm:px-5`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#20312B]/[0.06] font-mono text-sm font-bold text-[#20312B]/70">
          {station.station_code || '--'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold leading-snug text-ink">{station.station_name}</span>
            <Badge label={badge.label} cls={badge.cls} />
          </div>
          {station.station_location && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-ink/50">
              <Icon name="pin" className="h-4 w-4 shrink-0" />
              {station.station_location}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/45">
            <span className={full ? 'font-semibold text-[#D6492B]' : ''}>
              {capacityLabel(station.capacity)}{full ? ' · đầy' : ''}
            </span>
            <span>·</span>
            <span>{staffScan ? 'CTV quét QR để vào' : 'Tự do vào chơi'}</span>
            {station.has_form && (
              <>
                <span>·</span>
                <span>Có bài nộp</span>
              </>
            )}
            {visitCount > 1 && (
              <>
                <span>·</span>
                <span>Đã ghé {visitCount} lần</span>
              </>
            )}
          </div>
          {replayNote && (
            <p className="mt-1.5 text-xs text-[#9A6B12]">{replayNote}</p>
          )}
        </div>
        <Icon name="chevronR" className="mt-3 h-5 w-5 shrink-0 text-ink/25" />
      </div>
    </button>
  )
}

function StationListScreen({ payload, loading, error, activeStationId, onOpen, onRefresh }) {
  const stations = payload?.stations || []
  const activeStation = stations.find((item) => item.station_id === activeStationId) || null
  const hasJourneyStats = Boolean(payload) && typeof payload.total_stations === 'number' && payload.total_stations > 0
  // Chỉ cộng điểm khi payload thật sự mang best_score — payload cũ (backend chưa
  // deploy) sẽ không có field này ở bất kỳ trạm nào, lúc đó coi như "chưa tính được".
  const stationsWithScore = stations.filter((item) => item?.best_score !== undefined && item?.best_score !== null)
  const totalScore = stationsWithScore.length > 0
    ? stationsWithScore.reduce((sum, item) => sum + (Number(item.best_score) || 0), 0)
    : null

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 pt-2">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Vòng loại</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">Các trạm đang mở</h1>
          {hasJourneyStats && (
            <p className="mt-1 text-sm text-ink/50">
              Đã đi {payload.visited_count ?? 0}/{payload.total_stations} trạm · Đã qua {payload.passed_count ?? 0}
              {totalScore !== null && ` · Tổng điểm ${totalScore}`}
            </p>
          )}
          {payload?.replay_enabled && (
            <p className="mt-1 text-xs text-ink/40">
              {payload.all_visited
                ? 'Đội đã đi hết các trạm — được quay lại các trạm chưa qua.'
                : 'Luật chơi lại: đi hết tất cả các trạm mới được quay lại trạm đã ghé.'}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="shrink-0 rounded-xl border border-[#DCD8CC] bg-white px-3 py-3 text-[#20312B]/55 transition hover:bg-[#F3F4F1] hover:text-[#20312B]"
          aria-label="Làm mới danh sách trạm"
        >
          <Icon name="search" className="h-5 w-5" />
        </button>
      </header>

      {activeStationId != null && (
        <ElsewhereBanner
          station={activeStation}
          stationId={activeStationId}
          onGo={() => onOpen(activeStationId)}
        />
      )}

      {error && (
        <div className={`${STATION_CARD} px-5 py-6 text-center`}>
          <p className="text-base leading-7 text-ink/65">{error}</p>
          <button type="button" onClick={onRefresh} className={`mt-4 w-full ${PRIMARY_BUTTON}`}>
            Thử lại
          </button>
        </div>
      )}

      {loading && !payload && (
        <div className={`${STATION_CARD} px-5 py-14 text-center text-base text-ink/45`}>
          Đang tải danh sách trạm...
        </div>
      )}

      {payload && stations.length === 0 && !error && (
        <div className={`${STATION_CARD} px-5 py-12 text-center`}>
          <h2 className="font-display text-xl font-bold text-ink">Chưa có trạm nào đang mở</h2>
          <p className="mx-auto mt-3 max-w-sm text-base leading-7 text-ink/55">
            BTC chưa mở event có trạm cho đội của bạn, hoặc đội không nằm trong danh sách của phase hiện tại.
            Bấm làm mới khi BTC thông báo bắt đầu.
          </p>
          <button type="button" onClick={onRefresh} className={`mt-6 w-full ${SECONDARY_BUTTON}`}>
            Làm mới
          </button>
        </div>
      )}

      {stations.map((station) => (
        <StationRow key={station.station_id} station={station} onOpen={onOpen} />
      ))}
    </div>
  )
}

function StationStageScreen({
  station,
  stationId,
  state,
  step,
  lockRemaining,
  blockedStation,
  blockedStationId,
  pollError,
  onBack,
  onOpenForm,
}) {
  const payload = state?.qr?.payload || ''
  const teamCode = state?.team_code || ''
  const cancelled = state?.session?.status === 'cancelled'
  const full = isStationFull(station)

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#DCD8CC] bg-white text-[#20312B]/60 transition hover:bg-[#F3F4F1] hover:text-[#20312B]"
          aria-label="Về danh sách trạm"
        >
          <Icon name="chevronR" className="h-5 w-5 rotate-180" />
        </button>
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">
            {station?.station_code || `Trạm #${stationId}`}
          </p>
          <h1 className="truncate font-display text-xl font-bold text-ink sm:text-2xl">
            {station?.station_name || 'Trạm'}
          </h1>
        </div>
      </header>

      {station?.station_location && (
        <p className="flex items-center gap-1.5 text-sm text-ink/50">
          <Icon name="pin" className="h-4 w-4 shrink-0" />
          {station.station_location}
        </p>
      )}

      {station?.submission_brief && (
        <div className={`${STATION_CARD} mt-4 px-5 py-6 sm:px-7 sm:py-7`}>
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.24em] text-ink/55">Nhiệm vụ trạm</p>
          <MarkdownBlock content={station.submission_brief} />
        </div>
      )}

      <ConnectionNote message={pollError} />

      {step === 'loading' && (
        <div className={`${STATION_CARD} px-5 py-14 text-center text-base text-ink/45`}>
          Đang lấy trạng thái của trạm...
        </div>
      )}

      {step === 'station_gone' && (
        <StatusPanel
          tone="clay"
          eyebrow="Không tìm thấy"
          title="Trạm này không còn mở"
          body="BTC có thể vừa đóng hoặc đổi event. Quay lại danh sách để xem các trạm đang chạy."
        >
          <button type="button" onClick={onBack} className={`w-full ${PRIMARY_BUTTON}`}>
            Về danh sách trạm
          </button>
        </StatusPanel>
      )}

      {step === 'blocked' && (
        <StatusPanel
          tone="clay"
          eyebrow="Chưa vào được"
          title="Đội đang mở phiên ở trạm khác"
          body="Hệ thống sẽ từ chối nếu CTV quét vào trạm thứ hai. Hoàn thành và rời trạm cũ trước đã."
        >
          <ElsewhereBanner station={blockedStation} stationId={blockedStationId} onGo={null} />
          <button type="button" onClick={onBack} className={`mt-4 w-full ${PRIMARY_BUTTON}`}>
            Về danh sách trạm
          </button>
        </StatusPanel>
      )}

      {step === 'replay_locked' && (
        <StatusPanel
          tone="clay"
          eyebrow="Khoá chơi lại"
          title={station?.replay_reason === 'passed' ? 'Đã qua trạm này' : 'Đi hết trạm rồi mới được vào lại'}
          body={explainReplayLock(station?.replay_reason)}
        >
          <button type="button" onClick={onBack} className={`w-full ${PRIMARY_BUTTON}`}>
            Về danh sách trạm
          </button>
        </StatusPanel>
      )}

      {step === 'entry_disabled' && (
        <StatusPanel
          tone="gold"
          eyebrow="Điểm danh"
          title="Chờ BTC mở điểm danh"
          body="Trạm này chưa nhận check-in. Màn hình vẫn đang theo dõi, QR sẽ hiện ngay khi BTC bật."
        >
          <QrDisabledBlock />
        </StatusPanel>
      )}

      {step === 'entry_qr' && (
        <StatusPanel
          tone="gold"
          eyebrow="Bước 1"
          title="Đưa QR này cho CTV quét"
          body={cancelled
            ? 'Lượt vào trước đã bị CTV huỷ. Quét lại mã dưới đây để vào trạm.'
            : 'Giơ màn hình lên cho cộng tác viên tại trạm. Quét xong, màn hình này tự chuyển bước — không cần bấm gì thêm.'}
        >
          <QrBlock
            payload={payload}
            teamCode={teamCode}
            hint="Mã đổi sau mỗi lần quét thành công. Cứ để nguyên màn hình, đừng chụp lại màn hình để dùng sau."
          />
          {full && (
            <p className="mx-auto mt-5 max-w-sm rounded-xl border border-[#D6492B]/30 bg-[#D6492B]/[0.07] px-4 py-3 text-sm leading-6 text-[#D6492B]">
              Trạm đang kín chỗ ({capacityLabel(station?.capacity)}). CTV có thể yêu cầu đội chờ tới lượt.
            </p>
          )}
        </StatusPanel>
      )}

      {step === 'form' && (
        <StatusPanel
          tone="trail"
          eyebrow={station?.checkin_policy === 'free_play' ? "Phần thi" : "Bước 2"}
          title="Làm bài tại trạm"
          body={station?.checkin_policy === 'free_play'
            ? "Mở phần thi của trạm này để làm và nộp bài."
            : "CTV đã quét QR vào trạm. Mở phần thi của trạm này để làm và nộp bài."}
        >
          <button type="button" onClick={() => onOpenForm(stationId)} className={`w-full ${TRAIL_BUTTON}`}>
            <Icon name="doc" className="h-5 w-5" />
            Mở phần thi của trạm
          </button>
        </StatusPanel>
      )}

      {step === 'exit_lock' && (
        <StatusPanel
          tone="gold"
          eyebrow="Bước 2"
          title="Đã vào trạm"
          body="Bắt đầu phần thi tại trạm. QR rời trạm sẽ hiện sau ít giây nữa."
        >
          <CountdownBlock remaining={lockRemaining} />
        </StatusPanel>
      )}

      {step === 'exit_qr' && (
        <StatusPanel
          tone="trail"
          eyebrow="Bước cuối"
          title="Đưa QR rời trạm cho CTV"
          body="Xong phần thi thì nhờ CTV quét mã này để đóng lượt và đi trạm tiếp theo."
        >
          <QrBlock
            payload={payload}
            teamCode={teamCode}
            hint="Đây là mã mới, khác mã lúc vào trạm. Quét xong màn hình sẽ báo hoàn thành."
          />
        </StatusPanel>
      )}

      {step === 'exit_disabled' && (
        <StatusPanel
          tone="gold"
          eyebrow="Bước cuối"
          title="Chờ BTC mở điểm danh"
          body="Đội vẫn đang trong trạm. QR rời trạm sẽ hiện ngay khi BTC bật lại điểm danh — báo CTV nếu chờ quá lâu."
        >
          <QrDisabledBlock />
        </StatusPanel>
      )}

      {step === 'done_no_checkout' && (
        <StatusPanel
          tone="trail"
          eyebrow="Hoàn tất"
          title="Đã nộp bài xong"
          body="Trạm này không cần quét ra. Đội có thể đi tiếp sang trạm khác."
        >
          <button type="button" onClick={onBack} className={`w-full ${PRIMARY_BUTTON}`}>
            Chọn trạm tiếp theo
          </button>
        </StatusPanel>
      )}

      {step === 'closed' && (
        <StatusPanel
          tone="trail"
          eyebrow="Hoàn tất"
          title="Đã hoàn thành trạm này"
          body="Lượt chơi tại trạm đã được đóng. Chúc đội may mắn ở trạm tiếp theo."
        >
          <button type="button" onClick={onBack} className={`w-full ${PRIMARY_BUTTON}`}>
            Chọn trạm tiếp theo
          </button>
        </StatusPanel>
      )}

      {step !== 'loading' && step !== 'station_gone' && (
        <button type="button" onClick={onBack} className={`w-full ${SECONDARY_BUTTON}`}>
          Về danh sách trạm
        </button>
      )}
    </div>
  )
}

export default function StationRunPage({ onOpenForm, embedded = false }) {
  const [listPayload, setListPayload] = useState(null)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [openStationId, setOpenStationId] = useState(null)
  const [stationState, setStationState] = useState(null)
  // `undefined` = chưa hỏi bao giờ, `null` = đội không mở phiên ở đâu cả.
  const [globalSession, setGlobalSession] = useState(undefined)
  const [pollError, setPollError] = useState('')
  const [sessionExpired, setSessionExpired] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const stations = useMemo(() => listPayload?.stations || [], [listPayload])

  const loadStations = useCallback(async () => {
    setListLoading(true)
    try {
      const payload = await apiRequest('/my-team/stations')
      setListPayload(payload)
      setListError('')
    } catch (error) {
      if (error?.status === 401) {
        setSessionExpired(true)
        return
      }
      setListError(explainError(error))
    } finally {
      setListLoading(false)
    }
  }, [])

  const loadGlobalSession = useCallback(async () => {
    try {
      const payload = await apiRequest('/my-team/station-state')
      setGlobalSession(payload?.session || null)
    } catch {
      // Chỉ dùng để cảnh báo "đang kẹt ở trạm khác" — hỏng thì bỏ qua, đừng
      // làm hỏng màn hình chính vì một lần rớt mạng.
    }
  }, [])

  useEffect(() => {
    loadStations()
    loadGlobalSession()
  }, [loadStations, loadGlobalSession])

  // Poll đúng 2 giây, và chỉ khi đang mở một trạm. `inFlight` là biến cục bộ của
  // từng lần chạy effect nên đổi trạm là reset sạch, không có cờ dùng chung để
  // một request chậm của trạm cũ mở khoá cho trạm mới.
  useEffect(() => {
    if (openStationId == null || sessionExpired) return undefined

    let cancelled = false
    let inFlight = false
    let failures = 0
    let tickIndex = 0

    const tick = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      const wantGlobal = tickIndex % GLOBAL_CHECK_EVERY === 0
      tickIndex += 1
      try {
        const payload = await apiRequest(`/my-team/station-state?station_id=${openStationId}`)
        if (cancelled) return
        setStationState(payload)
        if (payload?.session?.status === 'active') {
          // Một đội chỉ mở được một phiên, nên phiên ở đây chính là phiên toàn
          // cục — khỏi tốn thêm request để biết điều đó.
          setGlobalSession(payload.session)
        } else if (wantGlobal) {
          const global = await apiRequest('/my-team/station-state')
          if (cancelled) return
          setGlobalSession(global?.session || null)
        }
        failures = 0
        setPollError('')
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          setSessionExpired(true)
          return
        }
        // Giữ nguyên trạng thái cũ: trang này chạy giữa sân, chớp mạng là
        // chuyện thường và làm trắng màn hình thì thí sinh mất QR đang giơ.
        failures += 1
        if (failures >= ERROR_AFTER_FAILURES) {
          setPollError(`${explainError(error)} Mã QR trên màn hình có thể đã cũ — chờ kết nối lại trước khi nhờ CTV quét.`)
        }
      } finally {
        inFlight = false
      }
    }

    tick()
    const timer = window.setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [openStationId, sessionExpired])

  const station = useMemo(
    () => stations.find((item) => item.station_id === openStationId) || null,
    [stations, openStationId],
  )

  // Mốc hết khoá 10 giây, tính từ `entered_at` của phiên chứ không phải từ lúc
  // component mount — tải lại trang giữa chừng thì đồng hồ không chạy lại.
  const exitLockUntil = useMemo(() => {
    if (!station || station.has_form) return null
    const session = stationState?.session
    if (!session || session.status !== 'active') return null
    const started = parseStamp(session.entered_at)
    return started === null ? null : started + EXIT_LOCK_MS
  }, [station, stationState])

  useEffect(() => {
    if (exitLockUntil === null) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= exitLockUntil) window.clearInterval(timer)
    }, CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [exitLockUntil])

  // Kẹp vào [0, 10s]: đồng hồ điện thoại có thể lệch với server, lệch nhiều thì
  // thà đếm đủ 10 giây còn hơn treo màn hình vô thời hạn.
  const lockRemaining = exitLockUntil === null
    ? 0
    : Math.min(EXIT_LOCK_MS, Math.max(0, exitLockUntil - now))

  const activeStationId = useMemo(() => {
    if (globalSession !== undefined) {
      return globalSession?.status === 'active' ? globalSession.station_id ?? null : null
    }
    const fromList = stations.find((item) => item.my_session?.status === 'active')
    return fromList ? fromList.station_id : null
  }, [globalSession, stations])

  const blockedStationId = activeStationId != null && activeStationId !== openStationId
    ? activeStationId
    : null
  const blockedStation = useMemo(
    () => stations.find((item) => item.station_id === blockedStationId) || null,
    [stations, blockedStationId],
  )

  const step = deriveStep({ station, state: stationState, blockedStationId, lockRemaining })

  const openStation = (stationId) => {
    // Không mang theo payload của trạm cũ: QR xoay sau mỗi lần quét nên một mã
    // cũ hiện ra ở đây chỉ dẫn tới 409 ở máy CTV.
    setStationState(null)
    setPollError('')
    setOpenStationId(stationId)
  }

  const backToList = () => {
    setOpenStationId(null)
    setStationState(null)
    setPollError('')
    loadStations()
    loadGlobalSession()
  }

  const handleOpenForm = (stationId) => {
    if (typeof onOpenForm === 'function') {
      onOpenForm(stationId)
      return
    }
    window.location.href = `/form?stationId=${stationId}`
  }

  const body = (
    <div className={embedded
      ? 'relative w-full'
      : 'relative mx-auto w-full max-w-2xl px-4 pb-20 pt-3 sm:px-6'}
    >
      {sessionExpired ? (
          <SessionExpiredCard />
        ) : openStationId == null ? (
          <StationListScreen
            payload={listPayload}
            loading={listLoading}
            error={listError}
            activeStationId={activeStationId}
            onOpen={openStation}
            onRefresh={() => {
              loadStations()
              loadGlobalSession()
            }}
          />
        ) : (
          <StationStageScreen
            station={station}
            stationId={openStationId}
            state={stationState}
            step={step}
            lockRemaining={lockRemaining}
            blockedStation={blockedStation}
            blockedStationId={blockedStationId}
            pollError={pollError}
            onBack={backToList}
            onOpenForm={handleOpenForm}
          />
        )}
    </div>
  )

  // Embedded inside the participant dashboard, the page chrome would stack a
  // second background and contour layer on top of the one already there.
  if (embedded) return body

  return (
    <div className="relative min-h-[100dvh] bg-[#F3F4F1] text-[#20312B]">
      <Contours />
      {body}
    </div>
  )
}
