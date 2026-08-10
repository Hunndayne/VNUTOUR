import { useState, useEffect, useRef, useCallback } from 'react'
import logoImage from './assets/vnutour-logo.png'
import { roleHomePath } from './api.js'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://10.147.17.251:8080/api'

const optValue = (o) => (typeof o === 'object' ? o.value : o)
const optLabel = (o) => (typeof o === 'object' ? o.label : o)

function LoginPage() {
  const [mode, setMode] = useState(() => (
    new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'signup' : 'login'
  )) // 'login' | 'signup'
  const [signupStep, setSignupStep] = useState('form') // 'form' | 'confirm' | 'manual'
  const [form, setForm] = useState({ username: '', email: '', mssv: '', password: '', confirmPassword: '' })
  const [matchInfo, setMatchInfo] = useState(null) // { full_name, school, faculty } from lookup
  const [basic, setBasic] = useState({ full_name: '', school: '', faculty: '' }) // manual entry
  const [schoolOptions, setSchoolOptions] = useState([])
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [googleReady, setGoogleReady] = useState(false)
  const googleInitialized = useRef(false)

  const resetSignup = () => {
    setSignupStep('form')
    setMatchInfo(null)
    setBasic({ full_name: '', school: '', faculty: '' })
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }))
  }

  // Pull the school dropdown options from the registration schema so signup and
  // the registration form stay in sync.
  useEffect(() => {
    if (mode !== 'signup' || schoolOptions.length) return
    fetch(`${API_BASE_URL}/register/schema`)
      .then(r => r.json())
      .then(s => {
        const field = (s?.person_fields || []).find(f => f.key === 'school')
        if (field?.options) setSchoolOptions(field.options)
      })
      .catch(() => {})
  }, [mode, schoolOptions.length])

  const handleApiError = useCallback((data, fallback) => {
    if (!data) return
    const map = {
      invalid_credentials: 'Tên đăng nhập hoặc mật khẩu không đúng',
      conflict: 'Tên đăng nhập, email hoặc MSSV đã tồn tại',
      username_email_or_mssv_exists: 'Tên đăng nhập, email hoặc MSSV đã tồn tại',
      registration_closed: 'Đăng ký hiện đang đóng. Vui lòng quay lại sau.',
      missing_credential: 'Không nhận được thông tin xác thực Google',
      invalid_google_token: 'Xác thực Google không hợp lệ. Vui lòng thử lại.',
      email_not_verified: 'Email Google của bạn chưa được xác minh.',
      forbidden: 'Bạn không có quyền thực hiện thao tác này.',
      missing_fields: 'Vui lòng điền đầy đủ thông tin.',
      missing_credentials: 'Vui lòng nhập tên đăng nhập và mật khẩu.',
      registration_mismatch: 'MSSV này đã được đăng ký với email khác. Vui lòng kiểm tra lại.',
      password_too_short: 'Mật khẩu chưa đạt độ dài tối thiểu của hệ thống.',
      too_many_attempts: 'Bạn thao tác quá nhiều lần. Vui lòng chờ rồi thử lại.',
    }
    setApiError(map[data.error] || `Lỗi: ${data.error || fallback}`)
  }, [])

  // ── Validation ──────────────────────────────────────────────────────
  const validateCredentials = () => {
    const e = {}
    if (!form.username.trim()) e.username = 'Vui lòng nhập tên đăng nhập'
    if (!form.email.trim()) e.email = 'Vui lòng nhập email'
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Email không hợp lệ'
    if (!form.mssv.trim()) e.mssv = 'Vui lòng nhập MSSV'
    if (!form.password) e.password = 'Vui lòng nhập mật khẩu'
    else if (form.password.length < 6) e.password = 'Mật khẩu phải có ít nhất 6 ký tự'
    if (form.confirmPassword !== form.password) e.confirmPassword = 'Mật khẩu xác nhận không khớp'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const persistAndRedirect = useCallback((data) => {
    localStorage.setItem('authToken', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    // Straight to the role's own screen. Going via `/` worked, but it made the
    // first thing after signing in a visible redirect off the landing page.
    window.location.replace(roleHomePath(data.user?.role))
  }, [])

  // ── Login ───────────────────────────────────────────────────────────
  const handleLogin = async () => {
    const e = {}
    if (!form.username.trim()) e.username = 'Vui lòng nhập tên đăng nhập'
    if (!form.password) e.password = 'Vui lòng nhập mật khẩu'
    setErrors(e)
    if (Object.keys(e).length) return

    setIsLoading(true); setApiError('')
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username, password: form.password }),
      })
      const data = await res.json()
      if (res.ok) persistAndRedirect(data)
      else handleApiError(data, `Lỗi ${res.status}`)
    } catch (err) {
      setApiError(err.message?.includes('fetch') ? 'Không thể kết nối tới server.' : `Lỗi: ${err.message}`)
    } finally { setIsLoading(false) }
  }

  // ── Signup step 1 → match ───────────────────────────────────────────
  const handleContinue = async () => {
    if (!validateCredentials()) return
    setIsLoading(true); setApiError('')
    try {
      const res = await fetch(`${API_BASE_URL}/register/lookup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mssv: form.mssv.trim(), email: form.email.trim() }),
      })
      const data = await res.json()
      if (data.status === 'match') {
        setMatchInfo({ full_name: data.full_name, school: data.school, faculty: data.faculty })
        setSignupStep('confirm')
      } else if (data.status === 'not_found') {
        setSignupStep('manual')
      } else if (data.status === 'email_mismatch') {
        setErrors(prev => ({ ...prev, mssv: 'MSSV này đã đăng ký với email khác. Vui lòng kiểm tra lại.' }))
      } else {
        setApiError('Không kiểm tra được thông tin. Vui lòng thử lại.')
      }
    } catch (err) {
      setApiError(err.message?.includes('fetch') ? 'Không thể kết nối tới server.' : `Lỗi: ${err.message}`)
    } finally { setIsLoading(false) }
  }

  // ── Signup final → create account ───────────────────────────────────
  const handleCreateAccount = async () => {
    // For the manual branch, require the basic fields.
    if (signupStep === 'manual') {
      const e = {}
      if (!basic.full_name.trim()) e.full_name = 'Vui lòng nhập họ và tên'
      if (!basic.school.trim()) e.school = 'Vui lòng chọn trường'
      if (!basic.faculty.trim()) e.faculty = 'Vui lòng nhập khoa'
      setErrors(e)
      if (Object.keys(e).length) return
    }
    const info = signupStep === 'confirm' ? matchInfo : basic
    setIsLoading(true); setApiError('')
    try {
      const res = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username, password: form.password, email: form.email,
          mssv: form.mssv.trim(),
          full_name: info?.full_name || undefined,
          school: info?.school || undefined,
          faculty: info?.faculty || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) persistAndRedirect(data)
      else handleApiError(data, `Lỗi ${res.status}`)
    } catch (err) {
      setApiError(err.message?.includes('fetch') ? 'Không thể kết nối tới server.' : `Lỗi: ${err.message}`)
    } finally { setIsLoading(false) }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (mode === 'login') return handleLogin()
    if (signupStep === 'form') return handleContinue()
    return handleCreateAccount()
  }

  // ── Google Identity Services ────────────────────────────────────────
  const handleGoogleCredential = useCallback(async (response) => {
    setIsLoading(true); setApiError('')
    try {
      const res = await fetch(`${API_BASE_URL}/auth/google`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential }),
      })
      const data = await res.json()
      if (res.ok) persistAndRedirect(data)
      else handleApiError(data, `Lỗi Google ${res.status}`)
    } catch (err) {
      setApiError(err.message?.includes('fetch') ? 'Không thể kết nối tới server.' : `Lỗi: ${err.message}`)
    } finally { setIsLoading(false) }
  }, [handleApiError, persistAndRedirect])

  useEffect(() => {
    if (googleInitialized.current) return
    googleInitialized.current = true

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) return

    const scriptId = 'google-gis-script'
    if (document.getElementById(scriptId)) {
      if (window.google?.accounts) {
        window.google.accounts.id.initialize({ client_id: clientId, callback: handleGoogleCredential })
        setGoogleReady(true)
      }
      return
    }

    const script = document.createElement('script')
    script.id = scriptId
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google?.accounts) {
        window.google.accounts.id.initialize({ client_id: clientId, callback: handleGoogleCredential })
        setGoogleReady(true)
      }
    }
    document.head.appendChild(script)
  }, [handleGoogleCredential])

  const renderGoogleButton = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) {
      return (
        <button type="button" disabled
          className="w-full flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/40 cursor-not-allowed">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Đăng nhập với Google (chưa cấu hình)
        </button>
      )
    }
    if (!googleReady) {
      return (
        <div className="flex items-center justify-center rounded-2xl border border-white/15 bg-white/[0.03] px-4 py-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span className="ml-3 text-sm text-white/50">Đang tải Google Sign-In...</span>
        </div>
      )
    }
    return (
      <div id="google-signin-btn"
        ref={(el) => {
          if (el && !el.hasChildNodes()) {
            window.google?.accounts.id.renderButton(el, {
              type: 'standard', theme: 'filled_black', size: 'large',
              text: 'signin_with', shape: 'pill',
              width: el.offsetWidth > 0 ? el.offsetWidth : 360,
            })
          }
        }}
        className="flex justify-center" />
    )
  }

  // ── Render helpers ──────────────────────────────────────────────────
  const inputClass = (hasErr) =>
    [
      'w-full rounded-2xl border px-4 py-3 text-sm text-white placeholder-white/30 bg-white/[0.06] backdrop-blur transition outline-none',
      hasErr
        ? 'border-rose-400/60 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/30'
        : 'border-white/15 focus:border-white/40 focus:ring-2 focus:ring-white/10',
    ].join(' ')

  const labelCls = 'text-sm font-medium text-white/70'

  const titleByStep = mode === 'login'
    ? 'Đăng nhập'
    : signupStep === 'form' ? 'Đăng ký'
    : signupStep === 'confirm' ? 'Xác nhận thông tin'
    : 'Bổ sung thông tin'

  const subtitleByStep = mode === 'login'
    ? 'Chào mừng trở lại! Vui lòng đăng nhập để tiếp tục.'
    : signupStep === 'form' ? 'Tạo tài khoản mới để tham gia VNUTour.'
    : signupStep === 'confirm' ? 'Chúng tôi đã tìm thấy đăng ký của bạn. Vui lòng xác nhận.'
    : 'Chưa có đăng ký khớp. Vui lòng điền thông tin cơ bản.'

  const showGoogle = mode === 'login'

  return (
    <main className="min-h-screen bg-[#0e1218] font-['Lato',Arial,sans-serif] flex items-center justify-center px-4 py-12">
      <div className="fixed inset-0 bg-black/70 z-0" />

      <div className="relative z-10 w-full max-w-md">
        <div className="flex justify-center mb-8">
          <a href="/" className="flex items-center gap-3">
            <img src={logoImage} alt="VNUTour" className="h-14 w-14 object-contain md:h-16 md:w-16" />
            <span className="text-xl font-bold uppercase text-white">VNUTour</span>
          </a>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-8 shadow-2xl">
          <h1 className="text-center text-2xl font-bold text-white">{titleByStep}</h1>
          <p className="mt-2 text-center text-sm text-white/50">{subtitleByStep}</p>

          {/* Signup step indicator */}
          {mode === 'signup' && (
            <div className="mt-4 flex items-center justify-center gap-2">
              {['form', signupStep === 'manual' ? 'manual' : 'confirm'].map((s, i) => (
                <span key={i}
                  className={`h-1.5 w-8 rounded-full ${
                    (i === 0) || signupStep !== 'form' ? 'bg-white/70' : 'bg-white/15'
                  }`} />
              ))}
            </div>
          )}

          {apiError && (
            <div className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {apiError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {/* LOGIN */}
            {mode === 'login' && (
              <>
                <div>
                  <label htmlFor="username" className={labelCls}>Tên đăng nhập</label>
                  <input id="username" name="username" type="text" value={form.username} onChange={handleChange}
                    placeholder="Nhập tên đăng nhập" className={inputClass(!!errors.username)} disabled={isLoading} />
                  {errors.username && <p className="mt-1 text-xs text-rose-400">{errors.username}</p>}
                </div>
                <div>
                  <label htmlFor="password" className={labelCls}>Mật khẩu</label>
                  <input id="password" name="password" type="password" value={form.password} onChange={handleChange}
                    placeholder="Nhập mật khẩu" className={inputClass(!!errors.password)} disabled={isLoading} />
                  {errors.password && <p className="mt-1 text-xs text-rose-400">{errors.password}</p>}
                </div>
              </>
            )}

            {/* SIGNUP — STEP 1: credentials */}
            {mode === 'signup' && signupStep === 'form' && (
              <>
                <div>
                  <label htmlFor="username" className={labelCls}>Tên đăng nhập <span className="text-rose-400">*</span></label>
                  <input id="username" name="username" type="text" value={form.username} onChange={handleChange}
                    placeholder="Nhập tên đăng nhập" className={inputClass(!!errors.username)} disabled={isLoading} />
                  {errors.username && <p className="mt-1 text-xs text-rose-400">{errors.username}</p>}
                </div>
                <div>
                  <label htmlFor="email" className={labelCls}>Email <span className="text-rose-400">*</span></label>
                  <input id="email" name="email" type="email" value={form.email} onChange={handleChange}
                    placeholder="Email đã dùng khi đăng ký" className={inputClass(!!errors.email)} disabled={isLoading} />
                  {errors.email && <p className="mt-1 text-xs text-rose-400">{errors.email}</p>}
                </div>
                <div>
                  <label htmlFor="mssv" className={labelCls}>MSSV <span className="text-rose-400">*</span></label>
                  <input id="mssv" name="mssv" type="text" value={form.mssv} onChange={handleChange}
                    placeholder="Mã số sinh viên" className={inputClass(!!errors.mssv)} disabled={isLoading} />
                  {errors.mssv && <p className="mt-1 text-xs text-rose-400">{errors.mssv}</p>}
                </div>
                <div>
                  <label htmlFor="password" className={labelCls}>Mật khẩu <span className="text-rose-400">*</span></label>
                  <input id="password" name="password" type="password" value={form.password} onChange={handleChange}
                    placeholder="Tối thiểu 6 ký tự" className={inputClass(!!errors.password)} disabled={isLoading} />
                  {errors.password && <p className="mt-1 text-xs text-rose-400">{errors.password}</p>}
                </div>
                <div>
                  <label htmlFor="confirmPassword" className={labelCls}>Xác nhận mật khẩu <span className="text-rose-400">*</span></label>
                  <input id="confirmPassword" name="confirmPassword" type="password" value={form.confirmPassword} onChange={handleChange}
                    placeholder="Nhập lại mật khẩu" className={inputClass(!!errors.confirmPassword)} disabled={isLoading} />
                  {errors.confirmPassword && <p className="mt-1 text-xs text-rose-400">{errors.confirmPassword}</p>}
                </div>
              </>
            )}

            {/* SIGNUP — STEP 2a: confirm matched info */}
            {mode === 'signup' && signupStep === 'confirm' && (
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Đã tìm thấy đăng ký</p>
                <dl className="mt-3 space-y-2 text-sm text-white/80">
                  <div><dt className="inline text-white/45">Họ tên: </dt><dd className="inline font-medium">{matchInfo?.full_name || '—'}</dd></div>
                  <div><dt className="inline text-white/45">Trường: </dt><dd className="inline font-medium">{matchInfo?.school || '—'}</dd></div>
                  <div><dt className="inline text-white/45">Khoa: </dt><dd className="inline font-medium">{matchInfo?.faculty || '—'}</dd></div>
                </dl>
                <p className="mt-3 text-xs text-white/40">Thông tin nhạy cảm (CCCD, SĐT…) được giữ kín và không hiển thị tại đây.</p>
              </div>
            )}

            {/* SIGNUP — STEP 2b: manual basic info */}
            {mode === 'signup' && signupStep === 'manual' && (
              <>
                <div>
                  <label htmlFor="full_name" className={labelCls}>Họ và tên <span className="text-rose-400">*</span></label>
                  <input id="full_name" type="text" value={basic.full_name}
                    onChange={(e) => setBasic(b => ({ ...b, full_name: e.target.value }))}
                    placeholder="Nhập họ và tên" className={inputClass(!!errors.full_name)} disabled={isLoading} />
                  {errors.full_name && <p className="mt-1 text-xs text-rose-400">{errors.full_name}</p>}
                </div>
                <div>
                  <label htmlFor="school" className={labelCls}>Trường <span className="text-rose-400">*</span></label>
                  <SchoolSelect options={schoolOptions} value={basic.school}
                    onChange={(v) => setBasic(b => ({ ...b, school: v }))} inputClass={inputClass} hasErr={!!errors.school} />
                  {errors.school && <p className="mt-1 text-xs text-rose-400">{errors.school}</p>}
                </div>
                <div>
                  <label htmlFor="faculty" className={labelCls}>Khoa <span className="text-rose-400">*</span></label>
                  <input id="faculty" type="text" value={basic.faculty}
                    onChange={(e) => setBasic(b => ({ ...b, faculty: e.target.value }))}
                    placeholder="Nhập khoa" className={inputClass(!!errors.faculty)} disabled={isLoading} />
                  {errors.faculty && <p className="mt-1 text-xs text-rose-400">{errors.faculty}</p>}
                </div>
              </>
            )}

            {/* Primary action */}
            <button type="submit" disabled={isLoading}
              className="w-full rounded-2xl bg-white px-6 py-3.5 text-sm font-bold uppercase text-[#0e1218] transition hover:bg-white/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
              {isLoading
                ? 'Đang xử lý...'
                : mode === 'login' ? 'Đăng nhập'
                : signupStep === 'form' ? 'Tiếp tục'
                : signupStep === 'confirm' ? 'Xác nhận & tạo tài khoản'
                : 'Tạo tài khoản'}
            </button>

            {/* Back link within signup steps */}
            {mode === 'signup' && signupStep !== 'form' && (
              <button type="button" onClick={resetSignup}
                className="w-full text-center text-xs text-white/40 underline underline-offset-4 transition hover:text-white/60">
                ← Quay lại bước nhập thông tin
              </button>
            )}
          </form>

          {showGoogle && (
            <>
              <div className="mt-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-white/10" />
                <span className="text-xs uppercase text-white/30">hoặc</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <div className="mt-6">{renderGoogleButton()}</div>
            </>
          )}

          <p className="mt-6 text-center text-sm text-white/50">
            {mode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'}{' '}
            <button type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login')
                setApiError(''); setErrors({}); resetSignup()
              }}
              className="font-semibold text-white underline underline-offset-4 transition hover:text-white/80">
              {mode === 'login' ? 'Đăng ký ngay' : 'Đăng nhập ngay'}
            </button>
          </p>

          <p className="mt-4 text-center">
            <a href="/" className="text-sm text-white/40 underline underline-offset-4 transition hover:text-white/60">
              ← Về trang chủ
            </a>
          </p>
        </div>
      </div>
    </main>
  )
}

// School dropdown with an "Khác" escape hatch (mirrors the registration form).
function SchoolSelect({ options, value, onChange, inputClass, hasErr }) {
  const values = (options || []).map(optValue)
  const isOther = value && !values.includes(value)
  return (
    <div className="space-y-2">
      <select
        className={inputClass(hasErr) + ' appearance-none'}
        value={values.includes(value) ? value : (isOther ? '__other__' : '')}
        onChange={(e) => onChange(e.target.value === '__other__' ? ' ' : e.target.value)}
      >
        <option value="" disabled className="text-black">— Chọn trường —</option>
        {(options || []).map((o) => (
          <option key={optValue(o)} value={optValue(o)} className="text-black">{optLabel(o)}</option>
        ))}
        <option value="__other__" className="text-black">Khác…</option>
      </select>
      {isOther && (
        <input className={inputClass(hasErr)} placeholder="Nhập tên trường"
          value={value.trim()} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}

export default LoginPage
