import { useState, useEffect, useRef, useCallback } from 'react'
import logoImage from './assets/vnutour-logo.png'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://10.147.17.251:8080/api'

function LoginPage() {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [form, setForm] = useState({ username: '', password: '', email: '', mssv: '', full_name: '' })
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [googleReady, setGoogleReady] = useState(false)
  const googleInitialized = useRef(false)

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const validate = () => {
    const e = {}
    if (!form.username.trim()) e.username = 'Vui lòng nhập tên đăng nhập'
    if (!form.password.trim()) {
      e.password = 'Vui lòng nhập mật khẩu'
    } else if (form.password.length < 6) {
      e.password = 'Mật khẩu phải có ít nhất 6 ký tự'
    }
    if (mode === 'signup') {
      if (!form.email.trim()) {
        e.email = 'Vui lòng nhập email'
      } else if (!/\S+@\S+\.\S+/.test(form.email)) {
        e.email = 'Email không hợp lệ'
      }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleApiError = useCallback((data, fallback) => {
    if (!data) return
    const map = {
      invalid_credentials: 'Tên đăng nhập hoặc mật khẩu không đúng',
      conflict: 'Tên đăng nhập, email hoặc MSSV đã tồn tại',
      registration_closed: 'Đăng ký hiện đang đóng. Vui lòng quay lại sau.',
      missing_credential: 'Không nhận được thông tin xác thực Google',
      invalid_google_token: 'Xác thực Google không hợp lệ. Vui lòng thử lại.',
      email_not_verified: 'Email Google của bạn chưa được xác minh.',
      forbidden: 'Bạn không có quyền thực hiện thao tác này.',
      missing_fields: 'Vui lòng điền đầy đủ thông tin.',
      missing_credentials: 'Vui lòng nhập tên đăng nhập và mật khẩu.',
    }
    setApiError(map[data.error] || `Lỗi: ${data.error || fallback}`)
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    setIsLoading(true)
    setApiError('')

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/signup'
      const body = mode === 'login'
        ? { username: form.username, password: form.password }
        : {
            username: form.username,
            password: form.password,
            email: form.email,
            mssv: form.mssv.trim() || undefined,
            full_name: form.full_name.trim() || undefined,
          }

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (res.ok) {
        localStorage.setItem('authToken', data.token)
        localStorage.setItem('user', JSON.stringify(data.user))
        redirectByRole(data.user.role)
      } else {
        handleApiError(data, `Lỗi ${res.status}`)
      }
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        setApiError('Không thể kết nối tới server. Kiểm tra lại địa chỉ API.')
      } else {
        setApiError(`Lỗi: ${err.message}`)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const redirectByRole = (role) => {
    // Use replace so browser back doesn't land on login again
    if (role === 'admin' || role === 'collab') {
      window.location.replace('/checkin')
    } else {
      window.location.replace('/participant')
    }
  }

  // ── Google Identity Services ────────────────────────────────────────
  const handleGoogleCredential = useCallback(async (response) => {
    setIsLoading(true)
    setApiError('')

    try {
      const res = await fetch(`${API_BASE_URL}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential }),
      })
      const data = await res.json()

      if (res.ok) {
        localStorage.setItem('authToken', data.token)
        localStorage.setItem('user', JSON.stringify(data.user))
        redirectByRole(data.user.role)
      } else {
        handleApiError(data, `Lỗi Google ${res.status}`)
      }
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        setApiError('Không thể kết nối tới server.')
      } else {
        setApiError(`Lỗi: ${err.message}`)
      }
    } finally {
      setIsLoading(false)
    }
  }, [handleApiError])

  useEffect(() => {
    if (googleInitialized.current) return
    googleInitialized.current = true

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) {
      // Google Sign-In not configured
      return
    }

    const scriptId = 'google-gis-script'
    if (document.getElementById(scriptId)) {
      // Already loaded by another page, just init
      if (window.google?.accounts) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleGoogleCredential,
        })
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
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleGoogleCredential,
        })
        setGoogleReady(true)
      }
    }
    document.head.appendChild(script)
  }, [handleGoogleCredential])

  const renderGoogleButton = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

    if (!clientId) {
      return (
        <button
          type="button"
          disabled
          className="w-full flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/40 cursor-not-allowed"
        >
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
      <div
        id="google-signin-btn"
        ref={(el) => {
          if (el && !el.hasChildNodes()) {
            window.google?.accounts.id.renderButton(el, {
              type: 'standard',
              theme: 'filled_black',
              size: 'large',
              text: 'signin_with',
              shape: 'pill',
              width: el.offsetWidth > 0 ? el.offsetWidth : 360,
            })
          }
        }}
        className="flex justify-center"
      />
    )
  }

  // ── Render ──────────────────────────────────────────────────────────
  const inputClass = (hasErr) =>
    [
      'w-full rounded-2xl border px-4 py-3 text-sm text-white placeholder-white/30 bg-white/[0.06] backdrop-blur transition outline-none',
      hasErr
        ? 'border-rose-400/60 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/30'
        : 'border-white/15 focus:border-white/40 focus:ring-2 focus:ring-white/10',
    ].join(' ')

  return (
    <main className="min-h-screen bg-[#0e1218] font-['Lato',Arial,sans-serif] flex items-center justify-center px-4 py-12">
      {/* Background overlay with hero image */}
      <div className="fixed inset-0 bg-black/70 z-0" />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <a href="/" className="flex items-center gap-3">
            <img src={logoImage} alt="VNUTour" className="h-14 w-14 object-contain md:h-16 md:w-16" />
            <span className="text-xl font-bold uppercase text-white">VNUTour</span>
          </a>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-8 shadow-2xl">
          <h1 className="text-center text-2xl font-bold text-white">
            {mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}
          </h1>
          <p className="mt-2 text-center text-sm text-white/50">
            {mode === 'login'
              ? 'Chào mừng trở lại! Vui lòng đăng nhập để tiếp tục.'
              : 'Tạo tài khoản mới để tham gia VNUTour.'}
          </p>

          {/* API Error */}
          {apiError && (
            <div className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {apiError}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="username" className="text-sm font-medium text-white/70">Tên đăng nhập</label>
              <input
                id="username" name="username" type="text"
                value={form.username} onChange={handleChange}
                placeholder="Nhập tên đăng nhập"
                className={inputClass(!!errors.username)}
                disabled={isLoading}
              />
              {errors.username && <p className="mt-1 text-xs text-rose-400">{errors.username}</p>}
            </div>

            <div>
              <label htmlFor="password" className="text-sm font-medium text-white/70">Mật khẩu</label>
              <input
                id="password" name="password" type="password"
                value={form.password} onChange={handleChange}
                placeholder="Nhập mật khẩu"
                className={inputClass(!!errors.password)}
                disabled={isLoading}
              />
              {errors.password && <p className="mt-1 text-xs text-rose-400">{errors.password}</p>}
            </div>

            {mode === 'signup' && (
              <>
                <div>
                  <label htmlFor="email" className="text-sm font-medium text-white/70">
                    Email <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="email" name="email" type="email"
                    value={form.email} onChange={handleChange}
                    placeholder="Nhập email của bạn"
                    className={inputClass(!!errors.email)}
                    disabled={isLoading}
                  />
                  {errors.email && <p className="mt-1 text-xs text-rose-400">{errors.email}</p>}
                </div>

                <div>
                  <label htmlFor="mssv" className="text-sm font-medium text-white/70">MSSV</label>
                  <input
                    id="mssv" name="mssv" type="text"
                    value={form.mssv} onChange={handleChange}
                    placeholder="Nhập MSSV (không bắt buộc)"
                    className={inputClass(false)}
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label htmlFor="full_name" className="text-sm font-medium text-white/70">Họ và tên</label>
                  <input
                    id="full_name" name="full_name" type="text"
                    value={form.full_name} onChange={handleChange}
                    placeholder="Nhập họ và tên (không bắt buộc)"
                    className={inputClass(false)}
                    disabled={isLoading}
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-2xl bg-white px-6 py-3.5 text-sm font-bold uppercase text-[#0e1218] transition hover:bg-white/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading
                ? (mode === 'login' ? 'Đang đăng nhập...' : 'Đang đăng ký...')
                : (mode === 'login' ? 'Đăng nhập' : 'Đăng ký')}
            </button>
          </form>

          {/* Divider */}
          <div className="mt-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-xs uppercase text-white/30">hoặc</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          {/* Google Sign-In */}
          <div className="mt-6">
            {renderGoogleButton()}
          </div>

          {/* Toggle login <-> signup */}
          <p className="mt-6 text-center text-sm text-white/50">
            {mode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login')
                setApiError('')
                setErrors({})
              }}
              className="font-semibold text-white underline underline-offset-4 transition hover:text-white/80"
            >
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

export default LoginPage
