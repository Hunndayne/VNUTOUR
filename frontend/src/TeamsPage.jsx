import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, CARD, APPROVAL, PROVISION, Badge } from './ui.jsx'
import { apiRequest, formatDateTime, logoutAndRedirect } from './api.js'

const FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'pending_approval', label: 'Chờ duyệt' },
  { key: 'approved', label: 'Đã duyệt' },
  { key: 'draft', label: 'Nháp' },
  { key: 'rejected', label: 'Từ chối' },
]

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    owner_not_found: 'Không tìm thấy tài khoản đội trưởng.',
    invalid_owner_role: 'Tài khoản này không phải participant.',
    owner_profile_incomplete: 'Đội trưởng cần có MSSV trước khi tạo đội từ admin.',
    owner_already_has_team: 'Tài khoản đội trưởng đã thuộc một đội khác.',
    conflict: 'Dữ liệu đội bị trùng hoặc đang xung đột.',
    not_found: 'Không tìm thấy đội cần thao tác.',
  }
  return map[code] || 'Không thể đồng bộ dữ liệu đội.'
}

function normalizeTeamSummary(team) {
  return {
    id: team.code,
    name: team.name || '',
    owner: team.owner_username || '',
    status: team.approval_status || 'draft',
    provision: team.provision_state || 'none',
    memberCount: team.member_count || 0,
    isLateRegistration: Boolean(team.is_late_registration),
    createdAt: team.created_at || '',
  }
}

function memberStripCls(member) {
  if (member.has_account && member.discord_id) return 'bg-trail'
  if (member.has_account) return 'bg-[#3E7CA8]'
  if (member.discord_id) return 'bg-[#5865F2]'
  return 'bg-stone'
}

function MemberCard({ member }) {
  const strip = memberStripCls(member)
  return (
    <div className="flex">
      <div className={`w-[3px] shrink-0 ${strip}`} />
      <div className="min-w-0 flex-1 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold text-ink">
                {member.full_name || '(Chưa điền tên)'}
              </span>
              {member.is_captain && (
                <Badge label="Đội trưởng" cls="bg-gold/15 text-[#9A6B12]" />
              )}
            </div>
            <p className="mt-0.5 font-mono text-xs text-ink/50">
              {member.mssv}
              {member.faculty && <> · {member.faculty}</>}
            </p>
            {(member.email || member.phone) && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink/40">
                {member.email && <span className="mr-3">{member.email}</span>}
                {member.phone && <span>{member.phone}</span>}
              </p>
            )}
            {(member.school || member.cccd || member.date_of_birth) && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink/40">
                {member.school && <span className="mr-3">{member.school}</span>}
                {member.cccd && <span className="mr-3">CCCD: {member.cccd}</span>}
                {member.date_of_birth && <span>Ngày sinh: {member.date_of_birth}</span>}
              </p>
            )}
            {member.extra && Object.keys(member.extra).length > 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink/35">
                {Object.entries(member.extra).map(([key, value]) => `${key}: ${value}`).join(' · ')}
              </p>
            )}
            {member.email_mismatch && (
              <p className="mt-1.5 rounded-md bg-gold/10 px-2 py-1 text-[11px] leading-relaxed text-[#9A6B12]">
                ⚠ Thành viên đã tạo tài khoản với email khác
                {member.form_email && (
                  <> (bạn nhập <span className="font-mono">{member.form_email}</span>,
                  {' '}tài khoản dùng <span className="font-mono">{member.account_email}</span>)</>
                )}
                . Thông tin đã được cập nhật theo tài khoản.
              </p>
            )}
          </div>

          <div className="shrink-0 flex flex-col items-end gap-1 pt-0.5">
            <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${member.has_account ? 'text-trail' : 'text-ink/30'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${member.has_account ? 'bg-trail' : 'bg-ink/20'}`} />
              {member.has_account ? 'Có TK web' : 'Chưa có TK'}
            </span>
            <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${member.discord_id ? 'text-[#5865F2]' : 'text-ink/25'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${member.discord_id ? 'bg-[#5865F2]' : 'bg-ink/15'}`} />
              {member.discord_id ? 'Discord ✓' : 'Discord —'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function QuickStat({ label, value, done = false, accent }) {
  const valCls = accent === 'discord'
    ? (done ? 'text-[#5865F2]' : 'text-ink/50')
    : (done ? 'text-trail' : 'text-ink/50')
  return (
    <div className={`${CARD} px-3 py-2.5`}>
      <p className={`font-mono text-lg font-bold leading-none ${valCls}`}>{value}</p>
      <p className="mt-1 text-[11px] text-ink/40">{label}</p>
    </div>
  )
}

function TeamDrawer({ team, loading, busy, onClose, onApprove, onReject }) {
  const [mode, setMode] = useState('idle')
  const [note, setNote] = useState('')

  useEffect(() => {
    setMode('idle')
    setNote('')
  }, [team?.id])

  if (!team) return null

  const canAct = team.status === 'pending_approval' || team.status === 'draft'
  const withAccount = team.members.filter(member => member.has_account).length
  const withDiscord = team.members.filter(member => member.discord_id).length

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[440px] flex-col border-l border-stone bg-paper shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-ink/40">{team.id}</span>
              <Badge {...APPROVAL[team.status]} />
              {team.provision && team.provision !== 'none' && (
                <Badge {...(PROVISION[team.provision] ?? PROVISION.none)} />
              )}
              {team.isLateRegistration && (
                <Badge label="Đăng ký trễ" cls="bg-clay/12 text-clay" />
              )}
            </div>
            <h2 className="mt-1 truncate font-display text-xl font-bold text-ink">
              {team.name}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
              <span className="text-sm text-ink/50">
                Đội trưởng: <span className="font-medium text-ink/70">{team.owner || 'Chưa gán'}</span>
              </span>
              {team.submittedAt && (
                <span className="font-mono text-xs text-ink/35">Gửi {formatDateTime(team.submittedAt)}</span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-ink/40 transition hover:bg-paper hover:text-ink">
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-12 text-center text-sm text-ink/35">Đang tải chi tiết đội...</div>
          ) : (
            <>
              {team.status === 'rejected' && team.note && (
                <div className="mx-4 mt-4 rounded-lg border border-clay/25 bg-clay/[0.05] px-3.5 py-3">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-clay/60">
                    Lý do từ chối
                  </p>
                  <p className="text-sm text-clay">{team.note}</p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 px-4 py-4">
                <QuickStat label="Thành viên" value={String(team.members.length)} />
                <QuickStat label="Có TK web" value={`${withAccount}/${team.members.length || 0}`} done={withAccount === team.members.length && team.members.length > 0} />
                <QuickStat label="Discord" value={String(withDiscord)} done={withDiscord > 0} accent="discord" />
              </div>

              <div className="px-4 pb-4">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">
                  Minh chứng thanh toán
                </p>
                <div className={`${CARD} px-4 py-3 text-sm`}>
                  {team.paymentProof ? (
                    <a
                      href={team.paymentProof}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-trail underline underline-offset-4"
                    >
                      Mở minh chứng
                    </a>
                  ) : (
                    <span className="text-ink/35">Chưa có minh chứng.</span>
                  )}
                </div>
              </div>
              <div className="px-4 pb-5">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">
                  Thành viên
                </p>
                <div className={`${CARD} overflow-hidden divide-y divide-stone/50`}>
                  {team.members.length > 0
                    ? team.members.map(member => <MemberCard key={member.mssv} member={member} />)
                    : <p className="px-4 py-5 text-sm italic text-ink/30">Đội chưa có thành viên.</p>}
                </div>

              </div>
            </>
          )}
        </div>

        {canAct && !loading && (
          <div className="border-t border-stone bg-white">
            {mode === 'idle' && (
              <div className="flex gap-2 px-4 py-4">
                <button type="button" onClick={() => setMode('rejecting')} className="flex items-center gap-1.5 rounded-lg border border-clay/30 bg-white px-4 py-2.5 text-sm font-semibold text-clay transition hover:bg-clay/[0.04]">
                  <Icon name="xmark" className="h-4 w-4" />
                  Từ chối
                </button>
                <button type="button" onClick={() => setMode('confirming')} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-trail px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96]">
                  <Icon name="checkPlain" className="h-4 w-4" />
                  Duyệt đội
                </button>
              </div>
            )}

            {mode === 'confirming' && (
              <div className="space-y-3 px-4 py-4">
                <div className="rounded-lg border border-trail/25 bg-trail/[0.06] px-4 py-3">
                  <p className="text-sm font-semibold text-ink">Xác nhận duyệt đội?</p>
                  <p className="mt-0.5 text-xs text-ink/55">
                    <span className="font-medium text-ink">{team.name}</span> · {team.members.length} thành viên · sẽ được thêm vào hàng đợi tạo kênh Discord.
                  </p>
                  {team.status === 'draft' && (
                    <p className="mt-2 text-xs font-medium text-clay">
                      Đội nháp được duyệt từ màn này sẽ được đánh dấu là đội đăng ký trễ.
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMode('idle')} className="flex-1 rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper">
                    Quay lại
                  </button>
                  <button type="button" onClick={onApprove} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-trail py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96] disabled:opacity-40">
                    <Icon name="checkPlain" className="h-4 w-4" />
                    {busy ? 'Đang duyệt...' : 'Xác nhận duyệt'}
                  </button>
                </div>
              </div>
            )}

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
                    placeholder="Mô tả cụ thể để đội trưởng có thể chỉnh sửa và gửi lại..."
                    className="w-full resize-none rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink placeholder:text-ink/30 outline-none transition focus:border-clay/40 focus:ring-2 focus:ring-clay/10"
                  />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMode('idle')} className="flex-1 rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper">
                    Quay lại
                  </button>
                  <button type="button" onClick={() => onReject(note)} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-clay py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96] disabled:opacity-40">
                    <Icon name="xmark" className="h-4 w-4" />
                    {busy ? 'Đang từ chối...' : 'Xác nhận từ chối'}
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

function CreateTeamDrawer({ open, form, busy, onClose, onChange, onCreate }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-stone bg-paper shadow-2xl animate-[fadeIn_0.15s_ease-out]">
        <div className="flex items-start justify-between gap-3 border-b border-stone bg-white px-5 py-4">
          <div>
            <h2 className="font-display text-xl font-bold text-ink">Tạo đội mới</h2>
            <p className="mt-0.5 text-sm text-ink/45">Đội admin tạo sẽ được duyệt ngay</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-ink/40 transition hover:bg-paper hover:text-ink">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Tên đội *</label>
            <input type="text" value={form.name} onChange={e => onChange(f => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Đội trưởng (username)</label>
            <input type="text" value={form.owner} onChange={e => onChange(f => ({ ...f, owner: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
          </div>
          <div className="rounded-lg border border-stone bg-paper/50 px-4 py-3 text-xs leading-6 text-ink/50">
            Nếu nhập đội trưởng, tài khoản đó cần là participant và đã có MSSV. Khi tạo thành công, đội trưởng sẽ được thêm luôn vào đội.
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-stone bg-white px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-stone bg-white px-4 py-2 text-sm font-medium text-ink/60 transition hover:bg-paper">
            Hủy
          </button>
          <button type="button" onClick={onCreate} disabled={!form.name.trim() || busy} className="rounded-lg bg-trail px-5 py-2 text-sm font-semibold text-white transition hover:bg-trail/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? 'Đang tạo...' : 'Tạo đội'}
          </button>
        </div>
      </aside>
    </div>
  )
}

function TeamsPage() {
  const [teams, setTeams] = useState([])
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [apiError, setApiError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', owner: '' })

  const loadTeams = useCallback(async () => {
    const params = new URLSearchParams({ limit: '200' })
    if (filter !== 'all') params.set('approval_status', filter)
    if (query.trim()) params.set('q', query.trim())
    const payload = await apiRequest(`/teams?${params.toString()}`)
    setTeams((payload.items || []).map(normalizeTeamSummary))
  }, [filter, query])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        setListLoading(true)
        await loadTeams()
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError(explainApiError(error))
      } finally {
        if (!cancelled) {
          setListLoading(false)
        }
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [loadTeams])

  useEffect(() => {
    let cancelled = false

    const loadTeamDetail = async () => {
      if (!selectedId) {
        setSelectedTeam(null)
        return
      }

      try {
        setDetailLoading(true)
        const detail = await apiRequest(`/teams/${selectedId}`)
        if (cancelled) return
        setSelectedTeam({
          id: detail.code,
          name: detail.name,
          owner: detail.owner_username || '',
          status: detail.approval_status,
          provision: detail.provision_state || 'none',
          submittedAt: detail.submitted_at,
          note: detail.approval_note || '',
          paymentProof: detail.payment_proof || '',
          isLateRegistration: Boolean(detail.is_late_registration),
          members: detail.members || [],
        })
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError(explainApiError(error))
      } finally {
        if (!cancelled) {
          setDetailLoading(false)
        }
      }
    }

    loadTeamDetail()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const counts = useMemo(() => {
    const next = { all: teams.length }
    for (const team of teams) {
      next[team.status] = (next[team.status] || 0) + 1
    }
    return next
  }, [teams])

  const rows = teams

  const withBusy = async (busyKey, task) => {
    setBusy(busyKey)
    setApiError('')
    try {
      await task()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusy('')
    }
  }

  const handleApprove = () => withBusy('approve', async () => {
    await apiRequest(`/teams/${selectedId}/approve`, {
      method: 'POST',
      body: { is_late_registration: selectedTeam?.status === 'draft' || selectedTeam?.isLateRegistration },
    })
    await loadTeams()
    if (selectedId) {
      const detail = await apiRequest(`/teams/${selectedId}`)
      setSelectedTeam({
        id: detail.code,
        name: detail.name,
        owner: detail.owner_username || '',
        status: detail.approval_status,
        provision: detail.provision_state || 'none',
        submittedAt: detail.submitted_at,
        note: detail.approval_note || '',
        paymentProof: detail.payment_proof || '',
        isLateRegistration: Boolean(detail.is_late_registration),
        members: detail.members || [],
      })
    }
  })

  const handleReject = (note) => withBusy('reject', async () => {
    await apiRequest(`/teams/${selectedId}/reject`, {
      method: 'POST',
      body: { note },
    })
    await loadTeams()
    if (selectedId) {
      const detail = await apiRequest(`/teams/${selectedId}`)
      setSelectedTeam({
        id: detail.code,
        name: detail.name,
        owner: detail.owner_username || '',
        status: detail.approval_status,
        provision: detail.provision_state || 'none',
        submittedAt: detail.submitted_at,
        note: detail.approval_note || '',
        paymentProof: detail.payment_proof || '',
        isLateRegistration: Boolean(detail.is_late_registration),
        members: detail.members || [],
      })
    }
  })

  const handleCreateTeam = () => withBusy('create', async () => {
    await apiRequest('/teams', {
      method: 'POST',
      body: {
        name: createForm.name.trim(),
        owner_username: createForm.owner.trim() || undefined,
      },
    })
    await loadTeams()
    setCreateForm({ name: '', owner: '' })
    setShowCreate(false)
  })

  return (
    <div className="space-y-4">
      {apiError && (
        <div className="rounded-lg border border-clay/20 bg-clay/10 px-4 py-3 text-sm text-clay">
          {apiError}
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1 rounded-xl border border-stone bg-white p-1">
          {FILTERS.map(filterItem => {
            const active = filter === filterItem.key
            return (
              <button
                key={filterItem.key}
                type="button"
                onClick={() => setFilter(filterItem.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active ? 'bg-ink text-white' : 'text-ink/55 hover:bg-paper hover:text-ink'
                }`}
              >
                {filterItem.label}
                <span className={`font-mono text-xs ${active ? 'text-white/70' : 'text-ink/30'}`}>
                  {counts[filterItem.key] ?? 0}
                </span>
              </button>
            )
          })}
        </div>

        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Tìm theo tên đội, mã đội, đội trưởng..."
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

      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead>
              <tr className="border-b border-stone font-mono text-[10px] uppercase tracking-wider text-ink/35">
                <th className="px-4 py-3 font-medium">Mã đội</th>
                <th className="px-4 py-3 font-medium">Tên đội</th>
                <th className="px-4 py-3 font-medium">Đội trưởng</th>
                <th className="px-4 py-3 text-center font-medium">TV</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 font-medium">Discord</th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/60">
              {listLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-sm text-ink/35">
                    Đang tải danh sách đội...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-sm text-ink/35">
                    Không có đội nào khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                rows.map(team => (
                  <tr
                    key={team.id}
                    onClick={() => setSelectedId(team.id)}
                    className={`cursor-pointer transition hover:bg-paper/70 ${selectedId === team.id ? 'bg-paper/60' : ''}`}
                  >
                    <td className="px-4 py-3.5 font-mono text-sm text-ink/55">{team.id}</td>
                    <td className="px-4 py-3.5 text-sm font-medium text-ink">{team.name}</td>
                    <td className="px-4 py-3.5 text-sm text-ink/60">{team.owner || '—'}</td>
                    <td className="px-4 py-3.5 text-center font-mono text-sm text-ink/55">{team.memberCount}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge {...APPROVAL[team.status]} />
                        {team.isLateRegistration && <Badge label="Đăng ký trễ" cls="bg-clay/12 text-clay" />}
                      </div>
                    </td>
                    <td className="px-4 py-3.5"><Badge {...(PROVISION[team.provision] ?? PROVISION.none)} /></td>
                    <td className="px-4 py-3.5 text-ink/25">
                      <Icon name="chevronR" className="h-4 w-4" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <TeamDrawer
        team={selectedTeam}
        loading={detailLoading}
        busy={busy === 'approve' || busy === 'reject'}
        onClose={() => setSelectedId(null)}
        onApprove={handleApprove}
        onReject={handleReject}
      />

      <CreateTeamDrawer
        open={showCreate}
        form={createForm}
        busy={busy === 'create'}
        onClose={() => setShowCreate(false)}
        onChange={setCreateForm}
        onCreate={handleCreateTeam}
      />
    </div>
  )
}

export default TeamsPage

