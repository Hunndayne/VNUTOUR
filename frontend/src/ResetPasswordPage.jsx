import { useState } from 'react'
import logoImage from './assets/vnutour-logo.webp'
import { apiRequest } from './api.js'
import { navigate, useSearchParam } from './router.js'

const ERROR_MESSAGES = {
  invalid_or_expired_token: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới.',
  password_too_short: 'Mật khẩu phải có ít nhất 8 ký tự.',
  missing_fields: 'Vui lòng điền đầy đủ thông tin.',
  too_many_attempts: 'Bạn thao tác quá nhiều lần. Vui lòng chờ rồi thử lại.',
}

function ResetPasswordPage() {
  const [token] = useSearchParam('token', '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [done, setDone] = useState(false)

  const inputClass = (hasErr) =>
    [
      'w-full appearance-none rounded-2xl border px-4 py-3 text-sm text-white placeholder-white/30 bg-white/[0.06] backdrop-blur transition outline-none',
      hasErr
        ? 'border-rose-400/60 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/30'
        : 'border-white/15 focus:border-white/40 focus:ring-2 focus:ring-white/10',
    ].join(' ')

  const validate = () => {
    const e = {}
    if (!password) e.password = 'Vui lòng nhập mật khẩu mới'
    else if (password.length < 8) e.password = 'Mật khẩu phải có ít nhất 8 ký tự'
    if (confirmPassword !== password) e.confirmPassword = 'Mật khẩu xác nhận không khớp'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    setIsLoading(true)
    setApiError('')
    try {
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        auth: false,
        body: { token, new_password: password },
      })
      setDone(true)
    } catch (err) {
      const code = err.data?.error
      setApiError(ERROR_MESSAGES[code] || (err.message?.includes('fetch') ? 'Không thể kết nối tới server.' : `Lỗi: ${err.message}`))
    } finally {
      setIsLoading(false)
    }
  }

  const missingToken = !token.trim()

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
          <h1 className="text-center text-2xl font-bold text-white">Đặt lại mật khẩu</h1>
          <p className="mt-2 text-center text-sm text-white/50">
            Nhập mật khẩu mới cho tài khoản VNUTour của bạn.
          </p>

          {missingToken ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-4 text-sm text-rose-300">
                Liên kết đặt lại mật khẩu không hợp lệ. Vui lòng yêu cầu một liên kết mới.
              </div>
              <button type="button"
                onClick={() => navigate('/forgot-password')}
                className="w-full rounded-2xl bg-white px-6 py-3.5 text-sm font-bold uppercase text-[#0e1218] transition hover:bg-white/90 active:scale-[0.98]">
                Yêu cầu liên kết mới
              </button>
            </div>
          ) : done ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-200">
                Mật khẩu của bạn đã được đặt lại thành công.
              </div>
              <button type="button"
                onClick={() => navigate('/login')}
                className="w-full rounded-2xl bg-white px-6 py-3.5 text-sm font-bold uppercase text-[#0e1218] transition hover:bg-white/90 active:scale-[0.98]">
                Đăng nhập ngay
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {apiError && (
                <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                  {apiError}
                </div>
              )}

              <div>
                <label htmlFor="password" className="text-sm font-medium text-white/70">Mật khẩu mới</label>
                <input id="password" name="password" type="password" value={password}
                  onChange={(e) => { setPassword(e.target.value); setErrors(err => ({ ...err, password: '' })) }}
                  placeholder="Tối thiểu 8 ký tự" className={inputClass(!!errors.password)} disabled={isLoading} />
                {errors.password && <p className="mt-1 text-xs text-rose-400">{errors.password}</p>}
              </div>

              <div>
                <label htmlFor="confirmPassword" className="text-sm font-medium text-white/70">Xác nhận mật khẩu mới</label>
                <input id="confirmPassword" name="confirmPassword" type="password" value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setErrors(err => ({ ...err, confirmPassword: '' })) }}
                  placeholder="Nhập lại mật khẩu" className={inputClass(!!errors.confirmPassword)} disabled={isLoading} />
                {errors.confirmPassword && <p className="mt-1 text-xs text-rose-400">{errors.confirmPassword}</p>}
              </div>

              <button type="submit" disabled={isLoading}
                className="w-full rounded-2xl bg-white px-6 py-3.5 text-sm font-bold uppercase text-[#0e1218] transition hover:bg-white/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
                {isLoading ? 'Đang xử lý...' : 'Đặt lại mật khẩu'}
              </button>
            </form>
          )}

          <p className="mt-6 text-center">
            <button type="button" onClick={() => navigate('/login')}
              className="text-sm text-white/40 underline underline-offset-4 transition hover:text-white/60">
              ← Về trang đăng nhập
            </button>
          </p>
        </div>
      </div>
    </main>
  )
}

export default ResetPasswordPage
