import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CheckoutReview from './CheckoutReview.jsx'
import ChallengeScores from './ChallengeScores.jsx'
import {
  challengeInitialValues, challengePayload, challengeSum, challengeValuesValid,
} from './challengeScores.js'
import logoImage from './assets/vnutour-logo.png'
import { FIXED_PHASES } from './adminProgram.js'
import {
  apiRequest,
  formatDateTime,
  getStoredUser,
  logoutAndRedirect,
  normalizeProgramForFrontend,
} from './api.js'
import { CARD, Icon } from './ui.jsx'
import { useSearchParam } from './router.js'
import { useDraftState, DraftNotice, readDraft, writeDraft, clearDraft } from './drafts.jsx'

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 min-h-[46px]'
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-stone/80 bg-white px-4 py-3 text-sm font-semibold text-ink/80 transition hover:bg-stone/20 hover:text-ink active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 min-h-[46px]'

const RESULT_META = {
  checkout: {
    label: 'Checkout sự kiện',
    badgeCls: 'bg-sky-100 text-sky-800 border border-sky-300',
    icon: 'check',
    tone: 'sky',
  },
  event: {
    label: 'Check-in sự kiện',
    badgeCls: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
    icon: 'check',
    tone: 'emerald',
  },
  enter: {
    label: 'Vào trạm',
    badgeCls: 'bg-amber-100 text-amber-900 border border-amber-300',
    icon: 'pin',
    tone: 'amber',
  },
  exit: {
    label: 'Rời trạm & Chấm điểm',
    badgeCls: 'bg-sky-100 text-sky-900 border border-sky-300',
    icon: 'clock',
    tone: 'sky',
  },
}

const CHECKOUT_REVIEW_DRAFT = 'coop:checkoutReview'

const CHECKIN_POLICY_META = {
  staff_scan: { label: 'Cần coop scan', cls: 'bg-amber-100 text-amber-900 border border-amber-200' },
  free_play: { label: 'Tự do vào chơi', cls: 'bg-stone/30 text-ink/70 border border-stone' },
}

// ─── Camera auto-pick ───────────────────────────────────────────────
// Phones expose several lenses and some of them (IR, depth, virtual) open but
// never show a picture, so the collab used to hunt for a working one by hand.
// In 'auto' mode the scanner tries each rear lens in turn and keeps the first
// that actually streams an image. The front camera is never tried.
const CAMERA_STORAGE_KEY = 'coop.cameraId'
const FRONT_CAMERA_RE = /front|user|trươ|trướ|truoc|selfie|facetime/i
// Lenses that work but are poor for a QR held close: tried after the main one.
const SECONDARY_LENS_RE = /ultra|wide|tele|depth|infrared|\bir\b|virtual|obs|desk view|macro/i

const isFrontCamera = (label = '') => FRONT_CAMERA_RE.test(label)

function readSavedCameraId() {
  try {
    return localStorage.getItem(CAMERA_STORAGE_KEY)
  } catch {
    return null
  }
}

function saveCameraId(id) {
  try {
    localStorage.setItem(CAMERA_STORAGE_KEY, id)
  } catch {
    // storage unavailable — the pick just is not remembered
  }
}

// Rear lenses in the order to try: last known good one, main lenses, then the rest.
function orderRearCameras(cameras, savedId) {
  const rear = cameras.filter((c) => !isFrontCamera(c.label))
  const rank = (c) => (c.id === savedId ? 0 : SECONDARY_LENS_RE.test(c.label) ? 2 : 1)
  return rear
    .map((camera, index) => ({ camera, index }))
    .sort((a, b) => rank(a.camera) - rank(b.camera) || a.index - b.index)
    .map(({ camera }) => camera)
}

function streamingDeviceId(video) {
  const track = video?.srcObject?.getVideoTracks?.()[0]
  return track?.getSettings?.().deviceId || null
}

// A lens "works" once it delivers a frame that is not solid black. Waits a few
// seconds because the first frames are often dark while exposure settles.
async function videoShowsPicture(video, isCancelled, timeoutMs = 3000) {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 16
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (isCancelled()) return false
    if (video.videoWidth > 0 && video.readyState >= 2 && ctx) {
      try {
        ctx.drawImage(video, 0, 0, 16, 16)
        const { data } = ctx.getImageData(0, 0, 16, 16)
        let min = 255
        let max = 0
        for (let i = 0; i < data.length; i += 4) {
          const luma = (data[i] + data[i + 1] + data[i + 2]) / 3
          if (luma < min) min = luma
          if (luma > max) max = luma
        }
        if (max > 12 || max - min > 6) return true
      } catch {
        return true // cannot sample the frame; trust that it is streaming
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

function LogoutIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15" />
      <path d="M12 9l3 3m0 0-3 3m3-3H2.25" />
    </svg>
  )
}

function QrIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="5" height="5" x="3" y="3" rx="1" />
      <rect width="5" height="5" x="16" y="3" rx="1" />
      <rect width="5" height="5" x="3" y="16" rx="1" />
      <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
      <path d="M21 21v.01" />
      <path d="M12 7v3a2 2 0 0 1-2 2H7" />
      <path d="M3 12h.01" />
      <path d="M12 3h.01" />
      <path d="M12 16v.01" />
      <path d="M16 12h1" />
      <path d="M21 12v.01" />
      <path d="M12 21v-1" />
    </svg>
  )
}

const STAY_WARNING_MINUTES = 15

function formatClock(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

// Đồng hồ lưu trú: vàng khi còn ≤ 15 phút, đỏ khi quá thời gian tối đa của trạm.
function StayTimer({ enteredAt, maxStayMinutes, nowMs }) {
  const elapsedMin = enteredAt ? (nowMs - new Date(enteredAt).getTime()) / 60000 : 0
  const limit = Number(maxStayMinutes) || 0
  const over = limit > 0 && elapsedMin > limit
  const warn = limit > 0 && !over && elapsedMin >= limit - STAY_WARNING_MINUTES
  const tone = over
    ? 'bg-clay/15 text-clay border-clay/40'
    : warn ? 'bg-amber-100 text-amber-900 border-amber-300' : 'bg-trail/10 text-trail border-transparent'
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
      <span className={over ? 'text-clay' : warn ? 'text-amber-900' : 'text-trail'}>⏱️ Đã ở trạm:</span>
      <span className={`font-mono rounded border px-1.5 py-0.5 ${tone}`}>
        {formatDuration(enteredAt, nowMs)}{limit > 0 && ` / ${limit} phút`}
      </span>
      {over && <span className="text-clay">Quá {Math.floor(elapsedMin - limit)} phút — đội phải rời trạm</span>}
      {warn && <span className="text-amber-900">Còn {Math.max(0, Math.ceil(limit - elapsedMin))} phút</span>}
    </div>
  )
}

// Bỏ thử thách trong lúc đội đang ở trạm: thử thách đó 0 điểm, đội bị giữ lại
// (thời gian quy định + 15 phút) — server chặn checkout tới hết phạt.
function ChallengeSkipControls({ session, challenges, nowMs, busy, onSkip }) {
  const skips = session.challenge_skips || {}
  const penaltyMs = session.penalty_until ? new Date(session.penalty_until).getTime() - nowMs : 0
  return (
    <div className="mt-2 space-y-1.5">
      {penaltyMs > 0 && (
        <p className="rounded-lg border border-clay/30 bg-clay/10 px-2.5 py-1.5 text-xs font-semibold text-clay" role="status">
          Đang phạt bỏ thử thách — chỉ được checkout sau {formatClock(session.penalty_until)} (còn {formatCountdown(penaltyMs)})
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {challenges.map(item => {
          const skipped = item.id in skips
          return skipped ? (
            <button key={item.id} type="button" disabled={busy}
              onClick={() => onSkip(session, item, true)}
              className="rounded-lg border border-clay/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-clay disabled:opacity-50"
              title="Hoàn tác nếu bấm nhầm">
              TT{item.index} đã bỏ · Hoàn tác
            </button>
          ) : (
            <button key={item.id} type="button" disabled={busy}
              onClick={() => onSkip(session, item, false)}
              className="rounded-lg border border-stone bg-white px-2.5 py-1 text-[11px] font-semibold text-ink/70 hover:border-clay/40 hover:text-clay disabled:opacity-50">
              Bỏ TT{item.index}: {item.title || 'Chưa đặt tên'}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function explainScanError(error) {
  const code = error?.data?.error || error?.message
  if (code === 'penalty_active') {
    const until = formatClock(error?.data?.penalty_until)
    return `Đội ${error?.data?.team_name || ''} đang chịu phạt bỏ thử thách, chỉ được checkout sau ${until}.`
  }
  const map = {
    no_current_event: 'BTC chưa mở event nào nên chưa thể check-in sự kiện.',
    team_not_found: 'Không tìm thấy đội với mã QR hoặc mã đội này.',
    qr_already_used: 'Mã QR này đã được quét rồi. Đề nghị đội mở lại màn hình để lấy mã mới.',
    team_not_approved: 'Đội này chưa được duyệt nên không thể scan.',
    personal_qr_required: 'Điểm danh sự kiện cần QR cá nhân của từng thành viên, không dùng QR đội.',
    team_qr_required: 'Event này check-in theo đội. Mời mở QR check-in đội để quét.',
    invalid_personal_qr: 'QR cá nhân không hợp lệ hoặc đã hết hiệu lực. Hãy yêu cầu thành viên mở lại QR điểm danh của mình.',
    checkin_qr_event_mismatch: 'QR cá nhân này thuộc event khác. Hãy quét QR của event đang mở.',
    participant_not_in_team: 'Thành viên trong QR này không thuộc đội đã đăng ký cho event.',
    already_checked_in: 'QR này đã được check-in sự kiện.',
    event_not_found: 'Không tìm thấy event đang thao tác.',
    phase_not_found: 'Không tìm thấy phase hiện tại.',
    team_not_in_phase: 'Đội này không nằm trong roster của phase hiện tại.',
    not_assigned_to_station: 'Bạn không được phân công trạm này nên không thể quét QR của trạm.',
    missing_fields: 'Mã quét không hợp lệ.',
    station_not_found: 'Không tìm thấy trạm mà mã QR trỏ tới.',
    station_not_in_event: 'Trạm này không thuộc event đang thao tác.',
    station_inactive: 'Trạm đang tạm ngưng hoạt động.',
    station_full: 'Trạm đã đầy công suất.',
    session_already_active: 'Đội này đang ở một trạm khác hoặc đã vào trạm này.',
    session_not_found: 'Không tìm thấy phiên trạm đang mở cho đội này.',
    policy_free_play: 'Trạm này đang ở chế độ tự do, không cần scan.',
    results_locked: 'Kết quả đã khóa ở phase Kết thúc nên không thể tiếp tục thao tác trạm.',
    replay_locked_incomplete: 'Đội phải đi hết tất cả các trạm khác rồi mới được quay lại trạm này.',
    replay_locked_passed: 'Đội đã qua trạm này rồi nên không cần vào lại.',
    replay_locked_attempts_exhausted: 'Đội đã dùng hết số lượt chơi của trạm này.',
    replay_locked_pending_result: 'Đội đang trong một lượt chơi chưa kết thúc ở trạm này.',
    event_not_checked_in: 'Đội chưa check-in sự kiện. Mời quét QR theo chế độ check-in của event.',
    event_insufficient_checkin: 'Đội chưa đủ số thành viên đã check-in để vào trạm. Mời thêm thành viên quét QR cá nhân.',
    team_checked_out: 'Đội đã checkout, không được chơi thêm trạm nào.',
    already_checked_out: 'Đội này đã checkout rồi.',
    invalid_checkout_qr: 'QR checkout sự kiện không hợp lệ hoặc hết hạn. Mời đội mở lại QR checkout.',
    checkout_qr_event_mismatch: 'QR checkout này thuộc sự kiện khác. Mời đội mở QR của sự kiện hiện tại.',
    checkout_station_required: 'Event có trạm checkout riêng. Mời đội mở trạm Checkout trong danh sách trạm.',
    station_not_playable: 'Đây là trạm check-in/checkout, không phải trạm chơi.',
  }
  return map[code] || 'Không thể xử lý mã vừa quét.'
}

function playScanFeedback(type = 'success') {
  try {
    if ('vibrate' in navigator) {
      if (type === 'success') {
        navigator.vibrate([40, 30, 40])
      } else {
        navigator.vibrate([150, 60, 150])
      }
    }
  } catch {
    // Ignore vibration failure
  }

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    if (type === 'success') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.08)
      gain.gain.setValueAtTime(0.12, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.2)
    } else {
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(320, ctx.currentTime)
      osc.frequency.setValueAtTime(220, ctx.currentTime + 0.09)
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.25)
    }
  } catch {
    // Ignore audio error
  }
}

function formatShift(assignment) {
  if (!assignment) return 'Chưa có khung giờ'
  if (!assignment.shift_start && !assignment.shift_end) return 'Trực cả event'
  return `${assignment.shift_start ? formatDateTime(assignment.shift_start) : 'Mở ca'} → ${assignment.shift_end ? formatDateTime(assignment.shift_end) : 'Đóng ca'}`
}

function formatDuration(startTimeIso, nowMs) {
  if (!startTimeIso) return '--'
  const startMs = Date.parse(startTimeIso)
  if (Number.isNaN(startMs)) return '--'
  const diffSec = Math.max(0, Math.floor((nowMs - startMs) / 1000))
  const mins = Math.floor(diffSec / 60)
  const secs = diffSec % 60
  if (mins >= 60) {
    const hours = Math.floor(mins / 60)
    const remMins = mins % 60
    return `${hours}h ${remMins}m`
  }
  return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`
}

function buildStationView(station) {
  return {
    id: String(station.id),
    code: station.code || '',
    name: station.name || '',
    location: station.location || '',
    active: station.active !== false,
    kind: station.kind || 'play',
    checkinPolicy: station.checkin_policy || 'staff_scan',
    capacityMode: station.capacity_mode || 'unlimited',
    maxConcurrentTeams: Number(station.max_concurrent_teams) || 0,
    order: station.order ?? 0,
    scoringMode: station.scoring_mode || 'score_only',
    passThreshold: station.pass_threshold ?? null,
    passPoints: station.pass_points ?? null,
    // Real challenge titles (staff only); empty for stations without challenges.
    challenges: station.scoring_mode === 'pass_fail' || !Array.isArray(station.challenges) ? [] : station.challenges,
    // Advisory stay limit in minutes (null = none).
    maxStayMinutes: station.max_stay_minutes ?? null,
    // Whether the station has a web form part next to its challenges.
    hasForm: (station.submission_config?.items || []).some(item => item.type !== 'challenge'),
  }
}

// Nhật ký trạm ở trạm có thử thách: điểm bài làm (nếu có form) + từng thử thách.
// Bản nháp nằm chung `scoreDrafts` (khoá `challenges:<id>` và `<id>`) nên reload không mất.
function SessionChallengeGrading({ session, station, drafts, setDrafts, saving, onSave }) {
  const challenges = station.challenges
  const [open, setOpen] = useState(false)
  const challengeKey = `challenges:${session.id}`
  const values = drafts[challengeKey] ?? challengeInitialValues(challenges, session.challenge_scores)
  const formValue = drafts[session.id] ?? (session.form_score ?? '')
  const formValid = !station.hasForm || formValue === '' || (Number.isInteger(Number(formValue)) && Number(formValue) >= 0)
  const valid = formValid && challengeValuesValid(challenges, values)
  const total = (station.hasForm ? Number(formValue) || 0 : 0) + challengeSum(challenges, values)
  const graded = challenges.filter(item => session.challenge_scores?.[item.id] != null).length
  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-ink/80">Điểm:</span>
          <span className="rounded bg-stone/20 px-2 py-0.5 font-mono text-sm font-extrabold text-ink">{session.score ?? 0}</span>
          <span className="text-[11px] text-ink/65">
            {graded}/{challenges.length} thử thách đã chấm
            {station.scoringMode === 'threshold' && station.passThreshold != null && ` · đạt ≥ ${station.passThreshold}`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(current => !current)}
          className="rounded-lg bg-ink px-3 py-1 text-xs font-bold text-white hover:brightness-110 active:scale-95"
        >
          {open ? 'Thu gọn' : 'Chấm thử thách'}
        </button>
      </div>
      {open && (
        <div className="space-y-2 rounded-lg bg-paper p-2.5">
          <ChallengeScores
            challenges={challenges}
            values={values}
            disabled={saving}
            onChange={next => setDrafts(current => ({ ...current, [challengeKey]: next }))}
          />
          <div className="flex flex-wrap items-end gap-2">
            {station.hasForm && (
              <label className="text-xs font-medium text-ink">Điểm phần bài làm
                <input
                  type="number" min="0" step="1"
                  value={formValue}
                  onChange={event => setDrafts(current => ({ ...current, [session.id]: event.target.value }))}
                  className="mt-1 block w-24 rounded-lg border border-stone bg-white px-2 py-1.5 text-sm font-bold text-ink outline-none focus:border-trail"
                />
              </label>
            )}
            <p className="py-1.5 text-xs text-ink/70">Tổng: <strong className="font-mono text-sm text-ink">{total}</strong></p>
            <button
              type="button"
              disabled={saving || !valid}
              onClick={() => onSave(
                session.id,
                station.hasForm && formValue !== '' ? formValue : null,
                challengePayload(challenges, values),
              )}
              className="ml-auto rounded-lg bg-trail px-3 py-1.5 text-xs font-bold text-white active:scale-95 disabled:opacity-50"
            >
              {saving ? '...' : 'Lưu điểm'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CheckedInMembers({ members }) {
  const list = Array.isArray(members) ? members : []
  if (list.length === 0) {
    return <p className="mt-2 text-xs text-ink/50">Chưa có thành viên nào điểm danh.</p>
  }
  return (
    <div className="mt-2 rounded-xl border border-stone/60 bg-paper/40 p-2.5">
      <p className="text-xs font-semibold text-ink/70">Thành viên đã điểm danh ({list.length})</p>
      <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
        {list.map((member) => (
          <li
            key={member.participant_id ?? `${member.mssv || ''}-${member.full_name || ''}`}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="truncate text-ink">{member.full_name}</span>
            <span className="shrink-0 font-mono text-ink/60">{member.mssv}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function sortStations(stations) {
  return [...stations].sort((left, right) => {
    const byOrder = (left.order ?? 0) - (right.order ?? 0)
    if (byOrder !== 0) return byOrder
    return left.name.localeCompare(right.name)
  })
}

function CoopDashboard() {
  const [bootLoading, setBootLoading] = useState(true)
  const [apiError, setApiError] = useState('')
  const [user, setUser] = useState(() => getStoredUser())
  const [programState, setProgramState] = useState(() => normalizeProgramForFrontend())
  const [assignments, setAssignments] = useState([])
  const [stations, setStations] = useState([])
  const [occupancy, setOccupancy] = useState(null)
  const [eventStats, setEventStats] = useState(null)
  const [eventSessions, setEventSessions] = useState([])
  const [stationSessions, setStationSessions] = useState([])
  const [checkinLog, setCheckinLog] = useState([])
  const [selectedEventId, setSelectedEventId] = useSearchParam('event', '')
  const [selectedStationId, setSelectedStationId] = useSearchParam('station', '')
  const [activeTab, setActiveTab] = useSearchParam('view', 'scan') // 'scan' | 'roster' | 'logs' | 'info'

  const [manualCode, setManualCode] = useState('')
  const [showManualModal, setShowManualModal] = useState(false)
  const [flash, setFlash] = useState(null)
  // The checkout being graded survives a reload: without it the coop lost the
  // review screen (and the team's answers) the moment the page refreshed.
  const [lastResult, setLastResult] = useState(() => {
    const saved = readDraft(CHECKOUT_REVIEW_DRAFT)?.value
    return saved?.kind === 'exit' ? saved : null
  })
  const [refreshing, setRefreshing] = useState(false)
  const [processingScan, setProcessingScan] = useState(false)
  const [scoreDrafts, setScoreDrafts, scoreDraft] = useDraftState('coop:scoreDrafts', {})
  const [savingScoreId, setSavingScoreId] = useState(null)
  const [skippingSessionId, setSkippingSessionId] = useState(null)
  const [rosterSearch, setRosterSearch] = useState('')
  const [logSearch, setLogSearch] = useState('')
  const [logFilter, setLogFilter] = useState('all') // 'all' | 'active' | 'exited' | 'unscored'
  const [hasTorch, setHasTorch] = useState(false)
  const [isTorchOn, setIsTorchOn] = useState(false)
  const [cameras, setCameras] = useState([])
  // 'auto' probes the rear lenses; otherwise the deviceId (or facing mode) the collab picked.
  const [cameraMode, setCameraMode] = useState('auto')
  const [activeCameraId, setActiveCameraId] = useState(null)
  const [cameraProbing, setCameraProbing] = useState(false)

  const [nowTick, setNowTick] = useState(() => Date.now())

  const videoRef = useRef(null)
  const scannerRef = useRef(null)
  const scanBusyRef = useRef(false)
  const reviewPausedRef = useRef(lastResult?.kind === 'exit')
  useEffect(() => {
    if (lastResult?.kind === 'exit') writeDraft(CHECKOUT_REVIEW_DRAFT, lastResult)
    else clearDraft(CHECKOUT_REVIEW_DRAFT)
  }, [lastResult])
  const scanHandlerRef = useRef(null)
  const lastScanRef = useRef({ code: '', at: 0 })
  const selectedStationIdRef = useRef(selectedStationId)
  selectedStationIdRef.current = selectedStationId

  // Live timer for duration counters
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const currentPhase = programState.currentPhase || 'qualifying'
  const phaseInfo = useMemo(
    () => FIXED_PHASES.find((phase) => phase.key === currentPhase) ?? FIXED_PHASES[0],
    [currentPhase],
  )
  const stationEvents = useMemo(
    () => (programState.subEventsByPhase?.[currentPhase] ?? []).filter((eventItem) => eventItem.usesStations),
    [currentPhase, programState.subEventsByPhase],
  )
  const selectedEvent = useMemo(
    () => stationEvents.find((eventItem) => eventItem.id === selectedEventId) ?? null,
    [selectedEventId, stationEvents],
  )

  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.active),
    [assignments],
  )
  const preferredAssignments = useMemo(() => {
    const currentItems = activeAssignments.filter((assignment) => assignment.is_current)
    return currentItems.length > 0 ? currentItems : activeAssignments
  }, [activeAssignments])
  const assignmentStationIds = useMemo(
    () => new Set(preferredAssignments.map((assignment) => String(assignment.station.id))),
    [preferredAssignments],
  )
  const assignmentEventIds = useMemo(
    () => new Set(preferredAssignments.map((assignment) => String(assignment.event.id))),
    [preferredAssignments],
  )
  const stationOptions = useMemo(() => {
    if (assignmentStationIds.size === 0) return stations
    return stations.filter((station) => assignmentStationIds.has(String(station.id)))
  }, [assignmentStationIds, stations])
  const selectedStation = useMemo(
    () => stations.find((station) => station.id === selectedStationId) ?? null,
    [selectedStationId, stations],
  )
  const selectedAssignment = useMemo(
    () => preferredAssignments.find((assignment) => String(assignment.station.id) === selectedStationId) ?? preferredAssignments[0] ?? null,
    [preferredAssignments, selectedStationId],
  )
  const stationPolicy = CHECKIN_POLICY_META[selectedStation?.checkinPolicy || 'staff_scan'] || CHECKIN_POLICY_META.staff_scan
  const activeTeams = useMemo(
    () => stationSessions.filter((session) => session.status === 'active'),
    [stationSessions],
  )

  const loadProgram = useCallback(async () => {
    const [mePayload, programPayload] = await Promise.all([
      apiRequest('/auth/me'),
      apiRequest('/program'),
    ])
    setUser((current) => ({ ...current, ...mePayload }))
    setProgramState(normalizeProgramForFrontend(programPayload))
  }, [])

  const loadAssignments = useCallback(async (phaseKey, eventId) => {
    if (!phaseKey) {
      setAssignments([])
      return []
    }
    const params = new URLSearchParams({ phase_key: phaseKey })
    if (eventId) {
      params.set('event_id', eventId)
    }
    const payload = await apiRequest(`/coop/me/assignments?${params.toString()}`)
    const items = payload.items || []
    setAssignments(items)
    return items
  }, [])

  const loadStations = useCallback(async (phaseKey, eventId) => {
    if (!phaseKey || !eventId) {
      setStations([])
      return []
    }
    const payload = await apiRequest(`/program/phases/${phaseKey}/sub-events/${eventId}/stations`)
    const items = sortStations((payload.stations || []).map(buildStationView))
    setStations(items)
    return items
  }, [])

  const loadLiveData = useCallback(async (phaseKey, eventId, stationId, stationKind) => {
    if (!phaseKey || !eventId) {
      setEventStats(null)
      setEventSessions([])
      setOccupancy(null)
      setStationSessions([])
      setCheckinLog([])
      return
    }

    const requests = [
      apiRequest(`/event-checkins/stats?phase_key=${encodeURIComponent(phaseKey)}&event_id=${encodeURIComponent(eventId)}`),
      apiRequest(`/station-sessions?event_id=${encodeURIComponent(eventId)}`),
    ]

    if (stationId) {
      requests.push(apiRequest(`/stations/${stationId}/occupancy`))
      requests.push(apiRequest(`/stations/${stationId}/sessions`))
    }

    const results = await Promise.all(requests)
    setEventStats(results[0] || null)
    setEventSessions(results[1]?.sessions || [])
    setOccupancy(stationId ? results[2] || null : null)
    setStationSessions(stationId ? results[3]?.sessions || [] : [])

    if (stationKind === 'checkin' && eventId) {
      try {
        const checkinPayload = await apiRequest(`/event-checkins?event_id=${encodeURIComponent(eventId)}&limit=200`)
        setCheckinLog(Array.isArray(checkinPayload?.items) ? checkinPayload.items : [])
      } catch {
        // Keep previous check-in log data on error instead of blanking the screen.
      }
    }
  }, [])

  const bootstrap = useCallback(async () => {
    setApiError('')
    await loadProgram()
  }, [loadProgram])

  useEffect(() => {
    let cancelled = false

    const start = async () => {
      try {
        setBootLoading(true)
        await bootstrap()
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError('Không thể đồng bộ thông tin vận hành.')
      } finally {
        if (!cancelled) {
          setBootLoading(false)
        }
      }
    }

    start()
    return () => {
      cancelled = true
    }
  }, [bootstrap])

  useEffect(() => {
    if (stationEvents.length === 0) {
      setSelectedEventId('', { replace: true })
      return
    }

    const assignmentEventId = [...assignmentEventIds][0]

    if (assignmentEventId && stationEvents.some((eventItem) => eventItem.id === assignmentEventId)) {
      if (selectedEventId !== assignmentEventId) {
        setSelectedEventId(assignmentEventId, { replace: true })
      }
      return
    }

    const currentEventId = programState.currentSubEventId
    const currentEventMatches = currentEventId && stationEvents.some((eventItem) => eventItem.id === currentEventId)

    if (selectedEventId && stationEvents.some((eventItem) => eventItem.id === selectedEventId)) {
      return
    }

    if (currentEventMatches) {
      setSelectedEventId(currentEventId, { replace: true })
      return
    }

    setSelectedEventId(stationEvents[0].id, { replace: true })
  }, [assignmentEventIds, programState.currentSubEventId, selectedEventId, setSelectedEventId, stationEvents])

  useEffect(() => {
    let cancelled = false

    const syncPhaseAssignments = async () => {
      try {
        const items = await loadAssignments(currentPhase)
        if (cancelled) return

        const currentItems = items.filter((assignment) => assignment.active && assignment.is_current)
        const preferredItems = currentItems.length > 0 ? currentItems : items.filter((assignment) => assignment.active)
        const rawAssignmentEventId = preferredItems[0]?.event?.id
        const assignmentEventId = rawAssignmentEventId != null ? String(rawAssignmentEventId) : ''

        if (assignmentEventId && selectedEventId !== assignmentEventId && stationEvents.some((eventItem) => eventItem.id === assignmentEventId)) {
          setSelectedEventId(assignmentEventId, { replace: true })
        }
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError('Không thể tải phân công coop.')
      }
    }

    if (stationEvents.length > 0) {
      syncPhaseAssignments()
    }

    return () => {
      cancelled = true
    }
  }, [currentPhase, loadAssignments, selectedEventId, setSelectedEventId, stationEvents])

  useEffect(() => {
    let cancelled = false

    const syncEvent = async () => {
      try {
        const nextAssignments = await loadAssignments(currentPhase, selectedEventId)
        const nextStations = await loadStations(currentPhase, selectedEventId)
        if (cancelled) return

        const currentStations = nextAssignments
          .filter((assignment) => assignment.is_current || assignment.active)
          .map((assignment) => String(assignment.station.id))
        const allowedIds = currentStations.length > 0 ? currentStations : nextStations.map((station) => station.id)

        if (!allowedIds.includes(selectedStationIdRef.current)) {
          setSelectedStationId(allowedIds[0] || '', { replace: true })
        }
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError('Không thể tải trạm và phân công coop.')
      }
    }

    if (!selectedEventId) {
      setAssignments([])
      setStations([])
      setSelectedStationId('', { replace: true })
      return () => {
        cancelled = true
      }
    }

    syncEvent()
    return () => {
      cancelled = true
    }
  }, [currentPhase, loadAssignments, loadStations, selectedEventId, setSelectedStationId])

  useEffect(() => {
    if (!selectedStationId && stationOptions.length > 0) {
      setSelectedStationId(stationOptions[0].id, { replace: true })
      return
    }

    if (selectedStationId && !stationOptions.some((station) => station.id === selectedStationId)) {
      setSelectedStationId(stationOptions[0]?.id || '', { replace: true })
    }
  }, [selectedStationId, setSelectedStationId, stationOptions])

  const refreshLive = useCallback(async () => {
    try {
      await loadLiveData(currentPhase, selectedEventId, selectedStationId, selectedStation?.kind)
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError('Không thể tải số liệu realtime của coop.')
    }
  }, [currentPhase, loadLiveData, selectedEventId, selectedStationId, selectedStation])

  const setFlashMessage = (tone, message) => {
    setFlash({ tone, message })
  }

  // `challenges` (at a challenge station) makes `rawValue` the form part only;
  // pass `rawValue = null` when the station has no form to score.
  const saveSessionScore = useCallback(async (sessionId, rawValue, challenges = null) => {
    if (!sessionId) return
    const points = rawValue == null ? null : Number(rawValue)
    if (points != null && !Number.isFinite(points)) {
      setFlashMessage('error', 'Điểm không hợp lệ.')
      playScanFeedback('error')
      return
    }
    setSavingScoreId(sessionId)
    try {
      const body = {}
      if (points != null) body.score = points
      if (challenges) body.challenges = challenges
      const response = await apiRequest(`/station-sessions/${sessionId}/score`, {
        method: 'PATCH',
        body,
      })
      setScoreDrafts((current) => {
        const next = { ...current }
        delete next[sessionId]
        delete next[`challenges:${sessionId}`]
        return next
      })
      scoreDraft.clear()
      setFlashMessage('success', `Đã lưu ${response?.score ?? points} điểm cho đội.`)
      playScanFeedback('success')
      await refreshLive()
    } catch (error) {
      playScanFeedback('error')
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setFlashMessage('error', error?.data?.error === 'not_assigned_to_station'
        ? 'Bạn không phụ trách trạm này nên không thể chấm điểm.'
        : error?.data?.error === 'results_locked'
          ? 'Kết quả đã khóa ở phase Kết thúc nên không thể lưu điểm.'
          : error?.data?.error === 'invalid_challenge_score'
            ? 'Điểm thử thách phải là số nguyên từ 0 đến điểm tối đa.'
            : 'Không lưu được điểm.')
    } finally {
      setSavingScoreId(null)
    }
  }, [refreshLive, scoreDraft, setScoreDrafts])

  const skipChallenge = useCallback(async (session, challenge, undo) => {
    const penalty = challenge.skipPenaltyMinutes ?? ((Number(challenge.durationMinutes) || 0) + 15)
    const question = undo
      ? `Hoàn tác bỏ thử thách ${challenge.index} (${challenge.title}) của đội ${session.team_name}?`
      : `Đội ${session.team_name} bỏ thử thách ${challenge.index} (${challenge.title})?\n\nThử thách này 0 điểm và đội bị giữ lại thêm ${penalty} phút mới được checkout.`
    if (!window.confirm(question)) return
    setSkippingSessionId(session.id)
    try {
      await apiRequest(`/station-sessions/${session.id}/challenge-skip`, {
        method: 'POST',
        body: { challenge_id: challenge.id, undo },
      })
      setFlashMessage('success', undo
        ? `Đã hoàn tác bỏ thử thách ${challenge.index}.`
        : `Đã ghi nhận đội bỏ thử thách ${challenge.index}, phạt ${penalty} phút.`)
      await refreshLive()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      const code = error?.data?.error
      setFlashMessage('error', code === 'session_not_active'
        ? 'Đội đã rời trạm, không thể bỏ thử thách nữa.'
        : code === 'not_assigned_to_station'
          ? 'Bạn không phụ trách trạm này.'
          : 'Không ghi nhận được. Thử lại.')
    } finally {
      setSkippingSessionId(null)
    }
  }, [refreshLive])

  const saveSessionOutcome = useCallback(async (sessionId, outcome) => {
    if (!sessionId) return
    setSavingScoreId(sessionId)
    try {
      await apiRequest(`/station-sessions/${sessionId}/score`, {
        method: 'PATCH',
        body: { outcome },
      })
      setFlashMessage('success', outcome === 'passed' ? 'Đã ghi nhận đội ĐẠT trạm.' : 'Đã ghi nhận đội KHÔNG ĐẠT trạm.')
      playScanFeedback('success')
      await refreshLive()
    } catch (error) {
      playScanFeedback('error')
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setFlashMessage('error', error?.data?.error === 'not_assigned_to_station'
        ? 'Bạn không phụ trách trạm này nên không thể chấm kết quả.'
        : error?.data?.error === 'results_locked'
          ? 'Kết quả đã khóa ở phase Kết thúc nên không thể lưu kết quả.'
          : 'Không lưu được kết quả.')
    } finally {
      setSavingScoreId(null)
    }
  }, [refreshLive])

  // Polling live data
  useEffect(() => {
    if (!selectedEventId) return undefined
    let cancelled = false

    const start = async () => {
      if (cancelled) return
      await refreshLive()
    }

    start()
    const timer = window.setInterval(() => {
      void refreshLive()
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [refreshLive, selectedEventId])

  const handleRefreshAll = async () => {
    try {
      setRefreshing(true)
      await bootstrap()
      await refreshLive()
      setFlashMessage('success', 'Đã làm mới dữ liệu.')
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError('Không thể làm mới màn hình coop.')
    } finally {
      setRefreshing(false)
    }
  }

  const handleScan = useCallback(async (rawCode) => {
    if (!rawCode || scanBusyRef.current || reviewPausedRef.current) return
    scanBusyRef.current = true

    const now = Date.now()
    if (rawCode === lastScanRef.current.code && now - lastScanRef.current.at < 2500) { scanBusyRef.current = false; return }
    lastScanRef.current = { code: rawCode, at: now }

    setProcessingScan(true)
    setApiError('')
    setFlash(null)
    try {
      const response = await apiRequest('/station-scan', {
        method: 'POST',
        body: { code: rawCode },
      })

      const teamName = response.team_name || response.team_code
      const participantName = response.participant_name || ''
      const participantMssv = response.mssv || ''
      const checkedInCount = Number(response.checked_in_count)
      const requiredCount = Number(response.required_count)
      setLastResult({
        kind: response.kind,
        teamId: response.team_code,
        teamName,
        eventName: response.event_name || selectedEvent?.name || '',
        stationName: response.station_name || '',
        timestamp: response.checked_in_at || response.checked_out_at || response.exited_at || response.entered_at || new Date().toISOString(),
        sessionId: response.kind === 'exit' ? response.id : null,
        scoringMode: response.scoring_mode || null,
        passThreshold: response.pass_threshold ?? null,
        passPoints: response.pass_points ?? null,
        submission: response.submission,
        score: response.score,
        formScore: response.form_score ?? null,
        challenges: Array.isArray(response.challenges) ? response.challenges : [],
        participantName,
        participantMssv,
        checkedInCount: Number.isFinite(checkedInCount) ? checkedInCount : null,
        requiredCount: Number.isFinite(requiredCount) && requiredCount > 0 ? requiredCount : null,
        eligible: response.eligible,
        checkedInMembers: Array.isArray(response.checked_in_members) ? response.checked_in_members : [],
      })

      if (response.kind === 'exit') {
        reviewPausedRef.current = true
        setActiveTab('review')
      }
      const message = response.kind === 'event'
        ? participantName
          ? `Đã check-in ${participantName}${participantMssv ? ` (${participantMssv})` : ''}${Number.isFinite(checkedInCount) && Number.isFinite(requiredCount) && requiredCount > 0 ? ` · ${checkedInCount}/${requiredCount} thành viên đã check-in.` : '.'}`
          : `Đã check-in sự kiện cho đội ${teamName}.`
        : response.kind === 'checkout'
          ? `Đã ghi nhận đội ${teamName} checkout lúc ${new Date(response.checked_out_at).toLocaleTimeString('vi-VN')}.`
        : response.kind === 'enter'
          ? `Đã nhận đội ${teamName} vào ${response.station_name}.`
          : `Đã ghi nhận đội ${teamName} rời ${response.station_name}.`
      setFlashMessage('success', message)
      playScanFeedback('success')

      await refreshLive()
    } catch (error) {
      const message = error?.status ? explainScanError(error) : error.message
      setFlashMessage('error', message)
      playScanFeedback('error')
    } finally {
      setProcessingScan(false)
      scanBusyRef.current = false
    }
  }, [refreshLive, selectedEvent, setActiveTab])

  scanHandlerRef.current = handleScan

  // Camera setup
  useEffect(() => {
    if (!videoRef.current) return undefined

    let cancelled = false
    let scanner = null

    const onDecode = (result) => {
      const value = typeof result === 'string' ? result : result?.data
      if (value && scanHandlerRef.current) {
        void scanHandlerRef.current(value)
      }
    }

    const discard = (target) => {
      try {
        target.stop()
        target.destroy()
      } catch {
        // already torn down
      }
      if (scanner === target) scanner = null
    }

    // Opens one camera and resolves to the device that is actually streaming,
    // or null. `strict` rejects a lens that shows no picture, and rejects the
    // library silently falling back to some other lens (possibly the front one).
    const openCamera = async (QrScanner, camera, strict) => {
      const candidate = new QrScanner(videoRef.current, onDecode, {
        preferredCamera: camera,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        maxScansPerSecond: 5,
      })
      scanner = candidate
      scannerRef.current = candidate
      try {
        await candidate.start()
      } catch {
        discard(candidate)
        return null
      }
      if (cancelled) return null
      const streaming = streamingDeviceId(videoRef.current)
      if (strict) {
        const fellBack = streaming && streaming !== camera
        if (fellBack || !(await videoShowsPicture(videoRef.current, () => cancelled))) {
          discard(candidate)
          return null
        }
      }
      return streaming || camera
    }

    import('qr-scanner').then(async ({ default: QrScanner }) => {
      if (cancelled || !videoRef.current) return

      let opened = null
      if (cameraMode === 'auto') {
        setCameraProbing(true)
        // Asks for camera permission first, so the labels needed to spot the front lens are filled in.
        const cams = await QrScanner.listCameras(true).catch(() => [])
        if (cancelled) return
        setCameras(cams)
        for (const cam of orderRearCameras(cams, readSavedCameraId())) {
          opened = await openCamera(QrScanner, cam.id, true)
          if (cancelled) return
          if (opened) {
            saveCameraId(opened)
            break
          }
        }
        // No rear lens proved itself (or the browser hid the labels): let it pick the back camera.
        if (!opened) opened = await openCamera(QrScanner, 'environment', false)
        if (cancelled) return
        setCameraProbing(false)
      } else {
        QrScanner.listCameras(true).then((cams) => { if (!cancelled) setCameras(cams) }).catch(() => {})
        opened = await openCamera(QrScanner, cameraMode, false)
        if (cancelled) return
      }

      if (!opened || !scanner) {
        setApiError('Không thể mở camera. Bạn có thể sử dụng nút Nhập mã tay.')
        return
      }
      setActiveCameraId(opened)
      scanner.hasFlash().then((has) => { if (!cancelled) setHasTorch(Boolean(has)) }).catch(() => {})
    }).catch(() => {
      if (!cancelled) setApiError('Không thể tải thư viện quét QR.')
    })

    return () => {
      cancelled = true
      if (scanner) discard(scanner)
      scannerRef.current = null
      setCameraProbing(false)
    }
  }, [cameraMode, bootLoading, stationEvents.length])

  const toggleTorch = async () => {
    if (!scannerRef.current) return
    try {
      await scannerRef.current.toggleFlash()
      const state = await scannerRef.current.isFlashOn()
      setIsTorchOn(Boolean(state))
    } catch {
      // ignore
    }
  }

  const toggleCameraFacing = () => {
    // Trên máy nhiều camera sau, chỉ luân phiên giữa các ống KÍNH SAU để bỏ qua
    // ống góc siêu rộng / camera ảo không lấy nét gần được, và không nhảy nhầm
    // sang camera trước.
    const rearCameras = cameras.filter((c) => !isFrontCamera(c.label))
    const pool = rearCameras.length > 1 ? rearCameras : cameras

    if (pool.length > 1) {
      const currentIndex = pool.findIndex((c) => c.id === activeCameraId)
      const next = currentIndex === -1 ? 0 : (currentIndex + 1) % pool.length
      setCameraMode(pool[next].id)
    } else {
      setCameraMode((prev) => (prev === 'user' ? 'environment' : 'user'))
    }
  }

  const handleCameraSelect = (e) => {
    const id = e.target.value
    setCameraMode(id)
    if (id !== 'auto') saveCameraId(id)
  }

  const activeCameraLabel = (() => {
    const index = cameras.findIndex((c) => c.id === activeCameraId)
    return index === -1 ? '' : cameras[index].label || `Camera ${index + 1}`
  })()

  const handleManualSubmit = async (e) => {
    e?.preventDefault()
    const value = manualCode.trim()
    if (!value) return
    await handleScan(value)
    setManualCode('')
    setShowManualModal(false)
  }

  const handleManualCheckout = async (session) => {
    if (!session || !selectedStationId) return
    if (!window.confirm(`Xác nhận cho đội "${session.team_name}" (${session.team_code}) rời trạm và chấm điểm?`)) {
      return
    }
    setProcessingScan(true)
    try {
      const response = await apiRequest('/station-sessions/exit', {
        method: 'POST',
        body: {
          team_code: session.team_code,
          station_id: Number(selectedStationId),
        },
      })
      const teamName = session.team_name || session.team_code
      setLastResult({
        kind: 'exit',
        teamId: session.team_code,
        teamName,
        eventName: selectedEvent?.name || '',
        stationName: selectedStation?.name || '',
        timestamp: response.exited_at || new Date().toISOString(),
        sessionId: response.id,
        scoringMode: selectedStation?.scoringMode || 'score_only',
        passThreshold: selectedStation?.passThreshold ?? null,
        passPoints: selectedStation?.passPoints ?? null,
        submission: response.submission,
        score: response.score,
        formScore: response.form_score ?? null,
        challenges: Array.isArray(response.challenges) ? response.challenges : [],
      })
      setFlashMessage('success', `Đã cho đội ${teamName} rời trạm.`)
      playScanFeedback('success')
      reviewPausedRef.current = true
      setActiveTab('review')
      await refreshLive()
    } catch (error) {
      const message = error?.status ? explainScanError(error) : error.message
      setFlashMessage('error', message)
      playScanFeedback('error')
    } finally {
      setProcessingScan(false)
      scanBusyRef.current = false
    }
  }

  const statsTeams = Number(eventStats?.checked_in_teams) || 0
  const statsEligible = Number(eventStats?.eligible_teams ?? eventStats?.checked_in_teams) || 0
  const statsParticipants = Number(eventStats?.checked_in_participants) || 0
  const liveStationCount = eventSessions.filter((session) => session.status === 'active').length
  const selectedStationOccupancy = occupancy?.active_sessions ?? activeTeams.length

  const maxCap = selectedStation?.maxConcurrentTeams || 0
  const isLimited = selectedStation?.capacityMode === 'limited' && maxCap > 0
  const capacityPercent = isLimited ? Math.min(100, Math.round((selectedStationOccupancy / maxCap) * 100)) : 0
  const isFull = isLimited && selectedStationOccupancy >= maxCap

  // Filtered Roster
  const filteredActiveTeams = useMemo(() => {
    if (!rosterSearch.trim()) return activeTeams
    const q = rosterSearch.toLowerCase()
    return activeTeams.filter(
      (t) => (t.team_name && t.team_name.toLowerCase().includes(q)) || (t.team_code && t.team_code.toLowerCase().includes(q)),
    )
  }, [activeTeams, rosterSearch])

  // Filtered Logs
  const filteredStationSessions = useMemo(() => {
    let list = stationSessions
    if (logFilter === 'active') {
      list = list.filter((s) => s.status === 'active')
    } else if (logFilter === 'exited') {
      list = list.filter((s) => s.status !== 'active')
    } else if (logFilter === 'unscored') {
      list = list.filter((s) => s.status !== 'active' && s.score == null && !s.outcome)
    }
    if (logSearch.trim()) {
      const q = logSearch.toLowerCase()
      list = list.filter(
        (s) => (s.team_name && s.team_name.toLowerCase().includes(q)) || (s.team_code && s.team_code.toLowerCase().includes(q)),
      )
    }
    return list
  }, [logFilter, logSearch, stationSessions])

  // Filtered check-in log (for check-in stations, which have no play sessions)
  const filteredCheckinLog = useMemo(() => {
    let list = [...checkinLog].sort((a, b) => {
      const bMs = b.checked_in_at ? Date.parse(b.checked_in_at) : 0
      const aMs = a.checked_in_at ? Date.parse(a.checked_in_at) : 0
      return bMs - aMs
    })
    if (logSearch.trim()) {
      const q = logSearch.toLowerCase()
      list = list.filter((item) => {
        if (item.team_name && item.team_name.toLowerCase().includes(q)) return true
        if (item.team_code && item.team_code.toLowerCase().includes(q)) return true
        return (item.members_detail || []).some((member) => member.full_name && member.full_name.toLowerCase().includes(q))
      })
    }
    return list
  }, [checkinLog, logSearch])

  if (bootLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-ink">
        <div className="relative flex flex-col items-center gap-3 rounded-2xl border border-stone bg-white p-8 shadow-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-trail border-t-transparent" />
          <p className="font-semibold text-ink/80">Đang chuẩn bị cổng cộng tác viên...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper text-ink pb-24 lg:pb-12">

      {/* TOP COMPACT HEADER */}
      <header className="sticky top-0 z-40 border-b border-stone bg-white/95 backdrop-blur shadow-xs">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-2.5 sm:px-6">
          <a href="/" className="flex items-center gap-2.5">
            <img src={logoImage} alt="VNUTour" className="h-9 w-9 object-contain" />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-display text-sm font-bold text-ink sm:text-base leading-tight">VNUTour</span>
                <span className="rounded-md bg-trail/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-trail">CTV</span>
              </div>
              <p className="text-[11px] font-medium text-ink/70 truncate max-w-[140px] sm:max-w-none">
                {user?.full_name || user?.username || 'Cộng tác viên'}
              </p>
            </div>
          </a>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={refreshing}
              title="Làm mới dữ liệu"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-stone bg-white px-2.5 text-xs font-semibold text-ink/80 transition hover:bg-paper hover:text-ink active:scale-95 disabled:opacity-50"
            >
              <svg className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-trail' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span className="hidden sm:inline">{refreshing ? 'Đang tải...' : 'Làm mới'}</span>
            </button>

            <button
              type="button"
              onClick={() => logoutAndRedirect('/')}
              title="Đăng xuất"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-stone bg-white px-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 active:scale-95"
            >
              <LogoutIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Thoát</span>
            </button>
          </div>
        </div>

        {/* STATION & CONTEXT QUICK SWITCHER STRIP */}
        <div className="border-t border-stone/60 bg-paper/90 px-3 py-2 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2.5">
            {/* Station dropdown / display */}
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-trail text-white shadow-xs">
                <Icon name="pin" className="h-4 w-4" />
              </span>

              {stationOptions.length > 1 ? (
                <div className="relative flex-1 max-w-xs">
                  <select
                    value={selectedStationId}
                    onChange={(e) => setSelectedStationId(e.target.value)}
                    className="w-full truncate rounded-lg border border-stone bg-white py-1.5 pl-2.5 pr-8 text-xs sm:text-sm font-bold text-ink outline-none focus:border-trail focus:ring-2 focus:ring-trail/20"
                  >
                    {stationOptions.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name} {st.location ? `(${st.location})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="min-w-0">
                  <h1 className="truncate font-display text-sm font-bold text-ink sm:text-base">
                    {selectedStation ? selectedStation.name : 'Chưa có trạm'}
                  </h1>
                  {selectedStation?.location && (
                    <p className="truncate text-[11px] text-ink/65">{selectedStation.location}</p>
                  )}
                </div>
              )}
            </div>

            {/* Live Capacity & Badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold shadow-2xs ${
                  isFull
                    ? 'bg-rose-100 text-rose-900 border border-rose-300 animate-pulse'
                    : isLimited && capacityPercent >= 80
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-current" />
                <span>
                  {isLimited
                    ? `${selectedStationOccupancy}/${maxCap} Đội`
                    : `${selectedStationOccupancy} Đội tại trạm`}
                </span>
              </span>

              <span className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-medium ${stationPolicy.cls}`}>
                {stationPolicy.label}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="mx-auto max-w-6xl p-3 sm:p-6 space-y-4">
        {/* Flash & Errors */}
        {apiError && (
          <div className="flex items-center justify-between rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900 shadow-sm animate-shake">
            <span>{apiError}</span>
            <button type="button" onClick={() => setApiError('')} className="text-rose-700 hover:text-rose-950">
              ✕
            </button>
          </div>
        )}

        {flash && (
          <div
            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm transition ${
              flash.tone === 'success'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                : 'border-rose-300 bg-rose-50 text-rose-950'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">{flash.tone === 'success' ? '✅' : '⚠️'}</span>
              <span>{flash.message}</span>
            </div>
            <button type="button" onClick={() => setFlash(null)} className="text-ink/60 hover:text-ink">
              ✕
            </button>
          </div>
        )}

        <DraftNotice draft={scoreDraft} label="điểm đang chấm dở cho các đội" />

        {stationEvents.length === 0 ? (
          <div className={`${CARD} border-dashed px-5 py-16 text-center`}>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-900">
              <Icon name="flag" className="h-7 w-7" />
            </span>
            <h2 className="mt-4 font-display text-xl font-bold text-ink">Phase hiện tại chưa mở trạm</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink/70">
              Ban tổ chức cần mở một event có trạm trước khi cộng tác viên thao tác.
            </p>
          </div>
        ) : (
          <>
            {/* MOBILE NAVIGATION TABS (Sticky at bottom on mobile, inline switch on desktop) */}
            <div className="flex lg:hidden sticky top-[92px] z-30 -mx-3 px-3 py-1 bg-paper/95 backdrop-blur border-b border-stone/60">
              <div className={`grid ${lastResult?.kind === 'exit' ? 'grid-cols-5' : 'grid-cols-4'} w-full gap-1 p-1 bg-stone/25 rounded-xl`}>
                {lastResult?.kind === 'exit' && <button type="button" onClick={() => setActiveTab('review')} className={`flex flex-col items-center justify-center rounded-lg py-2 text-xs font-bold ${activeTab === 'review' ? 'bg-ink text-white' : 'text-ink/70'}`}><Icon name="doc" className="mb-0.5 h-4 w-4" /><span>Chấm bài</span></button>}
                <button
                  type="button"
                  onClick={() => setActiveTab('scan')}
                  className={`flex flex-col items-center justify-center py-2 rounded-lg text-xs font-bold transition ${
                    activeTab === 'scan' ? 'bg-white text-trail shadow-sm' : 'text-ink/70 hover:text-ink'
                  }`}
                >
                  <QrIcon className="h-4 w-4 mb-0.5" />
                  <span>Quét QR</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('roster')}
                  className={`relative flex flex-col items-center justify-center py-2 rounded-lg text-xs font-bold transition ${
                    activeTab === 'roster' ? 'bg-white text-trail shadow-sm' : 'text-ink/70 hover:text-ink'
                  }`}
                >
                  <Icon name="users" className="h-4 w-4 mb-0.5" />
                  <span>Ở trạm</span>
                  {activeTeams.length > 0 && (
                    <span className="absolute top-1 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-trail px-1 font-mono text-[9px] font-bold text-white">
                      {activeTeams.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('logs')}
                  className={`relative flex flex-col items-center justify-center py-2 rounded-lg text-xs font-bold transition ${
                    activeTab === 'logs' ? 'bg-white text-trail shadow-sm' : 'text-ink/70 hover:text-ink'
                  }`}
                >
                  <Icon name="clock" className="h-4 w-4 mb-0.5" />
                  <span>Nhật ký</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('info')}
                  className={`flex flex-col items-center justify-center py-2 rounded-lg text-xs font-bold transition ${
                    activeTab === 'info' ? 'bg-white text-trail shadow-sm' : 'text-ink/70 hover:text-ink'
                  }`}
                >
                  <Icon name="gear" className="h-4 w-4 mb-0.5" />
                  <span>Ca trực</span>
                </button>
              </div>
            </div>

            {lastResult?.kind === 'exit' && activeTab !== 'review' && <button type="button" onClick={() => setActiveTab('review')} className="mb-4 w-full rounded-xl bg-trail px-4 py-3 font-semibold text-white lg:hidden">Chấm bài · {lastResult.teamName}</button>}
            {/* MAIN CONTENT GRID (Responsive: 1 col on mobile, 2 cols on lg+) */}
            <div className="grid gap-5 lg:grid-cols-12 items-start">
              {/* LEFT COLUMN: SCANNER & IMMEDIATE ACTION CARD (lg: 6 cols or 7 cols) */}
              <div className={`space-y-4 lg:col-span-4 ${activeTab !== 'scan' ? 'hidden lg:block' : 'block'}`}>
                {/* CAMERA SCANNER CARD */}
                <div className={`${CARD} overflow-hidden border-stone shadow-sm`}>
                  <div className="flex items-center justify-between border-b border-stone/80 bg-stone/10 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <h2 className="font-display text-sm font-bold text-ink">Camera Quét QR</h2>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {hasTorch && (
                        <button
                          type="button"
                          onClick={toggleTorch}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                            isTorchOn ? 'bg-amber-400 text-ink' : 'bg-white text-ink/70 hover:bg-paper'
                          }`}
                        >
                          🔦 {isTorchOn ? 'Tắt đèn' : 'Bật đèn'}
                        </button>
                      )}
                      {cameras.length > 1 ? (
                        <select
                          value={cameraMode === 'auto' || cameras.some((c) => c.id === cameraMode) ? cameraMode : 'auto'}
                          onChange={handleCameraSelect}
                          title="Chọn camera"
                          className="max-w-[11rem] rounded-lg border border-stone bg-white px-2 py-1 text-xs text-ink/70"
                        >
                          <option value="auto">
                            {cameraProbing ? 'Tự động · đang dò…' : `Tự động${activeCameraLabel ? ` · ${activeCameraLabel}` : ''}`}
                          </option>
                          {cameras.map((c, index) => (
                            <option key={c.id} value={c.id}>
                              {c.label || `Camera ${index + 1}`}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          type="button"
                          onClick={toggleCameraFacing}
                          title="Đổi camera"
                          className="rounded-lg border border-stone bg-white p-1 text-ink/70 hover:text-ink"
                        >
                          🔄
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="p-3 sm:p-4 space-y-3">
                    {/* CAMERA VIEWPORT WITH RETICLE */}
                    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black shadow-inner border border-stone/40">
                      <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

                      {cameraProbing && (
                        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
                          <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
                            Đang tìm camera sau hoạt động…
                          </span>
                        </div>
                      )}

                      {/* SCANNING TARGET FRAME OVERLAY */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
                        <div className="relative h-44 w-44 sm:h-52 sm:w-52 rounded-2xl border-2 border-dashed border-emerald-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
                          {/* Corner markers */}
                          <div className="absolute -top-1 -left-1 h-5 w-5 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
                          <div className="absolute -top-1 -right-1 h-5 w-5 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
                          <div className="absolute -bottom-1 -left-1 h-5 w-5 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
                          <div className="absolute -bottom-1 -right-1 h-5 w-5 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />

                          {/* Scanning laser line animation */}
                          <div className="absolute inset-x-2 top-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_#34d399] animate-pulse" />
                        </div>
                      </div>

                      {processingScan && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-xs">
                          <div className="flex items-center gap-2.5 rounded-xl bg-white/95 px-4 py-2 text-sm font-bold text-ink shadow-lg">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-trail border-t-transparent" />
                            Đang xử lý mã...
                          </div>
                        </div>
                      )}
                    </div>

                    {/* MANUAL CODE ENTRY TRIGGER */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowManualModal(true)}
                        disabled={processingScan || reviewPausedRef.current}
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-stone bg-white px-3 py-2.5 text-xs sm:text-sm font-bold text-ink/80 hover:bg-stone/20 hover:text-ink transition active:scale-98 shadow-xs disabled:opacity-50"
                      >
                        <span>⌨️</span>
                        <span>Nhập mã QR thủ công</span>
                      </button>
                    </div>
                  </div>
                </div>

                {lastResult && lastResult.kind !== 'exit' && <div className="rounded-xl border border-trail/20 bg-white p-4" role="status">
                  <p className="text-sm font-semibold text-trail">{(RESULT_META[lastResult.kind] || RESULT_META.event).label}</p>
                  <p className="mt-1 text-lg font-bold text-ink">{lastResult.participantName || lastResult.teamName}</p>
                  <p className="text-sm text-ink/60">
                    {lastResult.participantMssv && `${lastResult.participantMssv} · `}
                    {lastResult.stationName || lastResult.eventName}
                  </p>
                  {lastResult.kind === 'event' && lastResult.checkedInCount != null && lastResult.requiredCount != null && (
                    <p className="mt-2 text-sm font-semibold text-trail">
                      {lastResult.checkedInCount}/{lastResult.requiredCount} thành viên đã check-in
                      {lastResult.eligible ? ' · Đủ điều kiện vào trạm' : ''}
                    </p>
                  )}
                  <CheckedInMembers members={lastResult.checkedInMembers} />
                </div>}
                {reviewPausedRef.current && <div className="rounded-xl border border-gold/40 bg-gold/10 p-4 text-sm text-ink">
                  Đang tạm dừng quét để chấm bài của {lastResult?.teamName}.
                  <button type="button" onClick={() => setActiveTab('review')} className="mt-2 block font-semibold text-trail underline">Mở bài vừa checkout</button>
                  <CheckedInMembers members={lastResult?.checkedInMembers} />
                </div>}
              </div>

              {/* RIGHT COLUMN: TABS (LIVE ROSTER, HISTORY LOGS, SHIFT INFO) */}
              <div className="space-y-4 lg:col-span-8">
                {/* DESKTOP TAB SELECTOR */}
                <div className="hidden lg:flex flex-wrap items-center gap-1 border-b border-stone/80 pb-2">
                  {lastResult?.kind === 'exit' && <button type="button" onClick={() => setActiveTab('review')} className={`rounded-lg px-4 py-3 text-sm font-semibold ${activeTab === 'review' ? 'bg-ink text-white' : 'bg-white text-ink'}`}>Bài vừa checkout</button>}
                  <button
                    type="button"
                    onClick={() => setActiveTab('roster')}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                      activeTab === 'roster' || activeTab === 'scan'
                        ? 'bg-white text-ink shadow-xs border border-stone'
                        : 'text-ink/65 hover:text-ink'
                    }`}
                  >
                    <Icon name="users" className="h-4 w-4 text-trail" />
                    <span>Đang ở trạm</span>
                    <span className="rounded-full bg-trail/15 px-2 py-0.5 font-mono text-xs text-trail font-bold">
                      {activeTeams.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('logs')}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                      activeTab === 'logs'
                        ? 'bg-white text-ink shadow-xs border border-stone'
                        : 'text-ink/65 hover:text-ink'
                    }`}
                  >
                    <Icon name="clock" className="h-4 w-4 text-sky-700" />
                    <span>Nhật ký trạm</span>
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 font-mono text-xs text-sky-800 font-bold">
                      {stationSessions.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('info')}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                      activeTab === 'info'
                        ? 'bg-white text-ink shadow-xs border border-stone'
                        : 'text-ink/65 hover:text-ink'
                    }`}
                  >
                    <Icon name="gear" className="h-4 w-4 text-amber-700" />
                    <span>Ca trực & Thống kê</span>
                  </button>
                </div>

                {activeTab === 'review' && !lastResult && <div className="rounded-xl border border-stone bg-white p-6">
                  <h2 className="text-lg font-semibold text-ink">Chưa có bài vừa checkout</h2>
                  <p className="mt-2 text-sm text-ink/60">Quét QR checkout để xem đáp án, giải thích và chấm điểm cho đội.</p>
                  <button type="button" onClick={() => setActiveTab('scan')} className="mt-4 rounded-lg bg-trail px-4 py-3 font-semibold text-white">Mở máy quét</button>
                </div>}
                {lastResult?.kind === 'exit' && (activeTab === 'review' || activeTab === 'scan') && <CheckoutReview
                  key={lastResult.sessionId}
                  result={lastResult}
                  onSaved={updated => {
                    setLastResult(current => ({
                      ...current,
                      score: updated.score,
                      formScore: updated.form_score ?? current.formScore ?? null,
                      challenges: (current.challenges || []).map(item => ({
                        ...item,
                        points: updated.challenge_scores?.[item.id] ?? null,
                      })),
                      submission: current.submission && 'item_marks' in updated
                        ? { ...current.submission, item_marks: updated.item_marks }
                        : current.submission,
                    }))
                    void refreshLive()
                  }}
                  onNext={() => { reviewPausedRef.current = false; setActiveTab('scan'); setLastResult(null) }}
                />}
                {/* TAB CONTENT: LIVE ROSTER */}
                {(activeTab === 'roster' || activeTab === 'scan') && (
                  <div className={`${CARD} overflow-hidden border-stone shadow-sm ${activeTab === 'scan' ? 'hidden lg:block' : ''}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone/80 bg-stone/10 px-4 py-3">
                      <div>
                        <h2 className="font-display text-base font-bold text-ink">Đội đang ở trạm ({activeTeams.length})</h2>
                        <p className="text-xs text-ink/70">Danh sách các đội đã quét vào trạm hiện tại</p>
                      </div>

                      <div className="w-full sm:w-auto min-w-[200px]">
                        <input
                          type="text"
                          value={rosterSearch}
                          onChange={(e) => setRosterSearch(e.target.value)}
                          placeholder="Tìm tên hoặc mã đội..."
                          className="w-full rounded-lg border border-stone bg-white px-3 py-1.5 text-xs text-ink placeholder:text-ink/40 outline-none focus:border-trail"
                        />
                      </div>
                    </div>

                    <div className="p-3 sm:p-4 space-y-2.5 max-h-[500px] overflow-y-auto">
                      {filteredActiveTeams.length > 0 ? (
                        filteredActiveTeams.map((session) => (
                          <div
                            key={session.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-stone/80 bg-white p-3.5 shadow-2xs hover:border-trail/40 transition"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-md">
                                  {session.team_code}
                                </span>
                                <span className="font-mono text-xs font-semibold text-ink/70">
                                  Vào lúc: {formatDateTime(session.entered_at)}
                                </span>
                              </div>
                              <h4 className="mt-1 font-display text-base font-bold text-ink truncate">
                                {session.team_name}
                              </h4>
                              <StayTimer
                                enteredAt={session.entered_at}
                                maxStayMinutes={selectedStation?.maxStayMinutes}
                                nowMs={nowTick}
                              />
                              {selectedStation?.challenges?.length > 0 && (
                                <ChallengeSkipControls
                                  session={session}
                                  challenges={selectedStation.challenges}
                                  nowMs={nowTick}
                                  busy={skippingSessionId === session.id}
                                  onSkip={skipChallenge}
                                />
                              )}
                            </div>

                            <div className="shrink-0 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleManualCheckout(session)}
                                disabled={Boolean(session.penalty_until) && new Date(session.penalty_until).getTime() > nowTick}
                                title={session.penalty_until && new Date(session.penalty_until).getTime() > nowTick ? `Đang phạt tới ${formatClock(session.penalty_until)}` : undefined}
                                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-sky-300 bg-sky-50 px-3.5 py-2 text-xs font-bold text-sky-900 hover:bg-sky-100 active:scale-95 transition shadow-2xs min-h-[40px] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <span>🚪 Cho ra trạm</span>
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-12 text-center text-ink/60 space-y-1">
                          <p className="text-sm font-semibold">Hiện chưa có đội nào ở trạm này</p>
                          <p className="text-xs">Khi quét mã vào trạm thành công, đội sẽ xuất hiện tại đây.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: CHECK-IN LOG (check-in stations have no play sessions) */}
                {activeTab === 'logs' && selectedStation?.kind === 'checkin' && (
                  <div className={`${CARD} overflow-hidden border-stone shadow-sm`}>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone/80 bg-stone/10 px-4 py-3">
                      <div>
                        <h2 className="font-display text-base font-bold text-ink">Nhật ký điểm danh</h2>
                        <p className="text-xs text-ink/70">Danh sách đội và thành viên đã điểm danh sự kiện</p>
                      </div>

                      <div className="w-full sm:w-auto min-w-[200px]">
                        <input
                          type="text"
                          value={logSearch}
                          onChange={(e) => setLogSearch(e.target.value)}
                          placeholder="Tìm đội hoặc thành viên..."
                          className="w-full rounded-lg border border-stone bg-white px-3 py-1.5 text-xs text-ink placeholder:text-ink/40 outline-none focus:border-trail"
                        />
                      </div>
                    </div>

                    <div className="p-3 sm:p-4 space-y-3 max-h-[550px] overflow-y-auto">
                      {filteredCheckinLog.length > 0 ? (
                        filteredCheckinLog.map((item) => {
                          const checkedMembers = (item.members_detail || []).filter((member) => member.checked_in)
                          return (
                            <div key={item.id} className="rounded-xl border border-stone/80 bg-white p-3.5 shadow-2xs space-y-2">
                              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-mono text-xs font-bold text-ink/70">{item.team_code}</span>
                                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-800">
                                      {item.checked_in_count} thành viên
                                    </span>
                                  </div>
                                  <h4 className="mt-1 font-display text-base font-bold text-ink truncate">{item.team_name}</h4>
                                </div>
                                <div className="text-xs text-ink/70 font-mono">
                                  {item.checked_in_at ? new Date(item.checked_in_at).toLocaleTimeString('vi-VN') : '--'}
                                </div>
                              </div>

                              {checkedMembers.length > 0 ? (
                                <ul className="space-y-1 border-t border-stone/60 pt-2">
                                  {checkedMembers.map((member) => (
                                    <li key={member.mssv || member.full_name} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                      <span className="text-ink">
                                        {member.full_name} <span className="font-mono text-ink/50">({member.mssv})</span>
                                      </span>
                                      <span className="font-mono text-ink/60">
                                        {member.checked_in_at ? new Date(member.checked_in_at).toLocaleTimeString('vi-VN') : ''}
                                        {member.scanner ? ` · ${member.scanner}` : ''}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="border-t border-stone/60 pt-2 text-xs text-ink/50">Chưa có thành viên nào điểm danh.</p>
                              )}
                            </div>
                          )
                        })
                      ) : (
                        <div className="py-12 text-center text-ink/60">
                          <p className="text-sm font-semibold">Chưa có đội nào điểm danh</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: STATION LOGS & RE-GRADING */}
                {activeTab === 'logs' && selectedStation?.kind !== 'checkin' && (
                  <div className={`${CARD} overflow-hidden border-stone shadow-sm`}>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone/80 bg-stone/10 px-4 py-3">
                      <div>
                        <h2 className="font-display text-base font-bold text-ink">Nhật ký & Chấm điểm trạm</h2>
                        <p className="text-xs text-ink/70">Xem lịch sử các phiên chơi và sửa điểm nếu cần</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        <select
                          value={logFilter}
                          onChange={(e) => setLogFilter(e.target.value)}
                          className="rounded-lg border border-stone bg-white px-2.5 py-1.5 text-xs font-bold text-ink outline-none"
                        >
                          <option value="all">Tất cả ({stationSessions.length})</option>
                          <option value="active">Đang ở trạm ({activeTeams.length})</option>
                          <option value="exited">Đã rời trạm</option>
                          <option value="unscored">Chưa chấm điểm</option>
                        </select>
                        <input
                          type="text"
                          value={logSearch}
                          onChange={(e) => setLogSearch(e.target.value)}
                          placeholder="Lọc đội..."
                          className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs text-ink placeholder:text-ink/40 outline-none flex-1 sm:w-36"
                        />
                      </div>
                    </div>

                    <div className="p-3 sm:p-4 space-y-3 max-h-[550px] overflow-y-auto">
                      {filteredStationSessions.length > 0 ? (
                        filteredStationSessions.map((session) => (
                          <div
                            key={session.id}
                            className="rounded-xl border border-stone/80 bg-white p-3.5 shadow-2xs space-y-3"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${
                                      session.status === 'active'
                                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                        : 'bg-stone/20 text-ink/80 border border-stone'
                                    }`}
                                  >
                                    {session.status === 'active' ? 'Đang chơi' : 'Đã rời trạm'}
                                  </span>
                                  <span className="font-mono text-xs font-bold text-ink/70">
                                    {session.team_code}
                                  </span>
                                </div>
                                <h4 className="mt-1 font-display text-base font-bold text-ink">
                                  {session.team_name}
                                </h4>
                              </div>

                              <div className="text-xs text-ink/70 font-mono">
                                <div>Vào: {formatDateTime(session.entered_at)}</div>
                                {session.exited_at && <div>Ra: {formatDateTime(session.exited_at)}</div>}
                              </div>
                            </div>

                            {/* Scoring bar */}
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone/60 pt-2.5">
                              {selectedStation?.scoringMode === 'pass_fail' ? (
                                <>
                                  <span className="text-xs font-bold text-ink/80">
                                    Kết quả:{' '}
                                    {session.outcome === 'passed' ? (
                                      <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                        ĐẠT
                                      </span>
                                    ) : session.outcome === 'failed' ? (
                                      <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                        KHÔNG ĐẠT
                                      </span>
                                    ) : (
                                      <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                        Chưa chấm
                                      </span>
                                    )}
                                  </span>

                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => saveSessionOutcome(session.id, 'passed')}
                                      disabled={savingScoreId === session.id}
                                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                                    >
                                      {savingScoreId === session.id ? '...' : 'Đạt'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => saveSessionOutcome(session.id, 'failed')}
                                      disabled={savingScoreId === session.id}
                                      className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100 active:scale-95 disabled:opacity-50"
                                    >
                                      {savingScoreId === session.id ? '...' : 'Không đạt'}
                                    </button>
                                  </div>
                                </>
                              ) : selectedStation?.challenges?.length > 0 && !String(session.id).startsWith('sub-') ? (
                                <SessionChallengeGrading
                                  session={session}
                                  station={selectedStation}
                                  drafts={scoreDrafts}
                                  setDrafts={setScoreDrafts}
                                  saving={savingScoreId === session.id}
                                  onSave={saveSessionScore}
                                />
                              ) : (
                                <>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-ink/80">Điểm:</span>
                                    <span className="font-mono text-sm font-extrabold text-ink bg-stone/20 px-2 py-0.5 rounded">
                                      {session.score ?? 0}
                                    </span>
                                    {selectedStation?.scoringMode === 'threshold' && selectedStation?.passThreshold != null && (
                                      <span className="text-[11px] text-ink/65">
                                        (đạt ≥ {selectedStation.passThreshold})
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      value={scoreDrafts[session.id] ?? (session.score ?? '')}
                                      onChange={(e) =>
                                        setScoreDrafts((c) => ({ ...c, [session.id]: e.target.value }))
                                      }
                                      placeholder="Điểm"
                                      className="w-20 rounded-lg border border-stone bg-white px-2 py-1 text-xs font-bold text-ink outline-none focus:border-trail"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        saveSessionScore(session.id, scoreDrafts[session.id] ?? session.score ?? 0)
                                      }
                                      disabled={savingScoreId === session.id}
                                      className="rounded-lg bg-ink px-3 py-1 text-xs font-bold text-white hover:brightness-110 active:scale-95 disabled:opacity-50"
                                    >
                                      {savingScoreId === session.id ? '...' : 'Lưu'}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-12 text-center text-ink/60">
                          <p className="text-sm font-semibold">Không tìm thấy phiên trạm nào</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB CONTENT: SHIFT INFO & EVENT STATS */}
                {activeTab === 'info' && (
                  <div className="space-y-4">
                    {/* Shift assignment card */}
                    <div className={`${CARD} overflow-hidden border-stone p-4 sm:p-5 space-y-3`}>
                      <h3 className="font-display text-base font-bold text-ink flex items-center gap-2">
                        <span>📋</span> Phân công ca trực của bạn
                      </h3>
                      <div className="grid gap-3 sm:grid-cols-3 pt-1">
                        <div className="rounded-xl border border-stone/80 bg-paper/60 p-3">
                          <p className="text-xs font-medium text-ink/65">Phase hiện tại</p>
                          <p className="mt-1 font-display text-base font-bold text-ink">
                            {phaseInfo.label}
                          </p>
                        </div>
                        <div className="rounded-xl border border-stone/80 bg-paper/60 p-3">
                          <p className="text-xs font-medium text-ink/65">Trạm phụ trách</p>
                          <p className="mt-1 font-display text-base font-bold text-ink">
                            {selectedStation?.name || 'Chưa có trạm'}
                          </p>
                        </div>
                        <div className="rounded-xl border border-stone/80 bg-paper/60 p-3">
                          <p className="text-xs font-medium text-ink/65">Khung giờ trực</p>
                          <p className="mt-1 text-sm font-bold text-ink">
                            {formatShift(selectedAssignment)}
                          </p>
                        </div>
                      </div>

                      {selectedAssignment?.note && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900">
                          <span className="font-bold">Ghi chú từ BTC:</span> {selectedAssignment.note}
                        </div>
                      )}
                    </div>

                    {/* Event Stats Grid */}
                    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                      <div className={`${CARD} p-4 text-center border-stone`}>
                        <p className="font-mono text-2xl font-black text-trail">{statsTeams}</p>
                        <p className="mt-1 text-xs font-bold text-ink/70">Đội đã check-in</p>
                        {/* Có người đến chưa phải là đủ điều kiện vào trạm: event
                            điểm danh theo cá nhân còn đòi đủ số thành viên. */}
                        {statsEligible < statsTeams && (
                          <p className="mt-1 text-[11px] font-semibold text-amber-700">
                            {statsEligible} đội đủ điều kiện vào trạm
                          </p>
                        )}
                      </div>
                      <div className={`${CARD} p-4 text-center border-stone`}>
                        <p className="font-mono text-2xl font-black text-amber-700">{statsParticipants}</p>
                        <p className="mt-1 text-xs font-bold text-ink/70">Người qua cổng</p>
                      </div>
                      <div className={`${CARD} p-4 text-center border-stone col-span-2 sm:col-span-1`}>
                        <p className="font-mono text-2xl font-black text-sky-800">{liveStationCount}</p>
                        <p className="mt-1 text-xs font-bold text-ink/70">Phiên đang mở toàn sự kiện</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* MODAL: MANUAL CODE ENTRY */}
      {showManualModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="manual-qr-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border border-stone bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-stone/60 pb-3">
              <h3 id="manual-qr-title" className="font-display text-base font-bold text-ink flex items-center gap-2">
                Nhập mã QR thủ công
              </h3>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="rounded-lg p-1 text-ink/60 hover:bg-stone/20 hover:text-ink"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label htmlFor="manual-qr-code" className="block text-sm font-semibold text-ink/75 mb-1.5">
                  Nội dung QR cá nhân hoặc QR đội
                </label>
                <input
                  id="manual-qr-code"
                  type="text"
                  autoFocus
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Dán QR cá nhân để điểm danh, hoặc QR đội để vào/rời trạm"
                  className="w-full rounded-xl border-2 border-stone bg-paper px-3.5 py-3 text-base font-mono font-bold text-ink outline-none focus:border-trail focus:bg-white"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className={SECONDARY_BUTTON}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={processingScan || !manualCode.trim()}
                  className={PRIMARY_BUTTON}
                >
                  {processingScan ? 'Đang gửi...' : 'Xác nhận quét'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function BigScorePad({ currentScore, onScoreChange, onSaveScore, saving }) {
  const numScore = Number(currentScore) || 0

  const adjustScore = (delta) => {
    const next = Math.max(0, numScore + delta)
    onScoreChange(String(next))
  }

  const setFixed = (val) => {
    onScoreChange(String(val))
  }

  return (
    <div className="space-y-3 pt-1">
      {/* Large Input & Stepper buttons */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => adjustScore(-5)}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white border border-sky-300 text-sm font-bold text-sky-900 shadow-2xs hover:bg-sky-100 active:scale-95"
        >
          -5
        </button>
        <button
          type="button"
          onClick={() => adjustScore(-1)}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white border border-sky-300 text-sm font-bold text-sky-900 shadow-2xs hover:bg-sky-100 active:scale-95"
        >
          -1
        </button>

        <input
          type="number"
          value={currentScore}
          onChange={(e) => onScoreChange(e.target.value)}
          placeholder="0"
          className="min-w-0 flex-1 h-12 rounded-xl border-2 border-sky-300 bg-white px-3 text-center font-mono text-2xl font-black text-ink outline-none focus:border-trail focus:ring-2 focus:ring-trail/20"
        />

        <button
          type="button"
          onClick={() => adjustScore(1)}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white border border-sky-300 text-sm font-bold text-sky-900 shadow-2xs hover:bg-sky-100 active:scale-95"
        >
          +1
        </button>
        <button
          type="button"
          onClick={() => adjustScore(5)}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white border border-sky-300 text-sm font-bold text-sky-900 shadow-2xs hover:bg-sky-100 active:scale-95"
        >
          +5
        </button>
      </div>

      {/* Preset fast chips */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {[0, 10, 20, 30, 40, 50, 80, 100].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setFixed(preset)}
            className="rounded-lg border border-sky-200 bg-white/80 px-2.5 py-1 text-xs font-bold text-sky-900 hover:bg-sky-100 active:scale-95"
          >
            {preset}đ
          </button>
        ))}
      </div>

      {/* Big Save Button */}
      <button
        type="button"
        onClick={onSaveScore}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-700 py-3.5 text-base font-bold text-white shadow-md hover:bg-sky-800 active:scale-98 transition disabled:opacity-50 min-h-[50px]"
      >
        <span>💾</span>
        <span>{saving ? 'Đang lưu điểm...' : 'XÁC NHẬN LƯU ĐIỂM'}</span>
      </button>
    </div>
  )
}

export default CoopDashboard
