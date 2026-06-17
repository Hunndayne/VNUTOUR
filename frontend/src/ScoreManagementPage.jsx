import { useEffect, useMemo, useState } from 'react'
import { Badge, CARD, Icon } from './ui.jsx'
import { STATIONS_STORAGE_KEY, SUB_EVENT_TYPE_META, getPhaseInfo } from './adminProgram.js'

const SCORE_STATE_KEY = 'vnutour:admin:phase-scoring'

const TEAM_CATALOG = [
  { id: 'T0001', name: 'Sky Walker', captain: 'Hoàng Anh Tú', memberCount: 5 },
  { id: 'T0002', name: 'Ice Breaker', captain: 'Trịnh Văn Khoa', memberCount: 4 },
  { id: 'T0003', name: 'Fire Phoenix', captain: 'Nguyễn Châu Mỹ Ngọc', memberCount: 4 },
  { id: 'T0004', name: 'Thunder Map', captain: 'Lê Minh Khang', memberCount: 5 },
  { id: 'T0005', name: 'Bản đồ xanh', captain: 'Phạm Quốc Bảo', memberCount: 5 },
  { id: 'T0006', name: 'Alpha Route', captain: 'Trần Hải Yến', memberCount: 4 },
  { id: 'T0007', name: 'Những chiến binh', captain: 'Phạm Nguyễn Thanh Mai', memberCount: 5 },
  { id: 'T0008', name: 'North Quest', captain: 'Võ Thanh Tùng', memberCount: 4 },
  { id: 'T0009', name: 'Maze Runner', captain: 'Nguyễn Hoàng Phúc', memberCount: 5 },
  { id: 'T0010', name: 'Signal Camp', captain: 'Bùi Quốc Đạt', memberCount: 4 },
  { id: 'T0011', name: 'The Compass', captain: 'Lê Thị Mai Anh', memberCount: 5 },
  { id: 'T0012', name: 'Orbit Team', captain: 'Phạm Thanh Sơn', memberCount: 4 },
  { id: 'T0013', name: 'Trail Mix', captain: 'Đỗ Minh Quân', memberCount: 5 },
  { id: 'T0014', name: 'Echo Camp', captain: 'Trần Thị Ngọc', memberCount: 4 },
  { id: 'T0015', name: 'Golden Ticket', captain: 'Đặng Thu Trang', memberCount: 5 },
  { id: 'T0016', name: 'Blue Lantern', captain: 'Lý Khánh Vy', memberCount: 4 },
  { id: 'T0017', name: 'Day Break', captain: 'Mai Tiến Đạt', memberCount: 5 },
  { id: 'T0018', name: 'Urban Clue', captain: 'Phan Gia Bảo', memberCount: 4 },
]

const ENTRY_KIND_META = {
  station: { label: 'Điểm trạm', cls: 'bg-[#3E7CA8]/12 text-[#3E7CA8]' },
  bonus: { label: 'Cộng điểm', cls: 'bg-gold/15 text-gold' },
  penalty: { label: 'Trừ điểm', cls: 'bg-clay/12 text-clay' },
  manual: { label: 'Điều chỉnh', cls: 'bg-ink/[0.07] text-ink/55' },
}

const ROSTER_ORIGIN_META = {
  approved: { label: 'Nguồn đăng ký', cls: 'bg-ink/[0.07] text-ink/55' },
  qualified: { label: 'Qua phase trước', cls: 'bg-trail/12 text-trail' },
  wildcard: { label: 'Đặc cách BTC', cls: 'bg-gold/15 text-gold' },
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function createRosterEntry(team, partial = {}) {
  return {
    teamId: team.id,
    teamName: team.name,
    captain: team.captain,
    memberCount: team.memberCount,
    origin: 'approved',
    originLabel: 'Da duyet dang ky',
    qualifiedFrom: '',
    note: '',
    ...partial,
  }
}

function toPhaseMap(phaseKeys, makeValue) {
  return Object.fromEntries(phaseKeys.map((phaseKey, index) => [phaseKey, makeValue(phaseKey, index)]))
}

function createDefaultScoreState(phaseKeys) {
  return {
    rosterByPhase: toPhaseMap(phaseKeys, (phaseKey) => {
      if (phaseKey === 'registration') return TEAM_CATALOG.map(team => createRosterEntry(team))
      if (phaseKey === 'qualifying') return TEAM_CATALOG.slice(0, 18).map(team => createRosterEntry(team))
      if (phaseKey === 'final') return TEAM_CATALOG.slice(0, 15).map(team => createRosterEntry(team, {
        origin: 'qualified',
        originLabel: 'Top 15 vong loai',
        qualifiedFrom: 'qualifying',
      }))
      return []
    }),
    manualLedgerByPhase: toPhaseMap(phaseKeys, () => []),
    advancementByPhase: toPhaseMap(phaseKeys, (phaseKey) => {
      const index = phaseKeys.indexOf(phaseKey)
      return {
        nextPhaseKey: phaseKeys[index + 1] ?? '',
        mode: phaseKey === 'final' ? 'manual' : 'top_n',
        slots: phaseKey === 'qualifying' ? 15 : 3,
        manualTeamIds: [],
        lastPublishedAt: '',
      }
    }),
  }
}

function normalizeScoreState(savedState, phaseKeys) {
  const seed = createDefaultScoreState(phaseKeys)
  return {
    rosterByPhase: toPhaseMap(phaseKeys, (phaseKey) => (
      Array.isArray(savedState?.rosterByPhase?.[phaseKey]) && savedState.rosterByPhase[phaseKey].length > 0
        ? savedState.rosterByPhase[phaseKey].map(entry => ({ ...entry }))
        : seed.rosterByPhase[phaseKey].map(entry => ({ ...entry }))
    )),
    manualLedgerByPhase: toPhaseMap(phaseKeys, (phaseKey) => (
      Array.isArray(savedState?.manualLedgerByPhase?.[phaseKey])
        ? savedState.manualLedgerByPhase[phaseKey].map(entry => ({ ...entry }))
        : seed.manualLedgerByPhase[phaseKey].map(entry => ({ ...entry }))
    )),
    advancementByPhase: toPhaseMap(phaseKeys, (phaseKey) => ({
      ...seed.advancementByPhase[phaseKey],
      ...(savedState?.advancementByPhase?.[phaseKey] ?? {}),
      manualTeamIds: Array.isArray(savedState?.advancementByPhase?.[phaseKey]?.manualTeamIds)
        ? savedState.advancementByPhase[phaseKey].manualTeamIds
        : seed.advancementByPhase[phaseKey].manualTeamIds,
    })),
  }
}

function loadScoreStore() {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(SCORE_STATE_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function loadStationStore() {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(STATIONS_STORAGE_KEY) || '{}') || {}
  } catch {
    return {}
  }
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

function formatSignedPoints(points) {
  if (points > 0) return `+${points}`
  return String(points)
}

function MetricCard({ value, label, note, accent = 'default' }) {
  const valueClass = accent === 'trail'
    ? 'text-trail'
    : accent === 'gold'
      ? 'text-gold'
      : accent === 'sky'
        ? 'text-[#3E7CA8]'
        : accent === 'clay'
          ? 'text-clay'
          : 'text-ink'

  return (
    <div className={`${CARD} px-4 py-3`}>
      <p className={`font-mono text-2xl font-bold leading-none ${valueClass}`}>{value}</p>
      <p className="mt-1.5 text-sm font-medium text-ink/70">{label}</p>
      {note && <p className="mt-1 text-xs leading-5 text-ink/40">{note}</p>}
    </div>
  )
}

function EventBadge({ type }) {
  const meta = SUB_EVENT_TYPE_META[type] ?? SUB_EVENT_TYPE_META.custom
  return <Badge label={meta.label} cls={meta.cls} />
}

function EntryBadge({ kind }) {
  const meta = ENTRY_KIND_META[kind] ?? ENTRY_KIND_META.manual
  return <Badge label={meta.label} cls={meta.cls} />
}

function RosterOriginBadge({ origin }) {
  const meta = ROSTER_ORIGIN_META[origin] ?? ROSTER_ORIGIN_META.approved
  return <Badge label={meta.label} cls={meta.cls} />
}

function ScoreManagementPage({ phase, phaseOptions, phaseSchedule, phaseEvents, onPhaseChange }) {
  const [scoreStore, setScoreStore] = useState(loadScoreStore)
  const [entryForm, setEntryForm] = useState({
    teamId: '',
    phaseEventId: '',
    kind: 'bonus',
    points: 3,
    note: '',
  })
  const [wildcardTeamId, setWildcardTeamId] = useState('')

  const phaseKeys = useMemo(() => phaseOptions.map(item => item.key), [phaseOptions])

  useEffect(() => {
    setScoreStore((current) => {
      const currentState = current.default
      const normalized = normalizeScoreState(currentState, phaseKeys)
      if (JSON.stringify(currentState || null) === JSON.stringify(normalized)) {
        return current
      }
      return { ...current, default: normalized }
    })
  }, [phaseKeys])

  useEffect(() => {
    window.localStorage.setItem(SCORE_STATE_KEY, JSON.stringify(scoreStore))
  }, [scoreStore])

  const scoreState = useMemo(
    () => normalizeScoreState(scoreStore.default, phaseKeys),
    [phaseKeys, scoreStore.default],
  )

  const updateScoreState = (updater) => {
    setScoreStore((current) => {
      const currentState = normalizeScoreState(current.default, phaseKeys)
      const nextState = typeof updater === 'function' ? updater(currentState) : updater
      return {
        ...current,
        default: normalizeScoreState(nextState, phaseKeys),
      }
    })
  }

  const phaseInfo = getPhaseInfo(phase)
  const schedule = phaseSchedule[phase]
  const roster = useMemo(
    () => scoreState.rosterByPhase[phase] ?? [],
    [phase, scoreState.rosterByPhase],
  )
  const manualLedger = useMemo(
    () => scoreState.manualLedgerByPhase[phase] ?? [],
    [phase, scoreState.manualLedgerByPhase],
  )
  const advancement = useMemo(
    () => scoreState.advancementByPhase[phase] ?? {
      nextPhaseKey: '',
      mode: 'top_n',
      slots: 0,
      manualTeamIds: [],
      lastPublishedAt: '',
    },
    [phase, scoreState.advancementByPhase],
  )
  const nextPhase = phaseOptions.find(item => item.key === advancement.nextPhaseKey) ?? null
  const stationStore = useMemo(() => loadStationStore(), [])
  const stationsForPhase = useMemo(
    () => stationStore[phase] ?? {},
    [phase, stationStore],
  )

  const stationEntries = useMemo(() => (
    phaseEvents
      .filter(eventItem => eventItem.usesStations)
      .flatMap((eventItem) => {
        const stations = stationsForPhase[eventItem.id] ?? []
        return stations.flatMap((station) => (
          Array.isArray(station.teamsDone) ? station.teamsDone : []
        ).map((team, index) => ({
          id: `station-${eventItem.id}-${station.id}-${team.id}-${index}`,
          teamId: team.id,
          phaseEventId: eventItem.id,
          phaseEventName: eventItem.name,
          phaseEventType: eventItem.type,
          stationName: station.name,
          kind: 'station',
          points: Number(team.score) || 0,
          note: `${station.name}${team.doneAt ? ` · ${team.doneAt}` : ''}`,
          createdAt: team.doneAt || '',
        })))
      })
      .filter(entry => entry.points !== 0)
  ), [phaseEvents, stationsForPhase])

  const allEntries = useMemo(() => {
    const manualEntries = manualLedger.map((entry) => {
      const phaseEvent = phaseEvents.find(item => item.id === entry.phaseEventId)
      return {
        ...entry,
        phaseEventName: phaseEvent?.name ?? entry.phaseEventName ?? 'Event đã xoá',
        phaseEventType: phaseEvent?.type ?? entry.phaseEventType ?? 'custom',
      }
    })
    return [...stationEntries, ...manualEntries]
  }, [manualLedger, phaseEvents, stationEntries])

  const eventSummaries = useMemo(() => (
    phaseEvents.map((eventItem) => {
      const entries = allEntries.filter(entry => entry.phaseEventId === eventItem.id)
      const stationPoints = entries.filter(entry => entry.kind === 'station').reduce((sum, entry) => sum + entry.points, 0)
      const extraPoints = entries.filter(entry => entry.kind !== 'station').reduce((sum, entry) => sum + entry.points, 0)
      const totalPoints = entries.reduce((sum, entry) => sum + entry.points, 0)
      const teamsTouched = new Set(entries.map(entry => entry.teamId)).size
      return {
        ...eventItem,
        stationPoints,
        extraPoints,
        totalPoints,
        teamsTouched,
      }
    })
  ), [allEntries, phaseEvents])

  const leaderboardRows = useMemo(() => (
    roster
      .map((team) => {
        const teamEntries = allEntries.filter(entry => entry.teamId === team.teamId)
        const stationPoints = teamEntries.filter(entry => entry.kind === 'station').reduce((sum, entry) => sum + entry.points, 0)
        const bonusPoints = teamEntries.filter(entry => entry.kind === 'bonus' || entry.kind === 'manual').reduce((sum, entry) => sum + entry.points, 0)
        const penaltyPoints = teamEntries.filter(entry => entry.kind === 'penalty').reduce((sum, entry) => sum + entry.points, 0)
        const totalPoints = teamEntries.reduce((sum, entry) => sum + entry.points, 0)
        return { ...team, stationPoints, bonusPoints, penaltyPoints, totalPoints }
      })
      .sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
        return a.teamName.localeCompare(b.teamName)
      })
      .map((team, index) => ({ ...team, rank: index + 1 }))
  ), [allEntries, roster])

  const qualifiedTeamIds = useMemo(() => {
    if (!nextPhase) return []
    if (advancement.mode === 'manual') {
      return advancement.manualTeamIds.filter(teamId => roster.some(team => team.teamId === teamId))
    }
    return leaderboardRows.slice(0, Math.max(0, Number(advancement.slots) || 0)).map(team => team.teamId)
  }, [advancement.manualTeamIds, advancement.mode, advancement.slots, leaderboardRows, nextPhase, roster])

  const qualifiedTeams = useMemo(
    () => leaderboardRows.filter(team => qualifiedTeamIds.includes(team.teamId)),
    [leaderboardRows, qualifiedTeamIds],
  )

  const availableWildcardTeams = useMemo(
    () => TEAM_CATALOG.filter(team => !roster.some(entry => entry.teamId === team.id)),
    [roster],
  )

  useEffect(() => {
    if (roster.length === 0) {
      setEntryForm((current) => ({ ...current, teamId: '' }))
      return
    }
    if (!entryForm.teamId || !roster.some(team => team.teamId === entryForm.teamId)) {
      setEntryForm((current) => ({ ...current, teamId: roster[0].teamId }))
    }
  }, [entryForm.teamId, roster])

  useEffect(() => {
    if (phaseEvents.length === 0) {
      setEntryForm((current) => ({ ...current, phaseEventId: '' }))
      return
    }
    if (!entryForm.phaseEventId || !phaseEvents.some(item => item.id === entryForm.phaseEventId)) {
      setEntryForm((current) => ({ ...current, phaseEventId: phaseEvents[0].id }))
    }
  }, [entryForm.phaseEventId, phaseEvents])

  useEffect(() => {
    if (availableWildcardTeams.length === 0) {
      setWildcardTeamId('')
      return
    }
    if (!wildcardTeamId || !availableWildcardTeams.some(team => team.id === wildcardTeamId)) {
      setWildcardTeamId(availableWildcardTeams[0].id)
    }
  }, [availableWildcardTeams, wildcardTeamId])

  const setAdvancement = (patch) => {
    updateScoreState((current) => ({
      ...current,
      advancementByPhase: {
        ...current.advancementByPhase,
        [phase]: {
          ...current.advancementByPhase[phase],
          ...patch,
        },
      },
    }))
  }

  const toggleManualTeam = (teamId) => {
    if (advancement.mode !== 'manual') return
    updateScoreState((current) => {
      const selected = current.advancementByPhase[phase].manualTeamIds.includes(teamId)
        ? current.advancementByPhase[phase].manualTeamIds.filter(id => id !== teamId)
        : (
          current.advancementByPhase[phase].manualTeamIds.length >= current.advancementByPhase[phase].slots
            ? current.advancementByPhase[phase].manualTeamIds
            : [...current.advancementByPhase[phase].manualTeamIds, teamId]
        )
      return {
        ...current,
        advancementByPhase: {
          ...current.advancementByPhase,
          [phase]: {
            ...current.advancementByPhase[phase],
            manualTeamIds: selected,
          },
        },
      }
    })
  }

  const publishQualifiedTeams = () => {
    if (!nextPhase || qualifiedTeams.length === 0) return
    updateScoreState((current) => {
      const nextRoster = current.rosterByPhase[nextPhase.key] ?? []
      const rosterMap = new Map(nextRoster.map(item => [item.teamId, { ...item }]))

      qualifiedTeams.forEach((team) => {
        rosterMap.set(team.teamId, {
          teamId: team.teamId,
          teamName: team.teamName,
          captain: team.captain,
          memberCount: team.memberCount,
          origin: 'qualified',
          originLabel: `Top ${qualifiedTeams.length} ${phaseInfo.label.toLowerCase()}`,
          qualifiedFrom: phase,
          note: '',
        })
      })

      return {
        ...current,
        rosterByPhase: {
          ...current.rosterByPhase,
          [nextPhase.key]: Array.from(rosterMap.values()).sort((a, b) => a.teamName.localeCompare(b.teamName)),
        },
        advancementByPhase: {
          ...current.advancementByPhase,
          [phase]: {
            ...current.advancementByPhase[phase],
            lastPublishedAt: new Date().toISOString(),
          },
        },
      }
    })
  }

  const addManualLedgerEntry = () => {
    const phaseEvent = phaseEvents.find(item => item.id === entryForm.phaseEventId)
    if (!entryForm.teamId || !phaseEvent) return

    updateScoreState((current) => ({
      ...current,
      manualLedgerByPhase: {
        ...current.manualLedgerByPhase,
        [phase]: [
          {
            id: makeId('manual'),
            teamId: entryForm.teamId,
            phaseEventId: phaseEvent.id,
            phaseEventName: phaseEvent.name,
            phaseEventType: phaseEvent.type,
            kind: entryForm.kind,
            points: Number(entryForm.points) || 0,
            note: entryForm.note.trim(),
            createdAt: new Date().toISOString(),
          },
          ...current.manualLedgerByPhase[phase],
        ],
      },
    }))

    setEntryForm((current) => ({ ...current, note: '' }))
  }

  const removeManualEntry = (entryId) => {
    updateScoreState((current) => ({
      ...current,
      manualLedgerByPhase: {
        ...current.manualLedgerByPhase,
        [phase]: current.manualLedgerByPhase[phase].filter(entry => entry.id !== entryId),
      },
    }))
  }

  const addWildcardTeam = () => {
    const team = TEAM_CATALOG.find(item => item.id === wildcardTeamId)
    if (!team) return
    updateScoreState((current) => ({
      ...current,
      rosterByPhase: {
        ...current.rosterByPhase,
        [phase]: [
          ...current.rosterByPhase[phase],
          createRosterEntry(team, { origin: 'wildcard', originLabel: 'Dac cach BTC' }),
        ].sort((a, b) => a.teamName.localeCompare(b.teamName)),
      },
    }))
  }

  const removeTeamFromPhase = (teamId) => {
    updateScoreState((current) => ({
      ...current,
      rosterByPhase: {
        ...current.rosterByPhase,
        [phase]: current.rosterByPhase[phase].filter(team => team.teamId !== teamId),
      },
      manualLedgerByPhase: {
        ...current.manualLedgerByPhase,
        [phase]: current.manualLedgerByPhase[phase].filter(entry => entry.teamId !== teamId),
      },
      advancementByPhase: {
        ...current.advancementByPhase,
        [phase]: {
          ...current.advancementByPhase[phase],
          manualTeamIds: current.advancementByPhase[phase].manualTeamIds.filter(id => id !== teamId),
        },
      },
    }))
  }

  const totalPoints = leaderboardRows.reduce((sum, team) => sum + team.totalPoints, 0)
  const stationPoints = stationEntries.reduce((sum, entry) => sum + entry.points, 0)
  const manualAdjustmentPoints = manualLedger.reduce((sum, entry) => sum + entry.points, 0)

  return (
    <div className="space-y-5">
      <section className={`${CARD} px-5 py-5`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge label={phaseInfo.label} cls="bg-trail/12 text-trail" />
              {schedule && <Badge label={`${schedule.startDate || '--'} -> ${schedule.endDate || '--'}`} cls="bg-ink/[0.07] text-ink/55" />}
            </div>
            <h2 className="mt-3 font-display text-2xl font-semibold text-ink">Điểm của event con sẽ đổ lên phase</h2>
            <p className="mt-2 text-sm leading-6 text-ink/55">
              Tab này không tạo event mới. Event con được tạo ở Quản lý sự kiện. Nếu event có trạm, điểm trạm sẽ được cộng vào event;
              tổng điểm của tất cả event trong {phaseInfo.label.toLowerCase()} sẽ tạo ra bảng xếp hạng phase để chọn suất đi tiếp.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 rounded-xl border border-stone bg-white p-1">
            {phaseOptions.map((option) => {
              const active = option.key === phase
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onPhaseChange(option.key)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active
                      ? 'bg-ink text-white'
                      : 'text-ink/55 hover:bg-paper hover:text-ink'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard value={String(phaseEvents.length)} label="Event trong phase" note="Event con được đọc từ tab Quản lý sự kiện." accent="sky" />
        <MetricCard value={String(stationPoints)} label="Tổng điểm từ trạm" note="Lấy từ các trạm thuộc event có trạm." accent="trail" />
        <MetricCard value={String(manualAdjustmentPoints)} label="Cộng trừ thủ công" note="Social, quiz, file, điều chỉnh và event không có trạm." accent="gold" />
        <MetricCard value={String(totalPoints)} label="Tổng điểm phase" note="Tổng điểm sử dụng để xếp hạng và xét suất vào phase sau." accent="clay" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_minmax(320px,0.95fr)]">
        <section className={`${CARD} px-5 py-4`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Tổng hợp event</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Mỗi event nhỏ là một dòng tổng hợp</h3>
            </div>
            <Badge label={`${phaseEvents.length} event`} cls="bg-ink/[0.07] text-ink/55" />
          </div>

          <div className="mt-4 space-y-3">
            {eventSummaries.length > 0 ? eventSummaries.map((eventItem) => (
              <div key={eventItem.id} className="rounded-xl border border-stone bg-white px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <EventBadge type={eventItem.type} />
                      {eventItem.usesStations && <Badge label="Co tram" cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
                    </div>
                    <h4 className="mt-2 text-sm font-semibold text-ink">{eventItem.name}</h4>
                    {eventItem.note && <p className="mt-2 text-sm leading-6 text-ink/50">{eventItem.note}</p>}
                  </div>
                  <span className="font-mono text-lg font-bold text-ink">{eventItem.totalPoints}</span>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-stone bg-paper px-3 py-2">
                    <p className="font-mono text-lg font-bold text-ink">{eventItem.stationPoints}</p>
                    <p className="mt-1 text-[11px] text-ink/40">Diem tram</p>
                  </div>
                  <div className="rounded-lg border border-stone bg-paper px-3 py-2">
                    <p className="font-mono text-lg font-bold text-ink">{eventItem.extraPoints}</p>
                    <p className="mt-1 text-[11px] text-ink/40">Cộng trừ khác</p>
                  </div>
                  <div className="rounded-lg border border-stone bg-paper px-3 py-2">
                    <p className="font-mono text-lg font-bold text-ink">{eventItem.teamsTouched}</p>
                    <p className="mt-1 text-[11px] text-ink/40">Đội đã chấm</p>
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-stone bg-paper px-4 py-10 text-sm text-ink/35">
                Phase này chưa có event nào. Hãy quay lại Quản lý sự kiện để tạo event con trước.
              </div>
            )}
          </div>
        </section>

        <section className={`${CARD} px-5 py-4`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Đẩy phase</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Suất vào vòng sau</h3>
            </div>
            {nextPhase && <Badge label={`Đích đến · ${nextPhase.label}`} cls="bg-gold/15 text-gold" />}
          </div>

          {nextPhase ? (
            <>
              <p className="mt-3 text-sm leading-6 text-ink/50">
                Bang xep hang phase duoc tao tu tong diem cac event con. Co the lay top N tu dong,
                hoac BTC tick tay neu can dac cach.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAdvancement({ mode: 'top_n', manualTeamIds: [] })}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    advancement.mode === 'top_n'
                      ? 'bg-ink text-white'
                      : 'border border-stone bg-white text-ink/55 hover:bg-paper hover:text-ink'
                  }`}
                >
                  Lay top N
                </button>
                <button
                  type="button"
                  onClick={() => setAdvancement({ mode: 'manual', manualTeamIds: qualifiedTeamIds })}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    advancement.mode === 'manual'
                      ? 'bg-ink text-white'
                      : 'border border-stone bg-white text-ink/55 hover:bg-paper hover:text-ink'
                  }`}
                >
                  Chon tay
                </button>
              </div>

              <div className="mt-4">
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
                  So suat vao {nextPhase.label.toLowerCase()}
                </label>
                <input
                  type="number"
                  min="1"
                  value={advancement.slots}
                  onChange={(event) => setAdvancement({
                    slots: Math.max(1, Number(event.target.value) || 1),
                    manualTeamIds: advancement.mode === 'manual'
                      ? advancement.manualTeamIds.slice(0, Math.max(1, Number(event.target.value) || 1))
                      : advancement.manualTeamIds,
                  })}
                  className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                />
              </div>

              <div className="mt-4 rounded-lg border border-stone bg-paper px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">Preview roster sang {nextPhase.label.toLowerCase()}</p>
                  <span className="font-mono text-xs text-ink/40">{qualifiedTeams.length}/{advancement.slots}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {qualifiedTeams.length > 0 ? qualifiedTeams.map((team) => (
                    <div key={team.teamId} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{team.teamName}</p>
                        <p className="mt-0.5 text-xs text-ink/45">{team.teamId} · {team.captain}</p>
                      </div>
                      <span className="font-mono text-sm font-semibold text-ink">{team.totalPoints}</span>
                    </div>
                  )) : (
                    <p className="text-sm text-ink/35">
                      Chưa có đội nào được chọn.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-ink/40">
                  Lần đẩy gần nhất: {formatDateTime(advancement.lastPublishedAt)}
                </div>
                <button
                  type="button"
                  onClick={publishQualifiedTeams}
                  disabled={qualifiedTeams.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name="link" className="h-4 w-4" />
                  Day {qualifiedTeams.length} doi sang {nextPhase.label.toLowerCase()}
                </button>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm leading-6 text-ink/50">
              Đây là phase cuối. Bạn có thể tiếp tục cộng trừ điểm để đối chiếu kết quả tổng kết.
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_minmax(320px,0.95fr)]">
        <section className={`${CARD} overflow-hidden`}>
          <div className="flex flex-col gap-3 border-b border-stone px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Bảng tổng hợp</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Leaderboard cua phase</h3>
            </div>
            <p className="text-sm text-ink/45">
              Tổng điểm của đội = tổng điểm event có trạm + event không có trạm + cộng trừ tay.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-stone font-mono text-[10px] uppercase tracking-[0.18em] text-ink/35">
                  <th className="px-5 py-3 font-medium">Hang</th>
                  <th className="px-4 py-3 font-medium">Doi</th>
                  <th className="px-4 py-3 font-medium text-right">Tram</th>
                  <th className="px-4 py-3 font-medium text-right">Cong diem</th>
                  <th className="px-4 py-3 font-medium text-right">Tru diem</th>
                  <th className="px-4 py-3 font-medium text-right">Tong</th>
                  <th className="px-4 py-3 font-medium text-center">Chon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone/60">
                {leaderboardRows.length > 0 ? leaderboardRows.map((team) => {
                  const isSelected = qualifiedTeamIds.includes(team.teamId)
                  const autoSelected = advancement.mode === 'top_n' && isSelected
                  return (
                    <tr key={team.teamId} className={isSelected ? 'bg-paper/65' : ''}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-ink/65">#{team.rank}</span>
                          {autoSelected && <Badge label="Top N" cls="bg-trail/12 text-trail" />}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{team.teamName}</p>
                          <p className="mt-0.5 text-xs text-ink/45">
                            {team.teamId} · {team.captain} · {team.memberCount} thanh vien
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-ink/60">{team.stationPoints}</td>
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-gold">{team.bonusPoints}</td>
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-clay">{team.penaltyPoints}</td>
                      <td className="px-4 py-3.5 text-right font-mono text-lg font-bold text-ink">{team.totalPoints}</td>
                      <td className="px-4 py-3.5 text-center">
                        {nextPhase ? (
                          advancement.mode === 'manual' ? (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleManualTeam(team.teamId)}
                              className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
                            />
                          ) : (
                            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${
                              isSelected
                                ? 'border-trail/25 bg-trail/10 text-trail'
                                : 'border-stone text-ink/20'
                            }`}>
                              <Icon name="checkPlain" className="h-3.5 w-3.5" />
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-ink/30">--</span>
                        )}
                      </td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={7} className="px-5 py-14 text-center text-sm text-ink/35">
                      Chưa có đội nào trong phase này.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${CARD} px-5 py-4`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Roster phase</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Danh sách đội đang được chấm</h3>
            </div>
            <Badge label={`${roster.length} doi`} cls="bg-ink/[0.07] text-ink/55" />
          </div>

          <div className="mt-4 rounded-lg border border-stone bg-paper px-4 py-3">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Thêm suất đặc cách vào {phaseInfo.label.toLowerCase()}
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <select
                value={wildcardTeamId}
                onChange={(event) => setWildcardTeamId(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              >
                {availableWildcardTeams.length > 0 ? availableWildcardTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.id} · {team.name}
                  </option>
                )) : (
                  <option value="">Không còn đội để thêm</option>
                )}
              </select>
              <button
                type="button"
                onClick={addWildcardTeam}
                disabled={!wildcardTeamId}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone bg-white px-4 py-2 text-sm font-semibold text-ink/65 transition hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="plus" className="h-4 w-4" />
                Thêm vào roster
              </button>
            </div>
          </div>

          <div className="mt-4 divide-y divide-stone rounded-lg border border-stone">
            {roster.length > 0 ? roster.map((team) => (
              <div key={team.teamId} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{team.teamName}</p>
                    <RosterOriginBadge origin={team.origin} />
                  </div>
                  <p className="mt-1 text-xs text-ink/45">
                    {team.teamId} · {team.captain} · {team.memberCount} thanh vien
                  </p>
                  {team.qualifiedFrom && (
                    <p className="mt-1 text-xs text-ink/35">Được đẩy từ phase: {team.qualifiedFrom}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => removeTeamFromPhase(team.teamId)}
                  className="rounded-lg p-1.5 text-ink/30 transition hover:bg-paper hover:text-clay"
                  title="Xoá đội khỏi phase"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            )) : (
              <div className="px-4 py-10 text-sm text-ink/35">
                Chưa có đội nào trong roster phase này.
              </div>
            )}
          </div>
        </section>
      </div>

      <section className={`${CARD} px-5 py-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Bo sung diem thu cong</p>
            <h3 className="mt-1 font-display text-xl font-semibold text-ink">Dùng cho event không có trạm và điều chỉnh</h3>
          </div>
          <Badge label={`${manualLedger.length} dong`} cls="bg-ink/[0.07] text-ink/55" />
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Đội nhận điểm
            </label>
            <select
              value={entryForm.teamId}
              onChange={(event) => setEntryForm((current) => ({ ...current, teamId: event.target.value }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            >
              {roster.map((team) => (
                <option key={team.teamId} value={team.teamId}>
                  {team.teamId} · {team.teamName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Event con
            </label>
            <select
              value={entryForm.phaseEventId}
              onChange={(event) => setEntryForm((current) => ({ ...current, phaseEventId: event.target.value }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            >
              {phaseEvents.map((phaseEventItem) => (
                <option key={phaseEventItem.id} value={phaseEventItem.id}>
                  {phaseEventItem.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Loai diem
            </label>
            <select
              value={entryForm.kind}
              onChange={(event) => setEntryForm((current) => ({ ...current, kind: event.target.value }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            >
              {Object.entries(ENTRY_KIND_META).filter(([key]) => key !== 'station').map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              So diem
            </label>
            <input
              type="number"
              value={entryForm.points}
              onChange={(event) => setEntryForm((current) => ({ ...current, points: Number(event.target.value) || 0 }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
              Ghi chu
            </label>
            <textarea
              rows={4}
              value={entryForm.note}
              onChange={(event) => setEntryForm((current) => ({ ...current, note: event.target.value }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm leading-6 text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              placeholder="Ví dụ: Cộng điểm social, điểm quiz, trừ điểm nộp file muộn, điều chỉnh BTC."
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-ink/45">
            Đối với event có trạm, điểm trạm được lấy từ Quản lý trạm. Ở đây chỉ cần bổ sung phần cộng trừ khác.
          </p>
          <button
            type="button"
            onClick={addManualLedgerEntry}
            disabled={roster.length === 0 || phaseEvents.length === 0 || !entryForm.teamId || !entryForm.phaseEventId}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="plus" className="h-4 w-4" />
            Thêm dòng điểm
          </button>
        </div>

        <div className="mt-4 divide-y divide-stone rounded-lg border border-stone">
          {manualLedger.length > 0 ? manualLedger.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <EntryBadge kind={entry.kind} />
                  <EventBadge type={entry.phaseEventType} />
                  <span className="font-medium text-ink">{roster.find(team => team.teamId === entry.teamId)?.teamName || entry.teamId}</span>
                  <span className="font-mono text-xs text-ink/35">{formatDateTime(entry.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-ink/70">{entry.phaseEventName}</p>
                {entry.note && <p className="mt-1 text-xs leading-5 text-ink/45">{entry.note}</p>}
              </div>

              <div className="flex items-center gap-3">
                <span className={`font-mono text-lg font-bold ${entry.points >= 0 ? 'text-ink' : 'text-clay'}`}>
                  {formatSignedPoints(entry.points)}
                </span>
                <button
                  type="button"
                  onClick={() => removeManualEntry(entry.id)}
                  className="rounded-lg p-1.5 text-ink/30 transition hover:bg-paper hover:text-clay"
                  title="Xoá dòng điểm"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </div>
          )) : (
            <div className="px-4 py-10 text-sm text-ink/35">
              Chưa có cộng trừ thủ công nào trong phase này.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default ScoreManagementPage
