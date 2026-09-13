import { useEffect, useRef, useState } from 'react'
import { apiRequest, logoutAndRedirect } from './api.js'
import { fetchEncryptedTeamMemberDetails } from './accountDetailsCrypto.js'
import { Badge, Icon } from './ui.jsx'

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map(part => part[0])
    .join('')
    .toUpperCase()
}

function display(value) {
  return value === null || value === undefined || value === '' ? 'Chưa cập nhật' : String(value)
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function detailsError(error) {
  if (error?.status === 404) return 'Không tìm thấy thành viên này trong đội của bạn.'
  if (error?.status === 403) return 'Bạn không có quyền xem thông tin thành viên này.'
  if (error?.message === 'secure_browser_required') return 'Hãy mở trang bằng HTTPS trên trình duyệt hỗ trợ Web Crypto để xem chi tiết.'
  if (error?.message === 'invalid_encrypted_response') return 'Không thể xác minh và giải mã dữ liệu. Vui lòng thử lại.'
  return 'Chưa tải được thông tin thành viên. Vui lòng thử lại.'
}

function Field({ label, value, href }) {
  return <div className="min-w-0 border-b border-[#DCD8CC]/60 pb-4 last:border-0 last:pb-0 sm:border-0 sm:pb-0">
    <dt className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#20312B]/40">{label}</dt>
    <dd className="break-words text-sm font-semibold text-[#20312B] [overflow-wrap:anywhere]">
      {href ? <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-[#1F7A6B] underline decoration-[#1F7A6B]/30 underline-offset-4 hover:decoration-[#1F7A6B]">
        {display(value)} <Icon name="link" className="h-3.5 w-3.5 shrink-0" />
      </a> : display(value)}
    </dd>
  </div>
}

function AccountStatus({ label, connected, connectedText, disconnectedText, accent = 'web' }) {
  const activeClass = accent === 'discord'
    ? 'border-[#5865F2]/20 bg-[#5865F2]/[0.06] text-[#5865F2]'
    : 'border-[#1F7A6B]/20 bg-[#1F7A6B]/[0.06] text-[#1F7A6B]'
  return <div className={`rounded-xl border px-4 py-3.5 ${connected ? activeClass : 'border-[#DCD8CC] bg-[#F3F4F1]/70 text-[#20312B]/45'}`}>
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${connected ? (accent === 'discord' ? 'bg-[#5865F2]' : 'bg-[#1F7A6B]') : 'bg-[#20312B]/20'}`} />
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">{label}</p>
    </div>
    <p className="mt-2 text-sm font-bold text-[#20312B]">{connected ? connectedText : disconnectedText}</p>
  </div>
}

export default function TeamMemberDetailsDrawer({ mssv, onClose }) {
  const [details, setDetails] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const dialogRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    setDetails(null)
    setError('')
    fetchEncryptedTeamMemberDetails(mssv, apiRequest, { signal: controller.signal })
      .then(payload => {
        if (!controller.signal.aborted) setDetails(payload)
      })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setError(detailsError(failure))
      })
    return () => controller.abort()
  }, [mssv, attempt])

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const handleKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = dialogRef.current?.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')
      if (!nodes?.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKey)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [onClose])

  const member = details?.member
  const discord = details?.accounts?.discord
  const web = details?.accounts?.web
  const facebookUrl = safeHttpUrl(member?.facebook)

  return <div className="fixed inset-0 z-50">
    <div className="absolute inset-0 bg-[#20312B]/30 backdrop-blur-[2px]" onClick={onClose} />
    <aside
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-member-details-title"
      className="absolute bottom-0 right-0 flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-[#DCD8CC] bg-[#F3F4F1] shadow-2xl sm:bottom-auto sm:top-0 sm:h-full sm:max-h-none sm:max-w-[580px] sm:rounded-none sm:border-y-0 sm:border-r-0"
    >
      <header className="flex items-start justify-between gap-4 border-b border-[#DCD8CC] bg-white px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#1F7A6B]">Hồ sơ thành viên</p>
          <h2 id="team-member-details-title" className="mt-1 truncate font-display text-xl font-bold text-[#20312B]">
            {member?.full_name || mssv}
          </h2>
          <p className="mt-1 font-mono text-xs text-[#20312B]/45">{member?.mssv || mssv}</p>
        </div>
        <button ref={closeRef} type="button" aria-label="Đóng chi tiết thành viên" onClick={onClose} className="rounded-lg p-2 text-[#20312B]/55 transition hover:bg-[#F3F4F1] hover:text-[#20312B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A6B]">
          <Icon name="close" className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6" aria-busy={!details && !error}>
        {!details && !error && <div role="status" className="space-y-4 py-5">
          <div className="mx-auto h-16 w-16 animate-pulse rounded-2xl bg-[#20312B]/10" />
          <div className="mx-auto h-5 w-44 animate-pulse rounded bg-[#20312B]/10" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 animate-pulse rounded-xl bg-white" />
            <div className="h-24 animate-pulse rounded-xl bg-white" />
          </div>
          <p className="text-center text-sm text-[#20312B]/50">Đang tải và giải mã thông tin…</p>
        </div>}

        {error && <div role="alert" className="rounded-xl border border-[#D6492B]/20 bg-white p-5">
          <p className="text-sm text-[#D6492B]">{error}</p>
          <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-4 rounded-lg bg-[#20312B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#20312B]/85">Thử lại</button>
        </div>}

        {member && <>
          <section className="rounded-xl border border-[#DCD8CC] bg-white p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#20312B]/[0.08] text-sm font-bold text-[#20312B]/65">
                {initials(member.full_name)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="break-words font-display text-lg font-bold text-[#20312B]">{display(member.full_name)}</h3>
                  {member.is_captain && <Badge label="Đội trưởng" cls="bg-[#E0A23A]/15 text-[#9A6B12]" />}
                </div>
                <p className="mt-1 text-sm text-[#20312B]/50">{member.mssv}</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="account-status-title">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 id="account-status-title" className="font-display text-base font-bold text-[#20312B]">Tình trạng tài khoản</h3>
              <span className="font-mono text-[10px] text-[#20312B]/35">Cập nhật theo hệ thống</span>
            </div>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
              <AccountStatus
                label="Discord"
                connected={discord?.connected}
                connectedText={discord?.username ? `Đã kết nối · @${discord.username}` : 'Đã kết nối'}
                disconnectedText="Chưa kết nối"
                accent="discord"
              />
              <AccountStatus
                label="Tài khoản web"
                connected={web?.connected}
                connectedText="Đã có tài khoản"
                disconnectedText="Chưa có tài khoản"
              />
            </div>
          </section>

          <section className="rounded-xl border border-[#DCD8CC] bg-white p-5" aria-labelledby="member-information-title">
            <h3 id="member-information-title" className="mb-5 border-b border-[#DCD8CC]/70 pb-3 font-display text-base font-bold text-[#20312B]">Thông tin liên hệ</h3>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-5">
              <Field label="Họ tên" value={member.full_name} />
              <Field label="MSSV" value={member.mssv} />
              <Field label="Trường" value={member.school} />
              <Field label="Khoa" value={member.faculty} />
              <Field label="Số điện thoại" value={member.phone} />
              <Field label="Facebook" value={member.facebook} href={facebookUrl} />
            </dl>
          </section>

          <p className="flex items-start gap-2 px-1 text-xs leading-5 text-[#20312B]/45">
            <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-[#1F7A6B]" />
            Thông tin đã được mã hóa
          </p>
        </>}
      </div>
    </aside>
  </div>
}
