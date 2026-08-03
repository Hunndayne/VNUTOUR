import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest, formatDateTime, logoutAndRedirect } from './api.js'
import { Badge, CARD, Icon, PROVISION } from './ui.jsx'

const SUB_TABS = [
  { key: 'overview', label: 'Tổng quan', icon: 'grid' },
  { key: 'members', label: 'Thành viên', icon: 'userCircle' },
  { key: 'channels', label: 'Kênh & thông báo', icon: 'chat' },
]

const BROADCAST_STATUS_META = {
  draft: { label: 'Draft', cls: 'bg-gold/15 text-gold' },
  sent: { label: 'Sent', cls: 'bg-trail/12 text-trail' },
  failed: { label: 'Failed', cls: 'bg-clay/12 text-clay' },
}

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    forbidden: 'Bạn không có quyền thao tác Discord.',
    invalid_json: 'Dữ liệu gửi lên không hợp lệ.',
    missing_fields: 'Vui lòng điền đủ tiêu đề và nội dung.',
    team_not_found: 'Không tìm thấy đội cần đồng bộ lại.',
    member_not_found: 'Không tìm thấy thành viên cần sync.',
  }
  return map[code] || 'Không thể đồng bộ dữ liệu Discord.'
}

function toneValueClass(tone) {
  if (tone === 'trail') return 'text-trail'
  if (tone === 'gold') return 'text-gold'
  if (tone === 'clay') return 'text-clay'
  if (tone === 'sky') return 'text-[#3E7CA8]'
  return 'text-ink'
}

function MetricCard({ label, value, note, tone = 'default' }) {
  return (
    <div className={`${CARD} p-4`}>
      <p className={`font-mono text-2xl font-semibold ${toneValueClass(tone)}`}>{value}</p>
      <p className="mt-1 text-sm font-medium text-ink/70">{label}</p>
      {note && <p className="mt-0.5 text-xs text-ink/40">{note}</p>}
    </div>
  )
}

function SubTabBar({ active, onChange, counts }) {
  return (
    <div className={`${CARD} flex overflow-hidden`}>
      {SUB_TABS.map((tab, index) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`relative flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm transition hover:bg-paper ${
            index > 0 ? 'border-l border-stone' : ''
          }`}
        >
          {active === tab.key && (
            <span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-trail" />
          )}
          <Icon name={tab.icon} className={`h-4 w-4 ${active === tab.key ? 'text-trail' : 'text-ink/35'}`} />
          <span className={active === tab.key ? 'font-semibold text-ink' : 'font-medium text-ink/50'}>
            {tab.label}
          </span>
          {counts?.[tab.key] !== undefined && (
            <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
              active === tab.key ? 'bg-trail/12 text-trail' : 'bg-ink/[0.06] text-ink/35'
            }`}>
              {counts[tab.key]}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

function normalizeTeam(team) {
  return {
    code: team.code,
    name: team.name || '',
    provisionState: team.provision_state || 'none',
    provisionLastError: team.provision_last_error || '',
    lastProvisionedAt: team.last_provisioned_at || '',
    memberCount: team.member_count || 0,
    textChannelId: team.text_channel_id || null,
    voiceChannelId: team.voice_channel_id || null,
    discordRoleId: team.discord_role_id || null,
  }
}

function normalizeMember(item) {
  return {
    mssv: item.mssv,
    fullName: item.full_name || '(Chưa điền tên)',
    teamCode: item.team_code || '',
    teamName: item.team_name || '',
    discordId: item.discord_id ? String(item.discord_id) : '',
    linked: Boolean(item.linked),
  }
}

function targetLabel(item) {
  if (item.target === 'team_ids') {
    const count = Array.isArray(item.targetPayload?.team_codes) ? item.targetPayload.team_codes.length : 0
    return count > 0 ? `${count} đội cụ thể` : 'Nhóm đội tự chọn'
  }
  if (item.target === 'approved') return 'Đội đã duyệt'
  if (item.target === 'pending') return 'Đội chưa provision'
  return 'Tất cả đội'
}

function queueBadge(item) {
  if (item.provision_state === 'failed') {
    return <Badge label="Lỗi" cls="bg-clay/12 text-clay" />
  }
  return <Badge label="Đang chờ" cls="bg-gold/15 text-gold" />
}

function broadcastBadge(status) {
  return BROADCAST_STATUS_META[status] || BROADCAST_STATUS_META.draft
}

function OverviewTab({ status, teams, queue, broadcasts, busyKey, onRetry, onRefresh }) {
  const provisionedTeams = teams.filter(team => team.provisionState === 'done')
  const failedTeams = teams.filter(team => team.provisionState === 'failed')
  const pendingTeams = teams.filter(team => team.provisionState === 'pending')
  const linkedChannelTeams = provisionedTeams.filter(team => team.textChannelId || team.voiceChannelId)

  return (
    <div className="space-y-5">
      <div className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-bold text-ink">VNUTour Discord</h2>
              <Badge label={`${status.provisioning.done} đã xong`} cls="bg-trail/12 text-trail" />
            </div>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-lg border border-stone bg-white px-4 py-2 text-sm font-medium text-ink/65 transition hover:bg-paper hover:text-ink"
          >
            <Icon name="check" className="h-4 w-4" />
            Tải lại
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Đội đã provision" value={`${status.provisioning.done}`} note={`${linkedChannelTeams.length} đội đã có channel id`} tone="trail" />
        <MetricCard label="Đội trong queue" value={`${status.provisioning.pending}`} note={pendingTeams.length > 0 ? 'Cần bot xử lý tiếp' : 'Không có đội chờ'} tone="gold" />
        <MetricCard label="Provision lỗi" value={`${status.provisioning.failed}`} note={failedTeams.length > 0 ? 'Nên retry sau khi kiểm tra bot' : 'Không có lỗi tồn'} tone="clay" />
        <MetricCard label="Thông báo gần đây" value={`${broadcasts.length}`} note="Lấy từ lịch sử broadcast" tone="sky" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_minmax(320px,0.8fr)]">
        <section className={`${CARD} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-stone px-5 py-3">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">
              Hàng đợi provision
            </h3>
            <span className="font-mono text-xs text-ink/35">{queue.length} đội</span>
          </div>

          <div className="divide-y divide-stone/60">
            {queue.length > 0 ? queue.map((item) => {
              const retryKey = `queue:${item.code}`
              return (
                <div key={item.code} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-ink">{item.name}</p>
                      <span className="font-mono text-xs text-ink/35">{item.code}</span>
                      {queueBadge(item)}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-ink/45">
                      {item.provision_last_error || 'Đội đang chờ bot tạo role/channel tương ứng.'}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-ink/35">
                      Retry: {item.provision_retry_count || 0}
                      {item.last_provisioned_at ? ` · Lần gần nhất ${formatDateTime(item.last_provisioned_at)}` : ''}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRetry(item.code)}
                    disabled={busyKey === retryKey}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone bg-white px-4 py-2 text-sm font-semibold text-ink/65 transition hover:bg-paper hover:text-ink disabled:opacity-40"
                  >
                    <Icon name="check" className="h-4 w-4" />
                    {busyKey === retryKey ? 'Đang retry...' : 'Retry'}
                  </button>
                </div>
              )
            }) : (
              <div className="px-5 py-10 text-center text-sm text-ink/35">
                Queue đang trống. Không có đội nào cần provision thêm.
              </div>
            )}
          </div>
        </section>

        <section className={`${CARD} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-stone px-5 py-3">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">
              Broadcast gần đây
            </h3>
            <span className="font-mono text-xs text-ink/35">{broadcasts.length} mục</span>
          </div>

          <div className="divide-y divide-stone/60">
            {broadcasts.length > 0 ? broadcasts.slice(0, 6).map((item) => (
              <div key={item.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">{item.title}</p>
                  <Badge {...broadcastBadge(item.status)} />
                </div>
                <p className="mt-1 text-xs text-ink/45">{targetLabel(item)}</p>
                <p className="mt-1 font-mono text-[11px] text-ink/35">
                  Tạo lúc {formatDateTime(item.createdAt)}
                  {item.sentAt ? ` · Gửi lúc ${formatDateTime(item.sentAt)}` : ''}
                </p>
                {item.error && <p className="mt-2 text-xs leading-5 text-clay">{item.error}</p>}
              </div>
            )) : (
              <div className="px-5 py-10 text-center text-sm text-ink/35">
                Chưa có broadcast nào được tạo.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function MembersTab({ members, busyKey, onSync }) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedMember, setSelectedMember] = useState(null)
  const [items, setItems] = useState(members.items || [])
  const [counts, setCounts] = useState(members.counts || { all: 0, linked: 0, unlinked: 0 })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setItems(members.items || [])
    setCounts(members.counts || { all: 0, linked: 0, unlinked: 0 })
  }, [members])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    const loadMembers = async () => {
      try {
        setLoading(true)
        const params = new URLSearchParams({ limit: '100' })
        if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim())
        if (filter !== 'all') params.set('linked', filter)
        const payload = await apiRequest(`/discord/members?${params.toString()}`)
        if (cancelled) return
        setItems((payload.items || []).map(normalizeMember))
        setCounts(payload.counts || { all: 0, linked: 0, unlinked: 0 })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadMembers()
    return () => { cancelled = true }
  }, [debouncedSearch, filter])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-stone text-sm">
          {[
            { key: 'all', label: `Tất cả (${counts.all || 0})` },
            { key: 'linked', label: `Đã liên kết (${counts.linked || 0})` },
            { key: 'unlinked', label: `Chưa liên kết (${counts.unlinked || 0})` },
          ].map((tab, index) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className={`px-3.5 py-2 transition ${
                filter === tab.key ? 'bg-ink/6 font-semibold text-ink' : 'text-ink/50 hover:bg-paper'
              } ${index > 0 ? 'border-l border-stone' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[240px] flex-1 max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/25">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            type="text"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Tìm theo MSSV, tên, đội..."
            className="w-full rounded-lg border border-stone bg-white py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-ink/25 transition focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10"
          />
        </div>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone bg-paper/70">
                <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Thành viên</th>
                <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Đội</th>
                <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Discord</th>
                <th className="px-5 py-3 text-right font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/60">
              {items.length > 0 ? items.map((member) => {
                const syncKey = `member:${member.mssv}`
                return (
                  <tr key={member.mssv} className="transition hover:bg-paper/50">
                    <td className="px-5 py-3.5">
                      <button
                        type="button"
                        onClick={() => setSelectedMember(selectedMember?.mssv === member.mssv ? null : member)}
                        className="text-left"
                      >
                        <p className="text-sm font-semibold text-ink">{member.fullName}</p>
                        <p className="mt-0.5 font-mono text-xs text-ink/35">{member.mssv}</p>
                      </button>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-ink/70">{member.teamName || '--'}</p>
                      <p className="mt-0.5 font-mono text-xs text-ink/35">{member.teamCode || '--'}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      {member.linked ? (
                        <div>
                          <Badge label="Đã liên kết" cls="bg-trail/12 text-trail" />
                          <p className="mt-1 font-mono text-xs text-ink/35">{member.discordId}</p>
                        </div>
                      ) : (
                        <Badge label="Chưa liên kết" cls="bg-clay/12 text-clay" />
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onSync(member.mssv)}
                          disabled={busyKey === syncKey}
                          className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-semibold text-ink/65 transition hover:bg-paper hover:text-ink disabled:opacity-40"
                        >
                          {busyKey === syncKey ? 'Đang sync...' : 'Sync'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              }) : (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-sm text-ink/35">
                    {loading ? 'Đang tải thành viên...' : 'Không có thành viên nào khớp bộ lọc hiện tại.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedMember && (
        <div className={`${CARD} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-semibold text-ink">{selectedMember.fullName}</h3>
              <p className="mt-1 font-mono text-xs text-ink/40">{selectedMember.mssv}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedMember(null)}
              className="rounded-lg p-1.5 text-ink/25 transition hover:bg-paper hover:text-ink/55"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-stone p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink/35">Trạng thái</p>
              <div className="mt-2">
                {selectedMember.linked
                  ? <Badge label="Đã liên kết Discord" cls="bg-trail/12 text-trail" />
                  : <Badge label="Chưa liên kết Discord" cls="bg-clay/12 text-clay" />}
              </div>
            </div>
            <div className="rounded-lg border border-stone p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink/35">Đội</p>
              <p className="mt-2 text-sm text-ink">{selectedMember.teamName || '--'}</p>
              <p className="mt-0.5 font-mono text-xs text-ink/35">{selectedMember.teamCode || '--'}</p>
            </div>
            <div className="rounded-lg border border-stone p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink/35">Discord ID</p>
              <p className="mt-2 font-mono text-sm text-ink">{selectedMember.discordId || '--'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ChannelsTab({ teams, broadcasts, busyKey, onRetry, onCreateBroadcast }) {
  const [tab, setTab] = useState('channels')
  const [composeForm, setComposeForm] = useState({
    title: '',
    message: '',
    target: 'all',
    teamCodes: [],
  })

  const readyTeams = useMemo(
    () => teams.filter(team => team.provisionState === 'done'),
    [teams],
  )

  const selectableTeams = readyTeams.filter(team => team.textChannelId || team.voiceChannelId)

  const toggleTeamCode = (teamCode) => {
    setComposeForm((current) => ({
      ...current,
      teamCodes: current.teamCodes.includes(teamCode)
        ? current.teamCodes.filter(code => code !== teamCode)
        : [...current.teamCodes, teamCode],
    }))
  }

  const handleSubmit = async () => {
    await onCreateBroadcast(composeForm)
    setComposeForm({ title: '', message: '', target: 'all', teamCodes: [] })
    setTab('history')
  }

  return (
    <div className="space-y-5">
      <div className="flex w-fit overflow-hidden rounded-lg border border-stone text-sm">
        {[
          { key: 'channels', label: 'Danh sách kênh' },
          { key: 'compose', label: 'Soạn thông báo' },
          { key: 'history', label: 'Lịch sử' },
        ].map((item, index) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`px-4 py-2 transition ${
              tab === item.key ? 'bg-trail/10 font-semibold text-trail' : 'text-ink/50 hover:bg-paper'
            } ${index > 0 ? 'border-l border-stone' : ''}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'channels' && (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone bg-paper/70">
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Đội</th>
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Provision</th>
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Text channel</th>
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Voice channel</th>
                  <th className="px-5 py-3 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Members</th>
                  <th className="px-5 py-3 text-right font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone/60">
                {teams.length > 0 ? teams.map((team) => {
                  const retryKey = `queue:${team.code}`
                  return (
                    <tr key={team.code} className="transition hover:bg-paper/50">
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold text-ink">{team.name}</p>
                        <p className="mt-0.5 font-mono text-xs text-ink/35">{team.code}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge {...(PROVISION[team.provisionState] || PROVISION.none)} />
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-ink/55">
                        {team.textChannelId || '--'}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-ink/55">
                        {team.voiceChannelId || '--'}
                      </td>
                      <td className="px-5 py-3.5 text-center font-mono text-sm text-ink/65">
                        {team.memberCount}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-2">
                          {team.provisionState !== 'done' && (
                            <button
                              type="button"
                              onClick={() => onRetry(team.code)}
                              disabled={busyKey === retryKey}
                              className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-semibold text-ink/65 transition hover:bg-paper hover:text-ink disabled:opacity-40"
                            >
                              {busyKey === retryKey ? 'Đang retry...' : 'Retry'}
                            </button>
                          )}
                          {team.provisionState === 'done' && (team.textChannelId || team.voiceChannelId) && (
                            <button
                              type="button"
                              onClick={() => {
                                setComposeForm((current) => ({ ...current, target: 'team_ids', teamCodes: [team.code] }))
                                setTab('compose')
                              }}
                              className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-semibold text-ink/65 transition hover:bg-paper hover:text-ink"
                            >
                              Nhắc nhanh
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-ink/35">
                      Chưa có đội nào trong hệ thống.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'compose' && (
        <div className={`${CARD} p-5`}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Tiêu đề</label>
              <input
                type="text"
                value={composeForm.title}
                onChange={event => setComposeForm((current) => ({ ...current, title: event.target.value }))}
                className="w-full rounded-lg border border-stone bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink/25 transition focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10"
                placeholder="VD: Nhắc lịch check-in vòng loại"
              />
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Nội dung</label>
              <textarea
                rows={5}
                value={composeForm.message}
                onChange={event => setComposeForm((current) => ({ ...current, message: event.target.value }))}
                className="w-full resize-y rounded-lg border border-stone bg-white px-4 py-3 text-sm leading-6 text-ink placeholder:text-ink/25 transition focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10"
                placeholder="Hỗ trợ Markdown ở phía Discord bot."
              />
            </div>

            <div>
              <label className="mb-2 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Gửi đến</label>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { key: 'all', label: 'Tất cả đội' },
                  { key: 'approved', label: 'Đội đã duyệt' },
                  { key: 'pending', label: 'Đội chưa provision xong' },
                  { key: 'team_ids', label: 'Chọn đội cụ thể' },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setComposeForm((current) => ({ ...current, target: option.key }))}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      composeForm.target === option.key
                        ? 'border-trail/30 bg-trail/10 text-trail'
                        : 'border-stone bg-white text-ink/60 hover:bg-paper'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {composeForm.target === 'team_ids' && (
              <div className="rounded-lg border border-stone bg-paper px-4 py-3">
                <p className="mb-2 text-sm font-medium text-ink">Chọn đội có channel để gửi</p>
                <div className="grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2">
                  {selectableTeams.length > 0 ? selectableTeams.map((team) => (
                    <label key={team.code} className="flex items-center gap-2 rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink/70">
                      <input
                        type="checkbox"
                        checked={composeForm.teamCodes.includes(team.code)}
                        onChange={() => toggleTeamCode(team.code)}
                        className="h-4 w-4 rounded border-stone text-trail focus:ring-trail/20"
                      />
                      <span className="min-w-0 truncate">{team.code} · {team.name}</span>
                    </label>
                  )) : (
                    <p className="text-sm text-ink/35">Chưa có đội nào sẵn sàng nhận thông báo theo kênh riêng.</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink/45">
                Broadcast hiện tạo bản nháp trong database; bot sẽ đọc queue này để gửi về Discord.
              </p>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  busyKey === 'broadcast:create'
                  || !composeForm.title.trim()
                  || !composeForm.message.trim()
                  || (composeForm.target === 'team_ids' && composeForm.teamCodes.length === 0)
                }
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/85 disabled:opacity-40"
              >
                <Icon name="chat" className="h-4 w-4" />
                {busyKey === 'broadcast:create' ? 'Đang tạo...' : 'Tạo broadcast'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className={`${CARD} overflow-hidden`}>
          <div className="divide-y divide-stone/60">
            {broadcasts.length > 0 ? broadcasts.map((item) => (
              <div key={item.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">{item.title}</p>
                  <Badge {...broadcastBadge(item.status)} />
                </div>
                <p className="mt-1 text-xs text-ink/45">{targetLabel(item)}</p>
                <p className="mt-1 font-mono text-[11px] text-ink/35">
                  Tạo bởi {item.sentBy || 'admin'} · {formatDateTime(item.createdAt)}
                  {item.sentAt ? ` · Sent ${formatDateTime(item.sentAt)}` : ''}
                </p>
                {item.error && <p className="mt-2 text-xs leading-5 text-clay">{item.error}</p>}
              </div>
            )) : (
              <div className="px-5 py-12 text-center text-sm text-ink/35">
                Chưa có lịch sử broadcast.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function DiscordPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState('')
  const [apiError, setApiError] = useState('')
  const [status, setStatus] = useState({ provisioning: { pending: 0, failed: 0, done: 0 } })
  const [queue, setQueue] = useState([])
  const [members, setMembers] = useState({ items: [], counts: { all: 0, linked: 0, unlinked: 0 } })
  const [teams, setTeams] = useState([])
  const [broadcasts, setBroadcasts] = useState([])

  const loadDiscordData = useCallback(async () => {
    const [statusPayload, queuePayload, membersPayload, broadcastsPayload, teamsPayload] = await Promise.all([
      apiRequest('/discord/status'),
      apiRequest('/discord/provisioning-queue'),
      apiRequest('/discord/members?limit=100'),
      apiRequest('/discord/broadcasts'),
      apiRequest('/teams?limit=200'),
    ])

    setStatus(statusPayload || { provisioning: { pending: 0, failed: 0, done: 0 } })
    setQueue(queuePayload?.queue || [])
    setMembers({
      items: (membersPayload?.items || []).map(normalizeMember),
      counts: membersPayload?.counts || { all: 0, linked: 0, unlinked: 0 },
    })
    setBroadcasts((broadcastsPayload?.items || []).map(item => ({
      id: item.id,
      title: item.title || '',
      target: item.target || 'all',
      status: item.status || 'draft',
      sentBy: item.sent_by || '',
      sentAt: item.sent_at || '',
      createdAt: item.sent_at || item.created_at || '',
      error: item.error || '',
      targetPayload: item.target_payload || null,
    })))
    setTeams((teamsPayload?.items || []).map(normalizeTeam))
  }, [])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        setLoading(true)
        setApiError('')
        await loadDiscordData()
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
  }, [loadDiscordData])

  const handleRetryProvision = async (teamCode) => {
    const nextBusyKey = `queue:${teamCode}`
    try {
      setBusyKey(nextBusyKey)
      setApiError('')
      await apiRequest(`/discord/teams/${encodeURIComponent(teamCode)}/provision`, { method: 'POST' })
      await loadDiscordData()
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

  const handleSyncMember = async (mssv) => {
    const nextBusyKey = `member:${mssv}`
    try {
      setBusyKey(nextBusyKey)
      setApiError('')
      await apiRequest(`/discord/members/${encodeURIComponent(mssv)}/sync`, { method: 'POST' })
      await loadDiscordData()
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

  const handleCreateBroadcast = async (form) => {
    try {
      setBusyKey('broadcast:create')
      setApiError('')
      await apiRequest('/discord/broadcasts', {
        method: 'POST',
        body: {
          title: form.title.trim(),
          message: form.message.trim(),
          target: form.target,
          target_payload: form.target === 'team_ids'
            ? { team_codes: form.teamCodes }
            : null,
        },
      })
      await loadDiscordData()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
      throw error
    } finally {
      setBusyKey('')
    }
  }

  const counts = useMemo(() => ({
    overview: queue.length,
    members: members.counts?.all || 0,
    channels: teams.length,
  }), [members.counts, queue.length, teams.length])

  return (
    <div className="space-y-5">
      <SubTabBar active={activeTab} onChange={setActiveTab} counts={counts} />

      {apiError && (
        <div className="rounded-xl border border-clay/20 bg-clay/[0.05] px-4 py-3 text-sm text-clay">
          {apiError}
        </div>
      )}

      {loading ? (
        <div className={`${CARD} px-5 py-14 text-center text-sm text-ink/35`}>
          Đang tải dữ liệu Discord...
        </div>
      ) : (
        <>
          {activeTab === 'overview' && (
            <OverviewTab
              status={status}
              teams={teams}
              queue={queue}
              broadcasts={broadcasts}
              busyKey={busyKey}
              onRetry={handleRetryProvision}
              onRefresh={loadDiscordData}
            />
          )}
          {activeTab === 'members' && (
            <MembersTab
              members={members}
              busyKey={busyKey}
              onSync={handleSyncMember}
            />
          )}
          {activeTab === 'channels' && (
            <ChannelsTab
              teams={teams}
              broadcasts={broadcasts}
              busyKey={busyKey}
              onRetry={handleRetryProvision}
              onCreateBroadcast={handleCreateBroadcast}
            />
          )}
        </>
      )}
    </div>
  )
}
