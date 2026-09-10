import { useEffect, useRef, useState } from 'react'
import { apiRequest, isMasterAdmin, logoutAndRedirect, ROLE_MASTER_ADMIN } from './api.js'
import { fetchEncryptedAccountDetails, saveEncryptedAccountDetails } from './accountDetailsCrypto.js'
import { explainAccountSaveError } from './accountDetailsForm.js'
import AccountDetailsEditor from './AccountDetailsEditor.jsx'
import { Icon } from './ui.jsx'

const FIELD_LABELS = { mssv: 'MSSV', email: 'email', full_name: 'họ tên', phone: 'số điện thoại', school: 'trường', faculty: 'khoa' }
const ROLES = { master_admin: 'Master admin', admin: 'Admin', collab: 'Cộng tác viên', participant: 'Thí sinh' }
const APPROVAL = { draft: 'Bản nháp', pending_approval: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Bị từ chối' }

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có'
}

function display(value) {
  if (value === null || value === undefined || value === '') return 'Chưa có'
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function Fields({ rows }) {
  return <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
    {rows.map(([label, value]) => <div key={label} className="min-w-0">
      <dt className="mb-1 text-xs text-ink/55">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-sm font-medium text-ink [overflow-wrap:anywhere]">{display(value)}</dd>
    </div>)}
  </dl>
}

function Section({ title, children }) {
  return <section className="rounded-xl border border-stone bg-white p-5">
    <h3 className="mb-4 border-b border-stone/60 pb-3 font-display text-base font-semibold text-ink">{title}</h3>
    {children}
  </section>
}

function detailsError(error) {
  if (error?.status === 403) return 'Bạn không có quyền xem thông tin tài khoản này.'
  if (error?.status === 404) return 'Không tìm thấy tài khoản này. Có thể tài khoản đã được đổi tên hoặc xóa.'
  if (error?.message === 'secure_browser_required') return 'Hãy mở trang bằng HTTPS trên trình duyệt hỗ trợ Web Crypto để xem chi tiết.'
  if (error?.message === 'invalid_encrypted_response') return 'Không thể xác minh và giải mã dữ liệu. Vui lòng tải lại chi tiết.'
  return 'Chưa tải được thông tin tài khoản. Vui lòng thử lại.'
}

export default function AccountDetailsDrawer({ username, onClose, onUpdated, initialEditing = false }) {
  const [details, setDetails] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(initialEditing)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  const [success, setSuccess] = useState('')
  const [discardAction, setDiscardAction] = useState('')
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const closeActionRef = useRef(null)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const canGrantMasterAdmin = isMasterAdmin()
  const canEdit = details?.account && (canGrantMasterAdmin || details.account.role !== ROLE_MASTER_ADMIN)

  const resetEditor = () => {
    setEditing(false)
    setDirty(false)
    setSaveError('')
    setNeedsReload(false)
    setDiscardAction('')
  }
  const reloadDetails = () => {
    resetEditor()
    setError('')
    setRefreshing(true)
    setAttempt(value => value + 1)
  }
  const requestClose = () => {
    if (savingRef.current) return
    if (editing && dirty) setDiscardAction('close')
    else onClose()
  }
  useEffect(() => { closeActionRef.current = requestClose })
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchEncryptedAccountDetails(username, apiRequest, { signal: controller.signal }).then(payload => {
      if (!controller.signal.aborted) setDetails(payload)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure?.status === 401) { logoutAndRedirect('/'); return }
      setError(detailsError(failure))
    }).finally(() => {
      if (!controller.signal.aborted) setRefreshing(false)
    })
    return () => controller.abort()
  }, [username, attempt])

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const handleKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeActionRef.current?.(); return }
      if (event.key !== 'Tab') return
      const nodes = dialogRef.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')
      if (!nodes?.length) { event.preventDefault(); dialogRef.current?.focus(); return }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (!dialogRef.current.contains(document.activeElement) || document.activeElement === dialogRef.current || document.activeElement?.matches(':disabled')) {
        event.preventDefault()
        if (event.shiftKey) last.focus()
        else first.focus()
      }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKey)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    if (!dirty && !saving) return
    const preventUnload = event => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventUnload)
    return () => window.removeEventListener('beforeunload', preventUnload)
  }, [dirty, saving])

  const saveDetails = async changes => {
    if (savingRef.current || !canEdit) return
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    setSuccess('')
    setNeedsReload(false)
    try {
      await saveEncryptedAccountDetails(username, details, changes, apiRequest)
    } catch (failure) {
      if (mountedRef.current) {
        if (failure?.status === 401) logoutAndRedirect('/')
        else {
          setSaveError(explainAccountSaveError(failure, details))
          setNeedsReload(['edit_session_expired', 'account_changed', 'invalid_encrypted_request'].includes(failure?.data?.error || failure?.message))
        }
        setSaving(false)
      }
      savingRef.current = false
      return
    }
    if (!mountedRef.current) { savingRef.current = false; return }
    resetEditor()
    setSuccess('Đã lưu thay đổi. Đang tải lại thông tin…')
    setRefreshing(true)
    // The write has succeeded. A failed follow-up read must never be reported
    // as a failed save or lead to resubmitting the old draft.
    const [detailResult, listResult] = await Promise.allSettled([
      fetchEncryptedAccountDetails(username, apiRequest),
      Promise.resolve().then(() => onUpdated?.()),
    ])
    if (mountedRef.current) {
      if (detailResult.status === 'fulfilled') setDetails(detailResult.value)
      if (detailResult.status === 'rejected' && detailResult.reason?.status === 401) logoutAndRedirect('/')
      const refreshFailed = detailResult.status === 'rejected' || listResult.status === 'rejected'
      setSuccess(refreshFailed
        ? 'Đã lưu thay đổi. Chưa tải lại được đầy đủ thông tin; hãy tải lại chi tiết hoặc danh sách tài khoản.'
        : 'Đã lưu thay đổi.')
      setNeedsReload(refreshFailed)
      setRefreshing(false)
      setSaving(false)
    }
    savingRef.current = false
  }

  const account = details?.account
  const profile = details?.participant
  const team = details?.team
  const extra = profile?.extra
  const showEditor = editing && canEdit
  return <div className="fixed inset-0 z-50">
    <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={requestClose} />
    <aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="account-details-title"
      className="absolute right-0 top-0 flex h-full w-full max-w-[760px] flex-col border-l border-stone bg-paper shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-stone bg-white px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-trail">Chi tiết tài khoản</p>
          <h2 id="account-details-title" className="break-words font-display text-xl font-bold text-ink">{username}</h2>
          <p className="mt-1 text-xs text-ink/55">{showEditor ? 'Chỉnh sửa tài khoản và hồ sơ' : 'Lượt truy cập và thay đổi được ghi nhật ký'}</p>
        </div>
        <button ref={closeRef} type="button" aria-label="Đóng chi tiết tài khoản" onClick={requestClose} disabled={saving}
          className="rounded-lg p-2 text-ink/60 hover:bg-paper focus-visible:outline-trail disabled:cursor-wait disabled:opacity-40">
          <Icon name="close" className="h-5 w-5" />
        </button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-busy={(!details && !error) || refreshing}>
        {!details && !error && <p role="status" className="py-12 text-center text-sm text-ink/55">Đang tải và giải mã thông tin…</p>}
        {error && <div role="alert" className="rounded-xl border border-clay/20 bg-white p-5">
          <p className="text-sm text-clay">{error}</p>
          <button type="button" onClick={() => { setError(''); setAttempt(value => value + 1) }}
            className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">Thử lại</button>
        </div>}
        {success && <p role="status" className="rounded-lg border border-trail/20 bg-trail/10 p-4 text-sm text-trail">{success}</p>}
        {saveError && <p role="alert" className="rounded-lg border border-clay/20 bg-clay/10 p-4 text-sm text-clay">{saveError}</p>}
        {account && !canEdit && <p className="rounded-lg border border-stone bg-white p-4 text-sm text-ink/65">Chỉ Master admin mới được chỉnh sửa tài khoản Master admin.</p>}
        {needsReload && !saving && <button type="button" onClick={() => dirty ? setDiscardAction('reload') : reloadDetails()}
          className="rounded-lg border border-stone bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-paper">Tải lại để đối chiếu</button>}
        {account && <>
          {details.identity_mismatches?.length > 0 && <p role="status" className="rounded-lg border border-gold/40 bg-gold/10 p-4 text-sm text-ink">
            Cần đối chiếu: {details.identity_mismatches.map(field => FIELD_LABELS[field] || field).join(', ')} giữa tài khoản và hồ sơ đăng ký chưa khớp.
          </p>}
          {showEditor ? <AccountDetailsEditor details={details} canGrantMasterAdmin={canGrantMasterAdmin} saving={saving}
            onSave={saveDetails} onDirtyChange={setDirty} /> : <>
          <Section title="Tài khoản đăng nhập">
            <Fields rows={[
              ['Họ tên', account.full_name], ['Email đăng nhập', account.email],
              ['MSSV', account.mssv], ['Vai trò', ROLES[account.role] || account.role],
              ['Trạng thái', account.is_active ? 'Hoạt động' : 'Đã khóa'],
              ['Liên kết Google', account.google_linked ? 'Đã liên kết' : 'Chưa liên kết'],
              ['Số điện thoại', account.phone], ['Trường', account.school], ['Khoa', account.faculty],
              ['Địa chỉ ảnh đại diện', account.avatar],
              ['Tạo tài khoản', formatDateTime(account.created_at)], ['Cập nhật', formatDateTime(account.updated_at)],
              ['Đăng nhập gần nhất', formatDateTime(account.last_login)],
            ]} />
          </Section>
          <Section title="Hồ sơ đăng ký đã liên kết">
            {profile ? <Fields rows={[
              ['Họ tên', profile.full_name], ['MSSV', profile.mssv], ['Email hồ sơ', profile.email],
              ['Số điện thoại', profile.phone], ['Trường', profile.school], ['Khoa', profile.faculty],
              ['CCCD', profile.cccd], ['Ngày sinh', profile.date_of_birth], ['Facebook', profile.facebook],
              ['Tài khoản Discord', profile.discord_username], ['Discord ID', profile.discord_id],
              ['Tạo hồ sơ', formatDateTime(profile.created_at)], ['Cập nhật hồ sơ', formatDateTime(profile.updated_at)],
            ]} /> : <p className="text-sm text-ink/55">Tài khoản chưa liên kết hồ sơ đăng ký.</p>}
          </Section>
          <Section title="Đội tham gia">
            {team ? <Fields rows={[
              ['Tên đội', team.name], ['Mã đội', team.code], ['Vai trò trong đội', team.is_captain ? 'Đội trưởng' : 'Thành viên'],
              ['Trạng thái duyệt', APPROVAL[team.approval_status] || team.approval_status],
              ['Số thứ tự thành viên', team.team_number], ['Tham gia đội', formatDateTime(team.joined_at)],
              ['Xác nhận thanh toán', team.payment_confirmed_at ? formatDateTime(team.payment_confirmed_at) : 'Chưa xác nhận'],
            ]} /> : <p className="text-sm text-ink/55">Chưa có đội gắn với hồ sơ này.</p>}
          </Section>
          {extra && <Section title="Thông tin đăng ký bổ sung">
            <Fields rows={typeof extra === 'object' && !Array.isArray(extra)
              ? Object.entries(extra).map(([key, value]) => [details.extra_labels?.[key] || key, value])
              : [['Thông tin bổ sung', extra]]} />
          </Section>}
          </>}
        </>}
      </div>
      <footer className="border-t border-stone bg-white px-5 py-4">
        {discardAction ? <div>
          <p role="alert" className="mb-3 text-sm text-ink">{discardAction === 'reload' ? 'Tải lại sẽ bỏ các thay đổi chưa lưu để đối chiếu thông tin mới nhất.' : 'Bạn có thay đổi chưa lưu. Đóng chi tiết sẽ bỏ các thay đổi này.'}</p>
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={() => setDiscardAction('')} className="rounded-lg border border-stone px-4 py-2 text-sm font-semibold text-ink hover:bg-paper">Tiếp tục sửa</button>
            <button type="button" onClick={() => discardAction === 'reload' ? reloadDetails() : onClose()}
              className="rounded-lg bg-clay px-4 py-2 text-sm font-semibold text-white">Bỏ thay đổi{discardAction === 'reload' ? ' và tải lại' : ' và đóng'}</button>
          </div>
        </div> : <div className="flex flex-wrap items-center justify-end gap-3">
          {showEditor ? <>
            <span className="mr-auto text-xs text-ink/55" role="status">{saving ? 'Đang lưu và cập nhật…' : dirty ? 'Có thay đổi chưa lưu' : 'Chưa có thay đổi'}</span>
            <button type="button" disabled={saving} onClick={resetEditor} className="rounded-lg border border-stone px-4 py-2 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-40">Hủy</button>
            <button type="submit" form="account-details-editor" disabled={!dirty || saving} className="rounded-lg bg-trail px-5 py-2 text-sm font-semibold text-white hover:bg-trail/90 disabled:cursor-not-allowed disabled:opacity-40">{saving ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
          </> : <>
            <button type="button" disabled={saving} onClick={requestClose} className="rounded-lg border border-stone px-5 py-2 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-40">Đóng</button>
            {canEdit && <button type="button" disabled={refreshing || saving || needsReload} onClick={() => { setSuccess(''); setEditing(true) }}
              className="rounded-lg bg-trail px-5 py-2 text-sm font-semibold text-white hover:bg-trail/90 disabled:opacity-40">Chỉnh sửa</button>}
          </>}
        </div>}
      </footer>
    </aside>
  </div>
}
