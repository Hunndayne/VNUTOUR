import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, CARD, APPROVAL, PROVISION, Badge } from './ui.jsx'
import { apiRequest, formatDateTime, logoutAndRedirect } from './api.js'
import { useSearchParam } from './router.js'
import { useDraftState, DraftNotice } from './drafts.jsx'

const FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'pending_approval', label: 'Chờ duyệt' },
  { key: 'approved', label: 'Đã duyệt' },
  { key: 'draft', label: 'Nháp' },
  { key: 'rejected', label: 'Từ chối' },
]

const MAX_TEAM_SIZE = 5

const GENDER_META = {
  male: { short: 'Nam', cls: 'bg-[#3E7CA8]/10 text-[#32698F]' },
  female: { short: 'Nữ', cls: 'bg-clay/10 text-clay' },
  other: { short: 'Khác', cls: 'bg-gold/12 text-[#8A6417]' },
  unknown: { short: 'Chưa rõ', cls: 'bg-ink/[0.06] text-ink/45' },
}

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  if (code?.startsWith('merge_would_exceed_max')) {
    const max = code.split(':')[1] || MAX_TEAM_SIZE
    return `Tổng thành viên sau khi ghép vượt quá tối đa ${max} người. Hãy bỏ bớt đội đã chọn.`
  }
  if (code?.startsWith('merge_team_has_history')) {
    const teamCode = code.split(':')[1]
    return `Đội ${teamCode || 'này'} đã có điểm, lượt điểm danh hoặc bài nộp nên không thể ghép.`
  }
  if (code?.startsWith('merge_team_not_approved')) {
    const teamCode = code.split(':')[1]
    return `Đội ${teamCode || 'này'} chưa được duyệt nên chưa thể ghép.`
  }
  const map = {
    owner_not_found: 'Không tìm thấy tài khoản đội trưởng.',
    invalid_owner_role: 'Tài khoản này không phải participant.',
    owner_profile_incomplete: 'Đội trưởng cần có MSSV trước khi tạo đội từ admin.',
    owner_already_has_team: 'Tài khoản đội trưởng đã thuộc một đội khác.',
    conflict: 'Dữ liệu đội bị trùng hoặc đang xung đột.',
    not_found: 'Không tìm thấy đội cần thao tác.',
    merge_same_team: 'Không thể ghép một đội với chính nó.',
    missing_team_codes: 'Cần chọn ít nhất hai đội để ghép.',
    merge_requires_multiple_teams: 'Cần chọn ít nhất hai đội để ghép.',
    merge_duplicate_team_codes: 'Danh sách ghép đang chứa đội bị chọn trùng.',
    registration_phase_closed: 'Chỉ có thể ghép đội trong phase đăng ký.',
    team_not_submitted: 'Chỉ có thể duyệt hoặc từ chối đội đã gửi đăng ký.',
  }
  return map[code] || 'Không thể đồng bộ dữ liệu đội.'
}

function normalizeTeamSummary(team) {
  const genderCounts = team.gender_counts || {}
  return {
    id: team.code,
    name: team.name || '',
    owner: team.owner_username || '',
    status: team.approval_status || 'draft',
    provision: team.provision_state || 'none',
    memberCount: team.member_count || 0,
    genderCounts: {
      male: Number(genderCounts.male || 0),
      female: Number(genderCounts.female || 0),
      other: Number(genderCounts.other || 0),
      unknown: Number(genderCounts.unknown || 0),
    },
    memberSummaries: (team.member_summaries || []).map(member => ({
      mssv: member.mssv || '',
      fullName: member.full_name || '',
      gender: GENDER_META[member.gender] ? member.gender : 'unknown',
      isCaptain: Boolean(member.is_captain),
    })),
    isLateRegistration: Boolean(team.is_late_registration),
    createdAt: team.created_at || '',
  }
}

function memberStripCls(member) {
  if (member.has_account && member.discord_id) return 'bg-trail'
  if (member.has_account) return 'bg-[#3E7CA8]'
  if (member.discord_id) return 'bg-[#5865F2]'
  return 'bg-stone'
}

function MemberCard({ member }) {
  const strip = memberStripCls(member)
  return (
    <div className="flex">
      <div className={`w-[3px] shrink-0 ${strip}`} />
      <div className="min-w-0 flex-1 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold text-ink">
                {member.full_name || '(Chưa điền tên)'}
              </span>
              {member.is_captain && (
                <Badge label="Đội trưởng" cls="bg-gold/15 text-[#9A6B12]" />
              )}
            </div>
            <p className="mt-0.5 font-mono text-xs text-ink/50">
              {member.mssv}
              {member.faculty && <> · {member.faculty}</>}
            </p>
            {(member.email || member.phone) && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink/40">
                {member.email && <span className="mr-3">{member.email}</span>}
                {member.phone && <span>{member.phone}</span>}
              </p>
            )}
            {(member.school || member.cccd || member.date_of_birth) && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink/40">
                {member.school && <span className="mr-3">{member.school}</span>}
                {member.cccd && <span className="mr-3">CCCD: {member.cccd}</span>}
                {member.date_of_birth && <span>Ngày sinh: {member.date_of_birth}</span>}
              </p>
            )}
            {member.extra && Object.keys(member.extra).length > 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink/35">
                {Object.entries(member.extra).map(([key, value]) => `${key}: ${value}`).join(' · ')}
              </p>
            )}
            {member.email_mismatch && (
              <p className="mt-1.5 rounded-md bg-gold/10 px-2 py-1 text-[11px] leading-relaxed text-[#9A6B12]">
                ⚠ Thành viên đã tạo tài khoản với email khác
                {member.form_email && (
                  <> (bạn nhập <span className="font-mono">{member.form_email}</span>,
                  {' '}tài khoản dùng <span className="font-mono">{member.account_email}</span>)</>
                )}
                . Thông tin đã được cập nhật theo tài khoản.
              </p>
            )}
          </div>

          <div className="shrink-0 flex flex-col items-end gap-1 pt-0.5">
            <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${member.has_account ? 'text-trail' : 'text-ink/30'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${member.has_account ? 'bg-trail' : 'bg-ink/20'}`} />
              {member.has_account ? 'Có TK web' : 'Chưa có TK'}
            </span>
            <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${member.discord_id ? 'text-[#5865F2]' : 'text-ink/25'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${member.discord_id ? 'bg-[#5865F2]' : 'bg-ink/15'}`} />
              {member.discord_id ? 'Discord ✓' : 'Discord —'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function QuickStat({ label, value, done = false, accent }) {
  const valCls = accent === 'discord'
    ? (done ? 'text-[#5865F2]' : 'text-ink/50')
    : (done ? 'text-trail' : 'text-ink/50')
  return (
    <div className={`${CARD} px-3 py-2.5`}>
      <p className={`font-mono text-lg font-bold leading-none ${valCls}`}>{value}</p>
      <p className="mt-1 text-[11px] text-ink/40">{label}</p>
    </div>
  )
}

function TeamDrawer({ team, loading, busy, onClose, onApprove, onReject }) {
  const [mode, setMode] = useState('idle')
  const [note, setNote] = useState('')

  useEffect(() => {
    setMode('idle')
    setNote('')
  }, [team?.id])

  if (!team) return null

  const canAct = team.status === 'pending_approval'
  const withAccount = team.members.filter(member => member.has_account).length
  const withDiscord = team.members.filter(member => member.discord_id).length

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[440px] flex-col border-l border-stone bg-paper shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-ink/40">{team.id}</span>
              <Badge {...APPROVAL[team.status]} />
              {team.provision && team.provision !== 'none' && (
                <Badge {...(PROVISION[team.provision] ?? PROVISION.none)} />
              )}
              {team.isLateRegistration && (
                <Badge label="Đăng ký trễ" cls="bg-clay/12 text-clay" />
              )}
            </div>
            <h2 className="mt-1 truncate font-display text-xl font-bold text-ink">
              {team.name}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
              <span className="text-sm text-ink/50">
                Đội trưởng: <span className="font-medium text-ink/70">{team.owner || 'Chưa gán'}</span>
              </span>
              {team.submittedAt && (
                <span className="font-mono text-xs text-ink/35">Gửi {formatDateTime(team.submittedAt)}</span>
              )}
            </div>
          </div>
          <button type="button" aria-label="Đóng chi tiết đội" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-ink/40 transition hover:bg-paper hover:text-ink">
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-12 text-center text-sm text-ink/35">Đang tải chi tiết đội...</div>
          ) : (
            <>
              {team.status === 'rejected' && team.note && (
                <div className="mx-4 mt-4 rounded-lg border border-clay/25 bg-clay/[0.05] px-3.5 py-3">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-clay/60">
                    Lý do từ chối
                  </p>
                  <p className="text-sm text-clay">{team.note}</p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 px-4 py-4">
                <QuickStat label="Thành viên" value={String(team.members.length)} />
                <QuickStat label="Có TK web" value={`${withAccount}/${team.members.length || 0}`} done={withAccount === team.members.length && team.members.length > 0} />
                <QuickStat label="Discord" value={String(withDiscord)} done={withDiscord > 0} accent="discord" />
              </div>

              <div className="px-4 pb-4">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">
                  Minh chứng thanh toán
                </p>
                <div className={`${CARD} px-4 py-3 text-sm`}>
                  {team.paymentProof ? (
                    <a
                      href={team.paymentProof}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-trail underline underline-offset-4"
                    >
                      Mở minh chứng
                    </a>
                  ) : (
                    <span className="text-ink/35">Chưa có minh chứng.</span>
                  )}
                </div>
              </div>
              <div className="px-4 pb-5">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">
                  Thành viên
                </p>
                <div className={`${CARD} overflow-hidden divide-y divide-stone/50`}>
                  {team.members.length > 0
                    ? team.members.map(member => <MemberCard key={member.mssv} member={member} />)
                    : <p className="px-4 py-5 text-sm italic text-ink/30">Đội chưa có thành viên.</p>}
                </div>

              </div>
            </>
          )}
        </div>

        {canAct && !loading && (
          <div className="border-t border-stone bg-white">
            {mode === 'idle' && (
              <div className="flex gap-2 px-4 py-4">
                <button type="button" onClick={() => setMode('rejecting')} className="flex items-center gap-1.5 rounded-lg border border-clay/30 bg-white px-4 py-2.5 text-sm font-semibold text-clay transition hover:bg-clay/[0.04]">
                  <Icon name="xmark" className="h-4 w-4" />
                  Từ chối
                </button>
                <button type="button" onClick={() => setMode('confirming')} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-trail px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96]">
                  <Icon name="checkPlain" className="h-4 w-4" />
                  Duyệt đội
                </button>
              </div>
            )}

            {mode === 'confirming' && (
              <div className="space-y-3 px-4 py-4">
                <div className="rounded-lg border border-trail/25 bg-trail/[0.06] px-4 py-3">
                  <p className="text-sm font-semibold text-ink">Xác nhận duyệt đội?</p>
                  <p className="mt-0.5 text-xs text-ink/55">
                    <span className="font-medium text-ink">{team.name}</span> · {team.members.length} thành viên · sẽ được thêm vào hàng đợi tạo kênh Discord.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMode('idle')} className="flex-1 rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper">
                    Quay lại
                  </button>
                  <button type="button" onClick={onApprove} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-trail py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96] disabled:opacity-40">
                    <Icon name="checkPlain" className="h-4 w-4" />
                    {busy ? 'Đang duyệt...' : 'Xác nhận duyệt'}
                  </button>
                </div>
              </div>
            )}

            {mode === 'rejecting' && (
              <div className="space-y-3 px-4 py-4">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-ink/40">
                    Lý do từ chối · gửi cho đội trưởng
                  </label>
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder="Mô tả cụ thể để đội trưởng có thể chỉnh sửa và gửi lại..."
                    className="w-full resize-none rounded-lg border border-stone bg-paper px-3 py-2.5 text-sm text-ink placeholder:text-ink/30 outline-none transition focus:border-clay/40 focus:ring-2 focus:ring-clay/10"
                  />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMode('idle')} className="flex-1 rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper">
                    Quay lại
                  </button>
                  <button type="button" onClick={() => onReject(note)} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-clay py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96] disabled:opacity-40">
                    <Icon name="xmark" className="h-4 w-4" />
                    {busy ? 'Đang từ chối...' : 'Xác nhận từ chối'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

function CreateTeamDrawer({ open, form, draft, busy, onClose, onChange, onCreate }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-stone bg-paper shadow-2xl animate-[fadeIn_0.15s_ease-out]">
        <div className="flex items-start justify-between gap-3 border-b border-stone bg-white px-5 py-4">
          <div>
            <h2 className="font-display text-xl font-bold text-ink">Tạo đội mới</h2>
            <p className="mt-0.5 text-sm text-ink/45">Đội admin tạo sẽ được duyệt ngay</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-ink/40 transition hover:bg-paper hover:text-ink">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <DraftNotice draft={draft} label="đội mới đang tạo" />
          <div>
            <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Tên đội *</label>
            <input type="text" value={form.name} onChange={e => onChange(f => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/45">Đội trưởng (username)</label>
            <input type="text" value={form.owner} onChange={e => onChange(f => ({ ...f, owner: e.target.value }))} className="w-full rounded-lg border border-stone bg-white px-3 py-2 text-sm text-ink focus:border-trail/40 focus:outline-none focus:ring-2 focus:ring-trail/10" />
          </div>
          <div className="rounded-lg border border-stone bg-paper/50 px-4 py-3 text-xs leading-6 text-ink/50">
            Nếu nhập đội trưởng, tài khoản đó cần là participant và đã có MSSV. Khi tạo thành công, đội trưởng sẽ được thêm luôn vào đội.
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-stone bg-white px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-stone bg-white px-4 py-2 text-sm font-medium text-ink/60 transition hover:bg-paper">
            Hủy
          </button>
          <button type="button" onClick={onCreate} disabled={!form.name.trim() || busy} className="rounded-lg bg-trail px-5 py-2 text-sm font-semibold text-white transition hover:bg-trail/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? 'Đang tạo...' : 'Tạo đội'}
          </button>
        </div>
      </aside>
    </div>
  )
}

function MergeCandidateRow({ team, selected, disabled, onToggle }) {
  const missing = MAX_TEAM_SIZE - team.memberCount

  return (
    <label className={`block rounded-lg border px-3 py-3 transition ${
      selected
        ? 'cursor-pointer border-trail/45 bg-trail/[0.06]'
        : disabled
          ? 'cursor-not-allowed border-stone bg-paper/50 opacity-45'
          : 'cursor-pointer border-stone bg-white hover:border-trail/25 hover:bg-paper/60'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            disabled={disabled}
            onChange={onToggle}
            className="mt-0.5 h-4 w-4 shrink-0 accent-trail"
          />
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs font-semibold text-ink/55">{team.id}</span>
            <Badge {...APPROVAL[team.status]} />
            {selected && <Badge label="Đã chọn" cls="bg-trail/15 text-trail" />}
          </div>
          <p className="mt-0.5 truncate text-sm font-medium text-ink">{team.name || '(Chưa đặt tên)'}</p>
          <p className="mt-0.5 font-mono text-[11px] text-ink/40">
            {team.memberCount}/{MAX_TEAM_SIZE} thành viên
            {missing > 0 ? <span className="text-clay"> · thiếu {missing}</span> : <span className="text-trail"> · đã đủ</span>}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(GENDER_META).map(([key, meta]) => (
              team.genderCounts[key] > 0 && (
                <span key={key} className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${meta.cls}`}>
                  {meta.short} {team.genderCounts[key]}
                </span>
              )
            ))}
          </div>
          </div>
        </div>
        <span className={`shrink-0 font-mono text-sm font-bold ${selected ? 'text-trail' : 'text-ink/35'}`}>
          +{team.memberCount}
        </span>
      </div>
      {team.memberSummaries.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-stone/60 pt-2">
          {team.memberSummaries.map(member => {
            const gender = GENDER_META[member.gender] || GENDER_META.unknown
            return (
              <div key={member.mssv} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 truncate text-ink/55">
                  {member.fullName || member.mssv}
                  {member.isCaptain && <span className="ml-1 font-medium text-[#9A6B12]">Đội trưởng</span>}
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${gender.cls}`}>{gender.short}</span>
              </div>
            )
          })}
        </div>
      )}
    </label>
  )
}

function MergeTeamsModal({
  open, teams, loading, busy, error,
  selectedIds, onClose, onToggle, onClear, onMerge,
}) {
  const [search, setSearch] = useState('')
  const [onlyUnderStrength, setOnlyUnderStrength] = useState(true)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) return
    setSearch('')
    setOnlyUnderStrength(true)
    setConfirming(false)
  }, [open])

  useEffect(() => {
    setConfirming(false)
  }, [selectedIds])

  if (!open) return null

  const selectedTeams = teams.filter(team => selectedIds.includes(team.id))
  const combined = selectedTeams.reduce((sum, team) => sum + team.memberCount, 0)
  const selectedGenderCounts = selectedTeams.reduce(
    (counts, team) => {
      Object.keys(counts).forEach(key => { counts[key] += team.genderCounts[key] || 0 })
      return counts
    },
    { male: 0, female: 0, other: 0, unknown: 0 },
  )
  const genderGap = Math.abs(selectedGenderCounts.male - selectedGenderCounts.female)
  const otherOrUnknownCount = selectedGenderCounts.other + selectedGenderCounts.unknown
  const exceedsMax = combined > MAX_TEAM_SIZE
  const ready = selectedTeams.length >= 2 && !exceedsMax
  const survivor = selectedTeams.slice().sort((a, b) => a.id.localeCompare(b.id))[0] || null
  const removedTeams = selectedTeams.filter(team => team.id !== survivor?.id)

  const term = search.trim().toLowerCase()
  const visible = teams
    .filter(team => (
      !onlyUnderStrength
      || team.memberCount < MAX_TEAM_SIZE
      || selectedIds.includes(team.id)
    ))
    .filter(team => (
      !term
      || team.id.toLowerCase().includes(term)
      || team.name.toLowerCase().includes(term)
    ))
    .sort((a, b) => (
      Number(selectedIds.includes(b.id)) - Number(selectedIds.includes(a.id))
      || (a.memberCount - b.memberCount)
      || a.id.localeCompare(b.id)
    ))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Đóng cửa sổ ghép đội"
        className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-teams-title"
        className="relative flex h-[calc(100dvh-2rem)] max-h-[820px] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-stone bg-paper shadow-2xl sm:h-[calc(100dvh-3rem)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-stone bg-white px-5 py-4">
          <div>
            <h2 id="merge-teams-title" className="font-display text-xl font-bold text-ink">Ghép đội thiếu người</h2>
            <p className="mt-0.5 text-sm text-ink/45">
              Chọn từ 2 đội trở lên, tổng thành viên không vượt quá {MAX_TEAM_SIZE}
            </p>
          </div>
          <button type="button" aria-label="Đóng cửa sổ ghép đội" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-ink/40 transition hover:bg-paper hover:text-ink">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-stone bg-white px-5 pb-4">
          <div className={`${CARD} px-4 py-3`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">Đã chọn {selectedTeams.length} đội</p>
                <p className="mt-0.5 text-xs text-ink/45">
                  {selectedTeams.length < 2 ? 'Chọn thêm ít nhất một đội để ghép.' : `Mã ${survivor?.id} sẽ được giữ làm mã nội bộ.`}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-mono text-xl font-bold ${exceedsMax ? 'text-clay' : ready ? 'text-trail' : 'text-ink'}`}>
                  {combined}/{MAX_TEAM_SIZE}
                </p>
                <p className="text-[11px] text-ink/40">thành viên</p>
              </div>
            </div>

            {selectedTeams.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-stone/70 pt-3">
                <span className="mr-1 text-xs font-medium text-ink/50">Sau khi ghép:</span>
                {Object.entries(GENDER_META).map(([key, meta]) => (
                  selectedGenderCounts[key] > 0 && (
                    <span key={key} className={`rounded-md px-2 py-1 text-[11px] font-semibold ${meta.cls}`}>
                      {meta.short} {selectedGenderCounts[key]}
                    </span>
                  )
                ))}
                <span className={`ml-auto text-xs font-semibold ${selectedGenderCounts.unknown > 0 || genderGap > 1 ? 'text-clay' : 'text-trail'}`}>
                  {selectedGenderCounts.unknown > 0
                    ? `${selectedGenderCounts.unknown} người chưa khai báo giới tính`
                    : selectedGenderCounts.other > 0
                      ? `${selectedGenderCounts.other} người chọn giới tính khác`
                    : genderGap <= 1 ? 'Cơ cấu cân bằng' : `Đang lệch ${genderGap} người`}
                </span>
              </div>
            )}

            {selectedTeams.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-stone/70 pt-3">
                {selectedTeams.map(team => (
                  <span key={team.id} className="inline-flex items-center gap-1 rounded-md bg-paper px-2 py-1 font-mono text-[11px] text-ink/60">
                    {team.id} <span className="text-ink/35">({team.memberCount})</span>
                  </span>
                ))}
                <button type="button" onClick={onClear} className="ml-auto text-xs font-medium text-ink/45 transition hover:text-clay">
                  Bỏ chọn tất cả
                </button>
              </div>
            )}

            {exceedsMax && (
              <p className="mt-2 rounded-md bg-clay/10 px-2.5 py-1.5 text-xs font-medium text-clay">
                Tổng {combined} thành viên vượt quá tối đa {MAX_TEAM_SIZE}. Hãy bỏ bớt đội đã chọn.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-b border-stone bg-white px-5 py-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Lọc theo mã đội hoặc tên đội..."
              className="w-full rounded-lg border border-stone bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-ink/55">
            <input
              type="checkbox"
              checked={onlyUnderStrength}
              onChange={e => setOnlyUnderStrength(e.target.checked)}
              className="h-3.5 w-3.5 accent-trail"
            />
            Chỉ hiện đội chưa đủ {MAX_TEAM_SIZE} thành viên
          </label>
        </div>

        <div className="grid flex-1 auto-rows-max grid-cols-1 gap-2 overflow-y-auto px-5 py-4 md:grid-cols-2">
          {loading ? (
            <p className="py-12 text-center text-sm text-ink/35 md:col-span-2">Đang tải danh sách đội...</p>
          ) : visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink/35 md:col-span-2">Không có đội nào khớp bộ lọc.</p>
          ) : (
            visible.map(team => (
              <MergeCandidateRow
                key={team.id}
                team={team}
                selected={selectedIds.includes(team.id)}
                disabled={!selectedIds.includes(team.id) && combined + team.memberCount > MAX_TEAM_SIZE}
                onToggle={() => onToggle(team.id)}
              />
            ))
          )}
        </div>

        <div className="border-t border-stone bg-white">
          {error && (
            <p className="mx-5 mt-4 rounded-lg border border-clay/20 bg-clay/10 px-3.5 py-2.5 text-sm text-clay">
              {error}
            </p>
          )}

          {!confirming ? (
            <div className="flex items-center justify-end gap-3 px-5 py-4">
              <button type="button" onClick={onClose} className="rounded-lg border border-stone bg-white px-4 py-2 text-sm font-medium text-ink/60 transition hover:bg-paper">
                Hủy
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!ready || busy}
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2 text-sm font-semibold text-white transition hover:bg-ink/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="link" className="h-4 w-4" />
                Ghép {selectedTeams.length} đội
              </button>
            </div>
          ) : (
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-lg border border-clay/25 bg-clay/[0.06] px-4 py-3">
                <p className="text-sm font-semibold text-ink">
                  Ghép {selectedTeams.length} đội thành một đội có {combined} thành viên?
                </p>
                <ul className="mt-2 space-y-1 text-xs leading-relaxed text-ink/60">
                  <li>• Giữ mã nội bộ <span className="font-mono font-semibold text-ink">{survivor?.id}</span>.</li>
                  <li>
                    • Xoá vĩnh viễn {removedTeams.length} đội:{' '}
                    <span className="font-mono font-semibold text-clay">{removedTeams.map(team => team.id).join(', ')}</span>.
                  </li>
                  <li>• Toàn bộ thành viên được chuyển vào đội {survivor?.id}. Đội sau ghép có {combined}/{MAX_TEAM_SIZE} thành viên.</li>
                  <li>
                    • Cơ cấu giới tính: Nam {selectedGenderCounts.male}, Nữ {selectedGenderCounts.female}
                    {otherOrUnknownCount > 0 ? `, khác hoặc chưa rõ ${otherOrUnknownCount}` : ''}.
                  </li>
                  <li>• Các chức danh đội trưởng cũ bị xoá và hệ thống mở bỏ phiếu kín chọn đội trưởng mới.</li>
                </ul>
                <p className="mt-2 text-xs font-semibold text-clay">Thao tác này không thể hoàn tác.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="flex-1 rounded-lg border border-stone bg-white py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-paper disabled:opacity-40">
                  Quay lại
                </button>
                <button type="button" onClick={onMerge} disabled={busy || !ready} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-clay py-2.5 text-sm font-semibold text-white transition hover:brightness-[0.96] disabled:opacity-40">
                  <Icon name="link" className="h-4 w-4" />
                  {busy ? 'Đang ghép...' : `Xác nhận ghép ${selectedTeams.length} đội`}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function TeamsPage() {
  const [teams, setTeams] = useState([])
  const [filter, setFilter] = useSearchParam('status', 'all')
  const [query, setQuery] = useSearchParam('q', '')
  const [selectedId, setSelectedId] = useSearchParam('team', '')
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [apiError, setApiError] = useState('')
  const [newParam, setNewParam] = useSearchParam('new', '')
  const showCreate = newParam === '1'
  const [createForm, setCreateForm, createDraft] = useDraftState('team:create', { name: '', owner: '' })
  const [showMerge, setShowMerge] = useState(false)
  const [mergeCandidates, setMergeCandidates] = useState([])
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeSelectedIds, setMergeSelectedIds] = useState([])
  const [mergeError, setMergeError] = useState('')
  const [mergeNotice, setMergeNotice] = useState('')

  const loadTeams = useCallback(async () => {
    const params = new URLSearchParams({ limit: '200' })
    if (filter !== 'all') params.set('approval_status', filter)
    if (query.trim()) params.set('q', query.trim())
    const payload = await apiRequest(`/teams?${params.toString()}`)
    setTeams((payload.items || []).map(normalizeTeamSummary))
  }, [filter, query])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        setListLoading(true)
        await loadTeams()
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError(explainApiError(error))
      } finally {
        if (!cancelled) {
          setListLoading(false)
        }
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [loadTeams])

  useEffect(() => {
    let cancelled = false

    const loadTeamDetail = async () => {
      if (!selectedId) {
        setSelectedTeam(null)
        return
      }

      try {
        setDetailLoading(true)
        const detail = await apiRequest(`/teams/${selectedId}`)
        if (cancelled) return
        setSelectedTeam({
          id: detail.code,
          name: detail.name,
          owner: detail.owner_username || '',
          status: detail.approval_status,
          provision: detail.provision_state || 'none',
          submittedAt: detail.submitted_at,
          note: detail.approval_note || '',
          paymentProof: detail.payment_proof || '',
          isLateRegistration: Boolean(detail.is_late_registration),
          members: detail.members || [],
        })
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError(explainApiError(error))
      } finally {
        if (!cancelled) {
          setDetailLoading(false)
        }
      }
    }

    loadTeamDetail()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const counts = useMemo(() => {
    const next = { all: teams.length }
    for (const team of teams) {
      next[team.status] = (next[team.status] || 0) + 1
    }
    return next
  }, [teams])

  const rows = teams

  const withBusy = async (busyKey, task) => {
    setBusy(busyKey)
    setApiError('')
    try {
      await task()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(explainApiError(error))
    } finally {
      setBusy('')
    }
  }

  const handleApprove = () => withBusy('approve', async () => {
    await apiRequest(`/teams/${selectedId}/approve`, {
      method: 'POST',
      body: { is_late_registration: Boolean(selectedTeam?.isLateRegistration) },
    })
    await loadTeams()
    if (selectedId) {
      const detail = await apiRequest(`/teams/${selectedId}`)
      setSelectedTeam({
        id: detail.code,
        name: detail.name,
        owner: detail.owner_username || '',
        status: detail.approval_status,
        provision: detail.provision_state || 'none',
        submittedAt: detail.submitted_at,
        note: detail.approval_note || '',
        paymentProof: detail.payment_proof || '',
        isLateRegistration: Boolean(detail.is_late_registration),
        members: detail.members || [],
      })
    }
  })

  const handleReject = (note) => withBusy('reject', async () => {
    await apiRequest(`/teams/${selectedId}/reject`, {
      method: 'POST',
      body: { note },
    })
    await loadTeams()
    if (selectedId) {
      const detail = await apiRequest(`/teams/${selectedId}`)
      setSelectedTeam({
        id: detail.code,
        name: detail.name,
        owner: detail.owner_username || '',
        status: detail.approval_status,
        provision: detail.provision_state || 'none',
        submittedAt: detail.submitted_at,
        note: detail.approval_note || '',
        paymentProof: detail.payment_proof || '',
        isLateRegistration: Boolean(detail.is_late_registration),
        members: detail.members || [],
      })
    }
  })

  const loadMergeCandidates = useCallback(async () => {
    setMergeLoading(true)
    try {
      const payload = await apiRequest('/teams?limit=200&approval_status=approved')
      setMergeCandidates(
        (payload.items || [])
          .map(normalizeTeamSummary)
          .filter(team => team.status === 'approved'),
      )
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setMergeError(explainApiError(error))
    } finally {
      setMergeLoading(false)
    }
  }, [])

  const openMergeDrawer = () => {
    setMergeSelectedIds([])
    setMergeError('')
    setMergeNotice('')
    setShowMerge(true)
    loadMergeCandidates()
  }

  const toggleMergeTeam = (teamId) => {
    setMergeError('')
    setMergeSelectedIds(current => (
      current.includes(teamId)
        ? current.filter(id => id !== teamId)
        : [...current, teamId]
    ))
  }

  const handleMergeTeams = async () => {
    const selectedTeams = mergeCandidates.filter(team => mergeSelectedIds.includes(team.id))
    const combined = selectedTeams.reduce((sum, team) => sum + team.memberCount, 0)
    if (selectedTeams.length < 2 || combined > MAX_TEAM_SIZE) return

    setBusy('merge')
    setMergeError('')
    try {
      const result = await apiRequest('/admin/teams/merge', {
        method: 'POST',
        body: { team_codes: selectedTeams.map(team => team.id) },
      })
      const keptCode = result?.code || selectedTeams.slice().sort((a, b) => a.id.localeCompare(b.id))[0].id
      const memberCount = result?.member_count ?? combined
      const removedCodes = Array.isArray(result?.merged_from)
        ? result.merged_from
        : selectedTeams.filter(team => team.id !== keptCode).map(team => team.id)
      setShowMerge(false)
      setMergeSelectedIds([])
      if (mergeSelectedIds.includes(selectedId)) setSelectedId('', { replace: true })
      setMergeNotice(
        `Đã ghép ${selectedTeams.length} đội vào ${keptCode}. `
        + `${removedCodes.join(', ')} đã bị xoá, ${memberCount} thành viên nay thuộc đội ${keptCode}`
        + (result?.captain_vote_open
          ? ' và đội này đang mở bỏ phiếu kín chọn đội trưởng mới.'
          : '. Đội này hiện chưa có đội trưởng.'),
      )
      try {
        await loadTeams()
      } catch (reloadError) {
        if (reloadError?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError(explainApiError(reloadError))
      }
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setMergeError(explainApiError(error))
      await loadMergeCandidates()
    } finally {
      setBusy('')
    }
  }

  const handleCreateTeam = () => withBusy('create', async () => {
    await apiRequest('/teams', {
      method: 'POST',
      body: {
        name: createForm.name.trim(),
        owner_username: createForm.owner.trim() || undefined,
      },
    })
    await loadTeams()
    setCreateForm({ name: '', owner: '' })
    createDraft.clear()
    setNewParam('', { replace: true })
  })

  return (
    <div className="space-y-4">
      {apiError && (
        <div className="rounded-lg border border-clay/20 bg-clay/10 px-4 py-3 text-sm text-clay">
          {apiError}
        </div>
      )}

      {mergeNotice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-trail/25 bg-trail/[0.08] px-4 py-3 text-sm text-trail">
          <span>{mergeNotice}</span>
          <button
            type="button"
            onClick={() => setMergeNotice('')}
            className="shrink-0 rounded-md p-0.5 text-trail/60 transition hover:text-trail"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1 rounded-xl border border-stone bg-white p-1">
          {FILTERS.map(filterItem => {
            const active = filter === filterItem.key
            return (
              <button
                key={filterItem.key}
                type="button"
                onClick={() => setFilter(filterItem.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active ? 'bg-ink text-white' : 'text-ink/55 hover:bg-paper hover:text-ink'
                }`}
              >
                {filterItem.label}
                <span className={`font-mono text-xs ${active ? 'text-white/70' : 'text-ink/30'}`}>
                  {counts[filterItem.key] ?? 0}
                </span>
              </button>
            )
          })}
        </div>

        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value, { replace: true })}
            placeholder="Tìm theo tên đội, mã đội, đội trưởng..."
            className="w-full rounded-lg border border-stone bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none transition focus:border-trail/40 focus:ring-2 focus:ring-trail/10 lg:w-72"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openMergeDrawer}
            className="inline-flex items-center gap-2 rounded-lg border border-stone bg-white px-4 py-2 text-sm font-semibold text-ink/70 transition hover:bg-paper active:scale-[0.98]"
          >
            <Icon name="link" className="h-4 w-4" />
            Ghép đội
          </button>

          <button
            type="button"
            onClick={() => setNewParam('1')}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/85 active:scale-[0.98]"
          >
            <Icon name="plus" className="h-4 w-4" />
            Tạo đội mới
          </button>
        </div>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead>
              <tr className="border-b border-stone font-mono text-[10px] uppercase tracking-wider text-ink/35">
                <th className="px-4 py-3 font-medium">Mã đội</th>
                <th className="px-4 py-3 font-medium">Tên đội</th>
                <th className="px-4 py-3 font-medium">Đội trưởng</th>
                <th className="px-4 py-3 text-center font-medium">TV</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 font-medium">Discord</th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/60">
              {listLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-sm text-ink/35">
                    Đang tải danh sách đội...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-sm text-ink/35">
                    Không có đội nào khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                rows.map(team => (
                  <tr
                    key={team.id}
                    onClick={() => setSelectedId(team.id)}
                    className={`cursor-pointer transition hover:bg-paper/70 ${selectedId === team.id ? 'bg-paper/60' : ''}`}
                  >
                    <td className="px-4 py-3.5 font-mono text-sm text-ink/55">{team.id}</td>
                    <td className="px-4 py-3.5 text-sm font-medium text-ink">{team.name}</td>
                    <td className="px-4 py-3.5 text-sm text-ink/60">{team.owner || '—'}</td>
                    <td className="px-4 py-3.5 text-center font-mono text-sm text-ink/55">{team.memberCount}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge {...APPROVAL[team.status]} />
                        {team.isLateRegistration && <Badge label="Đăng ký trễ" cls="bg-clay/12 text-clay" />}
                      </div>
                    </td>
                    <td className="px-4 py-3.5"><Badge {...(PROVISION[team.provision] ?? PROVISION.none)} /></td>
                    <td className="px-4 py-3.5 text-ink/25">
                      <Icon name="chevronR" className="h-4 w-4" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <TeamDrawer
        team={selectedTeam}
        loading={detailLoading}
        busy={busy === 'approve' || busy === 'reject'}
        onClose={() => setSelectedId(null)}
        onApprove={handleApprove}
        onReject={handleReject}
      />

      <CreateTeamDrawer
        open={showCreate}
        form={createForm}
        draft={createDraft}
        busy={busy === 'create'}
        onClose={() => setNewParam('')}
        onChange={setCreateForm}
        onCreate={handleCreateTeam}
      />

      <MergeTeamsModal
        open={showMerge}
        teams={mergeCandidates}
        loading={mergeLoading}
        busy={busy === 'merge'}
        error={mergeError}
        selectedIds={mergeSelectedIds}
        onClose={() => setShowMerge(false)}
        onToggle={toggleMergeTeam}
        onClear={() => setMergeSelectedIds([])}
        onMerge={handleMergeTeams}
      />
    </div>
  )
}

export default TeamsPage
