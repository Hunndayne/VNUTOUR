import { useEffect, useMemo, useState } from 'react'
import logoImage from './assets/vnutour-logo.webp'
import { apiRequest, getStoredUser } from './api.js'
import { Icon } from './ui.jsx'
import RegistrationCapacityNotice from './RegistrationCapacityNotice.jsx'

const STATUS_TEXT = {
  invalid_invite: 'Link mời không hợp lệ.',
  invite_revoked: 'Đội trưởng đã thu hồi link mời này.',
  invite_expired: 'Link mời đã hết hạn. Hãy xin đội trưởng tạo link mới.',
  registration_closed: 'Đợt đăng ký hiện đã đóng.',
  registration_capacity_reached: 'Không còn đủ suất đăng ký để thêm thành viên. Vui lòng liên hệ BTC.',
  team_locked: 'Đội đã khóa danh sách thành viên.',
  team_full: 'Đội đã đủ thành viên.',
  participant_required: 'Chỉ tài khoản thí sinh mới có thể tham gia đội.',
  profile_incomplete: 'Bạn cần cập nhật MSSV trước khi tham gia đội.',
  profile_conflict: 'MSSV này đang được liên kết với tài khoản khác.',
  mssv_in_other_team: 'Bạn đang thuộc một đội khác.',
  mssv_in_submitted_team: 'Bạn đang thuộc một đội đã gửi duyệt.',
  mssv_leads_other_team: 'Bạn đang là đội trưởng của một đội khác.',
}

export default function JoinTeamPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') || '', [])
  const user = getStoredUser()
  const userRole = user?.role
  const [invite, setInvite] = useState(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')
  const [joined, setJoined] = useState(false)

  useEffect(() => {
    let cancelled = false
    const inspect = async () => {
      if (!token) {
        setError(STATUS_TEXT.invalid_invite)
        setLoading(false)
        return
      }
      try {
        const payload = await apiRequest(`/team-invites/${encodeURIComponent(token)}`, { auth: false })
        if (cancelled) return
        setInvite(payload)
        if (payload?.status === 'active' && userRole === 'participant') {
          const profilePayload = await apiRequest('/me/profile')
          if (!profilePayload?.profile_complete) {
            window.location.replace(`/participant?step=profile&team_invite=${encodeURIComponent(token)}`)
            return
          }
        }
      } catch (requestError) {
        if (!cancelled) {
          const code = requestError?.data?.status || requestError?.data?.error
          setInvite(requestError?.data || null)
          setError(STATUS_TEXT[code] || 'Không kiểm tra được link mời.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void inspect()
    return () => { cancelled = true }
  }, [token, userRole])

  const returnPath = `/join-team?token=${encodeURIComponent(token)}`
  const loginHref = `/login?return_to=${encodeURIComponent(returnPath)}`
  const signupHref = `/login?mode=signup&return_to=${encodeURIComponent(returnPath)}`
  const profileHref = `/participant?step=profile&team_invite=${encodeURIComponent(token)}`

  const acceptInvite = async () => {
    setJoining(true)
    setError('')
    try {
      const payload = await apiRequest(`/team-invites/${encodeURIComponent(token)}`, { method: 'POST' })
      setJoined(true)
      setInvite((current) => ({ ...current, member_count: payload.member_count || current?.member_count }))
    } catch (requestError) {
      const code = requestError?.data?.error || requestError?.message
      setError(STATUS_TEXT[code] || 'Không thể tham gia đội bằng link này.')
    } finally {
      setJoining(false)
    }
  }

  const team = invite?.team
  return (
    <main className="min-h-screen bg-[#EDF2EF] px-4 py-8 text-[#20312B] sm:py-14">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex justify-center">
          <img src={logoImage} alt="VNUTour" className="h-16 w-16 rounded-2xl object-cover shadow-sm" />
        </div>

        <section className="overflow-hidden rounded-2xl border border-[#DCD8CC] bg-white shadow-[0_18px_50px_rgba(32,49,43,0.10)]">
          <div className="bg-[#20312B] px-6 py-5 text-white sm:px-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/45">Thẻ mời vào đội</p>
            <h1 className="mt-2 font-display text-2xl font-bold">{team?.name || 'VNUTour 2026'}</h1>
            {team?.code && <p className="mt-1 font-mono text-sm text-white/55">{team.code}</p>}
          </div>

          <div className="relative border-t border-dashed border-[#DCD8CC] px-6 py-7 sm:px-8">
            <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-[#EDF2EF]" />
            <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-[#EDF2EF]" />

            {loading ? (
              <div className="flex items-center justify-center gap-3 py-10 text-sm text-[#20312B]/45">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#1F7A6B] border-t-transparent" />
                Đang kiểm tra link mời...
              </div>
            ) : error && !team ? (
              <div className="rounded-xl border border-[#D6492B]/20 bg-[#D6492B]/[0.06] px-4 py-4 text-sm text-[#B93A23]">{error}</div>
            ) : joined ? (
              <div className="text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#1F7A6B]/12 text-[#1F7A6B]">
                  <Icon name="checkPlain" className="h-6 w-6" />
                </span>
                <h2 className="mt-4 font-display text-xl font-bold">Bạn đã vào đội</h2>
                <p className="mt-2 text-sm leading-6 text-[#20312B]/55">Hồ sơ của bạn đã được thêm bằng thông tin từ tài khoản đang đăng nhập.</p>
                <a href="/participant?step=members" className="mt-5 inline-flex rounded-lg bg-[#20312B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#20312B]/85">Xem đội của tôi</a>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 rounded-xl bg-[#F3F4F1] px-4 py-3">
                  <div>
                    <p className="text-xs text-[#20312B]/40">Số thành viên hiện tại</p>
                    <p className="mt-1 font-mono text-lg font-semibold">{invite?.member_count ?? '—'} / {invite?.max_members ?? '—'}</p>
                  </div>
                  <span className="rounded-full bg-[#E0A23A]/15 px-3 py-1 font-mono text-xs text-[#9A6B12]">Có hiệu lực 3 giờ</span>
                </div>

                <p className="mt-5 text-sm leading-6 text-[#20312B]/60">
                  Bạn sẽ tham gia bằng MSSV và thông tin trong tài khoản của chính mình. Đội trưởng không cần nhập lại email hoặc thông tin cá nhân của bạn.
                </p>

                <RegistrationCapacityNotice
                  remaining={invite?.status === 'active' ? invite.registration_slots_remaining : null}
                  className="mt-5"
                />

                {error && (
                  <div className="mt-4 rounded-xl border border-[#D6492B]/20 bg-[#D6492B]/[0.06] px-4 py-3 text-sm text-[#B93A23]">{error}</div>
                )}

                {!user ? (
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <a href={loginHref} className="inline-flex items-center justify-center rounded-lg bg-[#20312B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#20312B]/85">Đăng nhập để tham gia</a>
                    <a href={signupHref} className="inline-flex items-center justify-center rounded-lg border border-[#DCD8CC] px-4 py-2.5 text-sm font-semibold text-[#20312B]/70 hover:bg-[#F3F4F1]">Tạo tài khoản mới</a>
                  </div>
                ) : error === STATUS_TEXT.profile_incomplete ? (
                  <a href={profileHref} className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-[#20312B] px-4 py-2.5 text-sm font-semibold text-white">Cập nhật MSSV</a>
                ) : (
                  <button
                    type="button"
                    onClick={acceptInvite}
                    disabled={joining || invite?.status !== 'active'}
                    className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1F7A6B] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {joining ? 'Đang tham gia...' : `Tham gia đội ${team?.name || ''}`}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
