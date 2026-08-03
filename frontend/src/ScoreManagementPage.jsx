import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest, formatDateTime, logoutAndRedirect } from './api.js'
import { Badge, CARD, Icon } from './ui.jsx'
import { SUB_EVENT_TYPE_META, getPhaseInfo } from './adminProgram.js'

const ENTRY_KIND_META = {
  station: { label: 'Điểm trạm', cls: 'bg-[#3E7CA8]/12 text-[#3E7CA8]' },
  bonus: { label: 'Cộng điểm', cls: 'bg-gold/15 text-gold' },
  penalty: { label: 'Trừ điểm', cls: 'bg-clay/12 text-clay' },
  manual: { label: 'Điều chỉnh', cls: 'bg-ink/[0.07] text-ink/55' },
}

const ROSTER_ORIGIN_META = {
  approved: { label: 'Đăng ký đã duyệt', cls: 'bg-ink/[0.07] text-ink/55' },
  qualified: { label: 'Qua phase trước', cls: 'bg-trail/12 text-trail' },
  wildcard: { label: 'Đặc cách BTC', cls: 'bg-gold/15 text-gold' },
}

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    forbidden: 'Bạn không có quyền thao tác điểm.',
    invalid_json: 'Dữ liệu gửi lên không hợp lệ.',
    missing_fields: 'Vui lòng điền đủ đội, event và số điểm.',
    phase_not_found: 'Không tìm thấy phase cần thao tác.',
    event_not_found: 'Không tìm thấy event cần cộng điểm.',
    team_not_found: 'Không tìm thấy đội cần cộng điểm.',
    team_not_in_phase: 'Đội này hiện không nằm trong roster của phase.',
    invalid_points: 'Số điểm không hợp lệ.',
    results_locked: 'Kết quả đã khóa ở phase Kết thúc. Hãy chuyển phase hiện tại khỏi Kết thúc nếu cần chỉnh lại điểm.',
    invalid_mode: 'Chế độ advancement không hợp lệ.',
    advancement_rule_not_found: 'Phase này chưa cấu hình phase đích.',
    manual_team_codes_required: 'Chế độ chọn tay cần có danh sách đội được chọn.',
    manual_team_not_in_phase: 'Có đội trong danh sách đẩy không thuộc roster phase.',
    not_found: 'Không tìm thấy dòng điểm cần thao tác.',
  }
  return map[code] || 'Không thể đồng bộ dữ liệu điểm.'
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

function normalizeScoreboard(payload = {}) {
  return {
    roster: (payload.roster_teams || []).map((team) => ({
      teamId: String(team.team_id ?? ''),
      teamCode: team.team_code || '',
      teamName: team.team_name || '',
      memberCount: team.member_count || 0,
      captainName: team.captain_name || '',
      origin: team.origin || 'approved',
      qualifiedFrom: team.qualified_from || '',
    })),
    leaderboard: (payload.leaderboard || []).map((team, index) => ({
      rank: index + 1,
      teamCode: team.team_code || '',
      teamName: team.team_name || '',
      memberCount: team.member_count || 0,
      captainName: team.captain_name || '',
      totalPoints: team.total_points || 0,
    })),
    entries: (payload.score_entries || []).map((entry) => ({
      id: entry.id,
      teamCode: entry.team_code || '',
      teamName: entry.team_name || '',
      eventId: String(entry.event_id ?? ''),
      eventName: entry.event_name || '',
      kind: entry.kind || 'manual',
      points: entry.points || 0,
      note: entry.note || '',
      stationCode: entry.station_code || '',
      stationName: entry.station_name || '',
      createdBy: entry.created_by || '',
      createdAt: entry.created_at || '',
      updatedAt: entry.updated_at || '',
    })),
    subEvents: (payload.sub_events || []).map((eventItem) => ({
      id: eventItem.id,
      phaseKey: eventItem.phase_key || '',
      name: eventItem.name || '',
      type: eventItem.type || 'custom',
      usesStations: Boolean(eventItem.uses_stations),
      note: eventItem.note || '',
      order: eventItem.order || 0,
    })),
    usesPhaseRoster: Boolean(payload.uses_phase_roster),
    resultsLocked: Boolean(payload.results_locked),
    sourcePhaseKey: payload.source_phase_key || payload.phase_key || '',
    sourcePhaseLabel: payload.source_phase_label || payload.phase_label || '',
    advancement: {
      nextPhaseKey: payload.advancement?.next_phase_key || '',
      nextPhaseLabel: payload.advancement?.next_phase_label || '',
      mode: payload.advancement?.mode || 'top_n',
      slots: Number(payload.advancement?.slots || 0),
      lastPublishedAt: payload.advancement?.last_published_at || '',
      publishedBy: payload.advancement?.published_by || '',
    },
  }
}

function formatSignedPoints(points) {
  return points > 0 ? `+${points}` : String(points)
}

function nextManualSelection(leaderboard, slots, previousSelection) {
  const allowed = new Set(leaderboard.map((row) => row.teamCode))
  const kept = previousSelection.filter((teamCode) => allowed.has(teamCode)).slice(0, slots)
  if (kept.length > 0) return kept
  return leaderboard.slice(0, slots).map((row) => row.teamCode)
}

export default function ScoreManagementPage({
  phase,
  phaseOptions,
  phaseSchedule,
  phaseEvents,
  onPhaseChange,
}) {
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState('')
  const [apiError, setApiError] = useState('')
  const [scoreboard, setScoreboard] = useState(() => normalizeScoreboard())
  const [entryForm, setEntryForm] = useState({
    teamCode: '',
    eventId: '',
    kind: 'bonus',
    points: 3,
    note: '',
  })
  const [ruleForm, setRuleForm] = useState({
    nextPhaseKey: '',
    mode: 'top_n',
    slots: 0,
  })
  const [manualSelection, setManualSelection] = useState([])

  const loadScoreboard = useCallback(async () => {
    const payload = await apiRequest(`/scores/phases/${phase}`)
    setScoreboard(normalizeScoreboard(payload))
  }, [phase])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        setLoading(true)
        setApiError('')
        const payload = await apiRequest(`/scores/phases/${phase}`)
        if (cancelled) return
        setScoreboard(normalizeScoreboard(payload))
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError(explainApiError(error))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [phase])

  useEffect(() => {
    setRuleForm({
      nextPhaseKey: scoreboard.advancement.nextPhaseKey || '',
      mode: scoreboard.advancement.mode || 'top_n',
      slots: scoreboard.advancement.slots || 0,
    })
  }, [scoreboard.advancement.lastPublishedAt, scoreboard.advancement.mode, scoreboard.advancement.nextPhaseKey, scoreboard.advancement.slots])

  const scoreEvents = useMemo(
    () => (scoreboard.subEvents.length > 0 ? scoreboard.subEvents : phaseEvents),
    [phaseEvents, scoreboard.subEvents],
  )

  useEffect(() => {
    if (scoreboard.roster.length === 0) {
      setEntryForm((current) => ({ ...current, teamCode: '' }))
      return
    }
    if (!entryForm.teamCode || !scoreboard.roster.some((team) => team.teamCode === entryForm.teamCode)) {
      setEntryForm((current) => ({ ...current, teamCode: scoreboard.roster[0].teamCode }))
    }
  }, [entryForm.teamCode, scoreboard.roster])

  useEffect(() => {
    if (scoreEvents.length === 0) {
      setEntryForm((current) => ({ ...current, eventId: '' }))
      return
    }
    if (!entryForm.eventId || !scoreEvents.some((eventItem) => String(eventItem.id) === entryForm.eventId)) {
      setEntryForm((current) => ({ ...current, eventId: String(scoreEvents[0].id) }))
    }
  }, [entryForm.eventId, scoreEvents])

  useEffect(() => {
    if (ruleForm.mode !== 'manual') return
    setManualSelection((current) => nextManualSelection(scoreboard.leaderboard, Math.max(0, ruleForm.slots), current))
  }, [ruleForm.mode, ruleForm.slots, scoreboard.leaderboard])

  const phaseInfo = getPhaseInfo(phase)
  const schedule = phaseSchedule[phase]

  const entriesByEvent = useMemo(() => {
    const bucket = new Map()
    scoreboard.entries.forEach((entry) => {
      const key = entry.eventId
      const current = bucket.get(key) || []
      current.push(entry)
      bucket.set(key, current)
    })
    return bucket
  }, [scoreboard.entries])

  const manualEntries = useMemo(
    () => scoreboard.entries.filter((entry) => entry.kind !== 'station'),
    [scoreboard.entries],
  )

  const stationEntries = useMemo(
    () => scoreboard.entries.filter((entry) => entry.kind === 'station'),
    [scoreboard.entries],
  )

  const eventSummaries = useMemo(() => (
    scoreEvents.map((eventItem) => {
      const eventEntries = entriesByEvent.get(String(eventItem.id)) || []
      const stationPoints = eventEntries
        .filter((entry) => entry.kind === 'station')
        .reduce((sum, entry) => sum + entry.points, 0)
      const extraPoints = eventEntries
        .filter((entry) => entry.kind !== 'station')
        .reduce((sum, entry) => sum + entry.points, 0)
      const totalPoints = eventEntries.reduce((sum, entry) => sum + entry.points, 0)
      const touchedTeams = new Set(eventEntries.map((entry) => entry.teamCode)).size
      return {
        ...eventItem,
        stationPoints,
        extraPoints,
        totalPoints,
        touchedTeams,
      }
    })
  ), [entriesByEvent, scoreEvents])

  const qualifiedTeamCodes = useMemo(() => {
    if (!ruleForm.nextPhaseKey) return []
    if (ruleForm.mode === 'manual') return manualSelection
    if (ruleForm.slots <= 0) return []
    return scoreboard.leaderboard.slice(0, ruleForm.slots).map((team) => team.teamCode)
  }, [manualSelection, ruleForm.mode, ruleForm.nextPhaseKey, ruleForm.slots, scoreboard.leaderboard])

  const qualifiedTeams = useMemo(() => {
    const selectedCodes = new Set(qualifiedTeamCodes)
    return scoreboard.leaderboard.filter((team) => selectedCodes.has(team.teamCode))
  }, [qualifiedTeamCodes, scoreboard.leaderboard])

  const totalStationPoints = stationEntries.reduce((sum, entry) => sum + entry.points, 0)
  const totalManualPoints = manualEntries.reduce((sum, entry) => sum + entry.points, 0)
  const isSummaryView = Boolean(scoreboard.sourcePhaseKey && scoreboard.sourcePhaseKey !== phase)
  const sourcePhaseLabel = scoreboard.sourcePhaseLabel || scoreboard.sourcePhaseKey
  const scoreEditingDisabled = scoreboard.resultsLocked || isSummaryView

  const readOnlyScoreMessage = () => (
    scoreboard.resultsLocked
      ? explainApiError({ data: { error: 'results_locked' } })
      : 'Phase Kết thúc chỉ tổng hợp kết quả từ phase trước, không nhập điểm trực tiếp.'
  )

  const buildRulePayload = () => ({
    toPhaseKey: ruleForm.nextPhaseKey,
    mode: ruleForm.mode,
    slots: ruleForm.mode === 'manual' ? manualSelection.length : ruleForm.slots,
  })

  const saveAdvancementRule = async () => {
    const payload = buildRulePayload()
    await apiRequest(`/scores/phases/${phase}/advancement`, {
      method: 'PUT',
      body: payload,
    })
    return payload
  }

  const handleSaveRule = async () => {
    if (!ruleForm.nextPhaseKey || scoreEditingDisabled) return
    try {
      setBusyKey('rule:save')
      setApiError('')
      await saveAdvancementRule()
      await loadScoreboard()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusyKey('')
    }
  }

  const handlePublishAdvancement = async () => {
    if (!ruleForm.nextPhaseKey || qualifiedTeamCodes.length === 0 || scoreEditingDisabled) return
    try {
      setBusyKey('rule:publish')
      setApiError('')
      const savedRule = await saveAdvancementRule()
      await apiRequest(`/scores/phases/${phase}/publish-advancement`, {
        method: 'POST',
        body: savedRule.mode === 'manual'
          ? { manual_team_codes: qualifiedTeamCodes }
          : {},
      })
      await loadScoreboard()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusyKey('')
    }
  }

  const handleCreateEntry = async () => {
    if (scoreEditingDisabled) {
      setApiError(readOnlyScoreMessage())
      return
    }
    try {
      setBusyKey('entry:create')
      setApiError('')
      await apiRequest('/scores/entries', {
        method: 'POST',
        body: {
          phaseKey: phase,
          eventId: Number(entryForm.eventId),
          teamCode: entryForm.teamCode,
          kind: entryForm.kind,
          points: Number(entryForm.points) || 0,
          note: entryForm.note.trim(),
        },
      })
      setEntryForm((current) => ({ ...current, note: '' }))
      await loadScoreboard()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusyKey('')
    }
  }

  const handleDeleteEntry = async (entryId) => {
    if (scoreEditingDisabled) {
      setApiError(readOnlyScoreMessage())
      return
    }
    try {
      setBusyKey(`entry:${entryId}`)
      setApiError('')
      await apiRequest(`/scores/entries/${entryId}`, { method: 'DELETE' })
      await loadScoreboard()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusyKey('')
    }
  }

  const toggleManualTeam = (teamCode) => {
    if (ruleForm.mode !== 'manual' || scoreEditingDisabled) return
    setManualSelection((current) => {
      const next = current.includes(teamCode)
        ? current.filter((code) => code !== teamCode)
        : [...current, teamCode]
      setRuleForm((form) => (
        form.mode === 'manual' && next.length > form.slots
          ? { ...form, slots: next.length }
          : form
      ))
      return next
    })
  }

  const nextPhaseOption = phaseOptions.find((option) => option.key === ruleForm.nextPhaseKey)

  if (loading) {
    return (
      <div className={`${CARD} px-5 py-14 text-center text-sm text-ink/35`}>
        Đang tải bảng điểm phase...
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {apiError && (
        <div className="rounded-xl border border-clay/20 bg-clay/[0.05] px-4 py-3 text-sm text-clay">
          {apiError}
        </div>
      )}

      <section className={`${CARD} px-5 py-5`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge label={phaseInfo.label} cls="bg-trail/12 text-trail" />
              {schedule && <Badge label={`${schedule.startDate || '--'} -> ${schedule.endDate || '--'}`} cls="bg-ink/[0.07] text-ink/55" />}
              {scoreboard.usesPhaseRoster && <Badge label="Dùng roster phase" cls="bg-gold/15 text-gold" />}
              {isSummaryView && <Badge label={`Tổng hợp từ ${sourcePhaseLabel}`} cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
              {scoreboard.resultsLocked && <Badge label="Đã khóa kết quả" cls="bg-clay/12 text-clay" />}
            </div>
            <h2 className="mt-3 font-display text-2xl font-semibold text-ink">Tổng hợp điểm theo phase</h2>
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
                    active ? 'bg-ink text-white' : 'text-ink/55 hover:bg-paper hover:text-ink'
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
        <MetricCard value={String(scoreEvents.length)} label={isSummaryView ? 'Event tổng kết' : 'Event trong phase'} note={isSummaryView ? `Từ ${sourcePhaseLabel}.` : 'Lấy từ Quản lý sự kiện.'} accent="sky" />
        <MetricCard value={String(totalStationPoints)} label="Tổng điểm trạm" note="Auto từ station session đã đóng." accent="trail" />
        <MetricCard value={String(totalManualPoints)} label="Cộng trừ thủ công" note="Bonus, penalty và điều chỉnh." accent="gold" />
        <MetricCard value={String(scoreboard.roster.length)} label="Đội trong roster" note={scoreboard.usesPhaseRoster ? 'Roster đã khóa theo phase' : 'Đang lấy từ đội đã duyệt'} accent="clay" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_minmax(320px,0.95fr)]">
        <section className={`${CARD} px-5 py-4`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Tổng hợp event</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Điểm của từng event con</h3>
            </div>
            <Badge label={`${scoreEvents.length} event`} cls="bg-ink/[0.07] text-ink/55" />
          </div>

          <div className="mt-4 space-y-3">
            {eventSummaries.length > 0 ? eventSummaries.map((eventItem) => (
              <div key={eventItem.id} className="rounded-xl border border-stone bg-white px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <EventBadge type={eventItem.type} />
                      {eventItem.usesStations && <Badge label="Có trạm" cls="bg-[#3E7CA8]/12 text-[#3E7CA8]" />}
                    </div>
                    <h4 className="mt-2 text-sm font-semibold text-ink">{eventItem.name}</h4>
                    {eventItem.note && <p className="mt-2 text-sm leading-6 text-ink/50">{eventItem.note}</p>}
                  </div>
                  <span className="font-mono text-lg font-bold text-ink">{eventItem.totalPoints}</span>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-stone bg-paper px-3 py-2">
                    <p className="font-mono text-lg font-bold text-ink">{eventItem.stationPoints}</p>
                    <p className="mt-1 text-[11px] text-ink/40">Điểm trạm</p>
                  </div>
                  <div className="rounded-lg border border-stone bg-paper px-3 py-2">
                    <p className="font-mono text-lg font-bold text-ink">{eventItem.extraPoints}</p>
                    <p className="mt-1 text-[11px] text-ink/40">Cộng trừ khác</p>
                  </div>
                  <div className="rounded-lg border border-stone bg-paper px-3 py-2">
                    <p className="font-mono text-lg font-bold text-ink">{eventItem.touchedTeams}</p>
                    <p className="mt-1 text-[11px] text-ink/40">Đội đã chấm điểm</p>
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-stone bg-paper px-4 py-10 text-sm text-ink/35">
                Phase này chưa có event nào. Hãy tạo event ở tab Quản lý sự kiện trước.
              </div>
            )}
          </div>
        </section>

        <section className={`${CARD} px-5 py-4`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Advancement</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Suất vào phase sau</h3>
            </div>
            {nextPhaseOption && <Badge label={`Đích đến · ${nextPhaseOption.label}`} cls="bg-gold/15 text-gold" />}
          </div>

          {ruleForm.nextPhaseKey ? (
            <>
              <div className="mt-4">
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
                  Phase đích
                </label>
                <select
                  value={ruleForm.nextPhaseKey}
                  disabled={scoreEditingDisabled}
                  onChange={(event) => setRuleForm((current) => ({ ...current, nextPhaseKey: event.target.value }))}
                  className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                >
                  {phaseOptions.filter((option) => option.key !== phase).map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { key: 'top_n', label: 'Lấy top N' },
                  { key: 'manual', label: 'Chọn tay' },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    disabled={scoreEditingDisabled}
                    onClick={() => setRuleForm((current) => ({ ...current, mode: option.key }))}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      ruleForm.mode === option.key
                        ? 'bg-ink text-white'
                        : 'border border-stone bg-white text-ink/55 hover:bg-paper hover:text-ink'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
                  Số suất
                </label>
                <input
                  type="number"
                  min="0"
                  value={ruleForm.slots}
                  disabled={scoreEditingDisabled}
                  onChange={(event) => setRuleForm((current) => ({ ...current, slots: Math.max(0, Number(event.target.value) || 0) }))}
                  className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                />
              </div>

              <div className="mt-4 rounded-lg border border-stone bg-paper px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">Preview đội được đẩy</p>
                  <span className="font-mono text-xs text-ink/40">{qualifiedTeams.length}/{ruleForm.slots}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {qualifiedTeams.length > 0 ? qualifiedTeams.map((team) => (
                    <div key={team.teamCode} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{team.teamName}</p>
                        <p className="mt-0.5 text-xs text-ink/45">{team.teamCode}{team.captainName ? ` · ${team.captainName}` : ''}</p>
                      </div>
                      <span className="font-mono text-sm font-semibold text-ink">{team.totalPoints}</span>
                    </div>
                  )) : (
                    <p className="text-sm text-ink/35">Chưa có đội nào đủ điều kiện để đẩy sang phase sau.</p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-ink/40">
                  Lần publish gần nhất: {formatDateTime(scoreboard.advancement.lastPublishedAt)}
                  {scoreboard.advancement.publishedBy ? ` · ${scoreboard.advancement.publishedBy}` : ''}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSaveRule}
                    disabled={!ruleForm.nextPhaseKey || scoreEditingDisabled || busyKey === 'rule:save'}
                    className="rounded-lg border border-stone bg-white px-4 py-2 text-sm font-semibold text-ink/65 transition hover:bg-paper hover:text-ink disabled:opacity-40"
                  >
                    {busyKey === 'rule:save' ? 'Đang lưu...' : 'Lưu luật'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePublishAdvancement}
                    disabled={!ruleForm.nextPhaseKey || qualifiedTeamCodes.length === 0 || scoreEditingDisabled || busyKey === 'rule:publish'}
                    className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/85 disabled:opacity-40"
                  >
                    <Icon name="link" className="h-4 w-4" />
                    {busyKey === 'rule:publish' ? 'Đang đẩy...' : `Đẩy ${qualifiedTeamCodes.length} đội`}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm leading-6 text-ink/50">
              Đây là phase cuối, không có phase đích để publish.
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_minmax(320px,0.95fr)]">
        <section className={`${CARD} overflow-hidden`}>
          <div className="flex flex-col gap-3 border-b border-stone px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Leaderboard</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Bảng xếp hạng của phase</h3>
            </div>
            <p className="text-sm text-ink/45">
              Tổng điểm được tính trực tiếp từ ledger score entries của backend.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-stone font-mono text-[10px] uppercase tracking-[0.18em] text-ink/35">
                  <th className="px-5 py-3 font-medium">Hạng</th>
                  <th className="px-4 py-3 font-medium">Đội</th>
                  <th className="px-4 py-3 font-medium text-right">Tổng</th>
                  <th className="px-4 py-3 font-medium text-center">Chọn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone/60">
                {scoreboard.leaderboard.length > 0 ? scoreboard.leaderboard.map((team) => {
                  const isSelected = qualifiedTeamCodes.includes(team.teamCode)
                  return (
                    <tr key={team.teamCode} className={isSelected ? 'bg-paper/65' : ''}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-ink/65">#{team.rank}</span>
                          {ruleForm.mode === 'top_n' && isSelected && <Badge label="Top N" cls="bg-trail/12 text-trail" />}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{team.teamName}</p>
                          <p className="mt-0.5 text-xs text-ink/45">
                            {team.teamCode}
                            {team.captainName ? ` · ${team.captainName}` : ''}
                            {team.memberCount ? ` · ${team.memberCount} thành viên` : ''}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-lg font-bold text-ink">{team.totalPoints}</td>
                      <td className="px-4 py-3.5 text-center">
                        {ruleForm.nextPhaseKey ? (
                          ruleForm.mode === 'manual' ? (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={scoreEditingDisabled}
                              onChange={() => toggleManualTeam(team.teamCode)}
                              className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
                            />
                          ) : (
                            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${
                              isSelected ? 'border-trail/25 bg-trail/10 text-trail' : 'border-stone text-ink/20'
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
                    <td colSpan={4} className="px-5 py-14 text-center text-sm text-ink/35">
                      Chưa có đội nào trong roster phase này.
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
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Danh sách đội được chấm</h3>
            </div>
            <Badge label={`${scoreboard.roster.length} đội`} cls="bg-ink/[0.07] text-ink/55" />
          </div>

          <div className="mt-4 divide-y divide-stone rounded-lg border border-stone">
            {scoreboard.roster.length > 0 ? scoreboard.roster.map((team) => (
              <div key={team.teamCode} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink">{team.teamName}</p>
                  <RosterOriginBadge origin={team.origin} />
                </div>
                <p className="mt-1 text-xs text-ink/45">
                  {team.teamCode}
                  {team.captainName ? ` · ${team.captainName}` : ''}
                  {team.memberCount ? ` · ${team.memberCount} thành viên` : ''}
                </p>
                {team.qualifiedFrom && (
                  <p className="mt-1 text-xs text-ink/35">Đi từ phase: {team.qualifiedFrom}</p>
                )}
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
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Cộng trừ thủ công</p>
            <h3 className="mt-1 font-display text-xl font-semibold text-ink">Điểm ngoài trạm và điều chỉnh</h3>
          </div>
          <Badge label={`${manualEntries.length} dòng`} cls="bg-ink/[0.07] text-ink/55" />
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">Đội nhận điểm</label>
            <select
              value={entryForm.teamCode}
              disabled={scoreEditingDisabled}
              onChange={(event) => setEntryForm((current) => ({ ...current, teamCode: event.target.value }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            >
              {scoreboard.roster.map((team) => (
                <option key={team.teamCode} value={team.teamCode}>
                  {team.teamCode} · {team.teamName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">Event con</label>
            <select
              value={entryForm.eventId}
              disabled={scoreEditingDisabled}
              onChange={(event) => setEntryForm((current) => ({ ...current, eventId: event.target.value }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            >
              {scoreEvents.map((eventItem) => (
                <option key={eventItem.id} value={String(eventItem.id)}>
                  {eventItem.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">Loại điểm</label>
            <select
              value={entryForm.kind}
              disabled={scoreEditingDisabled}
              onChange={(event) => setEntryForm((current) => ({ ...current, kind: event.target.value }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            >
              {Object.entries(ENTRY_KIND_META).filter(([key]) => key !== 'station').map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">Số điểm</label>
            <input
              type="number"
              value={entryForm.points}
              disabled={scoreEditingDisabled}
              onChange={(event) => setEntryForm((current) => ({ ...current, points: Number(event.target.value) || 0 }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">Ghi chú</label>
            <textarea
              rows={4}
              value={entryForm.note}
              disabled={scoreEditingDisabled}
              onChange={(event) => setEntryForm((current) => ({ ...current, note: event.target.value }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm leading-6 text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              placeholder="VD: cộng điểm social, trừ điểm nộp file muộn, điều chỉnh BTC."
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-ink/45">
            Điểm trạm sẽ được tạo tự động khi đóng station session. Ở đây chỉ thêm các dòng bonus, penalty và manual.
          </p>
          <button
            type="button"
            onClick={handleCreateEntry}
            disabled={!entryForm.teamCode || !entryForm.eventId || scoreEditingDisabled || busyKey === 'entry:create'}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/85 disabled:opacity-40"
          >
            <Icon name="plus" className="h-4 w-4" />
            {busyKey === 'entry:create' ? 'Đang thêm...' : 'Thêm dòng điểm'}
          </button>
        </div>

        <div className="mt-4 divide-y divide-stone rounded-lg border border-stone">
          {manualEntries.length > 0 ? manualEntries.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <EntryBadge kind={entry.kind} />
                  <EventBadge type={scoreEvents.find((item) => String(item.id) === entry.eventId)?.type} />
                  <span className="font-medium text-ink">{entry.teamName || entry.teamCode}</span>
                  <span className="font-mono text-xs text-ink/35">{formatDateTime(entry.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-ink/70">{entry.eventName}</p>
                {entry.note && <p className="mt-1 text-xs leading-5 text-ink/45">{entry.note}</p>}
              </div>

              <div className="flex items-center gap-3">
                <span className={`font-mono text-lg font-bold ${entry.points >= 0 ? 'text-ink' : 'text-clay'}`}>
                  {formatSignedPoints(entry.points)}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteEntry(entry.id)}
                  disabled={scoreEditingDisabled || busyKey === `entry:${entry.id}`}
                  className="rounded-lg p-1.5 text-ink/30 transition hover:bg-paper hover:text-clay disabled:opacity-40"
                  title="Xóa dòng điểm"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </div>
          )) : (
            <div className="px-4 py-10 text-sm text-ink/35">
              Chưa có dòng cộng trừ thủ công nào trong phase này.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
