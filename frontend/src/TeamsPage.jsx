import { useMemo, useState } from 'react'
import { Icon, CARD, APPROVAL, PROVISION, Badge } from './ui.jsx'

// ──────────────────────────────────────────────────────────────
// Mock data — sẽ thay bằng API
// ──────────────────────────────────────────────────────────────
const mem = (mssv, name, faculty, hasAccount, isCaptain = false, phone = null, email = null, discord = null) => ({
  mssv, name, faculty, hasAccount, isCaptain,
  phone, email, discordId: discord,
})

const INITIAL_TEAMS = [
  {
    id: 'T0007', name: 'Những chiến binh', owner: 'tranthanhhung',
    status: 'pending_approval', provision: 'none', submittedAt: '14:32 · 17/06',
    members: [
      mem('25521072', 'Phạm Nguyễn Thanh Mai', 'CNPM',  true,  true,  '0901 234 567', 'mai.pnt@gmail.com',  '740123456789012345'),
      mem('25521089', 'Lê Quốc Bảo',           'KHMT',  true,  false, '0912 345 678', 'bao.lq@gmail.com',   null),
      mem('25521144', 'Trần Thị Ngọc',          'HTTT',  false, false, null,           'ngoc.tt@gmail.com',  null),
      mem('25521210', 'Nguyễn Văn Hùng',        'CNPM',  false, false, '0934 567 890', null,                 null),
    ],
  },
  {
    id: 'T0008', name: 'Fire Phoenix', owner: 'baolq',
    status: 'pending_approval', provision: 'none', submittedAt: '08:45 · 17/06',
    members: [
      mem('2556110126', 'Nguyễn Châu Mỹ Ngọc', 'Đông Phương Học', true,  true,  null,           'ngoc.ncm@gmail.com', '840987654321098765'),
      mem('2556110200', 'Đỗ Minh Quân',         'Báo chí',         true,  false, '0945 678 901', null,                 null),
      mem('2556110301', 'Vũ Thanh Hà',           'Tâm lý',          false, false, null,           null,                 null),
    ],
  },
  {
    id: 'T0001', name: 'Sky Walker', owner: 'skywalker',
    status: 'approved', provision: 'done', submittedAt: '12/06',
    members: [
      mem('22520001', 'Hoàng Anh Tú',    'KHMT', true, true,  '0901 111 222', 'tu.ha@vnu.edu.vn',    '111111111111111111'),
      mem('22520044', 'Đặng Thu Trang',  'CNPM', true, false, null,           'trang.dt@vnu.edu.vn', '222222222222222222'),
      mem('22520120', 'Phan Gia Bảo',    'ATTT', true, false, '0923 345 678', null,                  '333333333333333333'),
      mem('22520155', 'Lý Khánh Vy',     'HTTT', true, false, null,           'vy.lk@vnu.edu.vn',    null),
      mem('22520199', 'Mai Tiến Đạt',    'KTMT', true, false, '0934 456 789', null,                  '444444444444444444'),
    ],
  },
  {
    id: 'T0002', name: 'Ice Breaker', owner: 'icebreaker',
    status: 'approved', provision: 'pending', submittedAt: '12/06',
    members: [
      mem('22520301', 'Trịnh Văn Khoa', 'CNPM', true,  true,  '0934 567 890', 'khoa.tv@vnu.edu.vn', null),
      mem('22520355', 'Bùi Thị Lan',    'KHMT', false, false, null,           null,                  null),
    ],
  },
  {
    id: 'T0009', name: 'Đội chưa đặt tên', owner: 'newcaptain',
    status: 'draft', provision: 'none', submittedAt: '—',
    members: [
      mem('25530010', 'Nguyễn Văn A', 'CNPM', true, true, null, null, null),
    ],
  },
  {
    id: 'T0006', name: 'Team trùng tên', owner: 'dupteam',
    status: 'rejected', provision: 'none', submittedAt: '13:58 · 17/06',
    note: 'Tên đội trùng với một đội đã đăng ký trước. Vui lòng đổi tên và gửi lại.',
    members: [
      mem('25521400', 'Lê Hoàng Long', 'KTPM', true, true, '0956 789 012', 'long.lh@gmail.com', '555555555555555555'),
    ],
  },
]

// Pool người đã đăng ký tài khoản nhưng chưa có đội
const REGISTERED_POOL = [
  mem('25591001', 'Nguyễn Hoàng Phúc', 'CNPM', true, false, '0978 111 222', 'phuc.nh@vnu.edu.vn', null),
  mem('25591002', 'Trần Minh Khang',   'KHMT', true, false, '0978 222 333', 'khang.tm@vnu.edu.vn', '666666666666666666'),
  mem('25591003', 'Lê Thị Mai Anh',    'HTTT', true, false, '0978 333 444', 'anh.ltm@vnu.edu.vn', null),
  mem('25591004', 'Võ Thanh Tùng',     'KTMT', true, false, '0978 444 555', 'tung.vt@vnu.edu.vn', '777777777777777777'),
  mem('25591005', 'Đỗ Hải Yến',        'ATTT', true, false, null,           'yen.dh@vnu.edu.vn', null),
  mem('25591006', 'Bùi Quốc Đạt',      'KTPM', true, false, '0978 555 666', 'dat.bq@vnu.edu.vn', '888888888888888888'),
  mem('25591007', 'Huỳnh Ngọc Trâm',   'CNPM', true, false, '0978 666 777', 'tram.hn@vnu.edu.vn', null),
  mem('25591008', 'Phan Thanh Sơn',    'KHMT', true, false, null,           'son.pt@vnu.edu.vn', '999999999999999999'),
]

const FILTERS = [
  { key: 'all',              label: 'Tất cả'    },
  { key: 'pending_approval', label: 'Chờ duyệt' },
  { key: 'approved',         label: 'Đã duyệt'  },
  { key: 'draft',            label: 'Nháp'       },
  { key: 'rejected',         label: 'Từ chối'   },
]

// ──────────────────────────────────────────────────────────────
// Màu dải trái — encode trạng thái liên kết của thành viên
// ──────────────────────────────────────────────────────────────
function memberStripCls(m) {
  if (m.hasAccount && m.discordId) return 'bg-trail'         // đầy đủ
  if (m.hasAccount)                return 'bg-[#3E7CA8]'    // chỉ TK web
  if (m.discordId)                 return 'bg-[#5865F2]'    // chỉ Discord
  return 'bg-stone'                                          // chưa liên kết
}

// ──────────────────────────────────────────────────────────────
// Thẻ thành viên — toàn bộ thông tin
// ──────────────────────────────────────────────────────────────
function MemberCard({ m }) {
  const strip = memberStripCls(m)
  return (
    <div className="flex">
      <div className={`w-[3px] shrink-0 ${strip}`} />
      <div className="min-w-0 flex-1 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          {/* Tên + MSSV + Khoa */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold text-ink">
                {m.name || '(Chưa điền tên)'}
              </span>
              {m.isCaptain && (
                <Badge label="Đội trưởng" cls="bg-gold/15 text-[#9A6B12]" />
              )}
            </div>
            <p className="mt-0.5 font-mono text-xs text-ink/50">
              {m.mssv}
              {m.faculty && <> · {m.faculty}</>}
            </p>
            {(m.email || m.phone) && (
              <p className="mt-1 text-[11px] text-ink/40 leading-relaxed">
                {m.email && <span className="mr-3">{m.email}</span>}
                {m.phone && <span>{m.phone}</span>}
              </p>
            )}
          </div>

          {/* Trạng thái */}
          <div className="shrink-0 flex flex-col items-end gap-1 pt-0.5">
            <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${m.hasAccount ? 'text-trail' : 'text-ink/30'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${m.hasAccount ? 'bg-trail' : 'bg-ink/20'}`} />
              {m.hasAccount ? 'Có TK web' : 'Chưa có TK'}
            </span>
            <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${m.discordId ? 'text-[#5865F2]' : 'text-ink/25'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${m.discordId ? 'bg-[#5865F2]' : 'bg-ink/15'}`} />
              {m.discordId ? 'Discord ✓' : 'Discord —'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Drawer — chi tiết đội
// ──────────────────────────────────────────────────────────────
function TeamDrawer({ team, onClose, onApprove, onReject, onAddMember, availablePool }) {
  // 'idle' | 'confirming' | 'rejecting'
  const [mode, setMode] = useState('idle')
  const [note, setNote] = useState('')
  const [showAddMember, setShowAddMember] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')

  if (!team) return null

  const canAct = team.status === 'pending_approval'
  const withAccount = team.members.filter(m => m.hasAccount).length
  const withDiscord  = team.members.filter(m => m.discordId).length

  const confirmApprove = () => { onApprove(team.id); setMode('idle') }
  const confirmReject  = () => { onReject(team.id, note); setNote(''); setMode('idle') }
  const cancel         = () => { setMode('idle'); setNote('') }

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[440px] flex-col border-l border-stone bg-paper shadow-2xl">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 border-b border-stone bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-ink/40">{team.id}</span>
              <Badge {...APPROVAL[team.status]} />
              {team.provision && team.provision !== 'none' && (
                <Badge {...(PROVISION[team.provision] ?? PROVISION.none)} />
              )}
            </div>
            <h2 className="mt-1 truncate font-display text-xl font-bold text-ink">
              {team.name}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
              <span className="text-sm text-ink/50">
                Đội trưởng: <span className="font-medium text-ink/70">{team.owner}</span>
              </span>
              {team.submittedAt !== '—' && (
                <span className="font-mono text-xs text-ink/35">Gửi {team.submittedAt}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-ink/40 transition hover:bg-paper hover:text-ink"
          >
            <Icon name="close" />
          </button>
        </div>

        {/* ── Body — luôn hiển thị, scroll được kể cả khi form đang mở ── */}
        <div className="flex-1 overflow-y-auto">

          {/* Lý do từ chối */}
          {team.status === 'rejected' && team.note && (
            <div className="mx-4 mt-4 rounded-lg border border-clay/25 bg-clay/[0.05] px-3.5 py-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-clay/60 mb-1">
                Lý do từ chối
              </p>
              <p className="text-sm text-clay">{team.note}</p>
            </div>
          )}

          {/* Thống kê nhanh */}
          <div className="grid grid-cols-3 gap-2 px-4 py-4">
            <QuickStat label="Thành viên" value={String(team.members.length)} />
            <QuickStat
              label="Có TK web"
              value={`${withAccount}/${team.members.length}`}
              done={withAccount === team.members.length && team.members.length > 0}
            />
            <QuickStat
              label="Discord"
              value={String(withDiscord)}
              done={withDiscord > 0}
              accent="discord"
            />
          </div>

          {/* Danh sách thành viên */}
          <div className="px-4 pb-5">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">
              Thành viên
            </p>
            <div className={`${CARD} overflow-hidden divide-y divide-stone/50`}>
              {team.members.length > 0
                ? team.members.map(m => <MemberCard key={m.mssv} m={m} />)
                : (
                  <p className="px-4 py-5 text-sm text-ink/30 italic">
                    Đội chưa có thành viên.
                  </p>
                )
              }
            </div>

            {/* Chú giải dải màu */}
            <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1">
              {[
                { cls: 'bg-trail',      label: 'TK web + Discord'  },
                { cls: 'bg-[#3E7CA8]', label: 'Chỉ TK web'        },
                { cls: 'bg-[#5865F2]', label: 'Chỉ Discord'        },
                { cls: 'bg-stone',     label: 'Chưa liên kết'      },
              ].map(({ cls, label }) => (
                <span key={label} className="inline-flex items-center gap-2 text-[10px] text-ink/40">
                  <span className={`inline-block h-3.5 w-[3px] rounded-full ${cls}`} />
                  {label}
                </span>
              ))}
            </div>

            {/* Add member — pick from registered pool (only for approved teams) */}
            {team.status === 'approved' && (
              <div className="mt-4 border-t border-stone pt-4">
                {!showAddMember ? (
                  <button
                    type="button"
                    onClick={() => { setShowAddMember(true); setMemberSearch('') }}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-stone px-4 py-3 text-sm font-medium text-ink/45 transition hover:border-trail/30 hover:text-trail"
                  >
                    <Icon name="plus" className="h-4 w-4" />
                    Thêm thành viên
                  </button>
                ) : (
                  <div className="space-y-3 rounded-lg border border-stone bg-white p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">
                        Người đã đăng ký chưa có đội
                      </p>
                      <button type="button" onClick={() => setShowAddMember(false)}
                        className="rounded-md p-1 text-ink/30 transition hover:text-ink/60">
                        <Icon name="close" className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Search */}
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30">
                        <Icon name="search" className="h-3.5 w-3.5" />
                      </span>
                      <input
                        type="text" placeholder="Tìm theo tên hoặc MSSV..."
                        value={memberSearch}
                        onChange={e => setMemberSearch(e.target.value)}
                        className="w-full rounded-lg border border-stone bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink/25 outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
                      />
                    </div>

                    {/* Pool list */}
                    <div className="max-h-52 space-y-1 overflow-y-auto">
                      {(() => {
                        const q = memberSearch.trim().toLowerCase()
                        const filtered = availablePool.filter(p =>
                          !q || p.mssv.includes(q) || (p.name || '').toLowerCase().includes(q)
                        )
                        if (filtered.length === 0) {
                          return (
                            <p className="py-4 text-center text-xs text-ink/30">
                              {availablePool.length === 0
                                ? 'Tất cả người đã đăng ký đều đã có đội.'
                                : 'Không tìm thấy người phù hợp.'}
                            </p>
                          )
                        }
                        return filtered.map(p => (
                          <button
                            key={p.mssv}
                            type="button"
                            onClick={() => { onAddMember(team.id, p); setShowAddMember(false) }}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-trail/[0.06]"
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-trail/12 font-display text-xs font-bold text-trail">
                              {(p.name || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                              <p className="font-mono text-xs text-ink/35">{p.mssv}{p.faculty ? ` · ${p.faculty}` : ''}</p>
                            </div>
                            <span className="shrink-0 rounded-full bg-trail/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-trail">
                              Có TK
                            </span>
                          </button>
                        ))
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer — duyệt / từ chối ── */}
        {canAct && (
          <div className="border-t border-stone bg-white">

            {/* Mặc định */}
            {mode === 'idle' && (
              <div className="flex gap-2 px-4 py-4">
                <button
                  type="button"
                  onClick={() => setMode('rejecting')}
                  className="flex items-center gap-1.5 rounded-lg border border-clay/30 bg-white px-4 py-2.5 text-sm font-semibold text-clay transition hover:bg-clay/[0.04]"
                >
                  <Icon name="xmark" className="h-4 w-4" />
                  Từ chối
                </button>
                <button
                  type="button"
                  onClick={() => setMode('confirming')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-trail px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96]"
                >
                  <Icon name="checkPlain" className="h-4 w-4" />
                  Duyệt đội
                </button>
              </div>
            )}

            {/* Bước xác nhận duyệt */}
            {mode === 'confirming' && (
              <div className="space-y-3 px-4 py-4">
                <div className="rounded-lg border border-trail/25 bg-trail/[0.06] px-4 py-3">
                  <p className="text-sm font-semibold text-ink">
                    Xác nhận duyệt đội?
                  </p>
                  <p className="mt-0.5 text-xs text-ink/55">
                    <span className="font-medium text-ink">{team.name}</span>
                    {' '}· {team.members.length} thành viên
                    · sẽ được thêm vào hàng đợi tạo kênh Discord.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancel}
                    className="flex-1 rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper"
                  >
                    Quay lại
                  </button>
                  <button
                    type="button"
                    onClick={confirmApprove}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-trail py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96]"
                  >
                    <Icon name="checkPlain" className="h-4 w-4" />
                    Xác nhận duyệt
                  </button>
                </div>
              </div>
            )}

            {/* Nhập lý do từ chối — body phía trên vẫn scroll được */}
            {mode === 'rejecting' && (
              <div className="space-y-3 px-4 py-4">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
                    Lý do từ chối · gửi cho đội trưởng
                  </label>
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder="Mô tả cụ thể để đội trưởng có thể chỉnh sửa và gửi lại…"
                    className="w-full resize-none rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink placeholder:text-ink/30 outline-none transition focus:border-clay/40 focus:ring-2 focus:ring-clay/10"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancel}
                    className="flex-1 rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper"
                  >
                    Quay lại
                  </button>
                  <button
                    type="button"
                    onClick={confirmReject}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-clay py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96]"
                  >
                    <Icon name="xmark" className="h-4 w-4" />
                    Xác nhận từ chối
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

function QuickStat({ label, value, done = false, accent }) {
  const valCls = accent === 'discord'
    ? (done ? 'text-[#5865F2]' : 'text-ink/50')
    : (done ? 'text-trail'     : 'text-ink/50')
  return (
    <div className={`${CARD} px-3 py-2.5`}>
      <p className={`font-mono text-lg font-bold leading-none ${valCls}`}>{value}</p>
      <p className="mt-1 text-[11px] text-ink/40">{label}</p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Trang chính
// ──────────────────────────────────────────────────────────────
function TeamsPage() {
  const [teams, setTeams]     = useState(INITIAL_TEAMS)
  const [filter, setFilter]   = useState('all')
  const [query, setQuery]     = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', owner: '' })
  const [availablePool, setAvailablePool] = useState(REGISTERED_POOL)

  const counts = useMemo(() => {
    const c = { all: teams.length }
    for (const t of teams) c[t.status] = (c[t.status] || 0) + 1
    return c
  }, [teams])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return teams.filter(t => {
      if (filter !== 'all' && t.status !== filter) return false
      if (q && !(`${t.name} ${t.id} ${t.owner}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [teams, filter, query])

  const selected = teams.find(t => t.id === selectedId) ?? null

  const handleApprove = (id) => {
    setTeams(prev => prev.map(t =>
      t.id === id ? { ...t, status: 'approved', provision: 'pending', note: undefined } : t
    ))
    setSelectedId(null)
  }

  const handleReject = (id, note) => {
    setTeams(prev => prev.map(t =>
      t.id === id ? { ...t, status: 'rejected', note: note || 'Không đạt yêu cầu.', provision: 'none' } : t
    ))
    setSelectedId(null)
  }

  const handleCreateTeam = () => {
    const name = createForm.name.trim()
    const owner = createForm.owner.trim()
    if (!name || !owner) return
    const nextNum = teams.length + 1
    const newId = `T${String(nextNum).padStart(4, '0')}`
    setTeams(prev => [...prev, {
      id: newId, name, owner,
      status: 'draft', provision: 'none', submittedAt: '—',
      members: [],
    }])
    setCreateForm({ name: '', owner: '' })
    setShowCreate(false)
  }

  const handleAddMember = (teamId, member) => {
    setTeams(prev => prev.map(t => {
      if (t.id !== teamId) return t
      const alreadyIn = t.members.some(m => m.mssv === member.mssv)
      if (alreadyIn) return t
      return { ...t, members: [...t.members, { ...member }] }
    }))
    setAvailablePool(prev => prev.filter(p => p.mssv !== member.mssv))
  }

  return (
    <div className="space-y-4">

      {/* ── Toolbar ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Filter pills */}
        <div className="flex flex-wrap gap-1 rounded-xl border border-stone bg-white p-1">
          {FILTERS.map(f => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active ? 'bg-ink text-white' : 'text-ink/55 hover:bg-paper hover:text-ink'
                }`}
              >
                {f.label}
                <span className={`font-mono text-xs ${active ? 'text-white/70' : 'text-ink/30'}`}>
                  {counts[f.key] ?? 0}
                </span>
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Tìm theo tên đội, mã đội, đội trưởng…"
            className="w-full rounded-lg border border-stone bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 lg:w-72"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/85 active:scale-[0.98]"
        >
          <Icon name="plus" className="h-4 w-4" />
          Tạo đội mới
        </button>
      </div>

      {/* ── Bảng đội ── */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead>
              <tr className="border-b border-stone font-mono text-[10px] uppercase tracking-wider text-ink/35">
                <th className="px-4 py-3 font-medium">Mã đội</th>
                <th className="px-4 py-3 font-medium">Tên đội</th>
                <th className="px-4 py-3 font-medium">Đội trưởng</th>
                <th className="px-4 py-3 font-medium text-center">TV</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 font-medium">Discord</th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/60">
              {rows.map(t => (
                <tr
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`cursor-pointer transition hover:bg-paper/70 ${selectedId === t.id ? 'bg-paper/60' : ''}`}
                >
                  <td className="px-4 py-3.5 font-mono text-sm text-ink/55">{t.id}</td>
                  <td className="px-4 py-3.5 text-sm font-medium text-ink">{t.name}</td>
                  <td className="px-4 py-3.5 text-sm text-ink/60">{t.owner}</td>
                  <td className="px-4 py-3.5 text-center font-mono text-sm text-ink/55">{t.members.length}</td>
                  <td className="px-4 py-3.5"><Badge {...APPROVAL[t.status]} /></td>
                  <td className="px-4 py-3.5"><Badge {...(PROVISION[t.provision] ?? PROVISION.none)} /></td>
                  <td className="px-4 py-3.5 text-ink/25">
                    <Icon name="chevronR" className="h-4 w-4" />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-sm text-ink/35">
                    Không có đội nào khớp bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer — key = selectedId để reset state khi đổi đội */}
      <TeamDrawer
        key={selectedId}
        team={selected}
        onClose={() => setSelectedId(null)}
        onApprove={handleApprove}
        onReject={handleReject}
        onAddMember={handleAddMember}
        availablePool={availablePool}
      />

      {/* Create team slide-in panel */}
      {showCreate && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={() => setShowCreate(false)} />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-stone bg-paper shadow-2xl animate-[fadeIn_0.15s_ease-out]">
            <div className="flex items-start justify-between gap-3 border-b border-stone bg-white px-5 py-4">
              <div>
                <h2 className="font-display text-xl font-bold text-ink">Tạo đội mới</h2>
                <p className="mt-0.5 text-sm text-ink/45">Mã đội sẽ được sinh tự động</p>
              </div>
              <button type="button" onClick={() => setShowCreate(false)}
                className="shrink-0 rounded-lg p-1.5 text-ink/40 transition hover:bg-paper hover:text-ink">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 mb-1">Tên đội *</label>
                <input type="text" placeholder="Nhập tên đội" value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/25 focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
              </div>
              <div>
                <label className="block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 mb-1">Đội trưởng (username) *</label>
                <input type="text" placeholder="Username của đội trưởng" value={createForm.owner}
                  onChange={e => setCreateForm(f => ({ ...f, owner: e.target.value }))}
                  className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/25 focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
              </div>
              <div className="rounded-lg border border-stone bg-paper/50 px-4 py-3">
                <p className="text-xs text-ink/40">Thành viên có thể được thêm sau khi tạo đội, trong trang chi tiết đội.</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-stone bg-white px-5 py-4">
              <button type="button" onClick={() => setShowCreate(false)}
                className="rounded-lg border border-stone bg-white px-4 py-2 text-sm font-medium text-ink/60 transition hover:bg-paper">
                Hủy
              </button>
              <button type="button" onClick={handleCreateTeam}
                disabled={!createForm.name.trim() || !createForm.owner.trim()}
                className="rounded-lg bg-trail px-5 py-2 text-sm font-semibold text-white transition hover:bg-trail/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed">
                Tạo đội
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

export default TeamsPage
