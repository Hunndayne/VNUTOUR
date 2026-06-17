import { useState } from 'react'
import { Icon, CARD, Badge, PROVISION } from './ui.jsx'

// ─────────────────────────────────────────────────────────────────────
// Mock data
// ─────────────────────────────────────────────────────────────────────
const BOT_INFO = {
  name: 'VNUTour Bot',
  status: 'online', // online | offline | degraded
  version: '2.1.0',
  uptime: '3 ngày 7 giờ',
  server: 'VNUTour Official',
  memberCount: 256,
  serverIcon: 'V',
}

const PROVISIONING_QUEUE = [
  { id: 'T0003', name: 'Những chiến binh', status: 'pending', reason: 'Đội vừa được duyệt' },
  { id: 'T0004', name: 'Ice Breaker', status: 'pending', reason: 'Đội vừa được duyệt' },
  { id: 'T0006', name: 'Đội A - Avengers', status: 'error', reason: 'Không còn slot category — cần thêm category hoặc dọn kênh cũ' },
]

const ALL_CHANNELS = [
  { id: 'ch-1', teamId: 'T0001', teamName: 'Sky Walker', textChannel: 'sky-walker', textId: '1234567890', voiceChannel: 'sky-walker', voiceId: '1234567891', memberCount: 5, lastActive: '15:01 hôm nay' },
  { id: 'ch-2', teamId: 'T0002', teamName: 'Fire Phoenix', textChannel: 'fire-phoenix', textId: '1234567892', voiceChannel: 'fire-phoenix', voiceId: '1234567893', memberCount: 5, lastActive: '14:45 hôm nay' },
  { id: 'ch-3', teamId: 'T0005', teamName: 'Thunder', textChannel: 'thunder', textId: '1234567894', voiceChannel: 'thunder', voiceId: '1234567895', memberCount: 5, lastActive: '09:12 hôm nay' },
  { id: 'ch-4', teamId: 'T0009', teamName: 'Blue Ocean', textChannel: 'blue-ocean', textId: '1234567896', voiceChannel: 'blue-ocean', voiceId: '1234567897', memberCount: 5, lastActive: 'Hôm qua' },
  { id: 'ch-5', teamId: 'T0007', teamName: 'Predator', textChannel: 'predator', textId: '1234567898', voiceChannel: 'predator', voiceId: '1234567899', memberCount: 3, lastActive: '2 ngày trước' },
]

const MOCK_MEMBERS = [
  { discordId: '740123456789012345', discordName: 'maipnt', displayName: 'Mai 🏕️', accountUser: 'maipnt', teamId: 'T0007', teamName: 'Những chiến binh', roles: ['Những chiến binh', 'Member'], joinedAt: '12/06', isLinked: true },
  { discordId: '840987654321098765', discordName: 'ngocncm', displayName: 'Ngọc 📸', accountUser: 'ngocncm', teamId: 'T0008', teamName: 'Fire Phoenix', roles: ['Fire Phoenix', 'Member'], joinedAt: '13/06', isLinked: true },
  { discordId: '111111111111111111', discordName: 'hoangtu', displayName: 'Tú', accountUser: 'tuha', teamId: 'T0001', teamName: 'Sky Walker', roles: ['Sky Walker', 'Captain'], joinedAt: '10/06', isLinked: true },
  { discordId: '222222222222222222', discordName: 'trangdt', displayName: 'Trang', accountUser: 'trangdt', teamId: 'T0001', teamName: 'Sky Walker', roles: ['Sky Walker', 'Member'], joinedAt: '10/06', isLinked: true },
  { discordId: '333333333333333333', discordName: 'giabao', displayName: 'Bảo 🎮', accountUser: 'giabao', teamId: 'T0001', teamName: 'Sky Walker', roles: ['Sky Walker', 'Member'], joinedAt: '11/06', isLinked: true },
  { discordId: null, discordName: null, displayName: null, accountUser: 'ngoctt', teamId: 'T0007', teamName: 'Những chiến binh', roles: [], joinedAt: null, isLinked: false },
  { discordId: null, discordName: null, displayName: null, accountUser: 'hungnv', teamId: 'T0007', teamName: 'Những chiến binh', roles: [], joinedAt: null, isLinked: false },
]

const CATEGORIES = [
  { name: '🏕️ VNUTour Teams 1', channels: 8, slots: 12, teams: ['Sky Walker', 'Fire Phoenix', 'Thunder'] },
  { name: '🏕️ VNUTour Teams 2', channels: 6, slots: 12, teams: ['Blue Ocean', 'Predator'] },
]

const MOCK_BROADCAST_HISTORY = [
  { id: 1, title: 'Thông báo lịch check-in vòng loại', sentTo: 'Tất cả đội (28)', sentAt: '18/06 08:00', status: 'sent' },
  { id: 2, title: 'Nhắc nhở submit đội trước hạn', sentTo: 'Đội chưa submit (3)', sentAt: '17/06 20:00', status: 'sent' },
]

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────
const SUB_TABS = [
  { key: 'overview', label: 'Tổng quan', icon: 'grid' },
  { key: 'members', label: 'Thành viên', icon: 'userCircle' },
  { key: 'channels', label: 'Kênh & Tin nhắn', icon: 'chat' },
]

function SubTabBar({ active, onChange, counts }) {
  return (
    <div className={`${CARD} flex items-stretch overflow-hidden`}>
      {SUB_TABS.map((tab, i) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={`group relative flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm transition hover:bg-paper ${
            i > 0 ? 'border-l border-stone' : ''
          }`}
        >
          {active === tab.key && (
            <span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-trail" />
          )}
          <Icon name={tab.icon} className={`h-4 w-4 ${active === tab.key ? 'text-trail' : 'text-ink/35'}`} />
          <span className={`font-medium ${active === tab.key ? 'text-ink' : 'text-ink/50'}`}>{tab.label}</span>
          {counts && counts[tab.key] !== undefined && (
            <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
              active === tab.key ? 'bg-trail/15 text-trail' : 'bg-ink/5 text-ink/35'
            }`}>
              {counts[tab.key]}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Overview tab
// ─────────────────────────────────────────────────────────────────────
function OverviewTab() {
  const statusColors = { online: 'bg-trail', offline: 'bg-clay', degraded: 'bg-gold' }
  const statusLabels = { online: 'Online', offline: 'Offline', degraded: 'Suy giảm' }

  return (
    <div className="space-y-5">
      {/* Bot status header */}
      <div className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-trail/15 font-display text-xl font-bold text-trail">
                {BOT_INFO.serverIcon}
              </div>
              <span className={`absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full border-2 border-white ${statusColors[BOT_INFO.status]}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-ink">{BOT_INFO.name}</h2>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColors[BOT_INFO.status] === 'bg-trail' ? 'bg-trail/12 text-trail' : 'bg-clay/12 text-clay'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${statusColors[BOT_INFO.status]}`} />
                  {statusLabels[BOT_INFO.status]}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink/45">
                <span className="font-mono text-xs">{BOT_INFO.version}</span>
                <span className="mx-2 text-stone">·</span>
                Server: {BOT_INFO.server}
                <span className="mx-2 text-stone">·</span>
                Uptime: {BOT_INFO.uptime}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded-lg border border-stone bg-white px-4 py-2 text-sm font-medium text-ink/70 transition hover:bg-paper active:scale-[0.98]">
              Khởi động lại
            </button>
            <button type="button" className="rounded-lg bg-trail px-4 py-2 text-sm font-semibold text-white transition hover:bg-trail/90 active:scale-[0.98]">
              Đồng bộ tất cả
            </button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Đội đã đồng bộ', value: '28/42', sub: '14 đội chưa có kênh', tone: 'trail' },
          { label: 'Roles Discord', value: 30, sub: 'Tương ứng 30 đội', tone: 'gold' },
          { label: 'Kênh team', value: 58, sub: '29 text + 29 voice', tone: 'sky' },
          { label: 'Người trong server', value: BOT_INFO.memberCount, sub: '120 đã liên kết đội', tone: 'ink' },
        ].map((s, i) => (
          <div key={i} className={`${CARD} p-4`}>
            <p className="font-mono text-2xl font-semibold text-ink">{s.value}</p>
            <p className="mt-1 text-sm font-medium text-ink/70">{s.label}</p>
            <p className="mt-0.5 text-xs text-ink/40">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Provisioning queue + Categories */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Queue */}
        <div className={`${CARD} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-stone px-5 py-3">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">
              Hàng đợi đồng bộ
            </h3>
            <span className="font-mono text-xs text-ink/35">{PROVISIONING_QUEUE.length} đội</span>
          </div>
          <div className="divide-y divide-stone/60">
            {PROVISIONING_QUEUE.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink/30">Hàng đợi trống — tất cả đã được đồng bộ</p>
            ) : (
              PROVISIONING_QUEUE.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {item.status === 'error' ? (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-clay/12">
                        <Icon name="xmark" className="h-4 w-4 text-clay" />
                      </span>
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold/12">
                        <Icon name="clock" className="h-4 w-4 text-gold" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {item.name}
                        <span className="ml-1.5 font-mono text-xs text-ink/35">{item.id}</span>
                      </p>
                      <p className="truncate text-xs text-ink/40">{item.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'error' ? (
                      <button type="button" className="rounded-md px-3 py-1.5 text-xs font-semibold text-clay transition hover:bg-clay/8 active:scale-95">
                        Thử lại
                      </button>
                    ) : (
                      <Badge label="Đang chờ" cls="bg-gold/15 text-[#9A6B12]" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Categories */}
        <div className={`${CARD} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-stone px-5 py-3">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">
              Category Discord
            </h3>
            <button type="button" className="rounded-md px-2 py-1 text-xs font-medium text-trail transition hover:bg-trail/6">
              + Thêm
            </button>
          </div>
          <div className="divide-y divide-stone/60">
            {CATEGORIES.map((cat, i) => (
              <div key={i} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">{cat.name}</p>
                  <span className="font-mono text-xs text-ink/35">{cat.channels}/{cat.slots} kênh</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-paper">
                  <div
                    className={`h-full rounded-full transition-all ${cat.channels >= cat.slots ? 'bg-clay' : cat.channels / cat.slots > 0.7 ? 'bg-gold' : 'bg-trail'}`}
                    style={{ width: `${Math.round((cat.channels / cat.slots) * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-ink/35">
                  {cat.teams.slice(0, 3).join(', ')}{cat.teams.length > 3 ? ` +${cat.teams.length - 3}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Members tab
// ─────────────────────────────────────────────────────────────────────
function MembersTab() {
  const [search, setSearch] = useState('')
  const [linkFilter, setLinkFilter] = useState('all') // all | linked | unlinked
  const [selectedMember, setSelectedMember] = useState(null)

  const filtered = MOCK_MEMBERS.filter((m) => {
    if (linkFilter === 'linked' && !m.isLinked) return false
    if (linkFilter === 'unlinked' && m.isLinked) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      (m.discordName || '').toLowerCase().includes(q) ||
      (m.displayName || '').toLowerCase().includes(q) ||
      (m.accountUser || '').toLowerCase().includes(q) ||
      (m.teamName || '').toLowerCase().includes(q)
    )
  })

  const linkedCount = MOCK_MEMBERS.filter(m => m.isLinked).length
  const unlinkedCount = MOCK_MEMBERS.filter(m => !m.isLinked).length

  return (
    <div className="space-y-5">
      {/* Filter + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-stone overflow-hidden text-sm">
          {[
            { key: 'all', label: `Tất cả (${MOCK_MEMBERS.length})` },
            { key: 'linked', label: `Đã liên kết (${linkedCount})`, dot: 'bg-trail' },
            { key: 'unlinked', label: `Chưa liên kết (${unlinkedCount})`, dot: 'bg-clay' },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setLinkFilter(f.key)}
              className={`flex items-center gap-1.5 px-3.5 py-2 transition ${
                linkFilter === f.key
                  ? 'bg-ink/6 font-semibold text-ink'
                  : 'text-ink/50 hover:bg-paper'
              } ${f.key !== 'all' ? 'border-l border-stone' : ''}`}
            >
              {f.dot && <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />}
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/25">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            type="text" placeholder="Tìm thành viên..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-stone bg-white py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-ink/25 transition focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10"
          />
        </div>
      </div>

      {/* List */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone bg-paper/70">
                <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Discord</th>
                <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Tài khoản Web</th>
                <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Đội</th>
                <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 hidden md:table-cell">Roles</th>
                <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 hidden md:table-cell">Tham gia</th>
                <th className="px-5 py-3 text-right font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/60">
              {filtered.map((m, i) => (
                <tr key={i} className="transition hover:bg-paper/50">
                  <td className="px-5 py-3.5">
                    {m.isLinked ? (
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-trail/15 font-display text-xs font-bold text-trail">
                          {(m.displayName || m.discordName || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{m.displayName || m.discordName}</p>
                          <p className="font-mono text-xs text-ink/35">{m.discordName}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-clay/10 font-display text-xs font-bold text-clay/60">
                          ?
                        </div>
                        <span className="text-sm text-ink/30 italic">Chưa liên kết</span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-ink/70">{m.accountUser}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm text-ink/60">{m.teamName || '—'}</span>
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {m.roles.map((r, j) => (
                        <span key={j} className="rounded-md bg-trail/8 px-2 py-0.5 font-mono text-[11px] text-trail">{r}</span>
                      ))}
                      {m.roles.length === 0 && <span className="text-ink/25">—</span>}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-ink/35 hidden md:table-cell">
                    {m.joinedAt || '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1">
                      {m.isLinked ? (
                        <>
                          <button type="button" className="rounded-md p-1.5 text-ink/25 transition hover:bg-trail/8 hover:text-trail" title="Đồng bộ lại roles">
                            <Icon name="check" className="h-4 w-4" />
                          </button>
                          <button type="button" className="rounded-md p-1.5 text-ink/25 transition hover:bg-clay/8 hover:text-clay" title="Gỡ liên kết Discord">
                            <Icon name="xmark" className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <button type="button" className="rounded-md px-3 py-1.5 text-xs font-semibold text-trail transition hover:bg-trail/8 active:scale-95">
                          Liên kết
                        </button>
                      )}
                      <button type="button" className="rounded-md p-1.5 text-ink/25 transition hover:bg-paper hover:text-ink/55" title="Xem chi tiết"
                        onClick={() => setSelectedMember(selectedMember?.accountUser === m.accountUser ? null : m)}>
                        <Icon name="chevronR" className={`h-4 w-4 transition ${selectedMember?.accountUser === m.accountUser ? 'rotate-90' : ''}`} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Member detail panel */}
      {selectedMember && (
        <div className={`${CARD} p-5 animate-[fadeIn_0.15s_ease-out]`}>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-display text-lg font-semibold text-ink">{selectedMember.accountUser}</h3>
              <p className="mt-1 font-mono text-xs text-ink/40">
                {selectedMember.isLinked
                  ? `Discord: ${selectedMember.discordName} (ID: ${selectedMember.discordId})`
                  : 'Chưa liên kết tài khoản Discord'}
              </p>
            </div>
            <button type="button" onClick={() => setSelectedMember(null)} className="rounded-lg p-1.5 text-ink/25 transition hover:bg-paper hover:text-ink/55">
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>
          {selectedMember.isLinked && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-stone p-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink/35">Roles Discord</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedMember.roles.map((r, j) => (
                    <span key={j} className="rounded-md bg-trail/8 px-2 py-0.5 font-mono text-[11px] text-trail">{r}</span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-stone p-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink/35">Đội</p>
                <p className="mt-2 text-sm text-ink">{selectedMember.teamName}</p>
              </div>
              <div className="rounded-lg border border-stone p-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink/35">Tham gia server</p>
                <p className="mt-2 text-sm text-ink">{selectedMember.joinedAt || '—'}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Channels & Broadcast tab
// ─────────────────────────────────────────────────────────────────────
function ChannelsTab() {
  const [broadcastTab, setBroadcastTab] = useState('channels') // channels | compose | history
  const [composeForm, setComposeForm] = useState({ title: '', message: '', target: 'all', teamIds: [] })
  const [sent, setSent] = useState(false)

  const handleSend = () => {
    if (!composeForm.title.trim() || !composeForm.message.trim()) return
    setSent(true)
    setTimeout(() => {
      setSent(false)
      setComposeForm({ title: '', message: '', target: 'all', teamIds: [] })
      setBroadcastTab('history')
    }, 1200)
  }

  const targetLabels = {
    all: 'Tất cả đội đã có kênh',
    approved: 'Đội đã duyệt',
    pending: 'Đội chưa submit',
    custom: 'Chọn đội cụ thể',
  }

  return (
    <div className="space-y-5">
      {/* Sub-tabs for channels/compose */}
      <div className="flex rounded-lg border border-stone overflow-hidden w-fit text-sm">
        {[
          { key: 'channels', label: 'Danh sách kênh' },
          { key: 'compose', label: 'Soạn tin nhắn' },
          { key: 'history', label: 'Lịch sử gửi' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setBroadcastTab(t.key)}
            className={`px-4 py-2 transition ${
              broadcastTab === t.key
                ? 'bg-trail/10 font-semibold text-trail'
                : 'text-ink/50 hover:bg-paper'
            } ${t.key !== 'channels' ? 'border-l border-stone' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {broadcastTab === 'channels' && (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone bg-paper/70">
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Đội</th>
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Text channel</th>
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Voice channel</th>
                  <th className="px-5 py-3 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Members</th>
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 hidden md:table-cell">Hoạt động</th>
                  <th className="px-5 py-3 text-right font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone/60">
                {ALL_CHANNELS.map((ch) => (
                  <tr key={ch.id} className="transition hover:bg-paper/50">
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-medium text-ink">{ch.teamName}</span>
                      <span className="ml-1.5 font-mono text-xs text-ink/35">{ch.teamId}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-trail">
                        <Icon name="listBullet" className="h-3.5 w-3.5" />
                        #{ch.textChannel}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink/50">
                        <span role="img" aria-label="voice">🔊</span>
                        {ch.voiceChannel}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="font-mono text-xs font-semibold text-ink/60">{ch.memberCount}/5</span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-ink/35 hidden md:table-cell">{ch.lastActive}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" className="rounded-md p-1.5 text-ink/25 transition hover:bg-trail/8 hover:text-trail" title="Gửi tin nhắn vào kênh"
                          onClick={() => { setComposeForm(f => ({ ...f, target: 'custom', teamIds: [ch.teamId] })); setBroadcastTab('compose') }}>
                          <Icon name="chat" className="h-4 w-4" />
                        </button>
                        <button type="button" className="rounded-md p-1.5 text-ink/25 transition hover:bg-paper hover:text-ink/55" title="Xoá kênh">
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {broadcastTab === 'compose' && (
        <div className={`${CARD} p-5`}>
          {sent ? (
            <div className="flex flex-col items-center py-12">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-trail/15">
                <Icon name="checkPlain" className="h-7 w-7 text-trail" />
              </span>
              <p className="mt-4 font-display text-lg font-semibold text-ink">Đã gửi!</p>
              <p className="mt-1 text-sm text-ink/45">Tin nhắn đang được gửi đến các kênh đã chọn</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 mb-1.5">Tiêu đề</label>
                <input
                  type="text" placeholder="VD: Thông báo lịch check-in vòng loại"
                  value={composeForm.title} onChange={e => setComposeForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full rounded-lg border border-stone bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink/25 transition focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10"
                />
              </div>

              <div>
                <label className="block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 mb-1.5">Nội dung</label>
                <textarea
                  rows={5} placeholder="Nhập nội dung tin nhắn... (hỗ trợ Markdown)"
                  value={composeForm.message} onChange={e => setComposeForm(f => ({ ...f, message: e.target.value }))}
                  className="w-full rounded-lg border border-stone bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/25 transition focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10 resize-y"
                />
              </div>

              <div>
                <label className="block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 mb-2">Gửi đến</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { key: 'all', icon: 'chat' },
                    { key: 'approved', icon: 'check' },
                    { key: 'pending', icon: 'clock' },
                    { key: 'custom', icon: 'pin' },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setComposeForm(f => ({ ...f, target: opt.key }))}
                      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                        composeForm.target === opt.key
                          ? 'border-trail/40 bg-trail/6'
                          : 'border-stone hover:bg-paper'
                      }`}
                    >
                      <Icon name={opt.icon} className={`h-4 w-4 ${composeForm.target === opt.key ? 'text-trail' : 'text-ink/30'}`} />
                      <div>
                        <p className={`text-sm font-medium ${composeForm.target === opt.key ? 'text-ink' : 'text-ink/60'}`}>
                          {targetLabels[opt.key]}
                        </p>
                        {opt.key === 'custom' && composeForm.target === 'custom' && composeForm.teamIds.length > 0 && (
                          <p className="mt-0.5 font-mono text-xs text-trail">{composeForm.teamIds.length} đội đã chọn</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
                {composeForm.target === 'custom' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {ALL_CHANNELS.map(ch => {
                      const selected = composeForm.teamIds.includes(ch.teamId)
                      return (
                        <button
                          key={ch.teamId}
                          type="button"
                          onClick={() => setComposeForm(f => ({
                            ...f,
                            teamIds: selected
                              ? f.teamIds.filter(id => id !== ch.teamId)
                              : [...f.teamIds, ch.teamId]
                          }))}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                            selected
                              ? 'bg-trail/15 text-trail border border-trail/30'
                              : 'bg-paper text-ink/50 border border-stone hover:border-stone/80'
                          }`}
                        >
                          {ch.teamName}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!composeForm.title.trim() || !composeForm.message.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-trail px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-trail/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Icon name="chat" className="h-4 w-4" />
                  Gửi tin nhắn
                </button>
                <span className="font-mono text-xs text-ink/30">
                  {composeForm.target === 'all' ? '→ 28 kênh'
                    : composeForm.target === 'approved' ? '→ 28 kênh'
                    : composeForm.target === 'pending' ? '→ 3 kênh'
                    : composeForm.teamIds.length > 0 ? `→ ${composeForm.teamIds.length} kênh`
                    : '→ chưa chọn đội'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {broadcastTab === 'history' && (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone bg-paper/70">
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Tiêu đề</th>
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Gửi đến</th>
                  <th className="px-5 py-3 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Thời gian</th>
                  <th className="px-5 py-3 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone/60">
                {MOCK_BROADCAST_HISTORY.map((item) => (
                  <tr key={item.id} className="transition hover:bg-paper/50">
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-medium text-ink">{item.title}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-ink/55">{item.sentTo}</span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-ink/35">{item.sentAt}</td>
                    <td className="px-5 py-3.5 text-center">
                      <Badge label="Đã gửi" cls="bg-trail/10 text-trail" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
export default function DiscordPage() {
  const [subTab, setSubTab] = useState('overview')

  const counts = {
    overview: PROVISIONING_QUEUE.filter(q => q.status === 'pending').length,
    members: MOCK_MEMBERS.length,
    channels: ALL_CHANNELS.length,
  }

  return (
    <div className="space-y-5">
      <SubTabBar active={subTab} onChange={setSubTab} counts={counts} />

      {subTab === 'overview' && <OverviewTab />}
      {subTab === 'members' && <MembersTab />}
      {subTab === 'channels' && <ChannelsTab />}
    </div>
  )
}
