import { useState } from 'react'
import logoImage from './assets/vnutour-logo.webp'
import { apiRequest } from './api.js'
import { navigate } from './router.js'

const GENERIC_SUCCESS_MESSAGE =
  'Nếu email tồn tại trong hệ thống, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu. Vui lòng kiểm tra hộp thư (kể cả mục spam).'

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const inputClass = (hasErr) =>
    [
      'w-full appearance-none rounded-2xl border px-4 py-3 text-sm text-white placeholder-white/30 bg-white/[0.06] backdrop-blur transition outline-none',
      hasErr
        ? 'border-rose-400/60 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/30'
        : 'border-white/15 focus:border-white/40 focus:ring-2 focus:ring-white/10',
    ].join(' ')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) {
      setError('Vui lòng nhập email')
      return
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError('Email không hợp lệ')
      return
    }
    setError('')
    setIsLoading(true)
    try {
      await apiRequest('/auth/forgot-password', {
        method: 'POST',
        auth: false,
        body: { email: email.trim() },
      })
      // The backend always answers 200 with a generic status — never branch
      // on its content, or this page would leak whether the email exists.
      setSent(true)
    } catch (err) {
      setError(err.message?.includes('fetch') ? 'Không thể kết nối tới server.' : `Lỗi: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

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
          <h1 className="text-center text-2xl font-bold text-white">Quên mật khẩu?</h1>
          <p className="mt-2 text-center text-sm text-white/50">
            Nhập email đã đăng ký, chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu.
          </p>

          {sent ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-200">
                {GENERIC_SUCCESS_MESSAGE}
              </div>
              <button type="button"
                onClick={() => navigate('/login')}
                className="w-full rounded-2xl bg-white px-6 py-3.5 text-sm font-bold uppercase text-[#0e1218] transition hover:bg-white/90 active:scale-[0.98]">
                Về trang đăng nhập
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {error && (
                <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="email" className="text-sm font-medium text-white/70">Email</label>
                <input id="email" name="email" type="email" value={email}
                  onChange={(e) => { setEmail(e.target.value); setError('') }}
                  placeholder="Email đã dùng khi đăng ký" className={inputClass(!!error)} disabled={isLoading} />
              </div>

              <button type="submit" disabled={isLoading}
                className="w-full rounded-2xl bg-white px-6 py-3.5 text-sm font-bold uppercase text-[#0e1218] transition hover:bg-white/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
                {isLoading ? 'Đang gửi...' : 'Gửi hướng dẫn đặt lại mật khẩu'}
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

export default ForgotPasswordPage
