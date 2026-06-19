import { useMemo, useState } from 'react'
import logoImage from './assets/vnutour-logo.png'
import { Icon, Badge } from './ui.jsx'

const MAX_MEMBERS = 5
const COLORS = {
  paper: '#F3F4F1',
  ink: '#20312B',
  stone: '#DCD8CC',
  gold: '#E0A23A',
  trail: '#1F7A6B',
  clay: '#D6492B',
}
const PARTICIPANT_CARD = 'rounded-xl border border-[#DCD8CC] bg-white shadow-[0_1px_3px_rgba(32,49,43,0.05)]'
const PRIMARY_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#20312B] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#20312B]/85 active:scale-[0.98]'
const SECONDARY_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[#DCD8CC] bg-white px-4 py-2.5 text-sm font-semibold text-[#20312B]/65 transition hover:bg-[#F3F4F1] hover:text-[#20312B]'
const TRAIL_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#1F7A6B] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45'

const STATUS = {
  draft: {
    label: 'Bản nháp',
    cls: 'bg-[#20312B]/[0.07] text-[#20312B]/55',
    color: COLORS.gold,
    title: 'Hoàn thiện đội trước khi gửi duyệt',
  },
  pending_approval: {
    label: 'Chờ duyệt',
    cls: 'bg-[#E0A23A]/15 text-[#9A6B12]',
    color: COLORS.gold,
    title: 'Đội đang chờ BTC duyệt',
  },
  approved: {
    label: 'Đã duyệt',
    cls: 'bg-[#1F7A6B]/12 text-[#1F7A6B]',
    color: COLORS.trail,
    title: 'Đội đã sẵn sàng tham gia',
  },
  rejected: {
    label: 'Cần sửa',
    cls: 'bg-[#D6492B]/12 text-[#D6492B]',
    color: COLORS.clay,
    title: 'Đội cần cập nhật lại thông tin',
  },
}

const PROVISION = {
  done: { label: 'Đã tạo Discord', cls: 'bg-[#1F7A6B]/12 text-[#1F7A6B]' },
  pending: { label: 'Đang tạo Discord', cls: 'bg-[#E0A23A]/15 text-[#9A6B12]' },
  none: { label: 'Chưa tạo Discord', cls: 'bg-[#20312B]/[0.06] text-[#20312B]/40' },
}

const STEPS = [
  { key: 'profile', label: 'Hồ sơ' },
  { key: 'team', label: 'Đội' },
  { key: 'members', label: 'Thành viên' },
  { key: 'submit', label: 'Gửi duyệt' },
  { key: 'approved', label: 'Được duyệt' },
]

const initialProfile = {
  full_name: 'Phạm Nguyễn Thanh Mai',
  mssv: '25521072',
  email: 'mai.pnt@example.edu.vn',
  phone: '0901234567',
  faculty: 'Công nghệ phần mềm',
  school: 'Trường Đại học Công nghệ Thông tin',
  facebook: 'facebook.com/maipnt',
}

const initialTeam = {
  team_id: 'T0007',
  team_name: 'Những chiến binh',
  approval_status: 'draft',
  provision_state: 'none',
  approval_note: '',
}

const initialMembers = [
  {
    mssv: '25521072',
    full_name: 'Phạm Nguyễn Thanh Mai',
    email: 'mai.pnt@example.edu.vn',
    phone: '0901234567',
    faculty: 'CNPM',
    school: 'UIT',
    has_account: true,
    is_captain: true,
  },
  {
    mssv: '25521089',
    full_name: 'Lê Quốc Bảo',
    email: 'bao.lq@example.edu.vn',
    phone: '0907654321',
    faculty: 'KHMT',
    school: 'UIT',
    has_account: true,
    is_captain: false,
  },
  {
    mssv: '25521144',
    full_name: 'Trần Thị Ngọc',
    email: '',
    phone: '',
    faculty: 'HTTT',
    school: 'UIT',
    has_account: false,
    is_captain: false,
  },
]

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null') || {
      username: 'participant',
      email: 'participant@vnutour.vn',
      role: 'participant',
    }
  } catch {
    return { username: 'participant', email: 'participant@vnutour.vn', role: 'participant' }
  }
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

function LogoutIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15" />
      <path d="M12 9l3 3m0 0-3 3m3-3H2.25" />
    </svg>
  )
}

function Field({ label, value, onChange, disabled = false, placeholder = '' }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink/50">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-[#DCD8CC] bg-white px-3 py-2 text-sm text-[#20312B] outline-none transition placeholder:text-[#20312B]/25 focus:border-[#1F7A6B]/40 focus:ring-2 focus:ring-[#1F7A6B]/10 disabled:bg-[#F3F4F1] disabled:text-[#20312B]/45"
      />
    </label>
  )
}

function getStepState(step, profile, team, members) {
  const status = team?.approval_status
  const done = {
    profile: Boolean(profile.mssv && profile.full_name),
    team: Boolean(team?.team_name),
    members: members.length > 0,
    submit: status === 'pending_approval' || status === 'approved',
    approved: status === 'approved',
  }
  if (done[step.key]) return 'done'
  if (step.key === 'profile') return 'active'
  if (step.key === 'team' && done.profile) return 'active'
  if (step.key === 'members' && done.team) return 'active'
  if (step.key === 'submit' && done.members) return 'active'
  return 'idle'
}

function getNextAction(profile, team, members) {
  if (!profile.mssv) {
    return {
      title: 'Bổ sung MSSV để ghép hồ sơ',
      body: 'MSSV giúp hệ thống nhận diện thành viên và tự điền thông tin khi đội trưởng thêm bạn vào đội.',
      action: 'Lưu hồ sơ',
      kind: 'profile',
    }
  }
  if (!team) {
    return {
      title: 'Tạo đội để bắt đầu đăng ký',
      body: 'Mỗi tài khoản thí sinh có thể sở hữu một đội. Người tạo đội sẽ là đội trưởng.',
      action: 'Tạo đội',
      kind: 'create-team',
    }
  }
  if (team.approval_status === 'rejected') {
    return {
      title: 'Sửa theo góp ý của BTC',
      body: team.approval_note || 'Đội cần cập nhật lại thông tin trước khi gửi duyệt lần nữa.',
      action: 'Sửa thông tin',
      kind: 'fix',
    }
  }
  if (members.length === 0) {
    return {
      title: 'Thêm thành viên đầu tiên',
      body: 'Bạn có thể nhập MSSV để hệ thống tự ghép hồ sơ nếu thành viên đã có tài khoản.',
      action: 'Thêm thành viên',
      kind: 'add-member',
    }
  }
  if (team.approval_status === 'draft') {
    return {
      title: 'Gửi đội cho BTC duyệt',
      body: 'Kiểm tra tên đội và danh sách thành viên trước khi gửi. Bạn vẫn có thể cập nhật nếu BTC yêu cầu sửa.',
      action: 'Gửi duyệt',
      kind: 'submit',
    }
  }
  if (team.approval_status === 'pending_approval') {
    return {
      title: 'Đội đang chờ duyệt',
      body: 'BTC sẽ kiểm tra thông tin đội. Bạn có thể rà lại danh sách thành viên trong lúc chờ.',
      action: 'Xem thành viên',
      kind: 'members',
    }
  }
  return {
    title: 'Sẵn sàng cho ngày thi',
    body: 'Đội đã được duyệt. Theo dõi Discord và thông báo từ BTC để nhận lịch tập trung.',
    action: 'Xem thông tin',
    kind: 'ready',
  }
}

function ProgressTrail({ profile, team, members }) {
  return (
    <div className={`${PARTICIPANT_CARD} overflow-hidden`}>
      <div className="grid grid-cols-5 divide-x divide-[#DCD8CC]">
        {STEPS.map((step) => {
          const state = getStepState(step, profile, team, members)
          const active = state === 'active'
          const done = state === 'done'
          const circleStyle = done
            ? { backgroundColor: COLORS.trail, borderColor: COLORS.trail, color: 'white' }
            : active
              ? { backgroundColor: 'rgba(224,162,58,0.15)', borderColor: COLORS.gold, color: '#9A6B12' }
              : { backgroundColor: COLORS.paper, borderColor: COLORS.stone, color: 'rgba(32,49,43,0.3)' }
          return (
            <div key={step.key} className="relative px-2 py-4 text-center" style={{ backgroundColor: active ? COLORS.paper : 'white' }}>
              <span
                className="mx-auto flex h-8 w-8 items-center justify-center rounded-full border font-mono text-xs font-semibold"
                style={circleStyle}
              >
                {done ? <Icon name="checkPlain" className="h-4 w-4" /> : STEPS.indexOf(step) + 1}
              </span>
              <p className={`mt-2 text-xs font-medium ${done || active ? 'text-ink' : 'text-ink/35'}`}>
                {step.label}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MemberDrawer({ form, onChange, onClose, onSave, editing }) {
  if (!form) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[#20312B]/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-[#DCD8CC] bg-[#F3F4F1] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#DCD8CC] bg-white px-5 py-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Thành viên</p>
            <h2 className="mt-1 font-display text-xl font-bold text-ink">
              {editing ? 'Sửa thông tin' : 'Thêm thành viên'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#20312B]/45 transition hover:bg-[#F3F4F1] hover:text-[#20312B]" aria-label="Đóng">
            <Icon name="close" />
          </button>
        </div>

        <form className="flex-1 space-y-4 overflow-y-auto px-5 py-5" onSubmit={onSave}>
          <Field label="MSSV" value={form.mssv} onChange={(v) => onChange({ ...form, mssv: v })} placeholder="Nhập MSSV" />
          <Field label="Họ và tên" value={form.full_name} onChange={(v) => onChange({ ...form, full_name: v })} placeholder="Nhập họ tên" />
          <Field label="Email" value={form.email} onChange={(v) => onChange({ ...form, email: v })} placeholder="name@example.edu.vn" />
          <Field label="Số điện thoại" value={form.phone} onChange={(v) => onChange({ ...form, phone: v })} placeholder="09..." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Khoa" value={form.faculty} onChange={(v) => onChange({ ...form, faculty: v })} placeholder="CNPM" />
            <Field label="Trường" value={form.school} onChange={(v) => onChange({ ...form, school: v })} placeholder="UIT" />
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-[#DCD8CC] bg-white px-3 py-2 text-sm text-[#20312B]/65">
            <input
              type="checkbox"
              checked={form.has_account}
              onChange={(e) => onChange({ ...form, has_account: e.target.checked })}
              className="h-4 w-4 rounded border-[#DCD8CC] text-[#1F7A6B] focus:ring-[#1F7A6B]/20"
            />
            Thành viên đã có tài khoản web
          </label>
        </form>

        <div className="border-t border-[#DCD8CC] bg-white px-5 py-4">
          <button
            type="button"
            onClick={onSave}
            className={`w-full ${PRIMARY_BUTTON}`}
          >
            <Icon name="checkPlain" className="h-4 w-4" />
            Lưu thành viên
          </button>
        </div>
      </aside>
    </div>
  )
}

function EmptyTeamCard({ onCreate }) {
  return (
    <div className={`${PARTICIPANT_CARD} border-dashed px-5 py-10 text-center`}>
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#E0A23A]/15 text-[#9A6B12]">
        <Icon name="users" className="h-6 w-6" />
      </span>
      <h2 className="mt-4 font-display text-xl font-bold text-ink">Bạn chưa có đội</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink/50">
        Tạo đội trước, sau đó thêm thành viên và gửi thông tin cho BTC duyệt.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className={`mt-5 ${PRIMARY_BUTTON}`}
      >
        <Icon name="plus" className="h-4 w-4" />
        Tạo đội
      </button>
    </div>
  )
}

function ParticipantDashboard() {
  const user = getUser()
  const [profile, setProfile] = useState(initialProfile)
  const [profileSaved, setProfileSaved] = useState(false)
  const [team, setTeam] = useState(initialTeam)
  const [members, setMembers] = useState(initialMembers)
  const [drawer, setDrawer] = useState(null)
  const [memberForm, setMemberForm] = useState(null)

  const status = STATUS[team?.approval_status || 'draft']
  const provision = PROVISION[team?.provision_state || 'none']
  const editable = !team || ['draft', 'pending_approval', 'rejected'].includes(team.approval_status)
  const nextAction = useMemo(() => getNextAction(profile, team, members), [profile, team, members])
  const accountCount = members.filter((m) => m.has_account).length

  const openMemberDrawer = (index = null) => {
    const base = index === null
      ? { mssv: '', full_name: '', email: '', phone: '', faculty: '', school: '', has_account: false, is_captain: false }
      : members[index]
    setDrawer({ index })
    setMemberForm({ ...base })
  }

  const closeMemberDrawer = () => {
    setDrawer(null)
    setMemberForm(null)
  }

  const saveMember = (event) => {
    event?.preventDefault?.()
    if (!memberForm?.mssv || !memberForm?.full_name) return
    if (drawer.index === null) {
      if (members.length >= MAX_MEMBERS) return
      setMembers((prev) => [...prev, memberForm])
    } else {
      setMembers((prev) => prev.map((m, i) => (i === drawer.index ? memberForm : m)))
    }
    closeMemberDrawer()
  }

  const removeMember = (index) => {
    const member = members[index]
    if (member?.is_captain) return
    setMembers((prev) => prev.filter((_, i) => i !== index))
  }

  const createTeam = () => {
    setTeam({
      team_id: 'T0911',
      team_name: 'Đội chưa đặt tên',
      approval_status: 'draft',
      provision_state: 'none',
      approval_note: '',
    })
    setMembers([
      {
        mssv: profile.mssv,
        full_name: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        faculty: profile.faculty,
        school: profile.school,
        has_account: true,
        is_captain: true,
      },
    ])
  }

  const saveProfile = (event) => {
    event.preventDefault()
    setProfileSaved(true)
    window.setTimeout(() => setProfileSaved(false), 1400)
  }

  const submitTeam = () => {
    if (!team || members.length === 0) return
    setTeam((prev) => ({
      ...prev,
      approval_status: 'pending_approval',
      approval_note: '',
    }))
  }

  const handleNextAction = () => {
    if (nextAction.kind === 'create-team') createTeam()
    if (nextAction.kind === 'add-member') openMemberDrawer()
    if (nextAction.kind === 'submit') submitTeam()
    if (nextAction.kind === 'fix') window.scrollTo({ top: 360, behavior: 'smooth' })
  }

  const logout = () => {
    localStorage.removeItem('authToken')
    localStorage.removeItem('user')
    window.location.replace('/login')
  }

  return (
    <div className="min-h-screen font-sans" style={{ backgroundColor: COLORS.paper, color: COLORS.ink }}>
      <Contours />

      <header
        className="sticky top-0 z-40 border-b backdrop-blur"
        style={{ backgroundColor: 'rgba(243,244,241,0.95)', borderColor: COLORS.stone }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/landing" className="flex items-center gap-3">
            <img src={logoImage} alt="VNUTour" className="h-10 w-10 object-contain" />
            <div>
              <p className="font-display text-base font-bold text-ink">VNUTour</p>
              <p className="font-mono text-[11px] text-ink/40">Cổng thí sinh</p>
            </div>
          </a>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-[#DCD8CC] bg-white px-3 py-1.5 text-sm text-[#20312B]/60 sm:inline-flex">
              {user.username}
            </span>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-2 rounded-lg border border-[#DCD8CC] bg-white px-3 py-2 text-sm font-semibold text-[#20312B]/60 transition hover:bg-[#F3F4F1] hover:text-[#20312B]"
            >
              <LogoutIcon />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <section className={`${PARTICIPANT_CARD} overflow-hidden`}>
          <div className="grid gap-0 lg:grid-cols-[1.45fr_0.55fr]">
            <div className="px-5 py-6 sm:px-7">
              <div className="flex flex-wrap items-center gap-2">
                {team ? <Badge label={status.label} cls={status.cls} /> : <Badge label="Chưa có đội" cls="bg-[#20312B]/[0.07] text-[#20312B]/50" />}
                {team && <span className="font-mono text-xs text-ink/35">{team.team_id}</span>}
              </div>
              <h1 className="mt-4 max-w-2xl font-display text-3xl font-bold tracking-normal text-ink sm:text-4xl">
                {team ? team.team_name : 'Bắt đầu đăng ký đội VNUTour'}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/55 sm:text-base">
                Quản lý hồ sơ, danh sách thành viên và trạng thái duyệt trong một nơi để đội trưởng luôn biết bước tiếp theo.
              </p>
            </div>

            <div className="border-t border-[#DCD8CC] bg-[#F3F4F1]/65 p-5 lg:border-l lg:border-t-0">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Việc cần làm</p>
              <h2 className="mt-2 font-display text-xl font-bold text-ink">{nextAction.title}</h2>
              <p className="mt-2 text-sm leading-6 text-ink/55">{nextAction.body}</p>
              <button
                type="button"
                onClick={handleNextAction}
                className={`mt-5 w-full ${PRIMARY_BUTTON}`}
              >
                {nextAction.action}
                <Icon name="chevronR" className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        <ProgressTrail profile={profile} team={team} members={members} />

        <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-5">
            {!team ? (
              <EmptyTeamCard onCreate={createTeam} />
            ) : (
              <div className={`${PARTICIPANT_CARD} p-5`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Đội của tôi</p>
                    <h2 className="mt-1 font-display text-xl font-bold text-ink">{status.title}</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge label={status.label} cls={status.cls} />
                    <Badge label={provision.label} cls={provision.cls} />
                  </div>
                </div>

                {team.approval_status === 'rejected' && team.approval_note && (
                  <div className="mt-4 rounded-lg border border-[#D6492B]/25 bg-[#D6492B]/[0.06] px-4 py-3 text-sm text-[#D6492B]">
                    Lý do cần sửa: {team.approval_note}
                  </div>
                )}

                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_160px]">
                  <Field
                    label="Tên đội"
                    value={team.team_name}
                    disabled={!editable}
                    onChange={(value) => setTeam((prev) => ({ ...prev, team_name: value }))}
                  />
                  <Field label="Mã đội" value={team.team_id} disabled onChange={() => {}} />
                </div>

                <div className="mt-5 rounded-lg border border-[#DCD8CC] bg-[#F3F4F1]/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-ink">Tiến độ thành viên</p>
                    <p className="font-mono text-xs text-ink/45">{members.length}/{MAX_MEMBERS}</p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                    <div className="h-full" style={{ width: `${Math.min(100, (members.length / MAX_MEMBERS) * 100)}%`, backgroundColor: status.color }} />
                  </div>
                  <p className="mt-2 text-xs text-ink/45">
                    {accountCount}/{members.length || 0} thành viên đã có tài khoản web.
                  </p>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={submitTeam}
                    disabled={!editable || members.length === 0 || team.approval_status === 'pending_approval'}
                    className={TRAIL_BUTTON}
                  >
                    <Icon name="checkPlain" className="h-4 w-4" />
                    Gửi duyệt
                  </button>
                  <button
                    type="button"
                    onClick={() => openMemberDrawer()}
                    disabled={!editable || members.length >= MAX_MEMBERS}
                    className={`${SECONDARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <Icon name="plus" className="h-4 w-4" />
                    Thêm thành viên
                  </button>
                </div>
              </div>
            )}

            <div className={`${PARTICIPANT_CARD} overflow-hidden`}>
              <div className="flex items-center justify-between border-b border-[#DCD8CC] px-5 py-4">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Danh sách</p>
                  <h2 className="mt-1 font-display text-lg font-bold text-ink">Thành viên đội</h2>
                </div>
                <span className="font-mono text-xs text-ink/40">{members.length} người</span>
              </div>

              <div className="divide-y divide-stone">
                {members.map((member, index) => (
                  <div key={`${member.mssv}-${index}`} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-ink">{member.full_name}</h3>
                        {member.is_captain && <Badge label="Đội trưởng" cls="bg-[#E0A23A]/15 text-[#9A6B12]" />}
                        <Badge
                          label={member.has_account ? 'Đã có tài khoản' : 'Chưa có tài khoản'}
                          cls={member.has_account ? 'bg-[#1F7A6B]/12 text-[#1F7A6B]' : 'bg-[#20312B]/[0.06] text-[#20312B]/40'}
                        />
                      </div>
                      <p className="mt-1 font-mono text-xs text-ink/45">
                        {member.mssv} · {member.faculty || 'Chưa có khoa'} · {member.school || 'Chưa có trường'}
                      </p>
                      {member.email && <p className="mt-1 truncate text-xs text-ink/40">{member.email}</p>}
                    </div>
                    <div className="flex items-center gap-1 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => openMemberDrawer(index)}
                        disabled={!editable}
                        className="rounded-md px-3 py-1.5 text-xs font-semibold text-[#20312B]/55 transition hover:bg-[#F3F4F1] hover:text-[#20312B] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMember(index)}
                        disabled={!editable || member.is_captain}
                        className="rounded-md p-1.5 text-[#20312B]/25 transition hover:bg-[#D6492B]/10 hover:text-[#D6492B] disabled:cursor-not-allowed disabled:opacity-30"
                        aria-label="Xóa thành viên"
                      >
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {members.length === 0 && (
                  <div className="px-5 py-12 text-center text-sm text-ink/40">
                    Chưa có thành viên nào trong đội.
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="space-y-5">
            <form className={`${PARTICIPANT_CARD} p-5`} onSubmit={saveProfile}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Hồ sơ</p>
                  <h2 className="mt-1 font-display text-lg font-bold text-ink">Thông tin cá nhân</h2>
                </div>
                {profileSaved && <Badge label="Đã lưu" cls="bg-[#1F7A6B]/12 text-[#1F7A6B]" />}
              </div>
              <div className="mt-4 space-y-3">
                <Field label="Họ và tên" value={profile.full_name} onChange={(v) => setProfile((p) => ({ ...p, full_name: v }))} />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <Field label="MSSV" value={profile.mssv} onChange={(v) => setProfile((p) => ({ ...p, mssv: v }))} />
                  <Field label="Số điện thoại" value={profile.phone} onChange={(v) => setProfile((p) => ({ ...p, phone: v }))} />
                </div>
                <Field label="Email" value={profile.email} onChange={(v) => setProfile((p) => ({ ...p, email: v }))} />
                <Field label="Khoa" value={profile.faculty} onChange={(v) => setProfile((p) => ({ ...p, faculty: v }))} />
                <Field label="Facebook" value={profile.facebook} onChange={(v) => setProfile((p) => ({ ...p, facebook: v }))} />
              </div>
              <button
                type="submit"
                className={`mt-4 w-full ${PRIMARY_BUTTON}`}
              >
                <Icon name="checkPlain" className="h-4 w-4" />
                Lưu hồ sơ
              </button>
            </form>

            <div className={`${PARTICIPANT_CARD} p-5`}>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Ngày thi</p>
              <h2 className="mt-1 font-display text-lg font-bold text-ink">Checklist nhanh</h2>
              <div className="mt-4 space-y-3">
                {[
                  ['Hồ sơ có MSSV', Boolean(profile.mssv)],
                  ['Đội đã có thành viên', members.length > 0],
                  ['Đội đã gửi duyệt', team?.approval_status === 'pending_approval' || team?.approval_status === 'approved'],
                  ['Đội đã được duyệt', team?.approval_status === 'approved'],
                ].map(([label, checked]) => (
                  <div key={label} className="flex items-center gap-3 rounded-lg border border-[#DCD8CC] bg-white px-3 py-2.5">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: checked ? COLORS.trail : COLORS.paper,
                        color: checked ? 'white' : 'rgba(32,49,43,0.25)',
                      }}
                    >
                      <Icon name="checkPlain" className="h-3.5 w-3.5" />
                    </span>
                    <span className={`text-sm ${checked ? 'text-ink' : 'text-ink/45'}`}>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${PARTICIPANT_CARD} p-5`}>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Thông báo</p>
              <h2 className="mt-1 font-display text-lg font-bold text-ink">Từ BTC</h2>
              <div className="mt-4 rounded-lg border border-[#DCD8CC] bg-[#F3F4F1]/70 px-4 py-3 text-sm leading-6 text-[#20312B]/55">
                Sau khi đội được duyệt, hệ thống sẽ tạo Discord role và kênh đội. Thành viên chưa có tài khoản cần đăng ký bằng email hoặc MSSV đã khai báo.
              </div>
            </div>
          </aside>
        </section>
      </main>

      <MemberDrawer
        form={memberForm}
        onChange={setMemberForm}
        onClose={closeMemberDrawer}
        onSave={saveMember}
        editing={drawer?.index !== null}
      />
    </div>
  )
}

export default ParticipantDashboard
