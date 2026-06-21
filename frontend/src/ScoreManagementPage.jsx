import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest, formatDateTime, logoutAndRedirect } from './api.js'
import { Badge, CARD, Icon } from './ui.jsx'
import { SUB_EVENT_TYPE_META, getPhaseInfo } from './adminProgram.js'

const ENTRY_KIND_META = {
  station: { label: 'Diem tram', cls: 'bg-[#3E7CA8]/12 text-[#3E7CA8]' },
  bonus: { label: 'Cong diem', cls: 'bg-gold/15 text-gold' },
  penalty: { label: 'Tru diem', cls: 'bg-clay/12 text-clay' },
  manual: { label: 'Dieu chinh', cls: 'bg-ink/[0.07] text-ink/55' },
}

const ROSTER_ORIGIN_META = {
  approved: { label: 'Dang ky da duyet', cls: 'bg-ink/[0.07] text-ink/55' },
  qualified: { label: 'Qua phase truoc', cls: 'bg-trail/12 text-trail' },
  wildcard: { label: 'Dac cach BTC', cls: 'bg-gold/15 text-gold' },
}

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    forbidden: 'Ban khong co quyen thao tac diem.',
    invalid_json: 'Du lieu gui len khong hop le.',
    missing_fields: 'Vui long dien du doi, event va so diem.',
    phase_not_found: 'Khong tim thay phase can thao tac.',
    event_not_found: 'Khong tim thay event can cong diem.',
    team_not_found: 'Khong tim thay doi can cong diem.',
    team_not_in_phase: 'Doi nay hien khong nam trong roster cua phase.',
    invalid_points: 'So diem khong hop le.',
    invalid_mode: 'Che do advancement khong hop le.',
    advancement_rule_not_found: 'Phase nay chua cau hinh phase dich.',
    manual_team_codes_required: 'Che do chon tay can co danh sach doi duoc chon.',
    manual_team_not_in_phase: 'Co doi trong danh sach day khong thuoc roster phase.',
    not_found: 'Khong tim thay dong diem can thao tac.',
  }
  return map[code] || 'Khong the dong bo du lieu diem.'
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
    usesPhaseRoster: Boolean(payload.uses_phase_roster),
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
    if (phaseEvents.length === 0) {
      setEntryForm((current) => ({ ...current, eventId: '' }))
      return
    }
    if (!entryForm.eventId || !phaseEvents.some((eventItem) => String(eventItem.id) === entryForm.eventId)) {
      setEntryForm((current) => ({ ...current, eventId: String(phaseEvents[0].id) }))
    }
  }, [entryForm.eventId, phaseEvents])

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
    phaseEvents.map((eventItem) => {
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
  ), [entriesByEvent, phaseEvents])

  const qualifiedTeamCodes = useMemo(() => {
    if (!ruleForm.nextPhaseKey || ruleForm.slots <= 0) return []
    if (ruleForm.mode === 'manual') return manualSelection.slice(0, ruleForm.slots)
    return scoreboard.leaderboard.slice(0, ruleForm.slots).map((team) => team.teamCode)
  }, [manualSelection, ruleForm.mode, ruleForm.nextPhaseKey, ruleForm.slots, scoreboard.leaderboard])

  const qualifiedTeams = useMemo(() => {
    const selectedCodes = new Set(qualifiedTeamCodes)
    return scoreboard.leaderboard.filter((team) => selectedCodes.has(team.teamCode))
  }, [qualifiedTeamCodes, scoreboard.leaderboard])

  const totalStationPoints = stationEntries.reduce((sum, entry) => sum + entry.points, 0)
  const totalManualPoints = manualEntries.reduce((sum, entry) => sum + entry.points, 0)

  const handleSaveRule = async () => {
    if (!ruleForm.nextPhaseKey) return
    try {
      setBusyKey('rule:save')
      setApiError('')
      await apiRequest(`/scores/phases/${phase}/advancement`, {
        method: 'PUT',
        body: {
          toPhaseKey: ruleForm.nextPhaseKey,
          mode: ruleForm.mode,
          slots: ruleForm.slots,
        },
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

  const handlePublishAdvancement = async () => {
    if (!ruleForm.nextPhaseKey || qualifiedTeamCodes.length === 0) return
    try {
      setBusyKey('rule:publish')
      setApiError('')
      await apiRequest(`/scores/phases/${phase}/publish-advancement`, {
        method: 'POST',
        body: ruleForm.mode === 'manual'
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
    if (ruleForm.mode !== 'manual') return
    setManualSelection((current) => {
      if (current.includes(teamCode)) {
        return current.filter((code) => code !== teamCode)
      }
      if (current.length >= ruleForm.slots) {
        return current
      }
      return [...current, teamCode]
    })
  }

  const nextPhaseOption = phaseOptions.find((option) => option.key === ruleForm.nextPhaseKey)

  if (loading) {
    return (
      <div className={`${CARD} px-5 py-14 text-center text-sm text-ink/35`}>
        Dang tai bang diem phase...
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
              {scoreboard.usesPhaseRoster && <Badge label="Dung roster phase" cls="bg-gold/15 text-gold" />}
            </div>
            <h2 className="mt-3 font-display text-2xl font-semibold text-ink">Tong hop diem theo phase</h2>
            <p className="mt-2 text-sm leading-6 text-ink/55">
              Diem tram, diem social, quiz va cac dieu chinh thu cong deu do ve cung mot bang diem phase.
              Roster phase duoc doc tu backend, va viec day doi sang phase sau se goi advancement API truc tiep.
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
        <MetricCard value={String(phaseEvents.length)} label="Event trong phase" note="Lay tu Quan ly su kien." accent="sky" />
        <MetricCard value={String(totalStationPoints)} label="Tong diem tram" note="Auto tu station session da dong." accent="trail" />
        <MetricCard value={String(totalManualPoints)} label="Cong tru thu cong" note="Bonus, penalty va dieu chinh." accent="gold" />
        <MetricCard value={String(scoreboard.roster.length)} label="Doi trong roster" note={scoreboard.usesPhaseRoster ? 'Roster da khoa theo phase' : 'Dang lay tu doi da duyet'} accent="clay" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_minmax(320px,0.95fr)]">
        <section className={`${CARD} px-5 py-4`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Tong hop event</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Diem cua tung event con</h3>
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
                    <p className="mt-1 text-[11px] text-ink/40">Cong tru khac</p>
                  </div>
                  <div className="rounded-lg border border-stone bg-paper px-3 py-2">
                    <p className="font-mono text-lg font-bold text-ink">{eventItem.touchedTeams}</p>
                    <p className="mt-1 text-[11px] text-ink/40">Doi da cham diem</p>
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-stone bg-paper px-4 py-10 text-sm text-ink/35">
                Phase nay chua co event nao. Hay tao event o tab Quan ly su kien truoc.
              </div>
            )}
          </div>
        </section>

        <section className={`${CARD} px-5 py-4`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Advancement</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Suat vao phase sau</h3>
            </div>
            {nextPhaseOption && <Badge label={`Dich den · ${nextPhaseOption.label}`} cls="bg-gold/15 text-gold" />}
          </div>

          {ruleForm.nextPhaseKey ? (
            <>
              <p className="mt-3 text-sm leading-6 text-ink/50">
                Cau hinh top N hoac chon tay, sau do publish roster sang phase tiep theo.
              </p>

              <div className="mt-4">
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
                  Phase dich
                </label>
                <select
                  value={ruleForm.nextPhaseKey}
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
                  { key: 'top_n', label: 'Lay top N' },
                  { key: 'manual', label: 'Chon tay' },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
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
                  So suat
                </label>
                <input
                  type="number"
                  min="0"
                  value={ruleForm.slots}
                  onChange={(event) => setRuleForm((current) => ({ ...current, slots: Math.max(0, Number(event.target.value) || 0) }))}
                  className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                />
              </div>

              <div className="mt-4 rounded-lg border border-stone bg-paper px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">Preview doi duoc day</p>
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
                    <p className="text-sm text-ink/35">Chua co doi nao du dieu kien de day sang phase sau.</p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-ink/40">
                  Lan publish gan nhat: {formatDateTime(scoreboard.advancement.lastPublishedAt)}
                  {scoreboard.advancement.publishedBy ? ` · ${scoreboard.advancement.publishedBy}` : ''}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSaveRule}
                    disabled={!ruleForm.nextPhaseKey || busyKey === 'rule:save'}
                    className="rounded-lg border border-stone bg-white px-4 py-2 text-sm font-semibold text-ink/65 transition hover:bg-paper hover:text-ink disabled:opacity-40"
                  >
                    {busyKey === 'rule:save' ? 'Dang luu...' : 'Luu luat'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePublishAdvancement}
                    disabled={!ruleForm.nextPhaseKey || qualifiedTeamCodes.length === 0 || busyKey === 'rule:publish'}
                    className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/85 disabled:opacity-40"
                  >
                    <Icon name="link" className="h-4 w-4" />
                    {busyKey === 'rule:publish' ? 'Dang day...' : `Day ${qualifiedTeamCodes.length} doi`}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm leading-6 text-ink/50">
              Day la phase cuoi, khong co phase dich de publish.
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_minmax(320px,0.95fr)]">
        <section className={`${CARD} overflow-hidden`}>
          <div className="flex flex-col gap-3 border-b border-stone px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Leaderboard</p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Bang xep hang cua phase</h3>
            </div>
            <p className="text-sm text-ink/45">
              Tong diem duoc tinh truc tiep tu ledger score entries cua backend.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-stone font-mono text-[10px] uppercase tracking-[0.18em] text-ink/35">
                  <th className="px-5 py-3 font-medium">Hang</th>
                  <th className="px-4 py-3 font-medium">Doi</th>
                  <th className="px-4 py-3 font-medium text-right">Tong</th>
                  <th className="px-4 py-3 font-medium text-center">Chon</th>
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
                            {team.memberCount ? ` · ${team.memberCount} thanh vien` : ''}
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
                      Chua co doi nao trong roster phase nay.
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
              <h3 className="mt-1 font-display text-xl font-semibold text-ink">Danh sach doi duoc cham</h3>
            </div>
            <Badge label={`${scoreboard.roster.length} doi`} cls="bg-ink/[0.07] text-ink/55" />
          </div>

          <div className="mt-3 rounded-lg border border-stone bg-paper px-4 py-3 text-sm leading-6 text-ink/50">
            Roster nay duoc quan ly tu backend: doi da duyet hoac doi duoc publish tu phase truoc se tu dong xuat hien o day.
            Neu can dac cach/wildcard, nen bo sung endpoint roster rieng o buoc tiep theo.
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
                  {team.memberCount ? ` · ${team.memberCount} thanh vien` : ''}
                </p>
                {team.qualifiedFrom && (
                  <p className="mt-1 text-xs text-ink/35">Di tu phase: {team.qualifiedFrom}</p>
                )}
              </div>
            )) : (
              <div className="px-4 py-10 text-sm text-ink/35">
                Chua co doi nao trong roster phase nay.
              </div>
            )}
          </div>
        </section>
      </div>

      <section className={`${CARD} px-5 py-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">Cong tru thu cong</p>
            <h3 className="mt-1 font-display text-xl font-semibold text-ink">Diem ngoai tram va dieu chinh</h3>
          </div>
          <Badge label={`${manualEntries.length} dong`} cls="bg-ink/[0.07] text-ink/55" />
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">Doi nhan diem</label>
            <select
              value={entryForm.teamCode}
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
              onChange={(event) => setEntryForm((current) => ({ ...current, eventId: event.target.value }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            >
              {phaseEvents.map((eventItem) => (
                <option key={eventItem.id} value={String(eventItem.id)}>
                  {eventItem.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">Loai diem</label>
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
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">So diem</label>
            <input
              type="number"
              value={entryForm.points}
              onChange={(event) => setEntryForm((current) => ({ ...current, points: Number(event.target.value) || 0 }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">Ghi chu</label>
            <textarea
              rows={4}
              value={entryForm.note}
              onChange={(event) => setEntryForm((current) => ({ ...current, note: event.target.value }))}
              className="w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm leading-6 text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              placeholder="VD: cong diem social, tru diem nop file muon, dieu chinh BTC."
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-ink/45">
            Diem tram se duoc tao tu dong khi dong station session. O day chi them cac dong bonus, penalty va manual.
          </p>
          <button
            type="button"
            onClick={handleCreateEntry}
            disabled={!entryForm.teamCode || !entryForm.eventId || busyKey === 'entry:create'}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/85 disabled:opacity-40"
          >
            <Icon name="plus" className="h-4 w-4" />
            {busyKey === 'entry:create' ? 'Dang them...' : 'Them dong diem'}
          </button>
        </div>

        <div className="mt-4 divide-y divide-stone rounded-lg border border-stone">
          {manualEntries.length > 0 ? manualEntries.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <EntryBadge kind={entry.kind} />
                  <EventBadge type={phaseEvents.find((item) => String(item.id) === entry.eventId)?.type} />
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
                  disabled={busyKey === `entry:${entry.id}`}
                  className="rounded-lg p-1.5 text-ink/30 transition hover:bg-paper hover:text-clay disabled:opacity-40"
                  title="Xoa dong diem"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </div>
          )) : (
            <div className="px-4 py-10 text-sm text-ink/35">
              Chua co dong cong tru thu cong nao trong phase nay.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
