import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest, formatDateTime, logoutAndRedirect } from './api.js'
import { Badge, CARD, Icon, PROVISION } from './ui.jsx'

const SUB_TABS = [
  { key: 'overview', label: 'Tong quan', icon: 'grid' },
  { key: 'members', label: 'Thanh vien', icon: 'userCircle' },
  { key: 'channels', label: 'Kenh & thong bao', icon: 'chat' },
]

const BROADCAST_STATUS_META = {
  draft: { label: 'Draft', cls: 'bg-gold/15 text-gold' },
  sent: { label: 'Sent', cls: 'bg-trail/12 text-trail' },
  failed: { label: 'Failed', cls: 'bg-clay/12 text-clay' },
}

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    forbidden: 'Ban khong co quyen thao tac Discord.',
    invalid_json: 'Du lieu gui len khong hop le.',
    missing_fields: 'Vui long dien du tieu de va noi dung.',
    team_not_found: 'Khong tim thay doi can dong bo lai.',
    member_not_found: 'Khong tim thay thanh vien can sync.',
  }
  return map[code] || 'Khong the dong bo du lieu Discord.'
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
    fullName: item.full_name || '(Chua dien ten)',
    teamCode: item.team_code || '',
    teamName: item.team_name || '',
    discordId: item.discord_id ? String(item.discord_id) : '',
    linked: Boolean(item.linked),
  }
}

function targetLabel(item) {
  if (item.target === 'team_ids') {
    const count = Array.isArray(item.targetPayload?.team_codes) ? item.targetPayload.team_codes.length : 0
    return count > 0 ? `${count} doi cu the` : 'Nhom doi tu chon'
  }
  if (item.target === 'approved') return 'Doi da duyet'
  if (item.target === 'pending') return 'Doi chua provision'
  return 'Tat ca doi'
}

function queueBadge(item) {
  if (item.provision_state === 'failed') {
    return <Badge label="Loi" cls="bg-clay/12 text-clay" />
  }
  return <Badge label="Dang cho" cls="bg-gold/15 text-gold" />
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
              <Badge label={`${status.provisioning.done} da xong`} cls="bg-trail/12 text-trail" />
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/50">
              Theo doi trang thai provision kenh/role, doi can retry, va lich su thong bao da tao tu trang admin.
            </p>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-lg border border-stone bg-white px-4 py-2 text-sm font-medium text-ink/65 transition hover:bg-paper hover:text-ink"
          >
            <Icon name="check" className="h-4 w-4" />
            Tai lai
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Doi da provision" value={`${status.provisioning.done}`} note={`${linkedChannelTeams.length} doi da co channel id`} tone="trail" />
        <MetricCard label="Doi trong queue" value={`${status.provisioning.pending}`} note={pendingTeams.length > 0 ? 'Can bot xu ly tiep' : 'Khong co doi cho'} tone="gold" />
        <MetricCard label="Provision loi" value={`${status.provisioning.failed}`} note={failedTeams.length > 0 ? 'Nen retry sau khi kiem tra bot' : 'Khong co loi ton'} tone="clay" />
        <MetricCard label="Thong bao gan day" value={`${broadcasts.length}`} note="Lay tu lich su broadcast" tone="sky" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_minmax(320px,0.8fr)]">
        <section className={`${CARD} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-stone px-5 py-3">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">
              Hang doi provision
            </h3>
            <span className="font-mono text-xs text-ink/35">{queue.length} doi</span>
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
                      {item.provision_last_error || 'Doi dang cho bot tao role/channel tuong ung.'}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-ink/35">
                      Retry: {item.provision_retry_count || 0}
                      {item.last_provisioned_at ? ` · Lan gan nhat ${formatDateTime(item.last_provisioned_at)}` : ''}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRetry(item.code)}
                    disabled={busyKey === retryKey}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone bg-white px-4 py-2 text-sm font-semibold text-ink/65 transition hover:bg-paper hover:text-ink disabled:opacity-40"
                  >
                    <Icon name="check" className="h-4 w-4" />
                    {busyKey === retryKey ? 'Dang retry...' : 'Retry'}
                  </button>
                </div>
              )
            }) : (
              <div className="px-5 py-10 text-center text-sm text-ink/35">
                Queue dang trong. Khong co doi nao can provision them.
              </div>
            )}
          </div>
        </section>

        <section className={`${CARD} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-stone px-5 py-3">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">
              Broadcast gan day
            </h3>
            <span className="font-mono text-xs text-ink/35">{broadcasts.length} muc</span>
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
                  Tao luc {formatDateTime(item.createdAt)}
                  {item.sentAt ? ` · Gui luc ${formatDateTime(item.sentAt)}` : ''}
                </p>
                {item.error && <p className="mt-2 text-xs leading-5 text-clay">{item.error}</p>}
              </div>
            )) : (
              <div className="px-5 py-10 text-center text-sm text-ink/35">
                Chua co broadcast nao duoc tao.
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
  const [filter, setFilter] = useState('all')
  const [selectedMember, setSelectedMember] = useState(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members.filter((member) => {
      if (filter === 'linked' && !member.linked) return false
      if (filter === 'unlinked' && member.linked) return false
      if (!q) return true
      return [
        member.fullName,
        member.mssv,
        member.teamCode,
        member.teamName,
        member.discordId,
      ].some(value => String(value || '').toLowerCase().includes(q))
    })
  }, [filter, members, search])

  const linkedCount = members.filter(member => member.linked).length
  const unlinkedCount = members.length - linkedCount

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-stone text-sm">
          {[
            { key: 'all', label: `Tat ca (${members.length})` },
            { key: 'linked', label: `Da lien ket (${linkedCount})` },
            { key: 'unlinked', label: `Chua lien ket (${unlinkedCount})` },
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
            placeholder="Tim theo MSSV, ten, doi..."
            className="w-full rounded-lg border border-stone bg-white py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-ink/25 transition focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10"
          />
        </div>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone bg-paper/70">
                <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Thanh vien</th>
                <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Doi</th>
                <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Discord</th>
                <th className="px-5 py-3 text-right font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Thao tac</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/60">
              {filtered.length > 0 ? filtered.map((member) => {
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
                          <Badge label="Da lien ket" cls="bg-trail/12 text-trail" />
                          <p className="mt-1 font-mono text-xs text-ink/35">{member.discordId}</p>
                        </div>
                      ) : (
                        <Badge label="Chua lien ket" cls="bg-clay/12 text-clay" />
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
                          {busyKey === syncKey ? 'Dang sync...' : 'Sync'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              }) : (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-sm text-ink/35">
                    Khong co thanh vien nao khop bo loc hien tai.
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
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink/35">Trang thai</p>
              <div className="mt-2">
                {selectedMember.linked
                  ? <Badge label="Da lien ket Discord" cls="bg-trail/12 text-trail" />
                  : <Badge label="Chua lien ket Discord" cls="bg-clay/12 text-clay" />}
              </div>
            </div>
            <div className="rounded-lg border border-stone p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-ink/35">Doi</p>
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
          { key: 'channels', label: 'Danh sach kenh' },
          { key: 'compose', label: 'Soan thong bao' },
          { key: 'history', label: 'Lich su' },
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
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Doi</th>
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Provision</th>
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Text channel</th>
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Voice channel</th>
                  <th className="px-5 py-3 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Members</th>
                  <th className="px-5 py-3 text-right font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Thao tac</th>
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
                              {busyKey === retryKey ? 'Dang retry...' : 'Retry'}
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
                              Nhac nhanh
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-ink/35">
                      Chua co doi nao trong he thong.
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
              <label className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Tieu de</label>
              <input
                type="text"
                value={composeForm.title}
                onChange={event => setComposeForm((current) => ({ ...current, title: event.target.value }))}
                className="w-full rounded-lg border border-stone bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink/25 transition focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10"
                placeholder="VD: Nhac lich check-in vong loai"
              />
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Noi dung</label>
              <textarea
                rows={5}
                value={composeForm.message}
                onChange={event => setComposeForm((current) => ({ ...current, message: event.target.value }))}
                className="w-full resize-y rounded-lg border border-stone bg-white px-4 py-3 text-sm leading-6 text-ink placeholder:text-ink/25 transition focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10"
                placeholder="Ho tro Markdown o phia Discord bot."
              />
            </div>

            <div>
              <label className="mb-2 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Gui den</label>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { key: 'all', label: 'Tat ca doi' },
                  { key: 'approved', label: 'Doi da duyet' },
                  { key: 'pending', label: 'Doi chua provision xong' },
                  { key: 'team_ids', label: 'Chon doi cu the' },
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
                <p className="mb-2 text-sm font-medium text-ink">Chon doi co channel de gui</p>
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
                    <p className="text-sm text-ink/35">Chua co doi nao san sang nhan thong bao theo kenh rieng.</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink/45">
                Broadcast hien tao ban nhap trong database; bot se doc queue nay de gui ve Discord.
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
                {busyKey === 'broadcast:create' ? 'Dang tao...' : 'Tao broadcast'}
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
                  Tao boi {item.sentBy || 'admin'} · {formatDateTime(item.createdAt)}
                  {item.sentAt ? ` · Sent ${formatDateTime(item.sentAt)}` : ''}
                </p>
                {item.error && <p className="mt-2 text-xs leading-5 text-clay">{item.error}</p>}
              </div>
            )) : (
              <div className="px-5 py-12 text-center text-sm text-ink/35">
                Chua co lich su broadcast.
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
  const [members, setMembers] = useState([])
  const [teams, setTeams] = useState([])
  const [broadcasts, setBroadcasts] = useState([])

  const loadDiscordData = useCallback(async () => {
    const [statusPayload, queuePayload, membersPayload, broadcastsPayload, teamsPayload] = await Promise.all([
      apiRequest('/discord/status'),
      apiRequest('/discord/provisioning-queue'),
      apiRequest('/discord/members'),
      apiRequest('/discord/broadcasts'),
      apiRequest('/teams?limit=200'),
    ])

    setStatus(statusPayload || { provisioning: { pending: 0, failed: 0, done: 0 } })
    setQueue(queuePayload?.queue || [])
    setMembers((membersPayload?.items || []).map(normalizeMember))
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
    members: members.length,
    channels: teams.length,
  }), [members.length, queue.length, teams.length])

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
          Dang tai du lieu Discord...
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
