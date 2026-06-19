import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import logoImage from './assets/vnutour-logo.png'
import { Badge, CARD, Icon } from './ui.jsx'
import { FIXED_PHASES, STATIONS_STORAGE_KEY, loadProgramState } from './adminProgram.js'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://10.147.17.251:8080/api'
const STATION_OPS_STORAGE_KEY = 'vnutour:checkin:station-ops'

const MODE_META = {
  event: {
    label: 'Check-in su kien',
    hint: 'Quet QR khi doi den ban tiep don hoac vao dia diem su kien.',
    badgeCls: 'bg-trail/12 text-trail',
  },
  station_enter: {
    label: 'Vao tram',
    hint: 'Ghi nhan doi bat dau choi tai tram.',
    badgeCls: 'bg-gold/15 text-gold',
  },
  station_exit: {
    label: 'Roi tram',
    hint: 'Ghi nhan doi da xong tram va roi checkpoint.',
    badgeCls: 'bg-[#3E7CA8]/12 text-[#3E7CA8]',
  },
}

const CHECKIN_POLICY_META = {
  staff_scan: {
    label: 'Can coop scan',
    cls: 'bg-gold/15 text-gold',
  },
  free_play: {
    label: 'Khong can scan',
    cls: 'bg-ink/[0.07] text-ink/55',
  },
}

function formatDateTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  })
}

function readJsonStorage(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) || 'null')
    return raw ?? fallback
  } catch {
    return fallback
  }
}

function loadStationStore() {
  return readJsonStorage(STATIONS_STORAGE_KEY, {})
}

function loadStationOps() {
  return readJsonStorage(STATION_OPS_STORAGE_KEY, [])
}

function writeStationStore(nextStore) {
  window.localStorage.setItem(STATIONS_STORAGE_KEY, JSON.stringify(nextStore))
}

function writeStationOps(nextOps) {
  window.localStorage.setItem(STATION_OPS_STORAGE_KEY, JSON.stringify(nextOps))
}

function parseQrPayload(rawValue) {
  const trimmed = String(rawValue || '').trim()
  if (!trimmed) {
    return { code: '', teamId: '', teamName: '' }
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') {
      const teamId = parsed.teamId || parsed.team_id || parsed.code || parsed.id || trimmed
      return {
        code: parsed.code || trimmed,
        teamId: String(teamId),
        teamName: parsed.teamName || parsed.team_name || parsed.name || '',
      }
    }
  } catch {
    // keep raw string
  }

  return {
    code: trimmed,
    teamId: trimmed,
    teamName: '',
  }
}

function buildStationDirectory(programState, stationStore) {
  const rows = []

  FIXED_PHASES.forEach((phaseInfo) => {
    const phaseKey = phaseInfo.key
    const phaseEvents = (programState.subEventsByPhase?.[phaseKey] ?? []).filter(eventItem => eventItem.usesStations)
    phaseEvents.forEach((eventItem) => {
      const stations = stationStore?.[phaseKey]?.[eventItem.id] ?? []
      stations.forEach((station) => {
        rows.push({
          ...station,
          phaseKey,
          phaseLabel: phaseInfo.label,
          eventId: eventItem.id,
          eventName: eventItem.name,
          eventType: eventItem.type,
        })
      })
    })
  })

  return rows
}

function getSelectedStation(programState, stationStore, phaseKey, eventId, stationId) {
  const phaseInfo = FIXED_PHASES.find(item => item.key === phaseKey) ?? FIXED_PHASES[0]
  const eventItem = (programState.subEventsByPhase?.[phaseKey] ?? []).find(item => item.id === eventId) ?? null
  const station = (stationStore?.[phaseKey]?.[eventId] ?? []).find(item => item.id === stationId) ?? null

  if (!eventItem || !station) return null

  return {
    ...station,
    phaseKey,
    phaseLabel: phaseInfo.label,
    eventId: eventItem.id,
    eventName: eventItem.name,
    eventType: eventItem.type,
  }
}

function CheckinPage() {
  const [formData, setFormData] = useState({ username: '', password: '', email: '', secret: '' })
  const [errors, setErrors] = useState({})
  const [isLoading, setIsLoading] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [user, setUser] = useState(null)
  const [authToken, setAuthToken] = useState(null)
  const [apiError, setApiError] = useState('')
  const [eventCheckins, setEventCheckins] = useState([])
  const [checkinStats, setCheckinStats] = useState(null)
  const [deletingTeamId, setDeletingTeamId] = useState(null)
  const [scannerMode, setScannerMode] = useState('event')
  const [manualCode, setManualCode] = useState('')
  const [flash, setFlash] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [programState, setProgramState] = useState(() => loadProgramState())
  const [stationStore, setStationStore] = useState(() => loadStationStore())
  const [selectedPhase, setSelectedPhase] = useState('qualifying')
  const [selectedEventId, setSelectedEventId] = useState('')
  const [selectedStationId, setSelectedStationId] = useState('')
  const [stationOps, setStationOps] = useState(() => loadStationOps())
  const videoRef = useRef(null)
  const qrScannerRef = useRef(null)
  const isFetchingRef = useRef(false)

  const stationDirectory = useMemo(
    () => buildStationDirectory(programState, stationStore),
    [programState, stationStore],
  )

  const stationEventOptions = useMemo(
    () => (programState.subEventsByPhase?.[selectedPhase] ?? []).filter(eventItem => eventItem.usesStations),
    [programState, selectedPhase],
  )
  const stationOptions = useMemo(
    () => stationDirectory.filter(item => item.phaseKey === selectedPhase && item.eventId === selectedEventId),
    [selectedEventId, selectedPhase, stationDirectory],
  )
  const selectedStation = useMemo(
    () => getSelectedStation(programState, stationStore, selectedPhase, selectedEventId, selectedStationId),
    [programState, selectedEventId, selectedPhase, selectedStationId, stationStore],
  )

  const stationOpsForSelected = useMemo(
    () => stationOps.filter(item => item.stationId === selectedStationId).slice(0, 8),
    [selectedStationId, stationOps],
  )

  const selectedStationOccupancy = selectedStation?.teamsHere?.length ?? 0

  const refreshProgramAndStations = useCallback(() => {
    setProgramState(loadProgramState())
    setStationStore(loadStationStore())
    setStationOps(loadStationOps())
  }, [])

  useEffect(() => {
    const savedToken = localStorage.getItem('authToken')
    const savedUser = localStorage.getItem('user')

    if (savedToken && savedUser) {
      setAuthToken(savedToken)
      setUser(JSON.parse(savedUser))
      setIsLoggedIn(true)
    }
  }, [])

  useEffect(() => {
    const currentPhase = programState.currentPhase || 'qualifying'
    if (!selectedPhase || !FIXED_PHASES.some(item => item.key === selectedPhase)) {
      setSelectedPhase(currentPhase)
    }
  }, [programState, selectedPhase])

  useEffect(() => {
    if (stationEventOptions.length === 0) {
      setSelectedEventId('')
      return
    }

    if (!selectedEventId || !stationEventOptions.some(item => item.id === selectedEventId)) {
      setSelectedEventId(stationEventOptions[0].id)
    }
  }, [selectedEventId, stationEventOptions])

  useEffect(() => {
    if (stationOptions.length === 0) {
      setSelectedStationId('')
      return
    }

    if (!selectedStationId || !stationOptions.some(item => item.id === selectedStationId)) {
      setSelectedStationId(stationOptions[0].id)
    }
  }, [selectedStationId, stationOptions])

  const handleInputChange = (event) => {
    const { name, value } = event.target
    setFormData(prev => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const validateForm = () => {
    const nextErrors = {}

    if (!formData.username.trim()) nextErrors.username = 'Vui long nhap ten dang nhap'
    if (!formData.password.trim()) nextErrors.password = 'Vui long nhap mat khau'
    else if (formData.password.length < 6) nextErrors.password = 'Mat khau phai co it nhat 6 ky tu'

    if (isRegisterMode) {
      if (!formData.email.trim()) nextErrors.email = 'Vui long nhap email'
      else if (!/\S+@\S+\.\S+/.test(formData.email)) nextErrors.email = 'Email khong hop le'

      if (!formData.secret.trim()) nextErrors.secret = 'Vui long nhap ma secret'
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!validateForm()) return

    setIsLoading(true)
    setApiError('')

    try {
      const endpoint = isRegisterMode ? '/auth/register' : '/auth/login'
      const payload = isRegisterMode
        ? {
            username: formData.username,
            password: formData.password,
            email: formData.email,
            secret: formData.secret,
          }
        : {
            username: formData.username,
            password: formData.password,
          }

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.error === 'invalid_credentials') setApiError('Ten dang nhap hoac mat khau khong dung')
        else if (data.error === 'conflict') setApiError('Ten dang nhap hoac email da ton tai')
        else if (data.error === 'forbidden') setApiError('Ma secret khong dung hoac khong duoc phep dang ky')
        else setApiError(`Loi: ${data.error || 'Co loi xay ra'}`)
        return
      }

      setAuthToken(data.token)
      setUser(data.user)
      setIsLoggedIn(true)
      setIsRegisterMode(false)
      setFormData({ username: '', password: '', email: '', secret: '' })
      localStorage.setItem('authToken', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
    } catch (error) {
      setApiError(error.name === 'TypeError' ? 'Khong the ket noi toi server API' : `Loi: ${error.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchCheckinsData = useCallback(async ({ force = false } = {}) => {
    if (!isLoggedIn || !authToken) return

    if (isFetchingRef.current) {
      if (!force) return
      await new Promise((resolve) => {
        const timer = setInterval(() => {
          if (!isFetchingRef.current) {
            clearInterval(timer)
            resolve()
          }
        }, 80)
      })
    }

    isFetchingRef.current = true

    try {
      const [listResponse, statsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/event-checkins`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(`${API_BASE_URL}/event-checkins/stats`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ])

      if (listResponse.ok) {
        const payload = await listResponse.json()
        const items = Array.isArray(payload) ? payload : payload.items || payload.data || payload.checkins || []
        setEventCheckins(items.map((item) => {
          const team = item.team || item
          const members = item.members || item.members_detail || item.members_mssv || team?.members || []
          return {
            checkinId: item.id,
            id: item.team_code || team?.code || team?.team_id || team?.id || item.team_id || item.id,
            name: team?.team_name || team?.name || item.team_name || item.name || 'Team khong ro',
            members: Array.isArray(members)
              ? members.map(member => member?.full_name || member?.name || member?.mssv || String(member)).join(', ')
              : '',
            scannedAt: item.checked_in_display || item.checked_in_at || item.created_at || '',
            eventName: item.event_name || '',
          }
        }))
      }

      if (statsResponse.ok) {
        setCheckinStats(await statsResponse.json())
      }
    } catch (error) {
      console.error('Failed to load checkins:', error)
    } finally {
      isFetchingRef.current = false
    }
  }, [authToken, isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn || !authToken) return undefined
    fetchCheckinsData({ force: true })
    const intervalId = setInterval(() => fetchCheckinsData(), 3000)
    return () => clearInterval(intervalId)
  }, [authToken, fetchCheckinsData, isLoggedIn])

  const setFlashMessage = (tone, message) => {
    setFlash({ tone, message })
  }

  const handleEventCheckin = useCallback(async (rawCode) => {
    const payload = parseQrPayload(rawCode)
    const scanCode = payload.code || payload.teamId || rawCode
    const response = await fetch(`${API_BASE_URL}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        code: scanCode,
        scanner: user?.username || 'unknown',
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      if (data.error === 'already_checked_in') {
        throw new Error(`Doi nay da duoc check-in luc ${data.checked_in_display || data.checked_in_at || '--'}`)
      }
      if (data.error === 'not_found') {
        throw new Error('Khong tim thay doi voi ma QR nay')
      }
      if (data.error === 'team_not_found') {
        throw new Error('Khong tim thay doi voi ma QR hoac ma doi nay')
      }
      if (data.error === 'team_not_in_phase') {
        throw new Error('Doi nay khong nam trong danh sach cua phase hien tai')
      }
      throw new Error(data.error || 'Check-in su kien that bai')
    }

    const membersArray = Array.isArray(data.members)
      ? data.members.map(member => member?.full_name || member?.name || member)
      : []
    const teamId = data.team_code || data.team?.code || payload.teamId || scanCode
    const teamName = data.team_name || data.team?.name || payload.teamName || `Team ${teamId}`
    const result = {
      kind: 'event',
      phaseKey: programState.currentPhase || 'qualifying',
      teamId,
      teamName,
      eventName: data.event_name || 'Check-in su kien',
      timestamp: data.checked_in_display || data.checked_in_at || new Date().toISOString(),
      members: membersArray,
    }

    setLastResult(result)
    setFlashMessage('success', `Da check-in su kien cho ${result.teamName}`)
    fetchCheckinsData({ force: true })
  }, [authToken, fetchCheckinsData, programState.currentPhase, user])

  const handleStationOperation = useCallback((rawCode, action) => {
    if (!selectedStation) {
      throw new Error('Hay chon tram truoc khi quet')
    }

    if (selectedStation.checkinPolicy === 'free_play') {
      throw new Error('Tram nay dang o che do tu do, khong can check-in/check-out boi co-op')
    }

    const payload = parseQrPayload(rawCode)
    const teamId = payload.teamId || payload.code
    const teamName = payload.teamName || eventCheckins.find(item => item.id === teamId)?.name || `Team ${teamId}`
    const phaseBucket = stationStore?.[selectedPhase] ?? {}
    const eventStations = [...(phaseBucket[selectedEventId] ?? [])]
    const stationIndex = eventStations.findIndex(item => item.id === selectedStation.id)
    if (stationIndex === -1) {
      throw new Error('Khong tim thay tram trong bo du lieu hien tai')
    }

    const station = { ...eventStations[stationIndex] }
    const teamsHere = Array.isArray(station.teamsHere) ? [...station.teamsHere] : []
    const teamsDone = Array.isArray(station.teamsDone) ? [...station.teamsDone] : []
    const now = new Date().toISOString()

    if (action === 'enter') {
      if (teamsHere.some(team => team.id === teamId)) {
        throw new Error(`${teamName} dang o tram nay`)
      }
      if (teamsDone.some(team => team.id === teamId)) {
        throw new Error(`${teamName} da duoc checkout khoi tram nay`)
      }
      if (station.capacityMode === 'limited' && teamsHere.length >= station.maxConcurrentTeams) {
        throw new Error(`Tram da day ${station.maxConcurrentTeams}/${station.maxConcurrentTeams} doi`)
      }
      teamsHere.push({ id: teamId, name: teamName, arrivedAt: formatDateTime(now) })
    }

    if (action === 'exit') {
      const currentIndex = teamsHere.findIndex(team => team.id === teamId)
      if (currentIndex === -1) {
        throw new Error(`${teamName} chua duoc check-in vao tram nay`)
      }
      teamsHere.splice(currentIndex, 1)
      if (!teamsDone.some(team => team.id === teamId)) {
        teamsDone.push({ id: teamId, name: teamName, doneAt: formatDateTime(now), score: 0 })
      }
    }

    eventStations[stationIndex] = {
      ...station,
      teamsHere,
      teamsDone,
    }

    const nextStore = {
      ...stationStore,
      [selectedPhase]: {
        ...phaseBucket,
        [selectedEventId]: eventStations,
      },
    }
    writeStationStore(nextStore)

    const nextOp = {
      id: `op-${Date.now()}`,
      action,
      phaseKey: selectedPhase,
      eventId: selectedEventId,
      stationId: selectedStation.id,
      stationName: selectedStation.name,
      teamId,
      teamName,
      operator: user?.username || 'unknown',
      timestamp: now,
    }
    const nextOps = [nextOp, ...stationOps].slice(0, 60)
    writeStationOps(nextOps)
    setStationOps(nextOps)
    setStationStore(nextStore)

    setLastResult({
      kind: action,
      phaseKey: selectedPhase,
      teamId,
      teamName,
      eventName: selectedStation.eventName,
      stationName: selectedStation.name,
      timestamp: now,
      members: [],
    })
    setFlashMessage('success', action === 'enter'
      ? `Da ghi nhan ${teamName} vao ${selectedStation.name}`
      : `Da ghi nhan ${teamName} roi ${selectedStation.name}`)
  }, [eventCheckins, selectedEventId, selectedPhase, selectedStation, stationOps, stationStore, user])

  const handleScan = useCallback(async (rawCode) => {
    if (!rawCode) return
    setFlash(null)

    try {
      if (scannerMode === 'event') {
        await handleEventCheckin(rawCode)
      } else if (scannerMode === 'station_enter') {
        handleStationOperation(rawCode, 'enter')
      } else {
        handleStationOperation(rawCode, 'exit')
      }
    } catch (error) {
      setFlashMessage('error', error.message)
    }
  }, [handleEventCheckin, handleStationOperation, scannerMode])

  useEffect(() => {
    if (!isLoggedIn || !videoRef.current) return undefined

    if (qrScannerRef.current) {
      qrScannerRef.current.stop()
      qrScannerRef.current.destroy()
      qrScannerRef.current = null
    }

    qrScannerRef.current = new QrScanner(
      videoRef.current,
      async (result) => {
        try {
          qrScannerRef.current?.stop()
          await handleScan(result.data)
        } finally {
          setTimeout(() => {
            qrScannerRef.current?.start().catch(err => {
              console.error('Unable to restart scanner:', err)
            })
          }, 700)
        }
      },
      {
        highlightScanRegion: true,
        highlightCodeOutline: true,
      },
    )

    qrScannerRef.current.start().catch((error) => {
      console.error('Camera error:', error)
      setFlashMessage('error', 'Khong the truy cap camera. Hay cho phep quyen camera hoac dung nhap tay.')
    })

    return () => {
      qrScannerRef.current?.stop()
      qrScannerRef.current?.destroy()
      qrScannerRef.current = null
    }
  }, [handleScan, isLoggedIn])

  const handleManualSubmit = async (event) => {
    event.preventDefault()
    await handleScan(manualCode)
    setManualCode('')
  }

  const handleResetCheckin = useCallback(async (team) => {
    if (!authToken) return

    const resetKey = team.checkinId || team.id || team.name
    if (!resetKey) return

    const confirmed = window.confirm(`Xoa check-in su kien cua ${team.name || team.id || resetKey}?`)
    if (!confirmed) return

    setDeletingTeamId(resetKey)

    try {
      const endpoint = team.checkinId
        ? `${API_BASE_URL}/event-checkins/${encodeURIComponent(team.checkinId)}`
        : `${API_BASE_URL}/checkin/${encodeURIComponent(team.id || team.name || resetKey)}`
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(payload?.error || `Khong the xoa check-in (${response.status})`)
      }

      setFlashMessage('success', `Da xoa check-in su kien cua ${team.name || team.id || resetKey}`)
      fetchCheckinsData({ force: true })
    } catch (error) {
      setFlashMessage('error', error.message)
    } finally {
      setDeletingTeamId(null)
    }
  }, [authToken, fetchCheckinsData])

  const handleLogout = () => {
    setIsLoggedIn(false)
    setUser(null)
    setAuthToken(null)
    setApiError('')
    setEventCheckins([])
    setCheckinStats(null)
    setLastResult(null)
    setFlash(null)
    localStorage.removeItem('authToken')
    localStorage.removeItem('user')
    qrScannerRef.current?.stop()
    qrScannerRef.current?.destroy()
    qrScannerRef.current = null
  }

  const stationPolicy = selectedStation ? (CHECKIN_POLICY_META[selectedStation.checkinPolicy] ?? CHECKIN_POLICY_META.staff_scan) : null
  const stationCapacityText = selectedStation
    ? (selectedStation.capacityMode === 'limited'
      ? `${selectedStation.maxConcurrentTeams} doi toi da`
      : 'Khong gioi han')
    : '--'
  const statsTeams = checkinStats?.checked_in_teams ?? eventCheckins.length
  const statsParticipants = checkinStats?.checked_in_participants ?? 0
  const lastResultPhaseLabel = FIXED_PHASES.find(item => item.key === lastResult?.phaseKey)?.label ?? '--'

  const inputClass = (hasError) => [
    'mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink outline-none transition',
    hasError
      ? 'border-clay/30 focus:border-clay focus:ring-2 focus:ring-clay/10'
      : 'border-stone focus:border-trail/40 focus:ring-2 focus:ring-trail/10',
  ].join(' ')

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-paper px-4 py-10 text-ink">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-5 lg:grid-cols-[1.1fr_minmax(380px,0.9fr)]">
            <section className={`${CARD} overflow-hidden`}>
              <div className="border-b border-stone px-6 py-6">
                <div className="flex items-center gap-4">
                  <img src={logoImage} alt="VNUTour" className="h-14 w-14 rounded-2xl object-contain" />
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">QR operations</p>
                    <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Check-in su kien va tram choi</h1>
                  </div>
                </div>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-ink/60">
                  Muc tieu cua trang nay la giup ban van hanh luong den su kien, vao tram, roi tram, va theo doi cong suat theo checkpoint.
                </p>
              </div>

              <div className="grid gap-3 px-6 py-5 md:grid-cols-3">
                {Object.entries(MODE_META).map(([key, meta]) => (
                  <div key={key} className="rounded-xl border border-stone bg-paper px-4 py-4">
                    <Badge label={meta.label} cls={meta.badgeCls} />
                    <p className="mt-3 text-sm leading-6 text-ink/55">{meta.hint}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className={`${CARD} px-5 py-5`}>
              <div className="mb-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">
                  {isRegisterMode ? 'Dang ky tai khoan' : 'Dang nhap van hanh'}
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold text-ink">
                  {isRegisterMode ? 'Tao tai khoan check-in' : 'Vao khu dieu phoi QR'}
                </h2>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {apiError && (
                  <div className="rounded-lg border border-clay/20 bg-clay/10 px-4 py-3 text-sm text-clay">
                    {apiError}
                  </div>
                )}

                <div>
                  <label htmlFor="username" className="text-sm font-medium text-ink/70">Ten dang nhap</label>
                  <input
                    id="username"
                    name="username"
                    value={formData.username}
                    onChange={handleInputChange}
                    disabled={isLoading}
                    className={inputClass(Boolean(errors.username))}
                  />
                  {errors.username && <p className="mt-1 text-xs font-medium text-clay">{errors.username}</p>}
                </div>

                <div>
                  <label htmlFor="password" className="text-sm font-medium text-ink/70">Mat khau</label>
                  <input
                    id="password"
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    disabled={isLoading}
                    className={inputClass(Boolean(errors.password))}
                  />
                  {errors.password && <p className="mt-1 text-xs font-medium text-clay">{errors.password}</p>}
                </div>

                {isRegisterMode && (
                  <>
                    <div>
                      <label htmlFor="email" className="text-sm font-medium text-ink/70">Email</label>
                      <input
                        id="email"
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        disabled={isLoading}
                        className={inputClass(Boolean(errors.email))}
                      />
                      {errors.email && <p className="mt-1 text-xs font-medium text-clay">{errors.email}</p>}
                    </div>

                    <div>
                      <label htmlFor="secret" className="text-sm font-medium text-ink/70">Ma secret</label>
                      <input
                        id="secret"
                        type="password"
                        name="secret"
                        value={formData.secret}
                        onChange={handleInputChange}
                        disabled={isLoading}
                        className={inputClass(Boolean(errors.secret))}
                      />
                      {errors.secret && <p className="mt-1 text-xs font-medium text-clay">{errors.secret}</p>}
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-lg bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:brightness-[0.92] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? 'Dang xu ly...' : isRegisterMode ? 'Dang ky' : 'Dang nhap'}
                </button>
              </form>

              <div className="mt-4 text-center text-sm text-ink/55">
                {isRegisterMode ? 'Da co tai khoan?' : 'Chua co tai khoan?'}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsRegisterMode(value => !value)
                    setApiError('')
                    setErrors({})
                    setFormData({ username: '', password: '', email: '', secret: '' })
                  }}
                  className="font-semibold text-trail"
                >
                  {isRegisterMode ? 'Dang nhap ngay' : 'Dang ky ngay'}
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className={`${CARD} px-5 py-5`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <img src={logoImage} alt="VNUTour" className="h-14 w-14 rounded-2xl object-contain" />
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">QR operations</p>
                <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Ban dieu phoi check-in</h1>
                <p className="mt-1 text-sm text-ink/55">Cung mot man hinh cho check-in su kien, vao tram va roi tram.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge label={user?.role || 'operator'} cls="bg-trail/12 text-trail" />
              <Badge label={user?.username || 'unknown'} cls="bg-ink/[0.07] text-ink/55" />
              <button
                type="button"
                onClick={refreshProgramAndStations}
                className="rounded-lg border border-stone bg-white px-3 py-2 text-sm font-semibold text-ink/60 transition hover:bg-paper hover:text-ink"
              >
                Lam moi context
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:brightness-[0.92]"
              >
                <Icon name="close" className="h-4 w-4" />
                Dang xuat
              </button>
            </div>
          </div>
        </header>

        {flash && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${
            flash.tone === 'success'
              ? 'border-trail/20 bg-trail/10 text-trail'
              : 'border-clay/20 bg-clay/10 text-clay'
          }`}>
            {flash.message}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(360px,460px)_minmax(0,1fr)]">
          <section className="space-y-5">
            <div className={`${CARD} overflow-hidden`}>
              <div className="border-b border-stone px-5 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Mode quet</p>
                <h2 className="mt-1 font-display text-xl font-semibold text-ink">Chon luong van hanh</h2>
              </div>

              <div className="grid gap-2 px-4 py-4">
                {Object.entries(MODE_META).map(([key, meta]) => {
                  const active = scannerMode === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setScannerMode(key)}
                      className={`rounded-xl border px-4 py-3 text-left transition ${
                        active
                          ? 'border-gold/30 bg-gold/10 shadow-[0_3px_10px_rgba(32,49,43,0.08)]'
                          : 'border-stone bg-white hover:bg-paper'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <Badge label={meta.label} cls={meta.badgeCls} />
                          <p className="mt-2 text-sm leading-6 text-ink/55">{meta.hint}</p>
                        </div>
                        {active && <Icon name="checkPlain" className="h-5 w-5 text-gold" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {scannerMode !== 'event' && (
              <div className={`${CARD} overflow-hidden`}>
                <div className="border-b border-stone px-5 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Context tram</p>
                  <h2 className="mt-1 font-display text-xl font-semibold text-ink">Chon phase, event va tram</h2>
                </div>

                <div className="space-y-4 px-5 py-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink/70">Phase</label>
                    <select
                      value={selectedPhase}
                      onChange={(event) => setSelectedPhase(event.target.value)}
                      className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                    >
                      {FIXED_PHASES.map((phaseInfo) => (
                        <option key={phaseInfo.key} value={phaseInfo.key}>{phaseInfo.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink/70">Event co tram</label>
                    <select
                      value={selectedEventId}
                      onChange={(event) => setSelectedEventId(event.target.value)}
                      className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                    >
                      {stationEventOptions.length > 0 ? stationEventOptions.map((eventItem) => (
                        <option key={eventItem.id} value={eventItem.id}>{eventItem.name}</option>
                      )) : (
                        <option value="">Khong co event nao co tram</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink/70">Tram</label>
                    <select
                      value={selectedStationId}
                      onChange={(event) => setSelectedStationId(event.target.value)}
                      className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                    >
                      {stationOptions.length > 0 ? stationOptions.map((station) => (
                        <option key={station.id} value={station.id}>{station.name}</option>
                      )) : (
                        <option value="">Khong co tram nao</option>
                      )}
                    </select>
                  </div>

                  {selectedStation && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className={`${CARD} px-4 py-3`}>
                        <p className="text-xs text-ink/40">Chinh sach vao tram</p>
                        <div className="mt-2">
                          <Badge label={stationPolicy.label} cls={stationPolicy.cls} />
                        </div>
                        <p className="mt-2 text-sm text-ink/55">{stationPolicy.label === 'Khong can scan'
                          ? 'Trang QR se khong bat buoc ghi nhan vao/ra cho tram nay.'
                          : 'Trang QR duoc dung de ghi nhan doi vao va roi tram.'}</p>
                      </div>
                      <div className={`${CARD} px-4 py-3`}>
                        <p className="text-xs text-ink/40">Cong suat hien tai</p>
                        <p className="mt-1 font-mono text-lg font-bold text-ink">{selectedStationOccupancy}</p>
                        <p className="mt-1 text-sm text-ink/55">{stationCapacityText}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className={`${CARD} overflow-hidden`}>
              <div className="border-b border-stone px-5 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Camera scanner</p>
                <h2 className="mt-1 font-display text-xl font-semibold text-ink">Quet QR</h2>
              </div>
              <div className="space-y-4 px-5 py-4">
                <div className="overflow-hidden rounded-xl border border-stone bg-ink">
                  <video ref={videoRef} className="aspect-[4/3] h-full w-full object-cover" />
                </div>

                <form onSubmit={handleManualSubmit} className="space-y-3">
                  <label className="block text-sm font-medium text-ink/70">Nhap tay ma QR</label>
                  <div className="flex gap-2">
                    <input
                      value={manualCode}
                      onChange={(event) => setManualCode(event.target.value)}
                      placeholder="VD: T0007 hoac payload QR"
                      className="min-w-0 flex-1 rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.92]"
                    >
                      Xac nhan
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </section>

          <section className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <MetricCard value={String(statsTeams)} label="Doi da check-in su kien" accent="trail" />
              <MetricCard value={String(statsParticipants)} label="Nguoi da qua cong" accent="gold" />
              <MetricCard value={String(stationDirectory.length)} label="Tong tram dang cau hinh" accent="sky" />
              <MetricCard value={String(stationOpsForSelected.length)} label="Nhat ky tram dang xem" accent="default" />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.05fr_minmax(320px,0.95fr)]">
              <div className={`${CARD} overflow-hidden`}>
                <div className="border-b border-stone px-5 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Ket qua gan nhat</p>
                  <h2 className="mt-1 font-display text-xl font-semibold text-ink">Thong tin vua quet</h2>
                </div>
                <div className="px-5 py-4">
                  {lastResult ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge label={MODE_META[lastResult.kind === 'event' ? 'event' : lastResult.kind === 'enter' ? 'station_enter' : 'station_exit'].label} cls="bg-ink text-white" />
                        <Badge label={formatDateTime(lastResult.timestamp)} cls="bg-ink/[0.07] text-ink/55" />
                      </div>
                      <h3 className="text-lg font-semibold text-ink">{lastResult.teamName}</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <InfoCell label="Ma doi" value={lastResult.teamId} />
                        <InfoCell label="Phase" value={lastResultPhaseLabel} />
                        <InfoCell label="Event" value={lastResult.eventName || 'Check-in su kien'} />
                        <InfoCell label="Tram" value={lastResult.stationName || '--'} />
                      </div>
                    </div>
                  ) : (
                    <EmptyBox text="Chua co ket qua quet nao trong phien nay." />
                  )}
                </div>
              </div>

              <div className={`${CARD} overflow-hidden`}>
                <div className="border-b border-stone px-5 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Nhat ky tram</p>
                  <h2 className="mt-1 font-display text-xl font-semibold text-ink">Recent station ops</h2>
                </div>
                <div className="px-5 py-4">
                  {stationOpsForSelected.length > 0 ? (
                    <div className="space-y-3">
                      {stationOpsForSelected.map((item) => (
                        <div key={item.id} className="rounded-xl border border-stone bg-paper px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  label={item.action === 'enter' ? 'Vao tram' : 'Roi tram'}
                                  cls={item.action === 'enter' ? 'bg-gold/15 text-gold' : 'bg-[#3E7CA8]/12 text-[#3E7CA8]'}
                                />
                                <span className="font-mono text-xs text-ink/40">{formatDateTime(item.timestamp)}</span>
                              </div>
                              <p className="mt-2 text-sm font-semibold text-ink">{item.teamName}</p>
                              <p className="mt-1 text-xs text-ink/45">{item.teamId} · {item.operator}</p>
                            </div>
                            <p className="text-right text-sm text-ink/55">{item.stationName}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyBox text="Chua co thao tac vao/ra tram nao cho tram dang chon." />
                  )}
                </div>
              </div>
            </div>

            <div className={`${CARD} overflow-hidden`}>
              <div className="border-b border-stone px-5 py-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Check-in su kien</p>
                    <h2 className="mt-1 font-display text-xl font-semibold text-ink">Danh sach doi da qua cong</h2>
                  </div>
                  <Badge label={`${statsTeams} doi`} cls="bg-trail/12 text-trail" />
                </div>
              </div>
              <div className="max-h-[520px] space-y-3 overflow-y-auto px-5 py-4">
                {eventCheckins.length > 0 ? eventCheckins.map((team) => {
                  const isDeleting = deletingTeamId === (team.checkinId || team.id || team.name)
                  return (
                    <div key={team.checkinId || team.id || team.name} className="rounded-xl border border-stone bg-paper px-4 py-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">{team.name}</p>
                          <p className="mt-1 font-mono text-xs text-ink/40">{team.id}</p>
                          <p className="mt-1 text-sm text-ink/55">{team.members || 'Chua co danh sach thanh vien'}</p>
                          <p className="mt-1 text-xs text-ink/40">{formatDateTime(team.scannedAt)}</p>
                        </div>
                        {user?.role === 'admin' && (
                          <button
                            type="button"
                            onClick={() => handleResetCheckin(team)}
                            disabled={isDeleting}
                            className="rounded-lg border border-stone bg-white px-3 py-2 text-sm font-semibold text-ink/60 transition hover:bg-paper hover:text-clay disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isDeleting ? 'Dang xoa...' : 'Xoa check-in'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                }) : (
                  <EmptyBox text="Chua co doi nao duoc check-in su kien." />
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ value, label, accent }) {
  const cls = accent === 'trail'
    ? 'text-trail'
    : accent === 'gold'
      ? 'text-gold'
      : accent === 'sky'
        ? 'text-[#3E7CA8]'
        : 'text-ink'

  return (
    <div className={`${CARD} px-4 py-3`}>
      <p className={`font-mono text-2xl font-bold leading-none ${cls}`}>{value}</p>
      <p className="mt-1.5 text-xs text-ink/40">{label}</p>
    </div>
  )
}

function InfoCell({ label, value }) {
  return (
    <div className="rounded-xl border border-stone bg-paper px-4 py-3">
      <p className="text-xs text-ink/40">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value || '--'}</p>
    </div>
  )
}

function EmptyBox({ text }) {
  return (
    <div className="rounded-xl border border-dashed border-stone bg-paper px-4 py-10 text-center text-sm text-ink/40">
      {text}
    </div>
  )
}

export default CheckinPage
