import { useCallback, useEffect, useState } from 'react'
import { CARD, Icon } from './ui.jsx'
import { apiRequest, formatDateTime, getStoredUser, logoutAndRedirect } from './api.js'
import { useDraftState, DraftNotice } from './drafts.jsx'
import { useDiscordConnect } from './discordConnect.js'
import { DiscordMark } from './DiscordConnectCard.jsx'

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
const FIELD_CLASS = 'w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10'
const LABEL_CLASS = 'mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40'
const PRIMARY_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40'
const SECONDARY_BTN = 'rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper'

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  const map = {
    invalid_json: 'Dữ liệu gửi lên không hợp lệ.',
    duplicate_field: 'MSSV này đã được sử dụng bởi tài khoản khác.',
    mssv_taken: 'MSSV này đã được sử dụng bởi tài khoản khác.',
    registration_mismatch: 'MSSV này đã được đăng ký với email khác. Vui lòng kiểm tra lại.',
    missing_fields: 'Vui lòng điền đầy đủ các trường bắt buộc.',
    password_too_short: 'Mật khẩu mới phải có ít nhất 6 ký tự.',
    invalid_current_password: 'Mật khẩu hiện tại không đúng.',
    google_account_no_password: 'Tài khoản Google không có mật khẩu riêng. Hãy dùng Google để đăng nhập.',
    already_linked: 'Tài khoản đã được liên kết Google.',
    not_linked: 'Tài khoản chưa liên kết Google.',
    email_mismatch: 'Email Google không khớp với email tài khoản hiện tại.',
    google_already_linked_other: 'Tài khoản Google này đã được liên kết với một tài khoản khác.',
    invalid_google_token: 'Xác thực Google không hợp lệ. Vui lòng thử lại.',
    missing_credential: 'Thiếu thông tin xác thực Google.',
    google_auth_not_configured: 'Đăng nhập Google chưa được cấu hình trên server.',
    token_audience_mismatch: 'Token Google không khớp với client ID.',
    missing_sub: 'Không thể xác định danh tính Google.',
  }
  return map[code] || 'Không thể thực hiện thao tác này.'
}

// ─────────────────────────────────────────────────────────────────────
// Avatar section
// ─────────────────────────────────────────────────────────────────────
function AvatarSection({ avatar, username, onAvatarChange }) {
  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState(avatar || '')

  const handleSave = () => {
    onAvatarChange(url.trim())
    setEditing(false)
  }

  const handleCancel = () => {
    setUrl(avatar || '')
    setEditing(false)
  }

  const initial = (username || 'U').charAt(0).toUpperCase()

  return (
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
      <div className="relative">
        {avatar ? (
          <img
            src={avatar}
            alt="Avatar"
            className="h-20 w-20 rounded-full border-2 border-stone object-cover"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
          />
        ) : null}
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-full border-2 border-stone bg-trail font-display text-2xl font-bold text-white ${avatar ? 'hidden' : ''}`}
        >
          {initial}
        </div>
      </div>

      <div className="min-w-0">
        {editing ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-[280px]">
              <label className={LABEL_CLASS}>URL ảnh đại diện</label>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://..."
                className={FIELD_CLASS}
              />
            </div>
            <button type="button" onClick={handleSave} className={PRIMARY_BTN}>
              <Icon name="checkPlain" className="h-4 w-4" />
              Lưu
            </button>
            <button type="button" onClick={handleCancel} className={SECONDARY_BTN + ' px-4'}>
              Huỷ
            </button>
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-sm font-medium text-trail hover:underline"
            >
              {avatar ? 'Đổi ảnh đại diện' : 'Thêm ảnh đại diện'}
            </button>
            <p className="mt-1 text-xs text-ink/40">
              Dán URL ảnh từ web (Google Photos, Imgur, Cloudinary...)
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Profile form
// ─────────────────────────────────────────────────────────────────────
function ProfileSection({ profile, onSave, saving }) {
  // Keyed remount on successful save (see SettingsPage) gives this a fresh
  // baseline each time, so `draft.dirty` reflects "since the last save" and
  // not "since the page first loaded".
  const [form, setForm, draft] = useDraftState('settings:profile', () => ({ ...profile }))

  const set = (key, value) => {
    setForm(f => ({ ...f, [key]: value }))
  }

  const handleSave = async () => {
    const payload = {}
    for (const key of ['full_name', 'mssv', 'phone', 'school', 'faculty']) {
      if (form[key] !== profile[key]) {
        payload[key] = form[key]
      }
    }
    const ok = await onSave(payload)
    // A successful save is echoed back as a fresh `profile` prop, which remounts
    // this component (new key) and resets the baseline — but that happens a
    // render later, so the now-stale draft would otherwise get rewritten to
    // localStorage by the debounce effect before the remount lands.
    if (ok) draft.clear()
  }

  return (
    <div className="space-y-4">
      <DraftNotice draft={draft} label="thông tin hồ sơ" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLASS}>Tên hiển thị</label>
          <input
            value={form.full_name}
            onChange={e => set('full_name', e.target.value)}
            placeholder="Nguyễn Văn A"
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>Email</label>
          <input
            value={form.email}
            disabled
            className={FIELD_CLASS + ' bg-paper text-ink/50 cursor-not-allowed'}
            title="Email không thể thay đổi"
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>MSSV</label>
          <input
            value={form.mssv}
            onChange={e => set('mssv', e.target.value)}
            placeholder="Nhập mã số sinh viên"
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>Số điện thoại</label>
          <input
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            placeholder="090xxxxxxx"
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>Trường</label>
          <input
            value={form.school}
            onChange={e => set('school', e.target.value)}
            placeholder="VD: Đại học Công nghệ Thông tin"
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label className={LABEL_CLASS}>Khoa / Ngành</label>
          <input
            value={form.faculty}
            onChange={e => set('faculty', e.target.value)}
            placeholder="VD: Khoa học Máy tính"
            className={FIELD_CLASS}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={!draft.dirty || saving}
        className={PRIMARY_BTN}
      >
        <Icon name="checkPlain" className="h-4 w-4" />
        {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Password change
// ─────────────────────────────────────────────────────────────────────
function PasswordSection({ hasGoogle, onPasswordChange, busy }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState('')

  const handleSubmit = () => {
    setLocalError('')
    if (!current || !next || !confirm) {
      setLocalError('Vui lòng điền đầy đủ các trường.')
      return
    }
    if (next.length < 6) {
      setLocalError('Mật khẩu mới phải có ít nhất 6 ký tự.')
      return
    }
    if (next !== confirm) {
      setLocalError('Mật khẩu mới không khớp.')
      return
    }
    onPasswordChange(current, next)
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  if (hasGoogle) {
    return (
      <div className="rounded-lg border border-stone bg-paper px-4 py-4">
        <p className="text-sm text-ink/60">
          Tài khoản của bạn đăng nhập qua Google, không có mật khẩu riêng. Hãy tiếp tục dùng nút <strong>Đăng nhập với Google</strong>.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {localError && (
        <div className="rounded-lg border border-clay/20 bg-clay/10 px-3 py-2 text-sm text-clay">
          {localError}
        </div>
      )}
      <div>
        <label className={LABEL_CLASS}>Mật khẩu hiện tại</label>
        <input
          type="password"
          value={current}
          onChange={e => setCurrent(e.target.value)}
          className={FIELD_CLASS}
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>Mật khẩu mới</label>
        <input
          type="password"
          value={next}
          onChange={e => setNext(e.target.value)}
          className={FIELD_CLASS}
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>Nhập lại mật khẩu mới</label>
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className={FIELD_CLASS}
        />
      </div>
      <button type="button" onClick={handleSubmit} disabled={busy} className={PRIMARY_BTN}>
        <Icon name="checkPlain" className="h-4 w-4" />
        {busy ? 'Đang đổi...' : 'Đổi mật khẩu'}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Google link section
// ─────────────────────────────────────────────────────────────────────
function GoogleSection({ googleLinked, googleEmail, onUnlink, unlinking, onLinkClick }) {
  if (googleLinked) {
    return (
      <div className="flex items-start justify-between gap-4 rounded-lg border border-stone bg-paper px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-trail/12 text-trail">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">Đã liên kết Google</p>
            <p className="text-xs text-ink/45">{googleEmail}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onUnlink}
          disabled={unlinking}
          className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-semibold text-ink/55 transition hover:border-clay/30 hover:text-clay disabled:opacity-40"
        >
          {unlinking ? 'Đang huỷ...' : 'Huỷ liên kết'}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-stone bg-paper px-4 py-4">
      <p className="mb-3 text-sm text-ink/60">
        Liên kết tài khoản Google để đăng nhập nhanh hơn và không cần nhớ mật khẩu.
      </p>
      <button
        type="button"
        onClick={onLinkClick}
        className={PRIMARY_BTN}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        Liên kết Google
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Discord link section (participants only). Self-contained: manages its own
// OAuth state through the shared hook. Connecting a new account here first
// cancels any existing link (reconnect = unlink then authorize).
// ─────────────────────────────────────────────────────────────────────
const DISCORD_BTN = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40'
const DISCORD_UNLINK_BTN = 'rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-semibold text-ink/55 transition hover:border-clay/30 hover:text-clay disabled:opacity-40'

function DiscordSection() {
  const { status, loading, busy, error, notice, connect, unlink, reconnect } = useDiscordConnect()

  if (loading) {
    return (
      <div className="rounded-lg border border-stone bg-paper px-4 py-4 text-sm text-ink/45">
        Đang tải trạng thái Discord...
      </div>
    )
  }

  const linked = Boolean(status?.linked)
  const inServer = status?.in_server
  const configured = Boolean(status?.oauth?.configured)
  const handle = status?.discord_username
  const serverNote = inServer === true
    ? 'Đã vào máy chủ Discord.'
    : inServer === false
      ? 'Chưa thấy bạn trong máy chủ — hãy vào server bằng đúng tài khoản này.'
      : 'Chưa xác nhận được tình trạng trong máy chủ.'

  return (
    <div className="space-y-3">
      {notice && (
        <div className="rounded-lg border border-trail/20 bg-trail/10 px-3 py-2 text-sm text-trail">{notice}</div>
      )}
      {error && (
        <div className="rounded-lg border border-clay/20 bg-clay/10 px-3 py-2 text-sm text-clay">{error}</div>
      )}
      {!configured && (
        <div className="rounded-lg border border-stone bg-paper px-4 py-3 text-sm text-ink/55">
          BTC chưa bật kết nối Discord qua web. Bạn có thể dùng lệnh
          <span className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono text-xs">/assign &lt;mssv&gt;</span>
          trong Discord.
        </div>
      )}

      {linked ? (
        <div className="rounded-lg border border-stone bg-paper px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#5865F2]/12 text-[#5865F2]">
                <DiscordMark className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">Đã liên kết Discord</p>
                <p className="font-mono text-xs text-ink/45">{handle ? `@${handle}` : 'Đã liên kết'}</p>
              </div>
            </div>
            <button type="button" onClick={unlink} disabled={Boolean(busy)} className={DISCORD_UNLINK_BTN}>
              {busy === 'unlink' ? 'Đang huỷ...' : 'Huỷ liên kết'}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink/45">{serverNote}</p>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => reconnect('settings')}
              disabled={!configured || Boolean(busy)}
              className={DISCORD_BTN}
            >
              <DiscordMark className="h-4 w-4" />
              {busy === 'reconnect' ? 'Đang mở...' : 'Đổi sang tài khoản khác'}
            </button>
            <p className="mt-1.5 text-xs text-ink/40">
              Kết nối tài khoản mới sẽ tự huỷ liên kết của tài khoản đang gắn.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-stone bg-paper px-4 py-4">
          <p className="mb-3 text-sm text-ink/60">
            Liên kết tài khoản Discord để nhận role và kênh riêng của đội mà không cần gõ lệnh.
            Hãy vào máy chủ Discord trước bằng đúng tài khoản này.
          </p>
          <button
            type="button"
            onClick={() => connect('settings')}
            disabled={!configured || Boolean(busy)}
            className={DISCORD_BTN}
          >
            <DiscordMark className="h-4 w-4" />
            Liên kết Discord
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Session section
// ─────────────────────────────────────────────────────────────────────
function SessionSection({ session, onLogoutAll }) {
  return (
    <div className="rounded-lg border border-stone bg-paper px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-ink">Phiên đăng nhập hiện tại</p>
          <p className="mt-1 text-xs text-ink/45">
            Đăng nhập lúc: {session?.created_at ? formatDateTime(session.created_at) : '—'}
          </p>
          <p className="mt-0.5 max-w-md truncate text-xs text-ink/35">
            {session?.user_agent || '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={onLogoutAll}
          className="rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-semibold text-clay transition hover:bg-clay/5 disabled:opacity-40"
        >
          Đăng xuất
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────
function SettingsPage() {
  const [profile, setProfile] = useState(() => ({
    full_name: '',
    email: '',
    mssv: '',
    phone: '',
    school: '',
    faculty: '',
    avatar: '',
    google_linked: false,
    role: '',
    session: null,
  }))
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState('')
  const [apiError, setApiError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  // Bumped only after a profile-field save lands, so ProfileSection remounts
  // and picks up the saved values as its new draft baseline. Other reloads
  // (avatar, Google link) leave it alone — remounting on those too would flash
  // a spurious "đã khôi phục bản nháp" notice over an unrelated, still-dirty edit.
  const [profileVersion, setProfileVersion] = useState(0)
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || null

  const loadProfile = useCallback(async () => {
    const me = await apiRequest('/auth/me')
    setProfile({
      full_name: me.full_name || '',
      email: me.email || '',
      mssv: me.mssv || '',
      phone: me.phone || '',
      school: me.school || '',
      faculty: me.faculty || '',
      avatar: me.avatar || '',
      google_linked: Boolean(me.google_linked),
      role: me.role || '',
      session: me.session || null,
    })
    // Update localStorage user
    try {
      const stored = getStoredUser()
      if (stored) {
        const updated = { ...stored, full_name: me.full_name, mssv: me.mssv, email: me.email }
        localStorage.setItem('user', JSON.stringify(updated))
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      try {
        setLoading(true)
        await loadProfile()
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) { logoutAndRedirect('/login'); return }
        setApiError(explainApiError(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    bootstrap()
    return () => { cancelled = true }
  }, [loadProfile])

  // Reports whether `task` completed so callers (ProfileSection's save) can
  // tell a real success apart from an error that's already been shown here.
  const withBusy = async (key, task) => {
    setBusyKey(key)
    setApiError('')
    setSuccessMsg('')
    try {
      await task()
      return true
    } catch (error) {
      if (error?.status === 401) { logoutAndRedirect('/login'); return false }
      setApiError(explainApiError(error))
      return false
    } finally {
      setBusyKey('')
    }
  }

  const handleSaveProfile = (payload) => withBusy('profile', async () => {
    await apiRequest('/auth/me', { method: 'PATCH', body: payload })
    await loadProfile()
    setProfileVersion(v => v + 1)
    setSuccessMsg('Đã cập nhật hồ sơ.')
    setTimeout(() => setSuccessMsg(''), 3000)
  })

  const handleAvatarChange = (url) => withBusy('avatar', async () => {
    await apiRequest('/auth/me', { method: 'PATCH', body: { avatar: url } })
    await loadProfile()
    setSuccessMsg('Đã cập nhật ảnh đại diện.')
    setTimeout(() => setSuccessMsg(''), 3000)
  })

  const handlePasswordChange = (current, next) => withBusy('password', async () => {
    await apiRequest('/auth/me/password', {
      method: 'PUT',
      body: { current_password: current, new_password: next },
    })
    setSuccessMsg('Đã đổi mật khẩu.')
    setTimeout(() => setSuccessMsg(''), 3000)
  })

  const handleUnlinkGoogle = () => withBusy('unlink-google', async () => {
    await apiRequest('/auth/me/google', { method: 'DELETE' })
    await loadProfile()
    setSuccessMsg('Đã huỷ liên kết Google.')
    setTimeout(() => setSuccessMsg(''), 3000)
  })

  const handleLinkGoogle = () => {
    if (!googleClientId) {
      setApiError('Đăng nhập Google chưa được cấu hình.')
      return
    }

    if (!window.google?.accounts?.id) {
      setApiError('Google Identity Services chưa được tải. Vui lòng thử lại sau.')
      return
    }

    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async (response) => {
        const credential = response.credential
        if (!credential) return
        await withBusy('link-google', async () => {
          await apiRequest('/auth/me/google', {
            method: 'POST',
            body: { credential },
          })
          await loadProfile()
          setSuccessMsg('Đã liên kết Google thành công.')
          setTimeout(() => setSuccessMsg(''), 3000)
        })
      },
    })

    window.google.accounts.id.prompt()
  }

  const handleLogoutAll = () => {
    logoutAndRedirect('/login')
  }

  if (loading) {
    return (
      <div className={`${CARD} px-4 py-14 text-center text-sm text-ink/35`}>
        Đang tải cài đặt...
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Feedback */}
      {apiError && (
        <div className="rounded-xl border border-clay/20 bg-clay/10 px-4 py-3 text-sm text-clay">
          {apiError}
        </div>
      )}
      {successMsg && (
        <div className="rounded-xl border border-trail/20 bg-trail/10 px-4 py-3 text-sm text-trail">
          {successMsg}
        </div>
      )}

      {/* Hồ sơ */}
      <div className={`${CARD} p-5`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">Hồ sơ</h3>
        </div>
        <div className="space-y-5">
          <AvatarSection
            avatar={profile.avatar}
            username={profile.full_name || profile.email}
            onAvatarChange={handleAvatarChange}
          />
          <ProfileSection
            key={profileVersion}
            profile={profile}
            onSave={handleSaveProfile}
            saving={busyKey === 'profile'}
          />
        </div>
      </div>

      {/* Bảo mật */}
      <div className={`${CARD} p-5`}>
        <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">Bảo mật</h3>
        <div className="space-y-5">
          <div>
            <p className="mb-3 text-sm font-semibold text-ink">Đổi mật khẩu</p>
            <PasswordSection
              hasGoogle={profile.google_linked}
              onPasswordChange={handlePasswordChange}
              busy={busyKey === 'password'}
            />
          </div>

          <div className="border-t border-stone pt-5">
            <p className="mb-3 text-sm font-semibold text-ink">Liên kết Google</p>
            <GoogleSection
              googleLinked={profile.google_linked}
              googleEmail={profile.email}
              onUnlink={handleUnlinkGoogle}
              unlinking={busyKey === 'unlink-google'}
              onLinkClick={handleLinkGoogle}
            />
          </div>

          {profile.role === 'participant' && (
            <div className="border-t border-stone pt-5">
              <p className="mb-3 text-sm font-semibold text-ink">Liên kết Discord</p>
              <DiscordSection />
            </div>
          )}

          <div className="border-t border-stone pt-5">
            <p className="mb-3 text-sm font-semibold text-ink">Phiên đăng nhập</p>
            <SessionSection
              session={profile.session}
              onLogoutAll={handleLogoutAll}
            />
          </div>
        </div>
      </div>

    </div>
  )
}

export default SettingsPage
