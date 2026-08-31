import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useDraftState, DraftNotice } from './drafts.jsx'

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 min-h-[46px]'
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-stone/80 bg-white px-4 py-3 text-sm font-semibold text-ink/80 transition hover:bg-stone/20 hover:text-ink active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 min-h-[46px]'

const RESULT_META = {
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

const CHECKIN_POLICY_META = {
  staff_scan: { label: 'Cần coop scan', cls: 'bg-amber-100 text-amber-900 border border-amber-200' },
  free_play: { label: 'Tự do vào chơi', cls: 'bg-stone/30 text-ink/70 border border-stone' },
}

function Contours() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 opacity-40"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg width='520' height='520' viewBox='0 0 520 520' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23C5C0B3' stroke-width='1'%3E%3Cpath d='M62 80c64-48 142-56 212-24 80 37 132 22 182-6'/%3E%3Cpath d='M30 166c70-58 154-68 236-32 78 34 132 24 218-20'/%3E%3Cpath d='M18 252c78-44 142-52 214-22 90 38 168 32 252-22'/%3E%3Cpath d='M44 338c72-35 130-42 196-18 88 32 164 22 238-28'/%3E%3Cpath d='M92 428c72-42 146-48 220-18 60 24 118 16 166-20'/%3E%3Ccircle cx='392' cy='138' r='52'/%3E%3Ccircle cx='392' cy='138' r='82'/%3E%3Ccircle cx='142' cy='330' r='46'/%3E%3Ccircle cx='142' cy='330' r='76'/%3E%3C/g%3E%3C/svg%3E\")",
        backgroundSize: '520px 520px',
      }}
    />
  )
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

function SparklesIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  )
}

function explainScanError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    no_current_event: 'BTC chưa mở event nào nên chưa thể check-in sự kiện.',
    team_not_found: 'Không tìm thấy đội với mã QR hoặc mã đội này.',
    qr_already_used: 'Mã QR này đã được quét rồi. Đề nghị đội mở lại màn hình để lấy mã mới.',
    team_not_approved: 'Đội này chưa được duyệt nên không thể scan.',
    already_checked_in: 'Đội này đã được check-in sự kiện.',
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
    checkinPolicy: station.checkin_policy || 'staff_scan',
    capacityMode: station.capacity_mode || 'unlimited',
    maxConcurrentTeams: Number(station.max_concurrent_teams) || 0,
    order: station.order ?? 0,
    scoringMode: station.scoring_mode || 'score_only',
    passThreshold: station.pass_threshold ?? null,
    passPoints: station.pass_points ?? null,
  }
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
  const [selectedEventId, setSelectedEventId] = useSearchParam('event', '')
  const [selectedStationId, setSelectedStationId] = useSearchParam('station', '')
  const [activeTab, setActiveTab] = useState('scan') // 'scan' | 'roster' | 'logs' | 'info'

  const [manualCode, setManualCode] = useState('')
  const [showManualModal, setShowManualModal] = useState(false)
  const [flash, setFlash] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [processingScan, setProcessingScan] = useState(false)
  const [scoreDrafts, setScoreDrafts, scoreDraft] = useDraftState('coop:scoreDrafts', {})
  const [savingScoreId, setSavingScoreId] = useState(null)
  const [rosterSearch, setRosterSearch] = useState('')
  const [logSearch, setLogSearch] = useState('')
  const [logFilter, setLogFilter] = useState('all') // 'all' | 'active' | 'exited' | 'unscored'
  const [hasTorch, setHasTorch] = useState(false)
  const [isTorchOn, setIsTorchOn] = useState(false)
  const [cameras, setCameras] = useState([])
  const [cameraMode, setCameraMode] = useState('environment')

  const [nowTick, setNowTick] = useState(() => Date.now())

  const videoRef = useRef(null)
  const scannerRef = useRef(null)
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

  const loadLiveData = useCallback(async (phaseKey, eventId, stationId) => {
    if (!phaseKey || !eventId) {
      setEventStats(null)
      setEventSessions([])
      setOccupancy(null)
      setStationSessions([])
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
      await loadLiveData(currentPhase, selectedEventId, selectedStationId)
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError('Không thể tải số liệu realtime của coop.')
    }
  }, [currentPhase, loadLiveData, selectedEventId, selectedStationId])

  const setFlashMessage = (tone, message) => {
    setFlash({ tone, message })
  }

  const saveSessionScore = useCallback(async (sessionId, rawValue) => {
    if (!sessionId) return
    const points = Number(rawValue)
    if (!Number.isFinite(points)) {
      setFlashMessage('error', 'Điểm không hợp lệ.')
      playScanFeedback('error')
      return
    }
    setSavingScoreId(sessionId)
    try {
      await apiRequest(`/station-sessions/${sessionId}/score`, {
        method: 'PATCH',
        body: { score: points },
      })
      setScoreDrafts((current) => {
        const next = { ...current }
        delete next[sessionId]
        return next
      })
      scoreDraft.clear()
      setFlashMessage('success', `Đã lưu ${points} điểm cho đội.`)
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
          : 'Không lưu được điểm.')
    } finally {
      setSavingScoreId(null)
    }
  }, [refreshLive, scoreDraft, setScoreDrafts])

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
    if (!rawCode || processingScan) return

    const now = Date.now()
    if (rawCode === lastScanRef.current.code && now - lastScanRef.current.at < 2500) return
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
      setLastResult({
        kind: response.kind,
        teamId: response.team_code,
        teamName,
        eventName: response.event_name || selectedEvent?.name || '',
        stationName: response.station_name || '',
        timestamp: response.checked_in_at || response.exited_at || response.entered_at || new Date().toISOString(),
        sessionId: response.kind === 'exit' ? response.id : null,
        scoringMode: response.scoring_mode || null,
        passThreshold: response.pass_threshold ?? null,
        passPoints: response.pass_points ?? null,
      })

      const message = response.kind === 'event'
        ? `Đã check-in sự kiện cho đội ${teamName}.`
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
    }
  }, [processingScan, refreshLive, selectedEvent])

  scanHandlerRef.current = handleScan

  // Camera setup
  useEffect(() => {
    if (!videoRef.current) return undefined

    let cancelled = false
    let scanner = null

    import('qr-scanner').then(({ default: QrScanner }) => {
      if (cancelled || !videoRef.current) return

      QrScanner.listCameras(true).then((cams) => {
        if (!cancelled) setCameras(cams)
      }).catch(() => {})

      scanner = new QrScanner(
        videoRef.current,
        (result) => {
          const value = typeof result === 'string' ? result : result?.data
          if (value && scanHandlerRef.current) {
            void scanHandlerRef.current(value)
          }
        },
        {
          preferredCamera: cameraMode,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          maxScansPerSecond: 5,
        },
      )

      scannerRef.current = scanner
      scanner.start()
        .then(() => {
          scanner.hasFlash().then((has) => setHasTorch(Boolean(has))).catch(() => {})
        })
        .catch(() => {
          setApiError('Không thể mở camera. Bạn có thể sử dụng nút Nhập mã tay.')
        })
    }).catch(() => {
      if (!cancelled) setApiError('Không thể tải thư viện quét QR.')
    })

    return () => {
      cancelled = true
      if (scanner) {
        scanner.stop()
        scanner.destroy()
      }
      scannerRef.current = null
    }
  }, [cameraMode])

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
    const isFront = (label = '') => /front|user|trươ|trướ|selfie|facing user/i.test(label)
    const rearCameras = cameras.filter((c) => !isFront(c.label))
    const pool = rearCameras.length > 1 ? rearCameras : cameras

    if (pool.length > 1) {
      const currentIndex = pool.findIndex((c) => c.id === cameraMode)
      const next = currentIndex === -1 ? 0 : (currentIndex + 1) % pool.length
      setCameraMode(pool[next].id)
    } else if (cameras.length > 1) {
      const currentIndex = cameras.findIndex((c) => c.id === cameraMode)
      setCameraMode(cameras[currentIndex === -1 ? 0 : (currentIndex + 1) % cameras.length].id)
    } else {
      setCameraMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
    }
  }

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
      })
      setFlashMessage('success', `Đã cho đội ${teamName} rời trạm.`)
      playScanFeedback('success')
      setActiveTab('scan')
      await refreshLive()
    } catch (error) {
      const message = error?.status ? explainScanError(error) : error.message
      setFlashMessage('error', message)
      playScanFeedback('error')
    } finally {
      setProcessingScan(false)
    }
  }

  const statsTeams = Number(eventStats?.checked_in_teams) || 0
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

  if (bootLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-ink">
        <Contours />
        <div className="relative flex flex-col items-center gap-3 rounded-2xl border border-stone bg-white p-8 shadow-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-trail border-t-transparent" />
          <p className="font-semibold text-ink/80">Đang chuẩn bị cổng cộng tác viên...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper text-ink pb-24 lg:pb-12">
      <Contours />

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
              <div className="grid grid-cols-4 w-full gap-1 p-1 bg-stone/25 rounded-xl">
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

            {/* MAIN CONTENT GRID (Responsive: 1 col on mobile, 2 cols on lg+) */}
            <div className="grid gap-5 lg:grid-cols-12 items-start">
              {/* LEFT COLUMN: SCANNER & IMMEDIATE ACTION CARD (lg: 6 cols or 7 cols) */}
              <div className={`space-y-4 lg:col-span-6 xl:col-span-5 ${activeTab !== 'scan' ? 'hidden lg:block' : 'block'}`}>
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
                      <button
                        type="button"
                        onClick={toggleCameraFacing}
                        title="Đổi camera"
                        className="rounded-lg border border-stone bg-white p-1 text-ink/70 hover:text-ink"
                      >
                        🔄
                      </button>
                    </div>
                  </div>

                  <div className="p-3 sm:p-4 space-y-3">
                    {/* CAMERA VIEWPORT WITH RETICLE */}
                    <div className="relative aspect-4/3 w-full overflow-hidden rounded-2xl bg-black shadow-inner border border-stone/40">
                      <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

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
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-stone bg-white px-3 py-2.5 text-xs sm:text-sm font-bold text-ink/80 hover:bg-stone/20 hover:text-ink transition active:scale-98 shadow-xs"
                      >
                        <span>⌨️</span>
                        <span>Nhập mã tay / Payload</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* LAST SCANNED RESULT & IMMEDIATE SCORING PAD */}
                <div className={`${CARD} overflow-hidden border-stone shadow-sm`}>
                  <div className="flex items-center justify-between border-b border-stone/80 bg-stone/10 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <SparklesIcon className="h-4 w-4 text-trail" />
                      <h2 className="font-display text-sm font-bold text-ink">Kết quả vừa quét</h2>
                    </div>
                    {lastResult && (
                      <span className="font-mono text-[11px] font-semibold text-ink/65">
                        {formatDateTime(lastResult.timestamp)}
                      </span>
                    )}
                  </div>

                  <div className="p-4 sm:p-5">
                    {lastResult ? (
                      <div className="space-y-4">
                        {/* Kind Header Badge */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                              (RESULT_META[lastResult.kind] || RESULT_META.event).badgeCls
                            }`}
                          >
                            <span className="h-2 w-2 rounded-full bg-current" />
                            {(RESULT_META[lastResult.kind] || RESULT_META.event).label}
                          </span>
                          <span className="font-mono text-xs font-bold text-ink/65 bg-stone/20 px-2 py-0.5 rounded-md">
                            Mã: {lastResult.teamId}
                          </span>
                        </div>

                        {/* Team Name Big */}
                        <div className="rounded-xl border border-stone/60 bg-paper/60 p-3">
                          <h3 className="font-display text-lg sm:text-xl font-bold text-ink leading-tight">
                            {lastResult.teamName}
                          </h3>
                          <p className="mt-1 text-xs text-ink/75">
                            {lastResult.stationName ? `Trạm: ${lastResult.stationName}` : `Sự kiện: ${lastResult.eventName}`}
                          </p>
                        </div>

                        {/* Scoring pad for exit */}
                        {lastResult.kind === 'exit' && lastResult.sessionId && (
                          <div className="rounded-2xl border-2 border-sky-300 bg-sky-50/70 p-4 space-y-3 shadow-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-display text-sm font-bold text-sky-950 flex items-center gap-1.5">
                                <span>🎯</span> Chấm điểm rời trạm
                              </span>
                              {lastResult.scoringMode === 'threshold' && lastResult.passThreshold != null && (
                                <span className="rounded-md bg-white px-2 py-0.5 text-xs font-bold text-sky-800 border border-sky-200">
                                  Đạt khi ≥ {lastResult.passThreshold} điểm
                                </span>
                              )}
                            </div>

                            {lastResult.scoringMode === 'pass_fail' ? (
                              <div className="grid grid-cols-2 gap-3 pt-1">
                                <button
                                  type="button"
                                  onClick={() => saveSessionOutcome(lastResult.sessionId, 'passed')}
                                  disabled={savingScoreId === lastResult.sessionId}
                                  className="flex flex-col items-center justify-center rounded-xl bg-emerald-600 p-4 text-white font-bold text-base hover:bg-emerald-700 active:scale-95 transition shadow-sm disabled:opacity-50 min-h-[56px]"
                                >
                                  <span>✅ ĐẠT</span>
                                  {lastResult.passPoints != null && (
                                    <span className="text-xs text-emerald-100 font-normal mt-0.5">
                                      (+{lastResult.passPoints} điểm)
                                    </span>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => saveSessionOutcome(lastResult.sessionId, 'failed')}
                                  disabled={savingScoreId === lastResult.sessionId}
                                  className="flex flex-col items-center justify-center rounded-xl bg-rose-600 p-4 text-white font-bold text-base hover:bg-rose-700 active:scale-95 transition shadow-sm disabled:opacity-50 min-h-[56px]"
                                >
                                  <span>❌ KHÔNG ĐẠT</span>
                                  <span className="text-xs text-rose-100 font-normal mt-0.5">(0 điểm)</span>
                                </button>
                              </div>
                            ) : (
                              <BigScorePad
                                currentScore={scoreDrafts[lastResult.sessionId] ?? ''}
                                onScoreChange={(val) =>
                                  setScoreDrafts((curr) => ({ ...curr, [lastResult.sessionId]: val }))
                                }
                                onSaveScore={() =>
                                  saveSessionScore(lastResult.sessionId, scoreDrafts[lastResult.sessionId] ?? 0)
                                }
                                saving={savingScoreId === lastResult.sessionId}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="py-8 text-center text-ink/65 space-y-2">
                        <span className="mx-auto block text-3xl">📷</span>
                        <p className="text-sm font-medium">Chưa có kết quả quét trong phiên này</p>
                        <p className="text-xs text-ink/60 max-w-xs mx-auto">
                          Hãy hướng camera vào mã QR của đội hoặc bấm &quot;Nhập mã tay&quot; để thao tác.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: TABS (LIVE ROSTER, HISTORY LOGS, SHIFT INFO) */}
              <div className="space-y-4 lg:col-span-6 xl:col-span-7">
                {/* DESKTOP TAB SELECTOR */}
                <div className="hidden lg:flex items-center gap-1 border-b border-stone/80 pb-2">
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

                {/* TAB CONTENT: LIVE ROSTER */}
                {(activeTab === 'roster' || (activeTab === 'scan' && window.innerWidth >= 1024)) && (
                  <div className={`${CARD} overflow-hidden border-stone shadow-sm`}>
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
                              <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-trail">
                                <span>⏱️ Đã ở trạm:</span>
                                <span className="font-mono bg-trail/10 px-1.5 py-0.5 rounded">
                                  {formatDuration(session.entered_at, nowTick)}
                                </span>
                              </div>
                            </div>

                            <div className="shrink-0 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleManualCheckout(session)}
                                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-sky-300 bg-sky-50 px-3.5 py-2 text-xs font-bold text-sky-900 hover:bg-sky-100 active:scale-95 transition shadow-2xs min-h-[40px]"
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

                {/* TAB CONTENT: STATION LOGS & RE-GRADING */}
                {activeTab === 'logs' && (
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border border-stone bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-stone/60 pb-3">
              <h3 className="font-display text-base font-bold text-ink flex items-center gap-2">
                <span>⌨️</span> Nhập mã đội hoặc payload QR
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
                <label className="block text-xs font-bold text-ink/75 mb-1.5">
                  Mã đội (ví dụ: T0007) hoặc chuỗi QR payload:
                </label>
                <input
                  type="text"
                  autoFocus
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Nhập T0001, T0002..."
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
