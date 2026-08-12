import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import logoImage from './assets/vnutour-logo.png'
import { FIXED_PHASES } from './adminProgram.js'
import {
  apiRequest,
  formatDateTime,
  getStoredUser,
  logoutAndRedirect,
  normalizeProgramForFrontend,
} from './api.js'
import { Badge, CARD, Icon } from './ui.jsx'
import { useSearchParam } from './router.js'
import { useDraftState, DraftNotice } from './drafts.jsx'

const PRIMARY_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.92] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45'
const SECONDARY_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg border border-stone bg-white px-4 py-2.5 text-sm font-semibold text-ink/65 transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-45'

// Mã QR tự nói nó là check-in sự kiện, vào trạm hay rời trạm; đây chỉ là nhãn
// để hiển thị lại kết quả server trả về, không còn là nút CTV bấm để chọn.
const RESULT_META = {
  event: { label: 'Check-in sự kiện', badgeCls: 'bg-trail/12 text-trail' },
  enter: { label: 'Vào trạm', badgeCls: 'bg-gold/15 text-[#9A6B12]' },
  exit: { label: 'Rời trạm', badgeCls: 'bg-[#3E7CA8]/12 text-[#3E7CA8]' },
}

const CHECKIN_POLICY_META = {
  staff_scan: { label: 'Cần coop scan', cls: 'bg-gold/15 text-[#9A6B12]' },
  free_play: { label: 'Tự do vào chơi', cls: 'bg-ink/[0.07] text-ink/55' },
}

function Contours() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 opacity-70"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg width='520' height='520' viewBox='0 0 520 520' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23DCD8CC' stroke-width='1'%3E%3Cpath d='M62 80c64-48 142-56 212-24 80 37 132 22 182-6'/%3E%3Cpath d='M30 166c70-58 154-68 236-32 78 34 132 24 218-20'/%3E%3Cpath d='M18 252c78-44 142-52 214-22 90 38 168 32 252-22'/%3E%3Cpath d='M44 338c72-35 130-42 196-18 88 32 164 22 238-28'/%3E%3Cpath d='M92 428c72-42 146-48 220-18 60 24 118 16 166-20'/%3E%3Ccircle cx='392' cy='138' r='52'/%3E%3Ccircle cx='392' cy='138' r='82'/%3E%3Ccircle cx='142' cy='330' r='46'/%3E%3Ccircle cx='142' cy='330' r='76'/%3E%3C/g%3E%3C/svg%3E\")",
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

function explainScanError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    no_current_event: 'BTC chưa mở event nào nên chưa thể check-in sự kiện.',
    team_not_found: 'Không tìm thấy đội với mã QR hoặc mã đội này.',
    // Mỗi QR chỉ dùng được một lần. Gặp mã này gần như luôn là máy đã quét trúng
    // đúng ảnh QR đó lần nữa — thao tác trước đó đã thành công rồi.
    qr_already_used: 'Mã QR này đã được quét rồi. Đề nghị đội mở lại màn hình để lấy mã mới.',
    team_not_approved: 'Đội này chưa được duyệt nên không thể scan.',
    already_checked_in: 'Đội này đã được check-in sự kiện.',
    event_not_found: 'Không tìm thấy event đang thao tác.',
    phase_not_found: 'Không tìm thấy phase hiện tại.',
    team_not_in_phase: 'Đội này không nằm trong roster của phase hiện tại.',
    // Trạm và chiều nằm sẵn trong QR, nên lỗi này nghĩa là bạn không được phân
    // công trạm mà mã QR vừa quét thuộc về.
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
    // Luật chơi lại (bật theo event): server chặn ngay ở bước quét vào trạm.
    replay_locked_incomplete: 'Đội phải đi hết tất cả các trạm khác rồi mới được quay lại trạm này.',
    replay_locked_passed: 'Đội đã qua trạm này rồi nên không cần vào lại.',
  }
  return map[code] || 'Không thể xử lý mã vừa quét.'
}

function formatShift(assignment) {
  if (!assignment) return 'Chưa có khung giờ'
  if (!assignment.shift_start && !assignment.shift_end) return 'Trực cả event'
  return `${assignment.shift_start ? formatDateTime(assignment.shift_start) : 'Mở ca'} → ${assignment.shift_end ? formatDateTime(assignment.shift_end) : 'Đến khi tắt'}`
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
    // Có thể chưa có ở endpoint này (chỉ /station-scan chắc chắn trả về) — mặc định
    // score_only để ô nhập điểm cũ vẫn hoạt động bình thường khi thiếu field.
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
  const [manualCode, setManualCode] = useState('')
  const [flash, setFlash] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [processingScan, setProcessingScan] = useState(false)
  const [scoreDrafts, setScoreDrafts, scoreDraft] = useDraftState('coop:scoreDrafts', {})
  const [savingScoreId, setSavingScoreId] = useState(null)
  const videoRef = useRef(null)
  const scannerRef = useRef(null)
  const scanHandlerRef = useRef(null)
  const lastScanRef = useRef({ code: '', at: 0 })
  // selectedStationId đến từ URL nên không dùng được updater dạng hàm; effect
  // dưới đọc giá trị mới nhất qua ref này thay vì thêm nó vào dependency array
  // (thêm vào sẽ làm effect chạy lại mỗi lần CTV đổi trạm, tải lại toàn bộ danh
  // sách phân công/trạm một cách không cần thiết).
  const selectedStationIdRef = useRef(selectedStationId)
  selectedStationIdRef.current = selectedStationId

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

  const saveSessionScore = useCallback(async (sessionId, rawValue) => {
    if (!sessionId) return
    const points = Number(rawValue)
    if (!Number.isFinite(points)) {
      setFlashMessage('error', 'Điểm không hợp lệ.')
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
      // Điểm này đã lưu vào server rồi nên bỏ luôn bản nháp local của nó —
      // giữ lại sẽ khiến banner "khôi phục nháp" cứ bám dai dẳng dù đã lưu xong.
      scoreDraft.clear()
      setFlashMessage('success', `Đã lưu ${points} điểm cho đội.`)
      await refreshLive()
    } catch (error) {
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

  // Trạm ở chế độ pass_fail không có điểm số để nhập — coop chỉ bấm đạt/không đạt,
  // server tự cộng `pass_points` khi đạt. Payload body vì vậy khác hẳn saveSessionScore.
  const saveSessionOutcome = useCallback(async (sessionId, outcome) => {
    if (!sessionId) return
    setSavingScoreId(sessionId)
    try {
      await apiRequest(`/station-sessions/${sessionId}/score`, {
        method: 'PATCH',
        body: { outcome },
      })
      setFlashMessage('success', outcome === 'passed' ? 'Đã ghi nhận đội đạt trạm.' : 'Đã ghi nhận đội không đạt trạm.')
      await refreshLive()
    } catch (error) {
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

  const setFlashMessage = (tone, message) => {
    setFlash({ tone, message })
  }

  // Một cú quét làm hết mọi việc. Mã QR đã mang sẵn đội + trạm + chiều vào/ra,
  // nên CTV chỉ giơ máy; server đọc từ mã và tự định tuyến (check-in sự kiện,
  // vào trạm, hay rời trạm). Không còn dropdown chọn trạm, không còn nút mode.
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
        // Chỉ lúc rời trạm mới mở ô chấm điểm cho người quản trạm.
        sessionId: response.kind === 'exit' ? response.id : null,
        // Trạm quy định cách tính điểm; quyết định card kết quả render ô điểm hay
        // nút Đạt/Không đạt. `/station-scan` là nguồn đáng tin nhất vì nó luôn
        // đọc thẳng từ trạm vừa quét, không phụ thuộc trạm đang chọn trên UI.
        scoringMode: response.scoring_mode || null,
        passThreshold: response.pass_threshold ?? null,
        passPoints: response.pass_points ?? null,
      })

      const message = response.kind === 'event'
        ? `Đã check-in sự kiện cho ${teamName}.`
        : response.kind === 'enter'
          ? `Đã ghi nhận ${teamName} vào ${response.station_name}.`
          : `Đã ghi nhận ${teamName} rời ${response.station_name}.`
      setFlashMessage('success', message)

      await refreshLive()
    } catch (error) {
      const message = error?.status ? explainScanError(error) : error.message
      setFlashMessage('error', message)
    } finally {
      setProcessingScan(false)
    }
  }, [processingScan, refreshLive, selectedEvent])

  scanHandlerRef.current = handleScan

  useEffect(() => {
    if (!videoRef.current) return undefined

    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        const value = typeof result === 'string' ? result : result?.data
        if (value && scanHandlerRef.current) {
          void scanHandlerRef.current(value)
        }
      },
      {
        preferredCamera: 'environment',
        highlightScanRegion: true,
        highlightCodeOutline: true,
      },
    )

    scannerRef.current = scanner
    scanner.start().catch(() => {
      setApiError('Không thể khởi động camera. Bạn vẫn có thể nhập tay mã đội.')
    })

    return () => {
      scanner.stop()
      scanner.destroy()
      scannerRef.current = null
    }
  }, [])

  const handleManualSubmit = async (event) => {
    event.preventDefault()
    const value = manualCode.trim()
    if (!value) return
    await handleScan(value)
    setManualCode('')
  }

  const statsTeams = Number(eventStats?.checked_in_teams) || 0
  const statsParticipants = Number(eventStats?.checked_in_participants) || 0
  const liveStationCount = eventSessions.filter((session) => session.status === 'active').length
  const selectedStationOccupancy = occupancy?.active_sessions ?? activeTeams.length
  const capacityText = selectedStation
    ? (selectedStation.capacityMode === 'limited'
      ? `${selectedStationOccupancy}/${selectedStation.maxConcurrentTeams || 0} đội`
      : `${selectedStationOccupancy} đội đang ở trạm`)
    : '--'

  if (bootLoading) {
    return (
      <div className="min-h-screen font-sans bg-paper text-ink">
        <Contours />
        <div className="mx-auto max-w-7xl p-4 sm:p-6">
          <div className={`${CARD} px-5 py-16 text-center text-sm text-ink/45`}>
            Đang tải màn hình coop...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen font-sans bg-paper text-ink">
      <Contours />

      <header className="sticky top-0 z-40 border-b border-stone bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-3">
            <img src={logoImage} alt="VNUTour" className="h-10 w-10 object-contain" />
            <div>
              <p className="font-display text-base font-bold text-ink">VNUTour</p>
              <p className="font-mono text-[11px] text-ink/40">Cổng cộng tác viên</p>
            </div>
          </a>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-stone bg-white px-3 py-1.5 text-sm text-ink/60 sm:inline-flex">
              {user?.full_name || user?.username || 'coop'}
            </span>
            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-stone bg-white px-3 py-2 text-sm font-semibold text-ink/60 transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="hidden sm:inline">{refreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
              <span className="sm:hidden">{refreshing ? '...' : '↻'}</span>
            </button>
            <button
              type="button"
              onClick={() => logoutAndRedirect('/')}
              className="inline-flex items-center gap-2 rounded-lg border border-stone bg-white px-3 py-2 text-sm font-semibold text-ink/60 transition hover:bg-paper hover:text-ink"
            >
              <LogoutIcon />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        {apiError && (
          <div className="rounded-lg border border-clay/25 bg-clay/[0.06] px-4 py-3 text-sm text-clay">
            {apiError}
          </div>
        )}

        {flash && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${
            flash.tone === 'success'
              ? 'border-trail/25 bg-trail/[0.08] text-trail'
              : 'border-clay/25 bg-clay/[0.06] text-clay'
          }`}>
            {flash.message}
          </div>
        )}

        <DraftNotice draft={scoreDraft} label="điểm đang chấm dở cho các đội" />

        {stationEvents.length === 0 ? (
          <div className={`${CARD} border-dashed px-5 py-16 text-center`}>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gold/15 text-[#9A6B12]">
              <Icon name="flag" className="h-6 w-6" />
            </span>
            <h2 className="mt-4 font-display text-xl font-bold text-ink">Phase hiện tại chưa có trạm</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink/50">
              BTC cần mở một event có trạm trước khi cộng tác viên thao tác.
            </p>
          </div>
        ) : (
          <>
            <section className={`${CARD} overflow-hidden`}>
              <div className="grid gap-0 lg:grid-cols-[1.45fr_0.55fr]">
                <div className="px-5 py-6 sm:px-7">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge label={phaseInfo.label} cls="bg-trail/12 text-trail" />
                    {selectedEvent && <Badge label={selectedEvent.name} cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
                    <Badge label={stationPolicy.label} cls={stationPolicy.cls} />
                  </div>
                  <h1 className="mt-4 max-w-2xl font-display text-3xl font-bold tracking-normal text-ink sm:text-4xl">
                    {selectedStation ? selectedStation.name : 'Điều phối check-in tại trạm'}
                  </h1>

                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    <InfoCell label="Chính sách trạm" value={stationPolicy.label} />
                    <InfoCell label="Công suất hiện tại" value={capacityText} />
                    <InfoCell label="Vị trí" value={selectedStation?.location || 'Chưa cập nhật'} />
                  </div>
                </div>

                <div className="border-t border-stone bg-paper/65 p-5 sm:px-6 lg:border-l lg:border-t-0">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Ca trực của bạn</p>
                  <h2 className="mt-2 font-display text-xl font-bold text-ink">
                    {selectedStation?.name || 'Chưa có trạm'}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {selectedAssignment ? (
                      <>
                        <Badge label={selectedAssignment.is_current ? 'Đang trong ca' : 'Đã lên lịch'} cls="bg-trail/12 text-trail" />
                        <Badge label={formatShift(selectedAssignment)} cls="bg-ink/[0.07] text-ink/55" />
                      </>
                    ) : (
                      <Badge label="Chưa có phân công" cls="bg-ink/[0.07] text-ink/55" />
                    )}
                  </div>
                  {selectedAssignment?.note && (
                    <p className="mt-2 text-sm leading-6 text-ink/55">{selectedAssignment.note}</p>
                  )}

                  <p className="mt-4 border-t border-stone pt-4 text-xs leading-5 text-ink/45">
                    Trạm và chiều vào/ra nằm sẵn trong mã QR của đội — bạn chỉ cần giơ máy quét,
                    không phải chọn trạm hay bật chế độ vào/ra.
                  </p>
                </div>
              </div>
            </section>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard value={String(statsTeams)} label="Đội đã check-in sự kiện" accent="trail" />
              <MetricCard value={String(statsParticipants)} label="Người đã qua cổng" accent="gold" />
              <MetricCard value={String(liveStationCount)} label="Phiên trạm đang mở" accent="sky" />
              <MetricCard value={String(selectedStationOccupancy)} label="Đội đang ở trạm này" accent="default" />
            </div>

            <section className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="space-y-5">
                <div className={`${CARD} overflow-hidden`}>
                  <div className="border-b border-stone px-5 py-4">
                    <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Camera scanner</p>
                    <h2 className="mt-1 font-display text-lg font-bold text-ink">Quét QR của đội</h2>
                  </div>
                  <div className="space-y-4 px-5 py-4">
                    <div className="overflow-hidden rounded-xl border border-stone bg-ink">
                      <video ref={videoRef} className="aspect-[4/3] h-full w-full object-cover" />
                    </div>

                    <form onSubmit={handleManualSubmit} className="space-y-2">
                      <label className="block text-xs font-medium text-ink/50">Nhập tay mã đội hoặc payload QR</label>
                      <div className="flex gap-2">
                        <input
                          value={manualCode}
                          onChange={(event) => setManualCode(event.target.value)}
                          placeholder="VD: T0007 hoặc payload QR"
                          className="min-w-0 flex-1 rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink/25 focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                        />
                        <button
                          type="submit"
                          disabled={processingScan}
                          className={PRIMARY_BUTTON}
                        >
                          {processingScan ? 'Đang xử lý...' : 'Xác nhận'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <div className="grid gap-5 xl:grid-cols-2">
                  <div className={`${CARD} overflow-hidden`}>
                    <div className="border-b border-stone px-5 py-4">
                      <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Kết quả gần nhất</p>
                      <h2 className="mt-1 font-display text-lg font-bold text-ink">Thông tin vừa quét</h2>
                    </div>
                    <div className="px-5 py-4">
                      {lastResult ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge label={(RESULT_META[lastResult.kind] || RESULT_META.event).label} cls="bg-ink text-white" />
                            <Badge label={formatDateTime(lastResult.timestamp)} cls="bg-ink/[0.07] text-ink/55" />
                          </div>
                          <h3 className="text-lg font-semibold text-ink">{lastResult.teamName}</h3>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <InfoCell label="Mã đội" value={lastResult.teamId} />
                            <InfoCell label="Phase" value={phaseInfo.label} />
                            <InfoCell label="Event" value={lastResult.eventName || '--'} />
                            <InfoCell label="Trạm" value={lastResult.stationName || '--'} />
                          </div>
                          {lastResult.kind === 'exit' && lastResult.sessionId && (
                            <div className="rounded-lg border border-stone bg-paper px-4 py-3">
                              <p className="text-xs text-ink/40">Chấm kết quả cho đội vừa rời trạm</p>
                              <div className="mt-2">
                                {lastResult.scoringMode === 'pass_fail' ? (
                                  <OutcomeButtons
                                    onPass={() => saveSessionOutcome(lastResult.sessionId, 'passed')}
                                    onFail={() => saveSessionOutcome(lastResult.sessionId, 'failed')}
                                    saving={savingScoreId === lastResult.sessionId}
                                  />
                                ) : (
                                  <>
                                    {lastResult.scoringMode === 'threshold' && lastResult.passThreshold != null && (
                                      <p className="mb-2 text-xs text-ink/45">Đạt khi điểm ≥ {lastResult.passThreshold}</p>
                                    )}
                                    <ScoreEditor
                                      value={scoreDrafts[lastResult.sessionId] ?? ''}
                                      onChange={(value) => setScoreDrafts((current) => ({ ...current, [lastResult.sessionId]: value }))}
                                      onSave={() => saveSessionScore(lastResult.sessionId, scoreDrafts[lastResult.sessionId] ?? 0)}
                                      saving={savingScoreId === lastResult.sessionId}
                                    />
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <EmptyBox text="Chưa có kết quả quét nào trong phiên này." />
                      )}
                    </div>
                  </div>

                  <div className={`${CARD} overflow-hidden`}>
                    <div className="flex items-center justify-between border-b border-stone px-5 py-4">
                      <div>
                        <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Đội đang ở trạm</p>
                        <h2 className="mt-1 font-display text-lg font-bold text-ink">Live roster</h2>
                      </div>
                      <span className="font-mono text-xs text-ink/40">{activeTeams.length} đội</span>
                    </div>
                    <div className="space-y-3 px-5 py-4">
                      {activeTeams.length > 0 ? activeTeams.map((session) => (
                        <div key={session.id} className="rounded-lg border border-stone bg-paper px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-ink">{session.team_name}</p>
                              <p className="mt-1 font-mono text-xs text-ink/40">{session.team_code}</p>
                            </div>
                            <Badge label={formatDateTime(session.entered_at)} cls="bg-gold/15 text-[#9A6B12]" />
                          </div>
                        </div>
                      )) : (
                        <EmptyBox text="Hiện chưa có đội nào đang ở trạm được chọn." />
                      )}
                    </div>
                  </div>
                </div>

                <div className={`${CARD} overflow-hidden`}>
                  <div className="flex items-center justify-between border-b border-stone px-5 py-4">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Nhật ký trạm</p>
                      <h2 className="mt-1 font-display text-lg font-bold text-ink">Lịch sử vào và rời trạm</h2>
                    </div>
                    <Badge label={`${stationSessions.length} phiên`} cls="bg-trail/12 text-trail" />
                  </div>
                  <div className="max-h-[360px] space-y-3 overflow-y-auto px-5 py-4">
                    {stationSessions.length > 0 ? stationSessions.map((session) => (
                      <div key={session.id} className="rounded-lg border border-stone bg-paper px-4 py-3">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                label={session.status === 'active' ? 'Đang ở trạm' : 'Đã rời trạm'}
                                cls={session.status === 'active' ? 'bg-gold/15 text-[#9A6B12]' : 'bg-[#3E7CA8]/12 text-[#3E7CA8]'}
                              />
                              <span className="font-mono text-xs text-ink/40">
                                {formatDateTime(session.entered_at)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm font-semibold text-ink">{session.team_name}</p>
                            <p className="mt-1 font-mono text-xs text-ink/40">{session.team_code}</p>
                          </div>
                          <div className="text-sm text-ink/55">
                            {session.exited_at ? (
                              <p>Rời lúc {formatDateTime(session.exited_at)}</p>
                            ) : (
                              <p>Chưa đóng phiên</p>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 border-t border-stone pt-2">
                          {selectedStation?.scoringMode === 'pass_fail' ? (
                            <>
                              <span className="text-xs text-ink/45">
                                {session.outcome === 'passed' ? (
                                  <span className="font-semibold text-trail">Đạt</span>
                                ) : session.outcome === 'failed' ? (
                                  <span className="font-semibold text-clay">Không đạt</span>
                                ) : 'Chưa chấm'}
                              </span>
                              <OutcomeButtons
                                compact
                                onPass={() => saveSessionOutcome(session.id, 'passed')}
                                onFail={() => saveSessionOutcome(session.id, 'failed')}
                                saving={savingScoreId === session.id}
                              />
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-ink/45">
                                Điểm: <span className="font-mono font-semibold text-ink">{session.score ?? 0}</span>
                                {selectedStation?.scoringMode === 'threshold' && selectedStation?.passThreshold != null && (
                                  <span className="ml-1.5 text-ink/35">(đạt ≥ {selectedStation.passThreshold})</span>
                                )}
                              </span>
                              <ScoreEditor
                                compact
                                value={scoreDrafts[session.id] ?? String(session.score ?? 0)}
                                onChange={(value) => setScoreDrafts((current) => ({ ...current, [session.id]: value }))}
                                onSave={() => saveSessionScore(session.id, scoreDrafts[session.id] ?? session.score ?? 0)}
                                saving={savingScoreId === session.id}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    )) : (
                      <EmptyBox text="Chưa có phiên nào cho trạm đang chọn." />
                    )}
                  </div>
                </div>

                <div className={`${CARD} overflow-hidden`}>
                  <div className="border-b border-stone px-5 py-4">
                    <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Feed event</p>
                    <h2 className="mt-1 font-display text-lg font-bold text-ink">Hoạt động mới nhất trong event</h2>
                  </div>
                  <div className="max-h-[280px] space-y-3 overflow-y-auto px-5 py-4">
                    {eventSessions.length > 0 ? eventSessions.slice(0, 10).map((session) => (
                      <div key={session.id} className="rounded-lg border border-stone bg-paper px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                label={session.status === 'active' ? 'Vào trạm' : 'Rời trạm'}
                                cls={session.status === 'active' ? 'bg-gold/15 text-[#9A6B12]' : 'bg-[#3E7CA8]/12 text-[#3E7CA8]'}
                              />
                              <span className="font-mono text-xs text-ink/40">
                                {formatDateTime(session.exited_at || session.entered_at)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm font-semibold text-ink">{session.team_name}</p>
                            <p className="mt-1 text-xs text-ink/45">{session.station_name}</p>
                          </div>
                          <p className="font-mono text-xs text-ink/40">{session.team_code}</p>
                        </div>
                      </div>
                    )) : (
                      <EmptyBox text="Chưa có thao tác trạm nào trong event đang chọn." />
                    )}
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function OutcomeButtons({ onPass, onFail, saving, compact = false }) {
  const size = compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs'
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onPass}
        disabled={saving}
        className={`rounded-lg bg-trail font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45 ${size}`}
      >
        {saving ? '...' : 'Đạt'}
      </button>
      <button
        type="button"
        onClick={onFail}
        disabled={saving}
        className={`rounded-lg border border-clay/30 font-semibold text-clay transition hover:bg-clay/10 disabled:cursor-not-allowed disabled:opacity-45 ${size}`}
      >
        {saving ? '...' : 'Không đạt'}
      </button>
    </div>
  )
}

function ScoreEditor({ value, onChange, onSave, saving, compact = false }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Điểm"
        className={`${compact ? 'w-16' : 'w-24'} rounded-lg border border-stone bg-white px-2 py-1.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10`}
      />
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-[0.92] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {saving ? '...' : 'Lưu điểm'}
      </button>
    </div>
  )
}

function MetricCard({ value, label, accent }) {
  const cls = accent === 'trail'
    ? 'text-trail'
    : accent === 'gold'
      ? 'text-[#9A6B12]'
      : accent === 'sky'
        ? 'text-[#3E7CA8]'
        : 'text-ink'

  return (
    <div className={`${CARD} px-4 py-4`}>
      <p className={`font-mono text-2xl font-bold leading-none ${cls}`}>{value}</p>
      <p className="mt-2 text-xs text-ink/40">{label}</p>
    </div>
  )
}

function InfoCell({ label, value }) {
  return (
    <div className="rounded-lg border border-stone bg-paper px-4 py-3">
      <p className="text-xs text-ink/40">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value || '--'}</p>
    </div>
  )
}

function EmptyBox({ text }) {
  return (
    <div className="rounded-lg border border-dashed border-stone bg-paper px-4 py-10 text-center text-sm text-ink/40">
      {text}
    </div>
  )
}

export default CoopDashboard
