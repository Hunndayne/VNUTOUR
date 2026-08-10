import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, CARD, Badge } from './ui.jsx'
import { apiRequest, formatDateTime, isMasterAdmin, logoutAndRedirect, ROLE_MASTER_ADMIN } from './api.js'
import { useSearchParam } from './router.js'
import { useDraftState, DraftNotice } from './drafts.jsx'

const ROLE_DEF = {
  master_admin: { label: 'Master admin', cls: 'bg-ink text-white' },
  admin: { label: 'Admin', cls: 'bg-clay/12 text-clay' },
  collab: { label: 'Collab', cls: 'bg-gold/12 text-[#9A6B12]' },
  participant: { label: 'Participant', cls: 'bg-trail/12 text-trail' },
}

/** Avatar chip colours, kept in step with the role badges above. */
const ROLE_AVATAR_CLS = {
  master_admin: 'bg-ink text-white',
  admin: 'bg-clay/15 text-clay',
  collab: 'bg-gold/15 text-[#9A6B12]',
  participant: 'bg-trail/15 text-trail',
}

function avatarCls(role) {
  return ROLE_AVATAR_CLS[role] || ROLE_AVATAR_CLS.participant
}

const EMPTY_COUNTS = { all: 0, master_admin: 0, admin: 0, collab: 0, participant: 0, inactive: 0 }

const FILTER_TABS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'master_admin', label: 'Master admin' },
  { key: 'admin', label: 'Admin' },
  { key: 'collab', label: 'Collab' },
  { key: 'participant', label: 'Participant' },
  { key: 'inactive', label: 'Đã khóa' },
]

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    conflict: 'Username, email hoặc MSSV đã tồn tại.',
    missing_fields: 'Vui lòng điền đủ các trường bắt buộc.',
    forbidden: 'Bạn không có quyền thao tác tài khoản.',
    not_found: 'Không tìm thấy tài khoản.',
  }
  return map[code] || 'Không thể đồng bộ dữ liệu tài khoản.'
}

function normalizeAccount(account) {
  return {
    username: account.username,
    email: account.email || '',
    role: account.role || 'participant',
    mssv: account.mssv || '',
    fullName: account.full_name || '',
    team: account.team_name || '',
    teamCode: account.team_code || '',
    isActive: Boolean(account.is_active),
    lastLogin: formatDateTime(account.last_login),
  }
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([])
  const [counts, setCounts] = useState(EMPTY_COUNTS)
  const [filter, setFilter] = useSearchParam('role', 'all')
  const [qParam, setQParam] = useSearchParam('q', '')
  const [search, setSearch] = useState(() => qParam)
  const [debouncedSearch, setDebouncedSearch] = useState(() => qParam)
  const [newParam, setNewParam] = useSearchParam('new', '')
  const showCreate = newParam === '1'
  // useSearchParam's setter stringifies whatever it's given, so a functional
  // updater has to be resolved against the current value here first.
  const setShowCreate = (next) => {
    setNewParam((typeof next === 'function' ? next(showCreate) : next) ? '1' : '')
  }
  const [accountParam, setAccountParam] = useSearchParam('account', '')
  const editing = accountParam || null
  const setEditing = (next) => setAccountParam(next || '')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [apiError, setApiError] = useState('')
  // Mật khẩu tạo tài khoản không bao giờ vào bản nháp — tách riêng khỏi
  // `createForm`, phần được persist qua useDraftState.
  const [createPassword, setCreatePassword] = useState('')
  const [createForm, setCreateForm, createDraft] = useDraftState('account:create', {
    username: '', email: '', role: 'collab', fullName: '', mssv: '',
  })
  // Only a master admin may hand out the master admin role; the backend answers
  // 403 for anyone else, so plain admins never see the option.
  const canGrantMasterAdmin = isMasterAdmin()

  // Gõ tìm kiếm chỉ đẩy vào URL sau khi đã debounce (dùng lại debouncedSearch
  // sẵn có) và luôn bằng replace, để mỗi ký tự gõ không đẻ thêm một entry lịch sử.
  useEffect(() => {
    setQParam(debouncedSearch, { replace: true })
  }, [debouncedSearch, setQParam])

  const loadAccounts = useCallback(async () => {
    const params = new URLSearchParams({ limit: '200' })
    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim())
    if (filter === 'inactive') {
      params.set('active', '0')
    } else {
      params.set('active', '1')
      if (filter !== 'all') params.set('role', filter)
    }
    const payload = await apiRequest(`/admin/accounts?${params.toString()}`)
    setAccounts((payload.items || []).map(normalizeAccount))
    setCounts({ ...EMPTY_COUNTS, ...(payload.counts || {}) })
  }, [debouncedSearch, filter])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        setLoading(true)
        await loadAccounts()
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
  }, [loadAccounts])

  const filtered = useMemo(() => accounts, [accounts])

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

  const handleCreate = () => withBusy('create', async () => {
    await apiRequest('/admin/accounts', {
      method: 'POST',
      body: {
        username: createForm.username.trim(),
        email: createForm.email.trim(),
        password: createPassword,
        role: createForm.role,
        mssv: createForm.mssv.trim() || undefined,
        full_name: createForm.fullName.trim() || undefined,
      },
    })
    await loadAccounts()
    setCreateForm({ username: '', email: '', role: 'collab', fullName: '', mssv: '' })
    setCreatePassword('')
    createDraft.clear()
    setShowCreate(false)
  })

  const handleEditSave = (username, form, editDraft) => withBusy('edit', async () => {
    await apiRequest(`/admin/accounts/${username}`, {
      method: 'PATCH',
      body: {
        email: form.email.trim(),
        mssv: form.mssv.trim() || '',
        full_name: form.fullName.trim() || '',
        role: form.role,
        is_active: form.isActive,
        password: form.password || undefined,
      },
    })
    await loadAccounts()
    editDraft.clear()
    setEditing(null)
  })

  const handleDeactivate = (username) => withBusy(`deactivate:${username}`, async () => {
    await apiRequest(`/admin/accounts/${username}`, { method: 'DELETE' })
    await loadAccounts()
    if (editing === username) setEditing(null)
  })

  const handleReactivate = (username) => withBusy(`reactivate:${username}`, async () => {
    await apiRequest(`/admin/accounts/${username}`, {
      method: 'PATCH',
      body: { is_active: true },
    })
    await loadAccounts()
  })

  const openEdit = (acct) => {
    setEditing(acct.username)
  }

  return (
    <div className="space-y-5">
      {apiError && (
        <div className="rounded-lg border border-clay/20 bg-clay/10 px-4 py-3 text-sm text-clay">
          {apiError}
        </div>
      )}

      <div className={`${CARD} flex items-stretch overflow-hidden`}>
        {FILTER_TABS.map((tab, i) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`group relative flex-1 px-4 py-4 text-left transition hover:bg-paper ${
              i > 0 ? 'border-l border-stone' : ''
            }`}
          >
            {filter === tab.key && (
              <span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-gold" />
            )}
            <span className="font-mono text-2xl font-semibold text-ink">{counts[tab.key] ?? 0}</span>
            <span className="mt-1 block text-sm text-ink/55">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/25">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            type="text"
            placeholder="Tìm username, email hoặc MSSV..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-stone bg-white py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-ink/25 transition focus:border-gold/40 focus:outline-none focus:ring-2 focus:ring-gold/10"
          />
        </div>
        <span className="font-mono text-xs text-ink/35">{filtered.length} tài khoản</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setShowCreate(v => !v)}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
            showCreate ? 'border border-stone bg-paper text-ink/60' : 'bg-ink text-white hover:bg-ink/85'
          }`}
        >
          <Icon name="plus" className="h-4 w-4" />
          Tạo tài khoản
        </button>
      </div>

      {showCreate && (
        <div className={`${CARD} p-5 animate-[fadeIn_0.15s_ease-out]`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-ink">Tạo tài khoản mới</h3>
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg p-1.5 text-ink/25 transition hover:bg-paper hover:text-ink/55">
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>
          <DraftNotice draft={createDraft} label="tài khoản đang tạo" className="mb-4" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Username *</label>
              <input type="text" value={createForm.username} onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Email *</label>
              <input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Mật khẩu *</label>
              <input type="password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Vai trò</label>
              <select value={createForm.role} onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10">
                {canGrantMasterAdmin && <option value="master_admin">Master admin</option>}
                <option value="admin">Admin</option>
                <option value="collab">Collab</option>
                <option value="participant">Participant</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Họ tên</label>
              <input type="text" value={createForm.fullName} onChange={e => setCreateForm(f => ({ ...f, fullName: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">MSSV</label>
              <input type="text" value={createForm.mssv} onChange={e => setCreateForm(f => ({ ...f, mssv: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" onClick={handleCreate} disabled={!createForm.username.trim() || !createForm.email.trim() || !createPassword.trim() || busy === 'create'} className="rounded-lg bg-trail px-5 py-2 text-sm font-semibold text-white transition hover:bg-trail/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed">
              {busy === 'create' ? 'Đang tạo...' : 'Tạo tài khoản'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-stone bg-white px-4 py-2 text-sm text-ink/60 transition hover:bg-paper">
              Hủy
            </button>
          </div>
        </div>
      )}

      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone bg-paper/70">
                <th className="px-5 py-3.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Username</th>
                <th className="px-5 py-3.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Email</th>
                <th className="px-5 py-3.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Vai trò</th>
                <th className="hidden px-5 py-3.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 md:table-cell">MSSV</th>
                <th className="hidden px-5 py-3.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 lg:table-cell">Đội</th>
                <th className="hidden px-5 py-3.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45 md:table-cell">Đăng nhập</th>
                <th className="px-5 py-3.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Trạng thái</th>
                <th className="px-5 py-3.5 text-right font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/60">
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-20 text-center text-sm text-ink/30">Đang tải tài khoản...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-20 text-center text-sm text-ink/30">Không tìm thấy tài khoản nào</td></tr>
              ) : (
                filtered.map((acct) => {
                  const role = ROLE_DEF[acct.role] || ROLE_DEF.participant
                  return (
                    <tr key={acct.username} className={`transition hover:bg-paper/50 ${!acct.isActive ? 'opacity-50' : ''}`}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold ${avatarCls(acct.role)}`}>
                            {acct.username.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{acct.username}</p>
                            {acct.fullName && <p className="truncate text-xs text-ink/35">{acct.fullName}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-sm text-ink/60">{acct.email}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge label={role.label} cls={role.cls} />
                      </td>
                      <td className="hidden px-5 py-3.5 md:table-cell">
                        <span className="font-mono text-xs text-ink/45">{acct.mssv || '—'}</span>
                      </td>
                      <td className="hidden px-5 py-3.5 lg:table-cell">
                        <span className="text-sm text-ink/50">{acct.team || '—'}</span>
                      </td>
                      <td className="hidden px-5 py-3.5 md:table-cell">
                        <span className="font-mono text-xs text-ink/35">{acct.lastLogin || 'Chưa đăng nhập'}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {acct.isActive ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-trail">
                            <span className="h-1.5 w-1.5 rounded-full bg-trail" />
                            Hoạt động
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-clay">
                            <span className="h-1.5 w-1.5 rounded-full bg-clay" />
                            Đã khóa
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => openEdit(acct)} className="rounded-md px-3 py-1.5 text-xs font-semibold text-trail transition hover:bg-trail/8 active:scale-95">
                            Chỉnh sửa
                          </button>
                          {acct.isActive ? (
                            <button type="button" onClick={() => handleDeactivate(acct.username)} className="rounded-md px-3 py-1.5 text-xs font-semibold text-clay transition hover:bg-clay/8 active:scale-95">
                              {busy === `deactivate:${acct.username}` ? 'Đang khóa...' : 'Khóa'}
                            </button>
                          ) : (
                            <button type="button" onClick={() => handleReactivate(acct.username)} className="rounded-md px-3 py-1.5 text-xs font-semibold text-trail transition hover:bg-trail/8 active:scale-95">
                              {busy === `reactivate:${acct.username}` ? 'Đang mở...' : 'Mở khóa'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (() => {
        const acct = accounts.find(a => a.username === editing)
        if (!acct) return null
        // Keyed by username so switching to a different account remounts the
        // drawer — that's what makes its useDraftState pick up a fresh baseline
        // instead of carrying over the previous account's edits.
        return (
          <EditAccountDrawer
            key={editing}
            acct={acct}
            canGrantMasterAdmin={canGrantMasterAdmin}
            busy={busy}
            onClose={() => setEditing(null)}
            onSave={handleEditSave}
          />
        )
      })()}
    </div>
  )
}

function EditAccountDrawer({ acct, canGrantMasterAdmin, busy, onClose, onSave }) {
  const [editForm, setEditForm, editDraft] = useDraftState(`account:${acct.username}:edit`, () => ({
    email: acct.email || '',
    mssv: acct.mssv || '',
    fullName: acct.fullName || '',
    role: acct.role || 'participant',
    isActive: acct.isActive,
  }))
  // Mật khẩu mới không bao giờ được lưu nháp — luôn trống mỗi lần mở lại đội này.
  const [password, setPassword] = useState('')

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col border-l border-stone bg-paper shadow-2xl animate-[fadeIn_0.15s_ease-out]">
        <div className="flex items-center justify-between gap-3 border-b border-stone bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full font-display text-xs font-bold ${avatarCls(acct.role)}`}>
                {acct.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="font-display text-lg font-bold text-ink">{acct.username}</h3>
                <p className="font-mono text-xs text-ink/40">{acct.email}</p>
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-ink/40 transition hover:bg-paper hover:text-ink">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <DraftNotice draft={editDraft} label="chỉnh sửa tài khoản" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Email</label>
              <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">MSSV</label>
              <input type="text" value={editForm.mssv} onChange={e => setEditForm(f => ({ ...f, mssv: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Họ tên</label>
              <input type="text" value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Đội</label>
              <input type="text" value={acct.team ? `${acct.teamCode ? `${acct.teamCode} · ` : ''}${acct.team}` : 'Chưa có đội'} readOnly className="w-full rounded-lg border border-stone bg-paper px-3 py-2 text-sm text-ink/55" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Vai trò</label>
              <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10">
                {(canGrantMasterAdmin || editForm.role === ROLE_MASTER_ADMIN) && <option value="master_admin">Master admin</option>}
                <option value="admin">Admin</option>
                <option value="collab">Collab</option>
                <option value="participant">Participant</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Mật khẩu mới</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={editForm.isActive} onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4 rounded border-stone text-trail focus:ring-trail" />
            <span className="text-sm text-ink/70">Tài khoản hoạt động</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-stone bg-white px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-stone bg-white px-4 py-2 text-sm font-medium text-ink/60 transition hover:bg-paper">
            Hủy
          </button>
          <button type="button" onClick={() => onSave(acct.username, { ...editForm, password }, editDraft)} className="rounded-lg bg-trail px-5 py-2 text-sm font-semibold text-white transition hover:bg-trail/90 active:scale-[0.98]">
            {busy === 'edit' ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </div>
      </aside>
    </div>
  )
}
