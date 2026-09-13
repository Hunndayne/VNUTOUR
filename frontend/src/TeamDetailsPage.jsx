import { useEffect, useMemo, useState } from 'react'
import logoImage from './assets/vnutour-logo.webp'
import { Badge, Icon } from './ui.jsx'
import { apiRequest, getStoredUser, logoutAndRedirect } from './api.js'
import { navigate } from './router.js'
import TeamMemberDetailsDrawer from './TeamMemberDetailsDrawer.jsx'

const COLORS = {
  paper: '#F3F4F1',
  ink: '#20312B',
  stone: '#DCD8CC',
}

const CARD = 'rounded-xl border border-[#DCD8CC] bg-white shadow-[0_1px_3px_rgba(32,49,43,0.05)]'

const APPROVAL = {
  draft: { label: 'Bản nháp', cls: 'bg-[#20312B]/[0.07] text-[#20312B]/55' },
  pending_approval: { label: 'Chờ duyệt', cls: 'bg-[#E0A23A]/15 text-[#9A6B12]' },
  approved: { label: 'Đã duyệt', cls: 'bg-[#1F7A6B]/12 text-[#1F7A6B]' },
  rejected: { label: 'Cần sửa', cls: 'bg-[#D6492B]/12 text-[#D6492B]' },
}

function Contours() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 opacity-70"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg width='520' height='520' viewBox='0 0 520 520' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23DCD8CC' stroke-width='1'%3E%3Cpath d='M62 80c64-48 142-56 212-24 80 37 132 22 182-6'/%3E%3Cpath d='M30 166c70-58 154-68 236-32 78 34 132 24 218-20'/%3E%3Cpath d='M18 252c78-44 142-52 214-22 90 38 168 32 252-22'/%3E%3Cpath d='M44 338c72-35 130-42 196-18 88 32 164 22 238-28'/%3E%3Cpath d='M92 428c72-42 146-48 220-18 60 24 118 16 166-20'/%3E%3Ccircle cx='392' cy='138' r='52'/%3E%3Ccircle cx='392' cy='138' r='82'/%3E%3Ccircle cx='142' cy='330' r='46'/%3E%3Ccircle cx='142' cy='330' r='76'/%3E%3C/g%3E%3C/svg%3E\")",
        backgroundSize: '520px 520px',
      }}
    />
  )
}

function teamValue(team, dashboardKey, apiKey) {
  return team?.[dashboardKey] ?? team?.[apiKey] ?? ''
}

function approvalFor(team) {
  return APPROVAL[team?.approval_status] || APPROVAL.draft
}

export function TeamSummaryCard({ team, members = [] }) {
  if (!team) return null

  const name = teamValue(team, 'team_name', 'name') || 'Đội chưa đặt tên'
  const code = teamValue(team, 'team_id', 'code')
  const memberCount = team.member_count ?? members.length
  const approval = approvalFor(team)

  return (
    <a
      href="/participant/team"
      onClick={(event) => {
        event.preventDefault()
        navigate('/participant/team')
      }}
      className={`${CARD} group block overflow-hidden transition hover:border-[#1F7A6B]/45 hover:shadow-[0_5px_18px_rgba(32,49,43,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A6B] focus-visible:ring-offset-2 active:scale-[0.995]`}
      aria-label={`Xem thông tin chi tiết đội ${name}`}
    >
      <div className="flex items-center gap-4 px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#1F7A6B]/10 text-[#1F7A6B]">
          <Icon name="users" className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-bold text-[#20312B] sm:text-xl">Đội của bạn</h2>
            <Badge label={approval.label} cls={approval.cls} />
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-[#20312B]/80">{name}</p>
          <p className="mt-1 text-sm text-[#20312B]/50">
            {code && <span>{code}</span>}
            {code && <span aria-hidden="true"> · </span>}
            <span>{memberCount} thành viên</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-sm font-semibold text-[#1F7A6B]">
          <span className="hidden sm:inline">Xem chi tiết</span>
          <Icon name="chevronR" className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </a>
  )
}

function LoadingState() {
  return (
    <main className="relative mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-8" aria-label="Đang tải thông tin đội">
      <div className="h-8 w-52 animate-pulse rounded-lg bg-[#20312B]/10" />
      <div className={`${CARD} h-36 animate-pulse bg-white/65`} />
      <div className={`${CARD} space-y-4 p-5 sm:p-7`}>
        {[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg bg-[#20312B]/[0.06]" />)}
      </div>
    </main>
  )
}

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export default function TeamDetailsPage() {
  const user = getStoredUser()
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedMemberMssv, setSelectedMemberMssv] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    const loadTeam = async () => {
      try {
        setLoading(true)
        setError('')
        const result = await apiRequest('/my-team?view=summary', { signal: controller.signal, cache: 'no-store' })
        setPayload(result)
      } catch (requestError) {
        if (requestError?.name === 'AbortError') return
        if (requestError?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setError('Không thể tải thông tin đội. Vui lòng thử lại.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadTeam()
    return () => controller.abort()
  }, [])

  const members = useMemo(() => {
    const seen = new Set()
    return (payload?.members || []).filter((member) => {
      const key = String(member?.mssv || '').trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [payload])

  const team = payload?.team || null
  const approval = approvalFor(team)
  const displayName = team?.name_is_placeholder ? 'Đội chưa đặt tên' : team?.name

  return (
    <div className="min-h-screen bg-[#F3F4F1] font-sans text-[#20312B]">
      <Contours />

      <header
        className="sticky top-0 z-40 border-b backdrop-blur"
        style={{ backgroundColor: 'rgba(243,244,241,0.95)', borderColor: COLORS.stone }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a
            href="/participant"
            onClick={(event) => {
              event.preventDefault()
              navigate('/participant')
            }}
            className="flex items-center gap-3"
          >
            <img src={logoImage} alt="VNUTour" className="h-10 w-10 object-contain" />
            <div>
              <p className="font-display text-base font-bold text-[#20312B]">VNUTour</p>
              <p className="font-mono text-[11px] text-[#20312B]/40">Thông tin đội</p>
            </div>
          </a>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/participant')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#DCD8CC] bg-white px-3 py-2 text-sm font-semibold text-[#20312B]/75 transition hover:bg-[#F3F4F1] hover:text-[#20312B] active:scale-[0.98]"
            >
              <Icon name="chevronR" className="h-4 w-4 rotate-180" />
              <span>Trang thí sinh</span>
            </button>
            {user && (
              <button
                type="button"
                onClick={() => logoutAndRedirect('/')}
                className="hidden rounded-lg border border-[#DCD8CC] bg-white px-3 py-2 text-sm font-semibold text-[#20312B]/60 transition hover:bg-[#F3F4F1] hover:text-[#20312B] active:scale-[0.98] sm:inline-flex"
              >
                Đăng xuất
              </button>
            )}
          </div>
        </div>
      </header>

      {loading ? <LoadingState /> : (
        <main className="relative mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
          <div>
            <h1 className="font-display text-2xl font-bold text-[#20312B] sm:text-3xl">Thông tin đội</h1>
            <p className="mt-1 text-sm text-[#20312B]/60">Các thông tin chính của đội bạn đang tham gia.</p>
          </div>

          {error && (
            <div className="rounded-xl border border-[#D6492B]/25 bg-[#D6492B]/[0.06] p-4 text-sm text-[#D6492B]" role="alert">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-3 rounded-lg bg-[#20312B] px-4 py-2 font-semibold text-white transition hover:bg-[#20312B]/85 active:scale-[0.98]"
              >
                Thử lại
              </button>
            </div>
          )}

          {!error && !team && (
            <section className={`${CARD} px-5 py-10 text-center sm:px-7`}>
              <h2 className="font-display text-xl font-bold text-[#20312B]">Bạn chưa có đội</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#20312B]/60">
                Quay lại trang thí sinh để tạo đội hoặc hoàn tất hồ sơ đăng ký.
              </p>
              <button
                type="button"
                onClick={() => navigate('/participant')}
                className="mt-5 rounded-lg bg-[#20312B] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#20312B]/85 active:scale-[0.98]"
              >
                Về trang thí sinh
              </button>
            </section>
          )}

          {!error && team && (
            <>
              <section className={`${CARD} overflow-hidden`}>
                <div className="flex flex-col gap-5 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge label={approval.label} cls={approval.cls} />
                      <span className="font-mono text-xs font-semibold text-[#20312B]/45">{team.code}</span>
                    </div>
                    <h2 className="mt-3 break-words font-display text-2xl font-bold text-[#20312B] sm:text-3xl">
                      {displayName || 'Đội chưa đặt tên'}
                    </h2>
                  </div>
                  <div className="flex items-center gap-3 rounded-lg bg-[#1F7A6B]/[0.08] px-4 py-3 text-[#1F7A6B]">
                    <Icon name="users" className="h-5 w-5" />
                    <div>
                      <p className="text-lg font-bold leading-none">{team.member_count ?? members.length}</p>
                      <p className="mt-1 text-xs font-semibold">thành viên</p>
                    </div>
                  </div>
                </div>
              </section>

              <section className={`${CARD} px-5 py-6 sm:px-7`}>
                <h2 className="font-display text-xl font-bold text-[#20312B]">Thành viên</h2>
                <p className="mt-1 text-sm text-[#20312B]/50">Nhấn vào một thành viên để xem thông tin liên hệ và tình trạng tài khoản.</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {members.map((member) => {
                    const isMe = String(member.mssv || '').toLowerCase() === String(user?.mssv || '').toLowerCase()
                    return (
                      <button
                        key={member.mssv}
                        type="button"
                        onClick={() => setSelectedMemberMssv(member.mssv)}
                        className="group flex min-w-0 items-center gap-3 rounded-lg border border-transparent bg-[#F3F4F1]/75 px-4 py-3.5 text-left transition hover:border-[#1F7A6B]/25 hover:bg-[#1F7A6B]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A6B] focus-visible:ring-offset-2 active:scale-[0.99]"
                        aria-label={`Xem chi tiết thành viên ${member.full_name || member.mssv}`}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#20312B]/[0.08] text-xs font-bold text-[#20312B]/65">
                          {initials(member.full_name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-[#20312B]">{member.full_name || 'Chưa cập nhật họ tên'}</h3>
                            {(member.is_captain || member.mssv === team.captain_mssv) && (
                              <Badge label="Đội trưởng" cls="bg-[#E0A23A]/15 text-[#9A6B12]" />
                            )}
                            {isMe && <Badge label="Bạn" cls="bg-[#1F7A6B]/12 text-[#1F7A6B]" />}
                          </div>
                          <p className="mt-1 truncate text-xs text-[#20312B]/50">
                            {member.mssv}
                            {member.school && <span> · {member.school}</span>}
                          </p>
                        </div>
                        <Icon name="chevronR" className="h-4 w-4 shrink-0 text-[#20312B]/25 transition group-hover:translate-x-0.5 group-hover:text-[#1F7A6B]" />
                      </button>
                    )
                  })}
                </div>
              </section>
            </>
          )}
        </main>
      )}
      {selectedMemberMssv && (
        <TeamMemberDetailsDrawer
          mssv={selectedMemberMssv}
          onClose={() => setSelectedMemberMssv('')}
        />
      )}
    </div>
  )
}
