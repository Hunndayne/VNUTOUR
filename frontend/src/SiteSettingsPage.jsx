import { useEffect, useState } from 'react'
import { CARD, Icon } from './ui.jsx'
import { apiRequest, logoutAndRedirect } from './api.js'
import banksData from './lib/banks.json'

// ─────────────────────────────────────────────────────────────────────
// System-wide (admin) settings. Distinct from SettingsPage, which is the
// personal account page. Each card is self-contained — it owns its own
// loading / apiError / successMsg, mirroring the PaymentConfigSection idiom
// this file inherited from AdminDashboard.
// ─────────────────────────────────────────────────────────────────────
const FIELD_CLASS = 'w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10'
const LABEL_CLASS = 'mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40'
const PRIMARY_BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.9] disabled:cursor-not-allowed disabled:opacity-40'

function ErrorNote({ children }) {
  if (!children) return null
  return <div className="rounded-lg border border-clay/20 bg-clay/10 px-3 py-2 text-sm text-clay">{children}</div>
}

function SuccessNote({ children }) {
  if (!children) return null
  return <div className="rounded-lg border border-trail/20 bg-trail/10 px-3 py-2 text-sm text-trail">{children}</div>
}

// ─────────────────────────────────────────────────────────────────────
// a. Mở / đóng đăng ký — site-wide signup switch
// ─────────────────────────────────────────────────────────────────────
function RegistrationToggleSection() {
  const [open, setOpen] = useState(false)
  const [serverOpen, setServerOpen] = useState(false)
  const [maxReg, setMaxReg] = useState(0)
  const [serverMaxReg, setServerMaxReg] = useState(0)
  const [currentReg, setCurrentReg] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      try {
        setLoading(true)
        setApiError('')
        const payload = await apiRequest('/admin/site-config')
        if (cancelled) return
        const value = Boolean(payload?.registration_open)
        const maxVal = Number(payload?.max_registrations) || 0
        const curVal = Number(payload?.current_registrations) || 0
        setServerOpen(value)
        setOpen(value)
        setServerMaxReg(maxVal)
        setMaxReg(maxVal)
        setCurrentReg(curVal)
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) { logoutAndRedirect('/login'); return }
        setApiError('Không tải được cấu hình đăng ký.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [])

  // Stays disabled until either the switch or the max registrations differs from server
  const isDirty = open !== serverOpen || Number(maxReg) !== serverMaxReg

  const handleSave = async () => {
    setSaving(true)
    setApiError('')
    setSuccessMsg('')
    try {
      const safeMax = Math.max(0, parseInt(maxReg, 10) || 0)
      const payload = await apiRequest('/admin/site-config', {
        method: 'PUT',
        body: { registration_open: open, max_registrations: safeMax },
      })
      const value = Boolean(payload?.registration_open)
      const maxVal = Number(payload?.max_registrations) || 0
      const curVal = Number(payload?.current_registrations) || 0
      setServerOpen(value)
      setOpen(value)
      setServerMaxReg(maxVal)
      setMaxReg(maxVal)
      setCurrentReg(curVal)
      setSuccessMsg('Đã lưu cấu hình đăng ký.')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (error) {
      if (error?.status === 401) { logoutAndRedirect('/login'); return }
      setApiError('Không thể lưu cấu hình đăng ký. Vui lòng thử lại.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className={`${CARD} px-4 py-14 text-center text-sm text-ink/35`}>
        Đang tải cấu hình đăng ký...
      </div>
    )
  }

  return (
    <div className={`${CARD} p-5`}>
      <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">
        Mở / đóng &amp; giới hạn đăng ký
      </h3>

      <div className="space-y-4">
        <ErrorNote>{apiError}</ErrorNote>
        <SuccessNote>{successMsg}</SuccessNote>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-stone bg-paper px-4 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Cho phép đăng ký tài khoản mới</p>
            <p className="mt-1 text-xs leading-5 text-ink/45">
              Khi tắt, trang đăng nhập sẽ ẩn nút đăng ký và không ai tạo được tài khoản
              mới trên toàn hệ thống. Các tài khoản hiện có vẫn đăng nhập bình thường.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={open}
            aria-label="Cho phép đăng ký tài khoản mới"
            onClick={() => setOpen(v => !v)}
            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
              open ? 'bg-trail' : 'bg-stone'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                open ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        <div className="rounded-lg border border-stone bg-paper px-4 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <label htmlFor="max-registrations-input" className="text-sm font-semibold text-ink">
                Số lượng đăng ký tối đa (người)
              </label>
              <p className="mt-1 text-xs leading-5 text-ink/45">
                Đặt 0 hoặc để trống = không giới hạn. Khi tổng số người đăng ký đạt con số này, trang đăng ký sẽ tự động khoá.
              </p>
            </div>
            <div className="shrink-0">
              <input
                id="max-registrations-input"
                type="number"
                min="0"
                value={maxReg === 0 ? '' : maxReg}
                onChange={(e) => {
                  const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0)
                  setMaxReg(val)
                }}
                placeholder="0 (Không giới hạn)"
                className="w-40 rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-stone/60 pt-3 text-xs text-ink/60">
            <span className="font-medium">Số người đã đăng ký:</span>
            <span className="font-mono font-semibold text-ink">
              {currentReg}
              {serverMaxReg > 0 ? ` / ${serverMaxReg}` : ' (không giới hạn)'}
            </span>
            {serverMaxReg > 0 && currentReg >= serverMaxReg && (
              <span className="rounded bg-clay/10 px-1.5 py-0.5 text-[11px] font-semibold text-clay">
                Đã đủ số lượng
              </span>
            )}
          </div>
        </div>

        <button type="button" onClick={handleSave} disabled={saving || !isDirty} className={PRIMARY_BTN}>
          <Icon name="checkPlain" className="h-4 w-4" />
          {saving ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// b. Chống bot — Turnstile cho các endpoint công khai
// ─────────────────────────────────────────────────────────────────────
function AntibotToggleSection() {
  const [enabled, setEnabled] = useState(false)
  const [serverEnabled, setServerEnabled] = useState(false)
  const [keysReady, setKeysReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      try {
        setLoading(true)
        setApiError('')
        const payload = await apiRequest('/admin/site-config')
        if (cancelled) return
        const antibot = payload?.antibot || {}
        setServerEnabled(Boolean(antibot.enabled))
        setEnabled(Boolean(antibot.enabled))
        setKeysReady(antibot.turnstile_ready !== false)
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) { logoutAndRedirect('/login'); return }
        setApiError('Không tải được cấu hình chống bot.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [])

  const isDirty = enabled !== serverEnabled

  const handleSave = async () => {
    setSaving(true)
    setApiError('')
    setSuccessMsg('')
    try {
      const payload = await apiRequest('/admin/site-config', {
        method: 'PUT',
        body: { antibot_enabled: enabled },
      })
      const antibot = payload?.antibot || {}
      setServerEnabled(Boolean(antibot.enabled))
      setEnabled(Boolean(antibot.enabled))
      setKeysReady(antibot.turnstile_ready !== false)
      setSuccessMsg('Đã lưu cấu hình chống bot.')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (error) {
      if (error?.status === 401) { logoutAndRedirect('/login'); return }
      setApiError('Không thể lưu cấu hình chống bot. Vui lòng thử lại.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className={`${CARD} px-4 py-14 text-center text-sm text-ink/35`}>
        Đang tải cấu hình chống bot...
      </div>
    )
  }

  return (
    <div className={`${CARD} p-5`}>
      <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">
        Chống bot
      </h3>

      <div className="space-y-4">
        <ErrorNote>{apiError}</ErrorNote>
        <SuccessNote>{successMsg}</SuccessNote>

        {!keysReady && (
          <div className="rounded-lg border border-gold/30 bg-gold/10 px-4 py-3 text-sm leading-6 text-[#9A6B12]">
            Chưa cấu hình <span className="font-mono text-xs">TURNSTILE_SITE_KEY</span> /{' '}
            <span className="font-mono text-xs">TURNSTILE_SECRET_KEY</span> trên server —
            bật công tắc sẽ không có tác dụng cho đến khi đủ cặp key.
          </div>
        )}

        <div className="flex items-start justify-between gap-4 rounded-lg border border-stone bg-paper px-4 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Yêu cầu xác minh Cloudflare Turnstile</p>
            <p className="mt-1 text-xs leading-5 text-ink/45">
              Khi bật, các form công khai (đăng nhập, đăng ký tài khoản, đăng ký thi, tải khung ảnh)
              yêu cầu xác minh vô hình của Cloudflare; server còn chặn honeypot và form nộp quá nhanh.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Bật chống bot Turnstile"
            onClick={() => setEnabled(v => !v)}
            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
              enabled ? 'bg-trail' : 'bg-stone'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        <button type="button" onClick={handleSave} disabled={saving || !isDirty} className={PRIMARY_BTN}>
          <Icon name="checkPlain" className="h-4 w-4" />
          {saving ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// c. Thanh toán / VietQR bank config (moved from AdminDashboard)
// ─────────────────────────────────────────────────────────────────────
const PAYMENT_CONFIG_DEFAULTS = {
  bank_bin: '',
  bank_short_name: '',
  account_no: '',
  account_name: '',
  fee_per_person: 25000,
  prefix: 'VNUTOUR2026',
}

function formFromPaymentConfig(cfg) {
  return {
    bank_bin: cfg?.bank_bin || '',
    bank_short_name: cfg?.bank_short_name || '',
    account_no: cfg?.account_no || '',
    account_name: cfg?.account_name || '',
    fee_per_person: cfg?.fee_per_person ?? PAYMENT_CONFIG_DEFAULTS.fee_per_person,
    prefix: cfg?.prefix || PAYMENT_CONFIG_DEFAULTS.prefix,
  }
}

function PaymentConfigSection() {
  const [config, setConfig] = useState(null)
  const [form, setForm] = useState(PAYMENT_CONFIG_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      try {
        setLoading(true)
        setApiError('')
        const payload = await apiRequest('/admin/payment-config')
        const next = payload?.payment_config || payload
        if (cancelled) return
        setConfig(next)
        setForm(formFromPaymentConfig(next))
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) { logoutAndRedirect('/login'); return }
        setApiError('Không tải được cấu hình thanh toán.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [])

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const handleBankChange = (e) => {
    const bin = e.target.value
    const bank = banksData.data.find(b => b.bin === bin)
    setForm(f => ({ ...f, bank_bin: bin, bank_short_name: bank ? bank.shortName : '' }))
  }

  const handleSave = async () => {
    setSaving(true)
    setApiError('')
    setSuccessMsg('')
    try {
      const feeInt = Number.parseInt(form.fee_per_person, 10)
      const safeFee = Number.isFinite(feeInt) && feeInt > 0 ? feeInt : PAYMENT_CONFIG_DEFAULTS.fee_per_person
      const body = {
        bank_bin: form.bank_bin,
        bank_short_name: form.bank_short_name,
        account_no: form.account_no,
        account_name: form.account_name,
        fee_per_person: safeFee,
        prefix: form.prefix,
      }
      const payload = await apiRequest('/admin/payment-config', { method: 'PUT', body })
      const next = payload?.payment_config || payload
      setConfig(next)
      setForm(formFromPaymentConfig(next))
      setSuccessMsg('Đã lưu cấu hình thanh toán.')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (error) {
      if (error?.status === 401) { logoutAndRedirect('/login'); return }
      setApiError('Không thể lưu cấu hình thanh toán. Vui lòng thử lại.')
    } finally {
      setSaving(false)
    }
  }

  const previewUrl = form.bank_bin && form.account_no
    ? `https://img.vietqr.io/image/${form.bank_bin}-${form.account_no}-compact2.png?amount=125000&addInfo=${encodeURIComponent(`${form.prefix} 123456 - 22521234 - NGUYEN VAN A`)}&accountName=${encodeURIComponent(form.account_name || '')}`
    : ''

  // Compares against the last value the server confirmed (either from the
  // initial load or the previous save) so the button stays disabled until
  // something actually changes — same "nothing to save" guard as the rest
  // of the settings tab.
  const isDirty = JSON.stringify(formFromPaymentConfig(config)) !== JSON.stringify(form)

  if (loading) {
    return (
      <div className={`${CARD} px-4 py-14 text-center text-sm text-ink/35`}>
        Đang tải cấu hình thanh toán...
      </div>
    )
  }

  return (
    <div className={`${CARD} p-5`}>
      <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">
        Thanh toán / Tài khoản nhận lệ phí
      </h3>

      <div className="space-y-4">
        <ErrorNote>{apiError}</ErrorNote>
        <SuccessNote>{successMsg}</SuccessNote>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={LABEL_CLASS}>Ngân hàng</label>
            <select value={form.bank_bin} onChange={handleBankChange} className={FIELD_CLASS}>
              <option value="">— Chọn ngân hàng —</option>
              {banksData.data.map(bank => (
                <option key={bank.bin} value={bank.bin}>{bank.shortName} — {bank.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLASS}>Số tài khoản</label>
            <input
              value={form.account_no}
              onChange={e => set('account_no', e.target.value)}
              placeholder="0123456789"
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label className={LABEL_CLASS}>Tên chủ tài khoản</label>
            <input
              value={form.account_name}
              onChange={e => set('account_name', e.target.value)}
              placeholder="NGUYEN VAN A"
              className={FIELD_CLASS}
            />
            <p className="mt-1 text-xs text-ink/40">IN HOA, KHÔNG DẤU</p>
          </div>

          <div>
            <label className={LABEL_CLASS}>Lệ phí / người (VND)</label>
            <input
              type="number"
              min="0"
              step="1000"
              value={form.fee_per_person}
              onChange={e => set('fee_per_person', e.target.value)}
              placeholder="25000"
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label className={LABEL_CLASS}>Tiền tố nội dung chuyển khoản</label>
            <input
              value={form.prefix}
              onChange={e => set('prefix', e.target.value)}
              placeholder="VNUTOUR2026"
              className={FIELD_CLASS}
            />
          </div>
        </div>

        <button type="button" onClick={handleSave} disabled={saving || !isDirty} className={PRIMARY_BTN}>
          <Icon name="checkPlain" className="h-4 w-4" />
          {saving ? 'Đang lưu...' : 'Lưu'}
        </button>

        {previewUrl && (
          <div className="border-t border-stone pt-4">
            <img
              src={previewUrl}
              alt="Xem trước mã VietQR"
              className="h-56 w-56 rounded-lg border border-stone bg-white object-contain p-2"
            />
            <p className="mt-2 text-xs text-ink/40">Xem trước QR (mẫu 5 người = 125.000₫)</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// b2. Hũ Timo — auto-reconciliation of bank transfers for the shared BTC pot.
// The share code / mật mã are hashed server-side on save and never returned,
// so this form only ever knows "configured: true/false" — there's nothing to
// pre-fill, only to overwrite.
// ─────────────────────────────────────────────────────────────────────
function TimoPotConfigSection() {
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [shareCode, setShareCode] = useState('')
  const [password, setPassword] = useState('')
  const [apiError, setApiError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    apiRequest('/admin/timo-pot-config')
      .then((payload) => { if (!cancelled) setConfigured(Boolean(payload?.configured)) })
      .catch((error) => {
        if (cancelled) return
        if (error?.status === 401) { logoutAndRedirect('/login'); return }
        setApiError('Không tải được trạng thái cấu hình hũ Timo.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleSave = async () => {
    if (!shareCode.trim()) return
    setSaving(true)
    setApiError('')
    setSuccessMsg('')
    try {
      const payload = await apiRequest('/admin/timo-pot-config', {
        method: 'PUT',
        body: { share_code: shareCode.trim(), password: password.trim() || null },
      })
      setConfigured(Boolean(payload?.configured))
      setShareCode('')
      setPassword('')
      setSuccessMsg('Đã lưu cấu hình hũ Timo.')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (error) {
      if (error?.status === 401) { logoutAndRedirect('/login'); return }
      setApiError('Không thể lưu cấu hình hũ Timo. Kiểm tra lại link/mã.')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setSaving(true)
    setApiError('')
    try {
      await apiRequest('/admin/timo-pot-config', { method: 'DELETE' })
      setConfigured(false)
      setSuccessMsg('Đã tắt tự động xác nhận qua Timo.')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (error) {
      if (error?.status === 401) { logoutAndRedirect('/login'); return }
      setApiError('Không tắt được cấu hình.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className={`${CARD} px-4 py-14 text-center text-sm text-ink/35`}>
        Đang tải cấu hình hũ Timo...
      </div>
    )
  }

  return (
    <div className={`${CARD} p-5`}>
      <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">
        Tự động xác nhận thanh toán — Hũ Timo
      </h3>
      <p className="mb-4 text-xs leading-5 text-ink/45">
        Cấu hình MỘT hũ Timo chung của BTC. Khi đội trưởng bấm "Đã chuyển tiền", hệ thống quét
        một lượt lịch sử giao dịch của hũ này (không tự quét định kỳ) để tìm khớp mã đội + số tiền.
        Chưa cấu hình thì đội vẫn dùng được luồng upload minh chứng thủ công như cũ.
      </p>

      <div className="space-y-4">
        <ErrorNote>{apiError}</ErrorNote>
        <SuccessNote>{successMsg}</SuccessNote>

        <div className="rounded-lg border border-stone bg-white px-3 py-2 text-sm">
          Trạng thái:{' '}
          <span className={configured ? 'font-semibold text-emerald-700' : 'font-semibold text-ink/45'}>
            {configured ? 'Đã cấu hình' : 'Chưa cấu hình'}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={LABEL_CLASS}>Link chia sẻ hũ (share.timo.vn/...) hoặc mã</label>
            <input
              value={shareCode}
              onChange={(e) => setShareCode(e.target.value)}
              placeholder="https://share.timo.vn/VN/transaction/xxxx"
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Mật mã bảo vệ hũ (nếu có)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Để trống nếu hũ không đặt mật mã"
              className={FIELD_CLASS}
            />
            <p className="mt-1 text-xs text-ink/40">Chỉ lưu ở dạng băm — không thể xem lại sau khi lưu.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleSave} disabled={saving || !shareCode.trim()} className={PRIMARY_BTN}>
            <Icon name="checkPlain" className="h-4 w-4" />
            {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
          </button>
          {configured && (
            <button
              type="button"
              onClick={handleClear}
              disabled={saving}
              className="rounded-lg border border-stone bg-white px-4 py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40"
            >
              Tắt tự động xác nhận
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// c. Schema form đăng ký — JSON editor for the registration schema
// ─────────────────────────────────────────────────────────────────────
function RegistrationSchemaSection() {
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState('')
  const [parseError, setParseError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      try {
        setLoading(true)
        setApiError('')
        const payload = await apiRequest('/admin/registration-schema')
        if (cancelled) return
        const pretty = JSON.stringify(payload ?? {}, null, 2)
        setText(pretty)
        setSavedText(pretty)
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) { logoutAndRedirect('/login'); return }
        setApiError('Không tải được schema đăng ký.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    boot()
    return () => { cancelled = true }
  }, [])

  const isDirty = text !== savedText

  const handleFormat = () => {
    setParseError('')
    try {
      setText(JSON.stringify(JSON.parse(text), null, 2))
    } catch (error) {
      setParseError(`JSON không hợp lệ: ${error.message}`)
    }
  }

  const handleSave = async () => {
    setParseError('')
    setApiError('')
    setSuccessMsg('')

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      setParseError(`JSON không hợp lệ: ${error.message}`)
      return
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setParseError('Schema phải là một object JSON (bắt đầu bằng "{").')
      return
    }

    setSaving(true)
    try {
      const payload = await apiRequest('/admin/registration-schema', {
        method: 'PUT',
        body: { schema: parsed },
      })
      const pretty = JSON.stringify(payload ?? {}, null, 2)
      setText(pretty)
      setSavedText(pretty)
      setSuccessMsg('Đã lưu schema đăng ký.')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (error) {
      if (error?.status === 401) { logoutAndRedirect('/login'); return }
      setApiError('Không thể lưu schema đăng ký. Vui lòng thử lại.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className={`${CARD} px-4 py-14 text-center text-sm text-ink/35`}>
        Đang tải schema đăng ký...
      </div>
    )
  }

  return (
    <div className={`${CARD} p-5`}>
      <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/40">
        Schema form đăng ký
      </h3>

      <div className="space-y-4">
        <p className="text-xs leading-5 text-ink/45">
          Chỉnh trực tiếp JSON của schema đăng ký (gồm mảng <span className="font-mono">person_fields</span>).
          Nội dung được kiểm tra cú pháp trước khi lưu.
        </p>

        <ErrorNote>{apiError}</ErrorNote>
        <SuccessNote>{successMsg}</SuccessNote>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          spellCheck={false}
          rows={20}
          className="h-96 w-full resize-y rounded-lg border border-stone bg-white px-3 py-2.5 font-mono text-xs leading-5 text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
        />

        {parseError && (
          <div className="rounded-lg border border-clay/20 bg-clay/10 px-3 py-2 font-mono text-xs text-clay">
            {parseError}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button type="button" onClick={handleSave} disabled={saving || !isDirty} className={PRIMARY_BTN}>
            <Icon name="checkPlain" className="h-4 w-4" />
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
          <button
            type="button"
            onClick={handleFormat}
            className="rounded-lg border border-stone bg-white px-4 py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper"
          >
            Định dạng lại
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────
function SiteSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <RegistrationToggleSection />
      <AntibotToggleSection />
      <PaymentConfigSection />
      <TimoPotConfigSection />
      <RegistrationSchemaSection />
    </div>
  )
}

export default SiteSettingsPage
