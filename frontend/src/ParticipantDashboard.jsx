import { useEffect, useMemo, useRef, useState } from 'react'
import logoImage from './assets/vnutour-logo.webp'
import { Badge, Icon } from './ui.jsx'
import SettingsPage from './SettingsPage.jsx'
import DiscordConnectCard from './DiscordConnectCard.jsx'
import FeedCard from './FeedCard.jsx'
import { DISCORD_RETURN_KEY } from './discordConnect.js'
import { apiDownload, apiRequest, formatDateTime, getStoredUser, logoutAndRedirect } from './api.js'
import { DraftNotice, clearDraft, readDraft, writeDraft } from './drafts.jsx'
import { compressImage } from './imageCompress.js'
import { navigate, useEnumSearchParam } from './router.js'
import {
  BANK_DEEPLINK_OPTIONS,
  buildBankDeeplink,
  buildTimoDeeplink,
  buildVietQrPayload,
  openDeeplinkWithFallback,
} from './lib/bankDeeplinks'

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
const PRIMARY_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#20312B] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#20312B]/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45'
const SECONDARY_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[#DCD8CC] bg-white px-4 py-2.5 text-sm font-semibold text-[#20312B]/65 transition hover:bg-[#F3F4F1] hover:text-[#20312B] disabled:cursor-not-allowed disabled:opacity-45'
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
  failed: { label: 'Discord lỗi', cls: 'bg-[#D6492B]/12 text-[#D6492B]' },
}

const STEPS = [
  { key: 'profile', label: 'Hồ sơ' },
  { key: 'members', label: 'Thành viên' },
  { key: 'team', label: 'Đội' },
  { key: 'payment', label: 'Thanh toán' },
  { key: 'submit', label: 'Gửi duyệt' },
  { key: 'approved', label: 'Được duyệt' },
]
const STEP_KEYS = STEPS.map((step) => step.key)

const EMPTY_PROFILE = {
  full_name: '',
  mssv: '',
  email: '',
  phone: '',
  faculty: '',
  school: '',
  facebook: '',
  cccd: '',
  date_of_birth: '',
  extra: {},
}

// Schema fields outside the first-class Participant columns (e.g. "gender")
// round-trip through `extra`. `schemaValue()` falls back to `data.extra[key]`
// for display, but the save payload is sent flat — so anything left only in
// `extra` reads as filled in the UI yet vanishes (and fails required-field
// validation) the moment the form is resubmitted without being re-touched.
// Flattening on load keeps the top-level key authoritative from then on.
function withFlatExtra(data) {
  return { ...(data?.extra || {}), ...data }
}

function normalizeProfile(authMe, profilePayload) {
  const profile = profilePayload?.profile || null
  return withFlatExtra({
    full_name: profile?.full_name || authMe?.full_name || '',
    mssv: profile?.mssv || authMe?.mssv || '',
    email: profile?.email || authMe?.email || '',
    phone: profile?.phone || authMe?.phone || '',
    faculty: profile?.faculty || authMe?.faculty || '',
    school: profile?.school || authMe?.school || '',
    facebook: profile?.facebook || '',
    cccd: profile?.cccd || '',
    date_of_birth: profile?.date_of_birth || '',
    extra: profile?.extra || {},
  })
}

function normalizeTeam(teamPayload, teamDetail = null) {
  if (!teamPayload?.team) return null
  return {
    team_id: teamPayload.team.code,
    team_name: teamDetail?.name || teamPayload.team.name || '',
    name_is_placeholder: Boolean(teamDetail?.name_is_placeholder ?? teamPayload?.team?.name_is_placeholder),
    roster_locked: Boolean(teamDetail?.roster_locked ?? teamPayload?.team?.roster_locked),
    approval_status: teamDetail?.approval_status || teamPayload.team.approval_status || 'draft',
    provision_state: teamDetail?.provision_state || 'none',
    approval_note: teamDetail?.approval_note || teamPayload.team.approval_note || '',
    submitted_at: teamDetail?.submitted_at || teamPayload.team.submitted_at || null,
    payment_proof: teamDetail?.payment_proof || teamPayload.team.payment_proof || '',
    has_payment_proof: Boolean(teamDetail?.has_payment_proof ?? teamPayload?.team?.has_payment_proof),
    // These roster gates come from `/my-team` (see views_participant); without
    // them the team step reads `undefined` as "not final" and blocks a solo (1)
    // or full team from ever reaching Thanh toán, showing "—/max".
    member_count: teamDetail?.member_count ?? teamPayload?.team?.member_count,
    max_members: teamDetail?.max_members ?? teamPayload?.team?.max_members,
    roster_size_final: Boolean(teamDetail?.roster_size_final ?? teamPayload?.team?.roster_size_final),
    can_name: Boolean(teamDetail?.can_name ?? teamPayload?.team?.can_name),
    naming_allowed: Boolean(teamPayload?.naming_allowed),
  }
}

function blankMember() {
  return {
    mssv: '',
    full_name: '',
    email: '',
    phone: '',
    faculty: '',
    school: '',
    cccd: '',
    date_of_birth: '',
    has_account: false,
    is_captain: false,
    extra: {},
  }
}

const FIELD_LABELS = {
  mssv: 'MSSV',
  email: 'Email',
  full_name: 'Họ và tên',
  gender: 'Giới tính',
  school: 'Trường',
  faculty: 'Khoa',
  phone: 'Số điện thoại',
  cccd: 'CCCD',
  date_of_birth: 'Ngày sinh',
  facebook: 'Link Facebook',
}

const MEMBERSHIP_CONFLICT_CODES = new Set([
  'already_has_team',
  'already_in_team',
  'membership_changed',
  'mssv_in_other_team',
  'mssv_in_submitted_team',
  'mssv_leads_other_team',
])

function explainApiError(error) {
  const code = error?.data?.error || error?.message
  if (code === 'missing:team:payment_proof') {
    return 'Bạn cần upload ảnh minh chứng chuyển tiền ở bước Thanh toán trước khi gửi duyệt.'
  }
  if (code?.startsWith('missing:')) {
    const [, who, field] = code.split(':')
    const whoLabel = who === 'team'
      ? 'đội'
      : who === 'captain'
        ? 'đội trưởng'
        : who?.startsWith('member_')
          ? `thành viên ${who.split('_')[1]}`
          : 'hồ sơ'
    return `Vui lòng điền đủ trường "${FIELD_LABELS[field] || field}" cho ${whoLabel}.`
  }
  if (code?.startsWith('invalid_date:')) {
    const [, who] = code.split(':')
    return `Ngày sinh của ${who || 'thành viên'} chưa hợp lệ.`
  }
  if (code?.startsWith('team_size_mismatch:')) {
    const expected = code.split('expected_')[1] || MAX_MEMBERS
    return `Đội cần đủ ${expected} thành viên trước khi gửi duyệt.`
  }
  if (code?.startsWith('team_size_out_of_range:')) {
    const range = code.split(':')[1] || `1-${MAX_MEMBERS}`
    return `Số thành viên phải trong khoảng ${range}.`
  }
  if (code?.startsWith('team_name_requires_full_team')) {
    const size = code.split(':')[1] || MAX_MEMBERS
    return `Chỉ đội đủ ${size} thành viên mới được đặt tên. Đội chưa đủ mang tên tạm và sẽ được BTC ghép với đội khác.`
  }
  if (code?.startsWith('team_size_not_final')) {
    const size = code.split(':')[1] || MAX_MEMBERS
    return `Đội cần đủ ${size} người, hoặc đúng 1 người (đăng ký cá nhân), mới có thể đặt tên, thanh toán hoặc gửi duyệt.`
  }
  if (code === 'registration_mismatch') {
    const teamCode = error?.data?.detail?.team_code
    const where = teamCode ? `đội ${teamCode}` : 'một đội'
    return `MSSV này đã thuộc ${where}, nhưng email đăng ký trong đội chưa khớp với tài khoản Google của bạn — có thể trưởng nhóm nhập nhầm email. Vui lòng nhờ trưởng nhóm cập nhật lại email của bạn trong thông tin đội, hoặc liên hệ Ban tổ chức để được hỗ trợ. Sau khi email được sửa đúng, đăng nhập lại là hệ thống sẽ tự đưa bạn vào đội.`
  }
  const map = {
    missing_mssv: 'Bạn cần cập nhật MSSV trước khi tiếp tục.',
    mssv_taken: 'MSSV này đã được dùng bởi tài khoản khác.',
    registration_mismatch: 'MSSV này đã được đăng ký với email khác. Vui lòng kiểm tra lại.',
    profile_incomplete: 'Hồ sơ hiện chưa đủ để tạo đội.',
    team_locked: 'Đội đã khóa chỉnh sửa.',
    roster_locked: 'Đội đã được xác nhận để thanh toán nên thông tin đã bị khóa. Cần thay đổi thì hãy liên hệ BTC.',
    roster_not_locked: 'Bạn cần xác nhận lại danh sách đội trước khi tải minh chứng hoặc gửi duyệt.',
    payment_already_confirmed: 'Hệ thống đã tìm thấy giao dịch. Thanh toán đã được xác nhận nên không thể hủy.',
    payment_check_unavailable: 'Chưa thể kiểm tra trạng thái thanh toán. BTC cần cấu hình lại kết nối Timo trước khi bạn có thể hủy.',
    payment_check_failed: 'Không kiểm tra được trạng thái thanh toán lúc này. Vui lòng thử lại sau; danh sách và minh chứng vẫn được giữ nguyên.',
    team_full: 'Đội đã đủ số lượng thành viên.',
    mssv_in_other_team: 'MSSV này đang nằm trong đội khác. Hãy liên hệ BTC nếu cần chuyển đội.',
    mssv_in_submitted_team: 'MSSV này đã thuộc một đội đã gửi duyệt, không thể thêm vào đội khác.',
    mssv_leads_other_team: 'MSSV này đang là đội trưởng của một đội đã có thành viên khác. Hãy liên hệ BTC để xử lý đội hiện tại trước khi chuyển.',
    already_in_team: 'MSSV này đã có trong đội — không thể thêm cùng một sinh viên hai lần.',
    membership_changed: 'Thông tin đội của thành viên vừa thay đổi. Danh sách đã được tải lại.',
    email_in_team: 'Email này đã được một người khác sử dụng — mỗi người phải dùng email riêng.',
    not_team_owner: 'Bạn không phải đội trưởng của đội này.',
    not_a_team_member: 'Bạn không thuộc đội này nên không bỏ phiếu được.',
    candidate_not_in_team: 'Người bạn chọn không thuộc đội của bạn.',
    candidate_not_found: 'Không tìm thấy thành viên bạn vừa chọn.',
    captain_already_elected: 'Đội đã có đội trưởng, cuộc bỏ phiếu đã kết thúc.',
    no_team: 'Bạn chưa có đội.',
    already_has_team: 'Tài khoản này đã có đội.',
    already_approved: 'Đội này đã được duyệt rồi.',
    no_members: 'Đội cần có ít nhất một thành viên trước khi gửi duyệt.',
    team_not_approved: 'Đội cần được duyệt trước khi lấy QR.',
    invalid_json: 'Dữ liệu gửi lên không hợp lệ.',
    registration_closed: 'Đợt đăng ký hiện đang đóng.',
    not_found: 'Không tìm thấy dữ liệu cần thiết.',
  }
  return map[code] || 'Có lỗi xảy ra khi đồng bộ dữ liệu.'
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

function Field({ label, value, onChange, disabled = false, placeholder = '', id, required = false }) {
  return (
    <label className="block" htmlFor={id}>
      <span className="text-xs font-medium text-ink/50">
        {label}
        {required && <span className="text-[#D6492B]"> *</span>}
      </span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-[#DCD8CC] bg-white px-3 py-2 text-sm text-[#20312B] outline-none transition placeholder:text-[#20312B]/25 focus:border-[#1F7A6B]/40 focus:ring-2 focus:ring-[#1F7A6B]/10 disabled:bg-[#F3F4F1] disabled:text-[#20312B]/45"
      />
    </label>
  )
}

const optValue = (o) => (typeof o === 'object' ? o.value : o)
const optLabel = (o) => (typeof o === 'object' ? o.label : o)

function schemaValue(data, key) {
  return data?.[key] ?? data?.extra?.[key] ?? ''
}

function isSchemaHidden(field, data) {
  const c = field.conditional
  return Boolean(c && c.hide && (schemaValue(data, c.watch) || '') === c.equals)
}

function getMissingProfileFields(profile, fields) {
  if (!fields.length) {
    return [
      !profile.mssv && { key: 'mssv', label: 'MSSV' },
      !profile.full_name && { key: 'full_name', label: 'Họ và tên' },
    ].filter(Boolean)
  }

  return fields.filter((field) => (
    field.enabled !== false
    && field.required
    && !isSchemaHidden(field, profile)
    && !String(schemaValue(profile, field.key) ?? '').trim()
  ))
}

function isProfileComplete(profile, fields) {
  return getMissingProfileFields(profile, fields).length === 0
}

function buildSchemaPatch(fields, key, value) {
  const patch = { [key]: value }
  for (const field of fields) {
    const c = field.conditional
    if (c && c.watch === key) {
      patch[field.key] = value === c.equals && 'set' in c ? c.set : ''
    }
  }
  return patch
}

function SchemaField({ field, value, onChange, disabled = false }) {
  const id = `participant-${field.key}`
  const values = (field.options || []).map(optValue)
  const isOther = field.type === 'select' && value && !values.includes(value)
  const baseClass = 'mt-1 w-full rounded-lg border border-[#DCD8CC] bg-white px-3 py-2 text-sm text-[#20312B] outline-none transition placeholder:text-[#20312B]/25 focus:border-[#1F7A6B]/40 focus:ring-2 focus:ring-[#1F7A6B]/10 disabled:bg-[#F3F4F1] disabled:text-[#20312B]/45'

  return (
    <label htmlFor={id} className="block">
      <span className="text-xs font-medium text-ink/50">
        {field.label}
        {field.required && <span className="text-[#D6492B]"> *</span>}
      </span>
      {field.help && <span className="mt-1 block text-[11px] leading-relaxed text-ink/40">{field.help}</span>}
      {field.type === 'select' ? (
        <div className="space-y-2">
          <select
            id={id}
            disabled={disabled}
            className={baseClass}
            value={values.includes(value) ? value : (isOther ? '__other__' : '')}
            onChange={(e) => onChange(e.target.value === '__other__' ? ' ' : e.target.value)}
          >
            <option value="" disabled>-- Chọn --</option>
            {(field.options || []).map((option) => (
              <option key={optValue(option)} value={optValue(option)}>{optLabel(option)}</option>
            ))}
            {field.allow_other && <option value="__other__">Khác...</option>}
          </select>
          {field.allow_other && isOther && (
            <input
              className={baseClass}
              disabled={disabled}
              placeholder="Nhập giá trị khác"
              value={String(value).trim()}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
      ) : field.type === 'file' ? (
        <input
          id={id}
          type="url"
          disabled={disabled}
          className={baseClass}
          placeholder="Dán link ảnh minh chứng"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type={field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text'}
          disabled={disabled || field.key === 'mssv' && disabled}
          className={baseClass}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}

function PersonSchemaFields({ fields, data, onPatch, disabled = false, lockMssv = false, lockEmail = false }) {
  const priority = { mssv: 0, email: 1 }
  const visible = fields
    .filter((field) => !isSchemaHidden(field, data))
    .slice()
    .sort((a, b) => (priority[a.key] ?? 10) - (priority[b.key] ?? 10))
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {visible.map((field) => {
        // mssv/email are reconciliation references: once a member exists,
        // they can't be edited here — remove the member and add a new one
        // instead if they were entered wrong.
        const locked = (lockMssv && field.key === 'mssv') || (lockEmail && field.key === 'email')
        return (
          <div key={field.key} className={field.key === 'full_name' || field.help ? 'sm:col-span-2' : ''}>
            <SchemaField
              field={field}
              value={schemaValue(data, field.key)}
              disabled={disabled || locked}
              onChange={(value) => onPatch(buildSchemaPatch(fields, field.key, value))}
            />
            {locked && (
              <p className="mt-1 text-xs text-ink/40">Không đổi được — muốn đổi phải xóa và thêm lại.</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CaptainProfileEditor({ profile, fields, open, saved, saving, error, onPatch, onSave }) {
  if (!open) return null

  return (
    <form className="border-t border-[#DCD8CC] bg-[#F3F4F1]/65 px-5 py-5" onSubmit={onSave}>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
        <p className="text-sm leading-6 text-ink/55">
          Hoàn thiện thông tin đăng ký của đội trưởng tại đây.
        </p>
        {saved && <Badge label="Đã lưu" cls="bg-[#1F7A6B]/12 text-[#1F7A6B]" />}
      </div>
      <PersonSchemaFields fields={fields} data={profile} onPatch={onPatch} />
      {error && (
        <p className="mt-4 rounded-lg border border-[#D6492B]/30 bg-[#D6492B]/[0.06] px-3 py-2 text-sm font-medium text-[#B93A23]">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          <Icon name="checkPlain" className="h-4 w-4" />
          {saving ? 'Đang lưu...' : 'Lưu thông tin'}
        </button>
      </div>
    </form>
  )
}

// A team carries a stand-in name ("Pending team <mssv>", or its own code after
// a merge) until its captain names it on the team step. Only a captain-chosen
// name counts as the team step being done — the placeholder must not, or the
// payment step unlocks the moment the team record appears.
function isTeamNamed(team) {
  return Boolean(team?.team_name) && !team?.name_is_placeholder
}

function getStepState(step, profile, team, members, fields) {
  const status = team?.approval_status
  const done = {
    profile: isProfileComplete(profile, fields),
    team: Boolean(team?.roster_size_final) && (team?.can_name ? isTeamNamed(team) : true),
    members: members.length > 0,
    payment: Boolean(team?.has_payment_proof),
    submit: status === 'pending_approval' || status === 'approved',
    approved: status === 'approved',
  }
  if (done[step.key]) return 'done'
  if (step.key === 'profile') return 'active'
  if (step.key === 'members' && done.profile) return 'active'
  if (step.key === 'team' && done.members) return 'active'
  if (step.key === 'payment' && done.team && done.members && done.profile) return 'active'
  if (step.key === 'submit' && done.payment) return 'active'
  return 'idle'
}

function getNextAction(profile, team, members, fields, editable = true) {
  const missingProfileFields = getMissingProfileFields(profile, fields)
  if (missingProfileFields.length > 0) {
    return {
      title: 'Hoàn thiện thông tin đội trưởng',
      body: `Còn thiếu ${missingProfileFields.map((field) => field.label).join(', ')}. Bổ sung ngay trong danh sách thành viên.`,
      action: 'Bổ sung thông tin',
      kind: 'profile',
    }
  }
  if (team?.approval_status === 'rejected') {
    return {
      title: 'Sửa theo góp ý của BTC',
      body: team.approval_note || 'Đội cần cập nhật lại thông tin trước khi gửi duyệt lần nữa.',
      action: 'Sửa thông tin',
      kind: 'fix',
    }
  }
  // The team record is created on arrival at the member step, so a null `team`
  // here only means that request is still in flight — the captain's next job
  // is the same: add the first member.
  if (members.length === 0) {
    return {
      title: 'Thêm thành viên đầu tiên',
      body: 'Bạn có thể nhập MSSV để hệ thống tự ghép hồ sơ nếu thành viên đã có tài khoản.',
      action: 'Thêm thành viên',
      kind: 'add-member',
    }
  }
  if (team && editable && team.can_name && !isTeamNamed(team)) {
    return {
      title: 'Đặt tên cho đội',
      body: 'Đội đã có thành viên — đặt tên chính thức ở bước Đội rồi mới sang thanh toán.',
      action: 'Đặt tên đội',
      kind: 'name-team',
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

// The trail doubles as the wizard's navigation. A step is a clickable button
// only once it is reachable (done, or the current active step); future steps
// stay locked so nobody skips ahead of the prerequisites. `activeStep` is the
// screen currently shown — highlighted with the paper background.
function ProgressTrail({ profile, team, members, fields, activeStep, blockedSteps = [], onSelect }) {
  return (
    <div className={`${PARTICIPANT_CARD} overflow-hidden`}>
      <div className="grid grid-cols-6 divide-x divide-[#DCD8CC]">
        {STEPS.map((step, index) => {
          const state = getStepState(step, profile, team, members, fields)
          const active = state === 'active'
          const done = state === 'done'
          // A done step is normally revisitable; `blockedSteps` closes the
          // roster steps after the payment confirm locked them.
          const blocked = blockedSteps.includes(step.key)
          const unlocked = (active || done) && !blocked
          const selected = step.key === activeStep
          const circleStyle = done
            ? { backgroundColor: COLORS.trail, borderColor: COLORS.trail, color: 'white' }
            : active
              ? { backgroundColor: 'rgba(224,162,58,0.15)', borderColor: COLORS.gold, color: '#9A6B12' }
              : { backgroundColor: COLORS.paper, borderColor: COLORS.stone, color: 'rgba(32,49,43,0.3)' }
          return (
            <button
              key={step.key}
              type="button"
              disabled={!unlocked}
              aria-current={selected ? 'step' : undefined}
              title={blocked ? 'Bước này đã khóa sau khi xác nhận thanh toán' : undefined}
              onClick={() => unlocked && onSelect?.(step.key)}
              className={`relative px-2 py-4 text-center transition ${unlocked ? 'cursor-pointer hover:bg-[#F3F4F1]' : 'cursor-not-allowed'}`}
              style={{ backgroundColor: selected ? COLORS.paper : 'white' }}
            >
              <span
                className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full border font-mono text-xs font-semibold ${selected ? 'ring-2 ring-offset-2 ring-[#20312B]/25' : ''}`}
                style={circleStyle}
              >
                {done ? <Icon name="checkPlain" className="h-4 w-4" /> : index + 1}
              </span>
              <p className={`mt-2 text-xs font-medium ${selected ? 'text-ink font-semibold' : done || active ? 'text-ink' : 'text-ink/35'}`}>
                {step.label}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Back / continue controls shared by every wizard step.
function StepNav({ onBack, onNext, nextLabel = 'Tiếp tục', nextDisabled = false, hint }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onBack && (
        <button type="button" onClick={onBack} className={SECONDARY_BUTTON}>
          ← Quay lại
        </button>
      )}
      {onNext && (
        <button type="button" onClick={onNext} disabled={nextDisabled} className={PRIMARY_BUTTON}>
          {nextLabel}
          <Icon name="chevronR" className="h-4 w-4" />
        </button>
      )}
      {hint && <p className="w-full text-xs leading-5 text-[#9A6B12]">{hint}</p>}
    </div>
  )
}

function MemberModal({ form, fields, editing, saving, draft, error, onChange, onClose, onSave }) {
  const [resolveKey, setResolveKey] = useState('')
  const [resolveError, setResolveError] = useState('')

  useEffect(() => {
    if (!form) return
    const mssv = String(form.mssv || '').trim()
    const email = String(form.email || '').trim()
    const key = `${mssv}|${email}`
    if (!mssv || !email || key === resolveKey) return

    setResolveError('')

    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const payload = await apiRequest('/my-team/members/resolve', {
          method: 'POST',
          body: { mssv, email },
        })
        if (cancelled) return
        setResolveKey(key)
        setResolveError('')
        onChange({
          ...form,
          ...(payload.profile || {}),
          has_account: Boolean(payload.has_account),
          resolved_fields: payload.fields || fields,
        })
      } catch (err) {
        if (cancelled) return
        setResolveKey(key)
        setResolveError(explainApiError(err))
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [form?.mssv, form?.email, resolveKey, fields, form, onChange])

  useEffect(() => {
    if (!form) return undefined
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [form, onClose, saving])

  if (!form) return null
  const identityFields = fields.filter((field) => field.key === 'mssv' || field.key === 'email')
  const visibleFields = form.resolved_fields || identityFields

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Đóng hộp thoại"
        className="absolute inset-0 cursor-default bg-[#20312B]/35 backdrop-blur-sm"
        onClick={onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-modal-title"
        className="relative flex max-h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[#DCD8CC] bg-[#F3F4F1] shadow-[0_24px_80px_rgba(32,49,43,0.22)] sm:max-h-[calc(100vh-3rem)] sm:max-h-[calc(100dvh-3rem)]"
        onSubmit={onSave}
      >
        <div className="flex items-start justify-between border-b border-[#DCD8CC] bg-white px-5 py-4 sm:px-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Thành viên</p>
            <h2 id="member-modal-title" className="mt-1 font-display text-xl font-bold text-ink">
              {editing ? 'Sửa thông tin' : 'Thêm thành viên'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#20312B]/45 transition hover:bg-[#F3F4F1] hover:text-[#20312B]" aria-label="Đóng">
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
          <DraftNotice draft={draft} label="thông tin thành viên đang nhập dở" />
          {resolveError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {resolveError}
            </div>
          )}
          <PersonSchemaFields
            fields={visibleFields}
            data={form}
            lockMssv={editing}
            lockEmail={editing}
            onPatch={(patch) => onChange({
              ...form,
              ...patch,
              ...(('mssv' in patch || 'email' in patch) ? { resolved_fields: null, has_account: false } : {}),
            })}
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-[#DCD8CC] bg-white px-5 py-4 sm:px-6">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className={SECONDARY_BUTTON}>
            Huỷ
          </button>
          <button
            type="submit"
            disabled={saving}
            className={PRIMARY_BUTTON}
          >
            <Icon name="checkPlain" className="h-4 w-4" />
            {saving ? 'Đang lưu...' : 'Lưu thành viên'}
          </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// The last gate before payment. The transfer amount is fee x member count,
// so the captain reviews the final roster here; confirming locks the roster
// server-side (member/name edits are refused from then on) and only then does
// the wizard move on to the payment step — the QR they pay must match the
// roster they confirmed.
function PaymentConfirmModal({
  open, teamName, members, maxMembers, paymentInfo, paymentLoading,
  busy, error, onConfirm, onClose, skipPayment,
}) {
  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose, busy])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Đóng hộp thoại"
        className="absolute inset-0 cursor-default bg-[#20312B]/35 backdrop-blur-sm"
        onClick={onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-confirm-title"
        className="relative flex max-h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[#DCD8CC] bg-[#F3F4F1] shadow-[0_24px_80px_rgba(32,49,43,0.22)] sm:max-h-[calc(100vh-3rem)] sm:max-h-[calc(100dvh-3rem)]"
        onSubmit={onConfirm}
      >
        <div className="flex items-start justify-between border-b border-[#DCD8CC] bg-white px-5 py-4 sm:px-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">{skipPayment ? 'Xác nhận' : 'Thanh toán'}</p>
            <h2 id="payment-confirm-title" className="mt-1 font-display text-xl font-bold text-ink">
              Xác nhận thông tin đội
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#20312B]/45 transition hover:bg-[#F3F4F1] hover:text-[#20312B]" aria-label="Đóng">
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Tên đội</p>
            <p className="mt-1 font-display text-lg font-bold text-ink">{teamName}</p>
          </div>

          <div className="overflow-hidden rounded-lg border border-[#DCD8CC] bg-white">
            <div className="flex items-center justify-between border-b border-[#DCD8CC] px-4 py-2.5">
              <p className="text-sm font-semibold text-ink">Thành viên</p>
              <p className="font-mono text-xs text-ink/45">{members.length}/{maxMembers}</p>
            </div>
            <ul className="divide-y divide-stone">
              {members.map((member) => (
                <li key={member.mssv} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{member.full_name}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-ink/45">
                      {member.mssv} · {member.school || 'Chưa có trường'}
                    </p>
                  </div>
                  {member.is_captain && <Badge label="Đội trưởng" cls="bg-[#E0A23A]/15 text-[#9A6B12]" />}
                </li>
              ))}
            </ul>
          </div>

          {!skipPayment && (
            <div className="rounded-lg border border-[#DCD8CC] bg-white px-4 py-3">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Số tiền cần chuyển</p>
              {paymentLoading ? (
                <p className="mt-1 text-sm text-ink/45">Đang tính số tiền theo số thành viên...</p>
              ) : paymentInfo ? (
                <p className="mt-1 text-sm leading-7 text-ink">
                  {paymentInfo.member_count} người × {formatVnd(paymentInfo.fee_per_person)} ={' '}
                  <span className="font-display text-lg font-bold text-ink">{formatVnd(paymentInfo.amount)}</span>
                </p>
              ) : (
                <p className="mt-1 text-sm text-ink/45">Số tiền sẽ hiển thị ở bước thanh toán.</p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-[#E0A23A]/40 bg-[#E0A23A]/10 px-4 py-3 text-sm leading-6 text-[#9A6B12]">
            {skipPayment
              ? 'Xác nhận sẽ khóa tên đội và danh sách thành viên. Nếu cần thay đổi sau này, hãy liên hệ BTC.'
              : <>Xác nhận sẽ <span className="font-semibold">khóa danh sách thành viên và tên đội</span> để
                số tiền chuyển khoản không bị chênh lệch. Nếu cần thay đổi sau này, hãy liên hệ BTC.</>}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[#DCD8CC] bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={onClose} disabled={busy} className={SECONDARY_BUTTON}>
            Quay lại chỉnh sửa
          </button>
          <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
            <Icon name="checkPlain" className="h-4 w-4" />
            {busy ? 'Đang xác nhận...' : skipPayment ? 'Xác nhận thông tin đội' : 'Xác nhận & thanh toán'}
          </button>
        </div>
      </form>
    </div>
  )
}

function FixTeamRequestCard({ note, onFix }) {
  return (
    <section className={`${PARTICIPANT_CARD} border-[#D6492B]/30 bg-[#D6492B]/[0.05] p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#D6492B]/70">
            BTC yêu cầu chỉnh sửa
          </p>
          <p className="mt-2 text-sm leading-6 text-ink/70">
            {note || 'BTC cần đội cập nhật lại thông tin. Sửa xong hãy gửi duyệt lại.'}
          </p>
        </div>
        <button type="button" onClick={onFix} className={SECONDARY_BUTTON}>
          <Icon name="users" className="h-4 w-4" />
          Chỉnh sửa đội
        </button>
      </div>
    </section>
  )
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className={`${PARTICIPANT_CARD} px-5 py-16 text-center text-sm text-ink/45`}>
        Đang tải dữ liệu thí sinh...
      </div>
    </div>
  )
}

function EventExperienceCard({ experience }) {
  const currentEvent = experience?.current_sub_event
  if (!currentEvent) {
    return (
      <div className={`${PARTICIPANT_CARD} p-5`}>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Đang mở</p>
        <h2 className="mt-1 font-display text-xl font-bold text-ink">Chưa mở event cho phase này</h2>
        <p className="mt-3 text-sm leading-6 text-ink/55">
          BTC chưa chọn event hiện tại. Dashboard sẽ cập nhật ngay khi admin mở event phù hợp.
        </p>
      </div>
    )
  }

  return (
    <div className={`${PARTICIPANT_CARD} overflow-hidden`}>
      <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="px-5 py-6 sm:px-7">
          <div className="flex flex-wrap items-center gap-2">
            <Badge label={currentEvent.type} cls="bg-gold/15 text-[#9A6B12]" />
            <Badge label={experience.current_phase_label || 'Phase hiện tại'} cls="bg-trail/12 text-trail" />
          </div>
          <h1 className="mt-4 max-w-2xl font-display text-3xl font-bold tracking-normal text-ink sm:text-4xl">
            {currentEvent.name}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/55 sm:text-base">
            {currentEvent.note || 'Nội dung của event đang mở sẽ hiển thị ở đây cho thí sinh thuộc phase hiện tại.'}
          </p>
        </div>

        <div className="border-t border-[#DCD8CC] bg-[#F3F4F1]/65 p-5 lg:border-l lg:border-t-0">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Quyền tham gia</p>
          <h2 className="mt-2 font-display text-xl font-bold text-ink">
            {experience.team_in_current_phase ? 'Đội của bạn đang trong phase này' : 'Đội của bạn không thuộc phase này'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink/55">
            {experience.team_in_current_phase
              ? 'Bạn chỉ nhìn thấy nội dung của event hiện tại và các form đang mở trong event đó.'
              : 'Nếu đội không nằm trong roster của phase hiện tại, các form và nội dung thi sẽ không được mở.'}
          </p>
        </div>
      </div>
    </div>
  )
}

function OpenFormsCard({ forms }) {
  return (
    <div className={`${PARTICIPANT_CARD} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Form đang mở</p>
          <h2 className="mt-1 font-display text-lg font-bold text-ink">Biểu mẫu tự do vào chơi</h2>
        </div>
        <span className="font-mono text-xs text-ink/40">{forms.length} form</span>
      </div>

      <div className="mt-4 space-y-3">
        {forms.map((form) => (
          <a
            key={form.station_id}
            href={`/form?stationId=${form.station_id}`}
            className="block rounded-lg border border-[#DCD8CC] bg-white px-4 py-3 transition hover:bg-[#F3F4F1]"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">{form.station_name}</p>
                <p className="mt-1 text-xs text-ink/45">{form.station_location || form.event_name}</p>
              </div>
              <span className="rounded-full bg-[#1F7A6B]/12 px-2.5 py-1 text-xs font-semibold text-[#1F7A6B]">
                Mở form
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}


// The ballot is a side call: a team that was never merged has no election to
// show, and a failure here must not blank the dashboard the way the old
// `/teams/{code}` 403 did. Losing it only costs us the captain-aware half of
// the rename rule, which falls back to the member-count check.
async function fetchCaptainVote() {
  try {
    return await apiRequest('/my-team/captain-vote')
  } catch {
    return null
  }
}

// A merged team loses both captains, so it elects one by secret ballot. The
// payload never says who voted for whom — only tallies — and neither does this
// card: it shows totals, progress, and whether *you* have voted.
function CaptainVoteCard({ vote, myMssv, selected, onSelect, onVote, busy }) {
  const candidates = vote?.candidates || []
  const memberCount = vote?.member_count || candidates.length
  const votesCast = vote?.votes_cast || 0
  const progress = memberCount > 0 ? Math.min(100, (votesCast / memberCount) * 100) : 0
  // The ballot only stays open past the last vote when nobody leads outright,
  // so a full box with the card still showing means the team is deadlocked.
  const deadlocked = memberCount > 0 && votesCast >= memberCount

  return (
    <section className={`${PARTICIPANT_CARD} overflow-hidden`}>
      <div className="border-b border-[#DCD8CC] px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Bỏ phiếu kín</p>
            <h2 className="mt-1 font-display text-xl font-bold text-ink">Bầu đội trưởng mới</h2>
          </div>
          <Badge
            label={vote?.i_have_voted ? 'Bạn đã bỏ phiếu' : 'Bạn chưa bỏ phiếu'}
            cls={vote?.i_have_voted ? 'bg-[#1F7A6B]/12 text-[#1F7A6B]' : 'bg-[#E0A23A]/15 text-[#9A6B12]'}
          />
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/55">
          Đội của bạn được BTC ghép từ hai đội nên hiện chưa có đội trưởng. Cả đội cùng chọn một
          người — ai được <strong>{vote?.threshold || Math.ceil(memberCount * 3 / 5)}/{memberCount}</strong> phiếu
          trở lên sẽ trở thành đội trưởng. Chỉ đội trưởng mới được đặt tên chính thức cho đội.
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/55">
          <span className="font-semibold text-ink">Phiếu của bạn là kín.</span> Hệ thống chỉ công bố
          tổng số phiếu của từng người — không ai, kể cả BTC, biết bạn đã bầu cho ai.
        </p>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <div className="rounded-lg border border-[#DCD8CC] bg-[#F3F4F1]/70 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink">Tiến độ bỏ phiếu</p>
            <p className="font-mono text-xs text-ink/45">{votesCast}/{memberCount}</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full" style={{ width: `${progress}%`, backgroundColor: COLORS.trail }} />
          </div>
          <p className="mt-2 text-xs leading-5 text-ink/45">
            {vote?.i_have_voted
              ? 'Bạn đã bỏ phiếu rồi. Muốn đổi ý thì chọn người khác và gửi lại — phiếu mới sẽ thay phiếu cũ.'
              : 'Bạn có thể bầu cho bất kỳ thành viên nào trong đội, kể cả chính mình.'}
          </p>
        </div>

        {deadlocked && (
          <div className="mt-3 rounded-lg border border-[#E0A23A]/35 bg-[#E0A23A]/[0.08] px-4 py-3 text-sm leading-6 text-[#9A6B12]">
            Cả đội đã bỏ phiếu nhưng đang hoà — chưa có ai dẫn đầu một mình nên cuộc bầu vẫn để mở.
            Cần ít nhất một người đổi phiếu thì mới chọn được đội trưởng.
          </div>
        )}

        <div className="mt-4 space-y-2">
          {candidates.map((candidate) => {
            const chosen = selected === candidate.mssv
            return (
              <label
                key={candidate.mssv}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-3 transition ${
                  chosen
                    ? 'border-[#1F7A6B]/45 bg-[#1F7A6B]/[0.07]'
                    : 'border-[#DCD8CC] bg-white hover:bg-[#F3F4F1]'
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <input
                    type="radio"
                    name="captain-vote-candidate"
                    className="h-4 w-4 shrink-0 accent-[#1F7A6B]"
                    value={candidate.mssv}
                    checked={chosen}
                    disabled={busy}
                    onChange={() => onSelect(candidate.mssv)}
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {candidate.full_name || candidate.mssv}
                      </span>
                      {candidate.mssv === myMssv && (
                        <Badge label="Bạn" cls="bg-[#E0A23A]/15 text-[#9A6B12]" />
                      )}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-ink/45">{candidate.mssv}</span>
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-[#20312B]/[0.06] px-2.5 py-1 font-mono text-xs font-semibold text-[#20312B]/55">
                  {candidate.votes || 0} phiếu
                </span>
              </label>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => onVote(selected)}
          disabled={!selected || busy}
          className={`mt-4 w-full ${PRIMARY_BUTTON}`}
        >
          <Icon name="checkPlain" className="h-4 w-4" />
          {busy
            ? 'Đang gửi phiếu...'
            : vote?.i_have_voted
              ? 'Đổi phiếu cho người đã chọn'
              : 'Bỏ phiếu cho người đã chọn'}
        </button>
      </div>
    </section>
  )
}

function formatVnd(amount) {
  const formatted = new Intl.NumberFormat('vi-VN').format(Number(amount) || 0)
  return `${formatted}₫`
}

// Fee payment sits between "add members" and "submit for approval": the
// team's captain scans/opens a VietQR to pay, then uploads a screenshot as
// proof. The backend already tracks the proof file on the team, so all this
// card owns is the VietQR display, the bank-app deeplinks, and the upload.
function BankDropdown({ options, onSelect }) {
  const [open, setOpen] = useState(false)
  
  return (
    <div className="relative mt-2">
      <button 
        type="button" 
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg border border-[#DCD8CC] bg-white px-3 py-2 text-sm text-ink/80 transition hover:bg-[#F3F4F1]"
      >
        <span>Chọn ngân hàng...</span>
        <Icon name="chevronD" className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-[#DCD8CC] bg-white shadow-lg">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => { setOpen(false); onSelect(option.key); }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[#20312B]/80 transition hover:bg-[#F3F4F1]"
            >
              {option.logo ? (
                <img src={option.logo} alt={option.name} className="h-5 w-8 object-contain" />
              ) : (
                <div className="h-5 w-8" />
              )}
              <span className="font-semibold">{option.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PaymentSection({ team, editable, isCaptain, onProofChange }) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hasProof, setHasProof] = useState(false)
  const [proofUrl, setProofUrl] = useState(null)
  // Timo auto-confirm: only ever polled by the captain's explicit click —
  // no background/cron polling here.
  const [checkingPaid, setCheckingPaid] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [paidNotice, setPaidNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    apiRequest('/my-team/payment')
      .then((payload) => {
        if (cancelled) return
        setInfo(payload)
        setHasProof(Boolean(payload?.has_proof))
      })
      .catch((err) => {
        if (cancelled) return
        setError(explainApiError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [team?.team_id])

  useEffect(() => {
    if (!hasProof) {
      setProofUrl(null)
      return undefined
    }
    let cancelled = false
    let objectUrl = null
    apiDownload('/my-team/payment-proof/file')
      .then(({ blob }) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setProofUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setProofUrl(null)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [hasProof])

  const handleDownloadQr = async () => {
    if (!info?.qr_image_url) return
    try {
      const response = await fetch(info.qr_image_url)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'vietqr.png'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      window.open(info.qr_image_url, '_blank', 'noopener')
    }
  }

  const handleCopyContent = async () => {
    if (!info?.content) return
    try {
      try {
        await navigator.clipboard.writeText(info.content)
      } catch {
        const ta = document.createElement('textarea')
        ta.value = info.content
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setNotice('Không copy được — hãy bôi đen nội dung và chép tay.')
    }
  }

  const handleDeeplink = (bankKey) => {
    setNotice('')
    try {
      const emv = buildVietQrPayload({
        bankBin: info.bank.bin,
        accountNumber: info.bank.account_no,
        amount: info.amount,
        description: info.content,
      })
      const url = bankKey === 'timo'
        ? buildTimoDeeplink({
          bankCode: info.bank.short_name,
          bankName: info.bank.short_name,
          accNumber: info.bank.account_no,
          amount: info.amount,
          description: info.content,
        }).url
        : buildBankDeeplink({ bankKey, qrPayload: emv }).url
      openDeeplinkWithFallback({
        deeplinkUrl: url,
        onFallback: () => setNotice('Nếu app không mở, hãy quét mã QR ở trên.'),
      })
    } catch {
      setNotice('Không mở được app ngân hàng — hãy quét mã QR ở trên.')
    }
  }

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const compressed = await compressImage(file)
      const fd = new FormData()
      fd.append('file', compressed, compressed.name || file.name)
      await apiRequest('/my-team/payment-proof', { method: 'POST', body: fd })
      setHasProof(true)
      setInfo((current) => (current ? { ...current, has_proof: true } : current))
      await onProofChange?.()
    } catch (err) {
      setError(explainApiError(err))
    } finally {
      setUploading(false)
    }
  }

  const handleMarkPaid = async () => {
    setCheckingPaid(true)
    setError('')
    setPaidNotice('')
    try {
      const result = await apiRequest('/my-team/payment/confirm-auto', { method: 'POST' })
      setPaidNotice(result?.message || '')
      if (result?.payment_confirmed) {
        setInfo((current) => (current ? { ...current, payment_confirmed: true } : current))
      }
      await onProofChange?.()
    } catch (err) {
      setError(explainApiError(err))
    } finally {
      setCheckingPaid(false)
    }
  }

  const handleCancelPayment = async () => {
    setCancelling(true)
    setError('')
    setPaidNotice('')
    try {
      await apiRequest('/my-team/payment/cancel', { method: 'POST' })
      setHasProof(false)
      setProofUrl(null)
      setInfo((current) => (current ? { ...current, roster_locked: false, has_proof: false } : current))
      await onProofChange?.()
      // Cancelling unlocks the roster so the captain can edit it again — the
      // mirror of the confirm flow (team → payment). Staying on the payment
      // step strands them: with the roster unlocked the proof upload is refused
      // and the confirm/cancel buttons are hidden, so nothing here is
      // actionable. Send them back to the team step. Navigate directly rather
      // than via gotoStep — the parent still has to re-render on the reloaded
      // (now unlocked) roster before the step guards would let 'team' through.
      const params = new URLSearchParams(window.location.search)
      params.set('step', 'team')
      navigate(`${window.location.pathname}?${params.toString()}${window.location.hash}`)
    } catch (err) {
      if (err?.data?.error === 'payment_already_confirmed') {
        setInfo((current) => (current ? { ...current, payment_confirmed: true } : current))
        await onProofChange?.()
      }
      setError(explainApiError(err))
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className={`${PARTICIPANT_CARD} p-5 text-sm text-ink/45`}>
        Đang tải thông tin thanh toán...
      </div>
    )
  }

  const bankReady = Boolean(info?.bank?.account_no)

  return (
    <div id="payment-section" className={`${PARTICIPANT_CARD} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Lệ phí</p>
          <h2 className="mt-1 font-display text-xl font-bold text-ink">Thanh toán lệ phí</h2>
        </div>
        <Badge
          label={info?.payment_confirmed ? 'Đã xác nhận thanh toán' : hasProof ? 'Đã upload minh chứng' : 'Chưa upload minh chứng'}
          cls={info?.payment_confirmed || hasProof ? 'bg-[#1F7A6B]/12 text-[#1F7A6B]' : 'bg-[#E0A23A]/15 text-[#9A6B12]'}
        />
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-[#D6492B]/25 bg-[#D6492B]/[0.06] px-4 py-3 text-sm text-[#D6492B]">
          {error}
        </div>
      )}

      {info && (
        <p className="mt-3 text-sm leading-6 text-ink/55">
          {info.member_count} người × {formatVnd(info.fee_per_person)} ={' '}
          <span className="font-semibold text-ink">{formatVnd(info.amount)}</span>
        </p>
      )}

      {isCaptain && info?.roster_locked && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#DCD8CC] bg-[#F3F4F1]/60 px-4 py-3">
          {info?.timo_configured && !info?.payment_confirmed && (
            <button type="button" onClick={handleMarkPaid} disabled={checkingPaid || cancelling} className={SECONDARY_BUTTON}>
              <Icon name="checkPlain" className="h-4 w-4" />
              {checkingPaid ? 'Đang kiểm tra...' : 'Đã chuyển tiền'}
            </button>
          )}
          {!info?.payment_confirmed && (
            <button
              type="button"
              onClick={handleCancelPayment}
              disabled={cancelling || checkingPaid}
              className="rounded-lg border border-[#D6492B]/25 bg-white px-3 py-1.5 text-xs font-semibold text-[#D6492B] transition hover:bg-[#D6492B]/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {cancelling ? 'Đang kiểm tra thanh toán...' : 'Hủy thanh toán'}
            </button>
          )}
          {paidNotice && <p className="w-full text-xs leading-5 text-ink/55">{paidNotice}</p>}
        </div>
      )}

      {!bankReady ? (
        <div className="mt-4 rounded-lg border border-[#DCD8CC] bg-[#F3F4F1] px-4 py-3 text-sm text-ink/55">
          BTC chưa cấu hình tài khoản nhận. Vui lòng quay lại sau.
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col items-center gap-3 rounded-lg border border-[#DCD8CC] bg-[#F3F4F1]/60 px-4 py-5">
            <img
              src={info.qr_image_url}
              alt="VietQR"
              className="h-auto w-full max-w-56 rounded-lg border border-[#DCD8CC] bg-white"
            />
            <button type="button" onClick={handleDownloadQr} className={SECONDARY_BUTTON}>
              <Icon name="doc" className="h-4 w-4" />
              Tải mã QR
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-[#DCD8CC] bg-white px-4 py-3">
            <p className="text-sm font-semibold text-ink">{info.bank.short_name}</p>
            <p className="mt-1 text-sm text-ink/60">
              Số TK: <span className="font-mono font-semibold text-ink break-all">{info.bank.account_no}</span>
            </p>
            <p className="mt-1 text-sm text-ink/60">Chủ TK: {info.bank.account_name}</p>
          </div>

          <div className="mt-3">
            <span className="text-xs font-medium text-ink/50">Nội dung chuyển khoản</span>
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-[#DCD8CC] bg-white px-3 py-2">
              <span className="flex-1 min-w-0 truncate font-mono text-sm text-ink">{info.content}</span>
              <button type="button" onClick={handleCopyContent} className={SECONDARY_BUTTON}>
                {copied ? 'Đã copy' : 'Copy'}
              </button>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink/45">Chuyển đúng nội dung để BTC đối soát nhanh.</p>
          </div>

          {/Android/i.test(navigator.userAgent) && (
            <div className="mt-4">
              <span className="text-xs font-medium text-ink/50">Mở app ngân hàng</span>
              <BankDropdown options={BANK_DEEPLINK_OPTIONS} onSelect={handleDeeplink} />
            </div>
          )}

          {notice && <p className="mt-2 text-xs leading-5 text-[#9A6B12]">{notice}</p>}
        </>
      )}

      <div className="mt-5 border-t border-[#DCD8CC] pt-4">
        <span className="text-xs font-medium text-ink/50">Minh chứng thanh toán</span>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {proofUrl ? (
            <img
              src={proofUrl}
              alt="Minh chứng thanh toán"
              className="h-24 w-24 rounded-lg border border-[#DCD8CC] object-cover"
            />
          ) : hasProof ? (
            <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-[#DCD8CC] bg-[#F3F4F1] text-center text-xs text-ink/40">
              Đang tải ảnh...
            </div>
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-[#DCD8CC] bg-[#F3F4F1] text-center text-xs text-ink/40">
              Chưa có ảnh
            </div>
          )}
          {editable && info?.roster_locked ? (
            <label className={`cursor-pointer ${SECONDARY_BUTTON}`}>
              <Icon name="paperclip" className="h-4 w-4" />
              {uploading ? 'Đang tải lên...' : hasProof ? 'Đổi ảnh' : 'Tải ảnh lên'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={handleFileChange}
              />
            </label>
          ) : (
            <p className="text-sm text-ink/45">
              {!info?.roster_locked
                ? 'Hãy quay lại bước Đội và xác nhận danh sách trước khi tải minh chứng.'
                : hasProof
                  ? 'Đội đã khoá chỉnh sửa — không thể đổi ảnh.'
                  : 'Đội chưa upload minh chứng thanh toán.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// A member's MSSV is their identity, so the roster must never show the same one
// twice. The server never returns duplicates, but an optimistic update or two
// overlapping loads briefly could — dedupe defensively so the UI can't flash a
// doubled row. Keep a captain entry over a plain one when both share an MSSV.
function dedupeMembersByMssv(list) {
  if (!Array.isArray(list)) return []
  const byMssv = new Map()
  const order = []
  for (const member of list) {
    const key = String(member?.mssv || '').trim().toLowerCase()
    if (!key) {
      order.push(member)
      continue
    }
    const existing = byMssv.get(key)
    if (!existing) {
      byMssv.set(key, member)
      order.push(key)
    } else if (member?.is_captain && !existing.is_captain) {
      byMssv.set(key, member)
    }
  }
  return order.map((item) => (typeof item === 'string' ? byMssv.get(item) : item))
}

function ParticipantDashboard() {
  const [user, setUser] = useState(() => getStoredUser() || {
    username: 'participant',
    email: 'participant@vnutour.vn',
    role: 'participant',
  })
  const [profile, setProfile] = useState(EMPTY_PROFILE)
  const [profileSaved, setProfileSaved] = useState(false)
  // Profile-save feedback lives next to the captain form, not in the page-level
  // apiError, so a "missing Trường/CCCD" reason is visible right at the button.
  const [profileError, setProfileError] = useState('')
  const [team, setTeam] = useState(null)
  const [members, setMembers] = useState([])
  const [teamNameDraft, setTeamNameDraft] = useState('')
  const [memberDialog, setMemberDialog] = useState(null)
  const [memberForm, setMemberForm] = useState(null)
  const [memberDraftSavedAt, setMemberDraftSavedAt] = useState(null)
  const [profileDetailsOpen, setProfileDetailsOpen] = useState(false)
  const [editable, setEditable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState('')
  const [apiError, setApiError] = useState('')
  // Reopen Settings when we return from a Discord OAuth round-trip that was
  // started there, so the participant lands back where they left off (the
  // DiscordConnectCard on the main view handles the other case). Only honour
  // the flag on an actual callback; otherwise just clear a stale one.
  const [showSettings, setShowSettings] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const returnTo = window.sessionStorage.getItem(DISCORD_RETURN_KEY)
      const hasCallback = /[?&](code|error)=/.test(window.location.search)
      if (returnTo === 'settings' && hasCallback) {
        window.sessionStorage.removeItem(DISCORD_RETURN_KEY)
        return true
      }
      if (returnTo) window.sessionStorage.removeItem(DISCORD_RETURN_KEY)
    } catch { /* sessionStorage unavailable — fall through */ }
    return false
  })
  const [registrationSchema, setRegistrationSchema] = useState(null)
  const [experience, setExperience] = useState(null)
  const [captainVote, setCaptainVote] = useState(null)
  const [voteChoice, setVoteChoice] = useState('')
  // The payment-confirm dialog: shows the roster + the amount it implies
  // (fee x member count) before locking anything.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmPayment, setConfirmPayment] = useState(null)
  const [confirmPaymentLoading, setConfirmPaymentLoading] = useState(false)
  const [latestPost, setLatestPost] = useState(null)

  const loadDashboard = async () => {
    const me = await apiRequest('/auth/me')
    const profilePayload = await apiRequest('/me/profile')
    const teamPayload = await apiRequest('/my-team')
    const schemaPayload = await apiRequest('/register/schema', { auth: false })
    const experiencePayload = await apiRequest('/me/experience')

    // `/teams/{code}` is admin/collab only, so for a participant it could only
    // ever 403 — and the throw skipped every setter below it, leaving the whole
    // dashboard blank. `/my-team` already carries the same fields, and its
    // members come back at "self" visibility rather than the thinner "basic".
    setUser((current) => ({ ...current, ...me }))
    setProfile(normalizeProfile(me, profilePayload))
    const normalizedTeam = normalizeTeam(teamPayload)
    setTeam(normalizedTeam)
    // A placeholder name ("Pending team <mssv>") is server bookkeeping, not a
    // name the captain chose — start the draft empty so the team step offers a
    // clean field instead of pre-filling the stand-in.
    setTeamNameDraft(
      normalizedTeam && !normalizedTeam.name_is_placeholder ? normalizedTeam.team_name : '',
    )
    setMembers(dedupeMembersByMssv(teamPayload?.members))
    setEditable(Boolean(teamPayload?.editable ?? (normalizedTeam ? normalizedTeam.approval_status !== 'approved' : true)))
    setRegistrationSchema(schemaPayload)
    setExperience(experiencePayload)
    setCaptainVote(normalizedTeam ? await fetchCaptainVote() : null)

    if (normalizedTeam?.approval_status === 'approved') {
      try {
        const feedRes = await apiRequest('/feed/latest')
        setLatestPost(feedRes?.post || null)
      } catch {
        setLatestPost(null)
      }
    } else {
      setLatestPost(null)
    }
  }

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        setLoading(true)
        await loadDashboard()
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError(explainApiError(error))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  // A member can be pulled into another team by that team's captain, which
  // silently shrinks this roster on the server. There's no realtime channel, so
  // refetch whenever the tab regains focus — the stale roster then self-corrects
  // the moment the user looks at it again, without flashing the page loader.
  const reloadingRef = useRef(false)
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible' || reloadingRef.current) return
      reloadingRef.current = true
      loadDashboard()
        .catch((error) => {
          if (error?.status === 401) logoutAndRedirect('/')
        })
        .finally(() => {
          reloadingRef.current = false
        })
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const status = STATUS[team?.approval_status || 'draft']
  const provision = PROVISION[team?.provision_state || 'none']
  const registrationOpen = experience?.registration_open !== false
  const currentPhase = experience?.current_phase || 'registration'
  const personFields = useMemo(
    () => (registrationSchema?.person_fields || []).filter((field) => field.enabled !== false),
    [registrationSchema],
  )
  const maxMembers = registrationSchema?.team_size_max || registrationSchema?.team_size || MAX_MEMBERS
  // Freshers sign up before they know four other people, so an under-strength
  // team may still be submitted; the organisers merge teams up to full size.
  const minMembers = registrationSchema?.team_size_min || 1
  // Naming a team is captain-only, at any roster size: the team step sits
  // between members and payment, so the captain names the team there whatever
  // the head count (a merge resets the name to the surviving team's code
  // anyway). The member list cannot tell us who the captain is on a merged
  // team, so the ballot payload is the authority — when it has not loaded we
  // optimistically allow it.
  const hasElectedCaptain = Boolean(captainVote?.captain_mssv)
  const captainMayRename = captainVote ? captainVote.can_rename_team !== false : true
  const rosterSizeFinal = Boolean(team?.roster_size_final)
  const teamIsFull = Boolean(team?.can_name)
  const canRenameTeam = captainMayRename && (teamIsFull || Boolean(team?.naming_allowed))
  const isFullyApproved = team?.approval_status === 'approved' && !team?.naming_allowed
  // Rejecting a team is the organisers asking for changes, and that ask can
  // land after registration closes. The backend allows the edit in that case,
  // so the editor has to stay reachable — creating a team stays registration-only.
  const teamEditingOpen = registrationOpen || team?.approval_status === 'rejected'
  const teamNameHint = teamIsFull
    ? (hasElectedCaptain
      ? 'Chỉ đội trưởng mới đổi được tên đội. Nhờ đội trưởng đặt tên giúp nhé.'
      : 'Đội chưa có đội trưởng nên chưa ai đổi được tên. Bầu xong đội trưởng thì người đó sẽ đặt tên chính thức.')
    : team?.member_count === 1
      ? 'Đăng ký cá nhân — hệ thống tự đặt tên tạm để nhận biết. Bạn có thể sang bước Thanh toán.'
      : `Đội chưa đủ ${maxMembers} người nên chưa đặt được tên chính thức. BTC sẽ ghép đội sau. Hiện ${team?.member_count ?? '—'}/${maxMembers}.`
  // A merged team is left named after its code until the new captain renames it.
  const teamNameIsCode = Boolean(team && team.team_name && team.team_name === team.team_id)
  const captainShouldNameTeam = hasElectedCaptain && canRenameTeam && teamNameIsCode
  const captainVoteOpen = Boolean(captainVote?.open)
  const missingProfileFields = useMemo(
    () => getMissingProfileFields(profile, personFields),
    [profile, personFields],
  )
  const profileComplete = missingProfileFields.length === 0
  const profilePanelOpen = profileDetailsOpen
  const nextAction = useMemo(
    () => getNextAction(profile, team, members, personFields, editable),
    [profile, team, members, personFields, editable],
  )
  const captainIndex = members.findIndex((member) => member.is_captain)
  const myMssv = profile.mssv || user.mssv || ''
  // The fallback "you are the captain" header block stands in only before the
  // captain's own membership row exists (the team is created on arrival at the
  // member step). Once the logged-in user is already listed in `members`,
  // rendering it duplicates their row — which is exactly what happens when a
  // team has no is_captain at all: a merge resets every flag pending the kín
  // election, or a captain flag was otherwise lost. Defer to the member row.
  const selfInMembers = members.some((member) => {
    const key = String(member?.mssv || '').trim()
    return key && key === String(myMssv).trim()
  })
  const showProfileAsCaptain = captainIndex === -1 && !selfInMembers
  const displayedMemberCount = showProfileAsCaptain ? members.length + 1 : members.length
  // Backend now lets a non-captain PATCH their own row too; mirror that here
  // so the "Sửa" button shows for the row that belongs to the logged-in
  // account, not only for the captain.
  const amCaptain = Boolean(members.find((member) => member.mssv === myMssv)?.is_captain)

  // ── Wizard navigation ───────────────────────────────────────────────
  // Each step is its own screen, synced to ?step=. A step is reachable only
  // when it is done or it is the current active step; a step linked into the
  // URL that isn't reachable yet snaps back to where the team actually stands.
  // This is what keeps member editing off the Thanh toán screen — you navigate
  // back to the Thành viên step for that.
  const stepStates = useMemo(
    () => Object.fromEntries(STEPS.map((s) => [s.key, getStepState(s, profile, team, members, personFields)])),
    [profile, team, members, personFields],
  )
  // Once the captain confirmed the roster for payment, its steps are closed:
  // the amount was computed from that roster, so editing it afterwards — even
  // just to "fix" something — is exactly the mismatch the confirm dialog
  // exists to prevent. BTC rejecting the team is what reopens them.
  const rosterLocked = Boolean(team?.roster_locked)
  const rosterLockedSteps = rosterLocked ? ['members', 'team'] : []
  const stepUnlocked = (key) => {
    if (rosterLockedSteps.includes(key)) return false
    return stepStates[key] === 'done' || stepStates[key] === 'active'
  }
  const currentStepKey = STEPS.find((s) => stepStates[s.key] === 'active')?.key
    || (stepStates.approved === 'done' ? 'approved' : 'submit')
  const [stepParam] = useEnumSearchParam('step', STEP_KEYS, currentStepKey)
  const activeStep = stepUnlocked(stepParam) ? stepParam : currentStepKey
  const pendingStepScroll = useRef(null)

  // Wait until React has rendered the destination step, then bring its form
  // back under the sticky header. Without this, Next swaps the content while
  // preserving the old document offset, often leaving the user below the next
  // form on both mobile and desktop.
  useEffect(() => {
    if (pendingStepScroll.current !== activeStep) return undefined
    pendingStepScroll.current = null
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('registration-step-form')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeStep])

  // Always spell the step out in the URL instead of going through
  // `setStepParam` — that drops a parameter equal to its fallback, and the
  // fallback tracks live data. Leaving the param out is what let the team
  // record appearing (or the roster growing) recompute `currentStepKey` under
  // the user and yank them to a later step, e.g. straight to Thanh toán.
  const gotoStep = (key) => {
    if (!stepUnlocked(key)) return
    pendingStepScroll.current = key
    const params = new URLSearchParams(window.location.search)
    params.set('step', key)
    navigate(`${window.location.pathname}?${params.toString()}${window.location.hash}`)
    // A shortcut can target the step already on screen. That does not change
    // activeStep, so its effect will not rerun; scroll it immediately instead.
    if (key === activeStep) {
      pendingStepScroll.current = null
      window.requestAnimationFrame(() => {
        document.getElementById('registration-step-form')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      })
    }
  }

  // `useEnumSearchParam`'s fallback is `currentStepKey`, recomputed on every
  // render — so while `?step=` is absent from the URL, the "active" step
  // silently tracks live form state instead of the last explicit
  // Next/gotoStep click. That let filling in the last missing required field
  // (e.g. Facebook link) flip `profileComplete` mid-keystroke and jump the
  // wizard straight to "Thành viên" before Lưu was ever pressed. Pin the step
  // into the URL once it is first known — after the dashboard data has landed,
  // since during loading every state is empty and the "furthest" step would
  // pin as Hồ sơ — so later edits can no longer change the fallback under it;
  // only an explicit gotoStep() can move on.
  const stepPinned = useRef(false)
  useEffect(() => {
    if (stepPinned.current || !currentStepKey || loading) return
    stepPinned.current = true
    if (new URLSearchParams(window.location.search).get('step')) return
    navigate(`${window.location.pathname}?step=${currentStepKey}${window.location.hash}`, { replace: true })
  }, [currentStepKey, loading])

  // The team record is an implementation detail of the roster APIs — every
  // member operation (/my-team/members, .../resolve) needs a membership to
  // exist. There is no "Tạo đội" button anymore: the member step enters
  // members straight away, and the unnamed team is created on arrival.
  const teamAutoCreated = useRef(false)
  useEffect(() => {
    if (teamAutoCreated.current) return
    if (loading || !registrationOpen || !profileComplete) return
    if (activeStep !== 'members' || team) return
    teamAutoCreated.current = true
    withBusy('create-team', async () => {
      try {
        await apiRequest('/my-team', { method: 'POST', body: {} })
      } catch (error) {
        // Also fires when the request is already in flight elsewhere (or a
        // StrictMode double-run) — the record exists either way.
        if (error?.data?.error !== 'already_has_team') throw error
      }
      await loadDashboard()
    })
  }, [activeStep, team, loading, registrationOpen, profileComplete])

  // Adding a member means typing MSSV, email and whatever the schema asks for,
  // five times over. The dialog is not a `useDraftState` because the parent
  // owns `memberForm` and the identity being edited changes between openings,
  // which the hook's mount-once baseline cannot express.
  const memberDraftKey = memberDialog
    ? `participant:member:${memberDialog.index === null ? 'new' : members[memberDialog.index]?.mssv || 'new'}`
    : ''

  const memberBaseline = () => (
    memberDialog?.index == null ? blankMember() : withFlatExtra(members[memberDialog.index])
  )

  const openMemberDialog = (index = null) => {
    // Clear any error left over from a prior action so the modal opens clean —
    // its warning box only shows problems from this add/edit attempt.
    setApiError('')
    const base = index === null ? blankMember() : withFlatExtra(members[index])
    const stored = readDraft(`participant:member:${index === null ? 'new' : base.mssv || 'new'}`)
    setMemberDialog({ index })
    // The stored draft wins field by field, but anything the server has since
    // added to the record still comes through.
    setMemberForm(stored?.value ? { ...base, ...stored.value } : { ...base })
    setMemberDraftSavedAt(stored?.savedAt || null)
  }

  const closeMemberDialog = () => {
    // Closing is not discarding — the draft stays so reopening picks it up.
    // Drop the modal's error so it never leaks onto the page behind.
    setApiError('')
    setMemberDialog(null)
    setMemberForm(null)
    setMemberDraftSavedAt(null)
  }

  useEffect(() => {
    if (!memberDraftKey || !memberForm) return undefined
    const timer = window.setTimeout(() => writeDraft(memberDraftKey, memberForm), 400)
    return () => window.clearTimeout(timer)
  }, [memberDraftKey, memberForm])

  // The confirm dialog previews the exact amount the captain is about to be
  // billed, so fetch the same payload the payment step will show.
  // Approved teams (e.g. merged teams) already paid individually — skip.
  useEffect(() => {
    if (!confirmOpen || team?.approval_status === 'approved') return undefined
    let cancelled = false
    setConfirmPaymentLoading(true)
    apiRequest('/my-team/payment')
      .then((payload) => {
        if (!cancelled) setConfirmPayment(payload)
      })
      .catch(() => {
        if (!cancelled) setConfirmPayment(null)
      })
      .finally(() => {
        if (!cancelled) setConfirmPaymentLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [confirmOpen, team?.approval_status])

  // A closed form should not keep showing a stale save error next time it opens.
  useEffect(() => {
    if (!profileDetailsOpen) setProfileError('')
  }, [profileDetailsOpen])

  const memberDraft = useMemo(() => ({
    dirty: false,
    restored: Boolean(memberDraftSavedAt),
    savedAt: memberDraftSavedAt,
    discard: () => {
      clearDraft(memberDraftKey)
      setMemberForm(memberBaseline())
      setMemberDraftSavedAt(null)
    },
    clear: () => {
      clearDraft(memberDraftKey)
      setMemberDraftSavedAt(null)
    },
    dismiss: () => setMemberDraftSavedAt(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [memberDraftKey, memberDraftSavedAt, memberDialog, members])

  const saveTeamNameIfNeeded = async () => {
    if (!team || !editable) return
    // Renaming needs a full team; a not-yet-full team keeps its placeholder.
    const nextName = canRenameTeam ? teamNameDraft.trim() : team.team_name
    if (!nextName || nextName === team.team_name) return

    const payload = await apiRequest('/my-team', {
      method: 'PATCH',
      body: { team_name: nextName },
    })
    setTeam((current) => (
      current ? { ...current, team_name: payload.name || nextName, name_is_placeholder: false } : current
    ))
    setTeamNameDraft(payload.name || nextName)
  }

  // The team step is where the captain names the team; payment only opens
  // behind a confirmed roster. "Tiếp tục" opens the confirm dialog instead of
  // jumping straight to the QR: confirming saves any pending rename, locks
  // the roster server-side, and only then moves on — the lock landing in
  // state and the URL write batch together, so the payment step is unlocked
  // by the time the URL points at it.
  const openPaymentConfirm = () => {
    setApiError('')
    setConfirmOpen(true)
  }

  const confirmTeamForPayment = async (event) => {
    event?.preventDefault?.()
    await withBusy('confirm-team', async () => {
      const body = {}
      const nextName = teamNameDraft.trim()
      if (nextName && nextName !== team.team_name) body.team_name = nextName
      if (!team.roster_locked) body.roster_locked = true
      if (Object.keys(body).length > 0) {
        await apiRequest('/my-team', { method: 'PATCH', body })
      }
      await loadDashboard()
      setConfirmOpen(false)
      // Not gotoStep(): its unlock check closes over the pre-confirm render,
      // where a not-yet-saved name still reads as "team not named" and the
      // move to payment would be silently dropped.
      const params = new URLSearchParams(window.location.search)
      const isApproved = team?.approval_status === 'approved'
      const destination = isApproved ? 'approved' : 'payment'
      pendingStepScroll.current = destination
      params.set('step', destination)
      navigate(`${window.location.pathname}?${params.toString()}${window.location.hash}`)
    })
  }

  const withBusy = async (actionKey, task) => {
    setBusyAction(actionKey)
    setApiError('')
    try {
      await task()
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      const conflictCode = error?.data?.error || error?.message
      if (error?.status === 409 && MEMBERSHIP_CONFLICT_CODES.has(conflictCode)) {
        try {
          await loadDashboard()
        } catch {
          // Preserve the original conflict: it explains the action that failed.
        }
      }
      setApiError(explainApiError(error))
    } finally {
      setBusyAction('')
    }
  }

  // Safety net for the auto-create above: if the user races it (hero button
  // opens the member dialog on the same tick the step renders), make sure the
  // record exists before the member request goes out. No refresh — the caller
  // reloads the dashboard after its own write anyway.
  const ensureTeamExists = async () => {
    if (team) return
    try {
      await apiRequest('/my-team', { method: 'POST', body: {} })
    } catch (error) {
      if (error?.data?.error !== 'already_has_team') throw error
    }
  }

  const castCaptainVote = (candidateMssv) => withBusy('captain-vote', async () => {
    if (!candidateMssv) return
    try {
      const payload = await apiRequest('/my-team/captain-vote', {
        method: 'POST',
        body: { candidate_mssv: candidateMssv },
      })
      setCaptainVote(payload)
      // Keeping the ballot secret means not leaving the choice highlighted
      // afterwards; the "đã bỏ phiếu" badge and the tally are the feedback.
      setVoteChoice('')
      // The winner is promoted server-side the moment the last vote lands, and
      // that changes the captain badge and the rename right on this page.
      if (payload?.captain_mssv) await loadDashboard()
    } catch (error) {
      // A rejected vote usually means the election moved on under us, so resync
      // the ballot before surfacing the message.
      setCaptainVote(await fetchCaptainVote())
      throw error
    }
  })

  const saveProfile = async (event) => {
    event.preventDefault()
    // Catch empty required fields (e.g. Trường not picked, CCCD blank) before
    // the request so the reason lands at the button instead of a rejected save
    // that reads as "nothing happened".
    const missing = getMissingProfileFields(profile, personFields)
    if (missing.length > 0) {
      setProfileError(`Vui lòng hoàn thiện: ${missing.map((field) => field.label).join(', ')}.`)
      return
    }
    setProfileError('')
    setBusyAction('save-profile')
    try {
      const nextProfile = await apiRequest('/me/profile', {
        method: 'PATCH',
        body: profile,
      })
      const updatedProfile = { ...profile, ...nextProfile }
      setProfile(updatedProfile)
      if (isProfileComplete(updatedProfile, personFields)) setProfileDetailsOpen(false)
      setProfileSaved(true)
      window.setTimeout(() => setProfileSaved(false), 1400)
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setProfileError(explainApiError(error))
    } finally {
      setBusyAction('')
    }
  }

  const saveMember = async (event) => {
    event?.preventDefault?.()
    if (!memberForm?.mssv || !memberForm?.email) return
    const normalizedMemberForm = {
      ...memberForm,
      mssv: String(memberForm.mssv).trim().toUpperCase(),
      email: String(memberForm.email).trim().toLowerCase(),
    }

    // A student is identified by MSSV, so refuse a second row with an MSSV that
    // already belongs to the team — the captain (shown separately) or any listed
    // member — before it even reaches the server. Only guards new additions;
    // editing keeps its own MSSV.
    if (memberDialog?.index === null) {
      const mssv = normalizedMemberForm.mssv
      const taken = new Set(
        [profile.mssv, ...members.map((m) => m.mssv)]
          .filter(Boolean)
          .map((value) => String(value).trim().toUpperCase()),
      )
      if (taken.has(mssv)) {
        setApiError('MSSV này đã có trong đội — không thể thêm cùng một sinh viên hai lần.')
        return
      }
    }

    await withBusy('save-member', async () => {
      await ensureTeamExists()
      if (memberDialog?.index === null) {
        await apiRequest('/my-team/members', {
          method: 'POST',
          body: normalizedMemberForm,
        })
      } else {
        await apiRequest(`/my-team/members/${members[memberDialog.index].mssv}`, {
          method: 'PATCH',
          body: normalizedMemberForm,
        })
      }
      // Saved server-side, so the local copy has nothing left to protect.
      clearDraft(memberDraftKey)
      await loadDashboard()
      closeMemberDialog()
    })
  }

  const removeMember = async (index) => {
    const member = members[index]
    if (!member || member.is_captain) return

    await withBusy('remove-member', async () => {
      await apiRequest(`/my-team/members/${member.mssv}`, {
        method: 'DELETE',
      })
      await loadDashboard()
    })
  }

  const submitTeam = async () => {
    if (members.length < minMembers || members.length > maxMembers) {
      setApiError(`Đội cần từ ${minMembers} đến ${maxMembers} thành viên trước khi gửi duyệt.`)
      return
    }
    await withBusy('submit-team', async () => {
      await saveTeamNameIfNeeded()
      await apiRequest('/my-team/submit', {
        method: 'POST',
        body: {},
      })
      await loadDashboard()
    })
  }

  const handleNextAction = () => {
    if (!registrationOpen) return
    // Route the "việc cần làm" shortcut to the step that owns that action
    // instead of scrolling a single long page.
    switch (nextAction.kind) {
      case 'profile':
        gotoStep('profile')
        setProfileDetailsOpen(true)
        break
      case 'name-team':
        gotoStep('team')
        break
      case 'fix':
        gotoStep('members')
        break
      case 'add-member':
        gotoStep('members')
        openMemberDialog()
        break
      case 'members':
        gotoStep('members')
        break
      case 'submit':
        // Can't submit before paying; send them to the payment step first.
        gotoStep(stepUnlocked('submit') ? 'submit' : 'payment')
        break
      default:
        break
    }
  }

  const logout = () => {
    logoutAndRedirect('/')
  }

  if (loading) {
    return (
      <div className="min-h-screen font-sans" style={{ backgroundColor: COLORS.paper, color: COLORS.ink }}>
        <Contours />
        <LoadingState />
      </div>
    )
  }

  return (
    <div className="min-h-screen font-sans" style={{ backgroundColor: COLORS.paper, color: COLORS.ink }}>
      <Contours />

      <header
        className="sticky top-0 z-40 border-b backdrop-blur"
        style={{ backgroundColor: 'rgba(243,244,241,0.95)', borderColor: COLORS.stone }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-3">
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
              onClick={() => setShowSettings(s => !s)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                showSettings
                  ? 'border-[#1F7A6B]/30 bg-[#1F7A6B]/10 text-[#1F7A6B]'
                  : 'border-[#DCD8CC] bg-white text-[#20312B]/60 hover:bg-[#F3F4F1] hover:text-[#20312B]'
              }`}
              title="Cài đặt"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.241.437-.613.43-.992a7.723 7.723 0 0 1 0-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              <span className="hidden sm:inline">Cài đặt</span>
            </button>
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
        {apiError && (
          <div className="rounded-lg border border-[#D6492B]/25 bg-[#D6492B]/[0.06] px-4 py-3 text-sm text-[#D6492B]">
            {apiError}
          </div>
        )}

        {showSettings ? (
          <SettingsPage />
        ) : (
          <>
        {captainVoteOpen && (
          <CaptainVoteCard
            vote={captainVote}
            myMssv={profile.mssv || user.mssv || ''}
            selected={voteChoice}
            onSelect={setVoteChoice}
            onVote={castCaptainVote}
            busy={busyAction === 'captain-vote'}
          />
        )}
        {registrationOpen && !isFullyApproved ? (
          <>
            <section className={`${PARTICIPANT_CARD} overflow-hidden`}>
              <div className="grid gap-0 lg:grid-cols-[1.45fr_0.55fr]">
                <div className="min-w-0 px-5 py-6 sm:px-7">
                  <div className="flex flex-wrap items-center gap-2">
                    {team ? <Badge label={status.label} cls={status.cls} /> : <Badge label="Chưa có đội" cls="bg-[#20312B]/[0.07] text-[#20312B]/50" />}
                  </div>
                  <h1 className="mt-4 max-w-2xl font-display text-3xl font-bold tracking-normal text-ink sm:text-4xl">
                    {team ? team.team_name : 'Bắt đầu đăng ký đội VNUTour'}
                  </h1>
                </div>

                <div className="border-t border-[#DCD8CC] bg-[#F3F4F1]/65 p-5 lg:border-l lg:border-t-0">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Việc cần làm</p>
                  <h2 className="mt-2 font-display text-xl font-bold text-ink">{nextAction.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-ink/55">{nextAction.body}</p>
                  <button
                    type="button"
                    onClick={handleNextAction}
                    disabled={Boolean(busyAction)}
                    className={`mt-5 w-full ${PRIMARY_BUTTON}`}
                  >
                    {nextAction.action}
                    <Icon name="chevronR" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </section>

            <ProgressTrail
              profile={profile}
              team={team}
              members={members}
              fields={personFields}
              activeStep={activeStep}
              blockedSteps={rosterLockedSteps}
              onSelect={gotoStep}
            />
          </>
        ) : (
          <>
            <EventExperienceCard experience={experience} />
            {team?.approval_status === 'rejected' && (
              <FixTeamRequestCard
                note={team.approval_note}
                onFix={() => document.getElementById('team-editor')?.scrollIntoView({
                  behavior: 'smooth', block: 'start',
                })}
              />
            )}
            {/* Feed Announcement Card for approved teams */}
            {team?.approval_status === 'approved' && latestPost && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold text-ink sm:text-xl">Bảng tin Ban tổ chức</h2>
                  <a
                    href="/feed"
                    onClick={(e) => {
                      e.preventDefault()
                      navigate('/feed')
                    }}
                    className="text-sm font-semibold text-trail hover:underline"
                  >
                    Xem tất cả →
                  </a>
                </div>
                <FeedCard post={latestPost} compact />
              </section>
            )}

            {/* Once registration closes or the team is approved, they just need
                to run the course. Stations are now a separate page. */}
            {team && (
              <div className={`${PARTICIPANT_CARD} px-5 py-6 sm:px-7`}>
                <h2 className="font-display text-xl font-bold text-ink">Các trạm sự kiện</h2>
                <p className="mt-2 text-sm leading-6 text-ink/65">
                  Truy cập trang chạy trạm để xem bản đồ, quét mã QR check-in và làm bài tập tại các trạm.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/stations')}
                  className={`mt-6 w-full sm:w-auto ${PRIMARY_BUTTON}`}
                >
                  Đến trang Trạm
                  <Icon name="chevronR" className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}


        {/* The Discord role and private channel only exist once the team is
            approved (provisioning is queued on approval), so the connect card is
            only useful — and only shown — after the team is approved. */}
        {team?.approval_status === 'approved' && <DiscordConnectCard />}

        {!isFullyApproved && (
        <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <div id="registration-step-form" className="min-w-0 scroll-mt-24 space-y-5">
            {registrationOpen && !isFullyApproved ? (
              <>
                {/* BƯỚC 1 — HỒ SƠ */}
                {activeStep === 'profile' && (
                  <div id="captain-profile" className={`${PARTICIPANT_CARD} p-5`}>
                    <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Bước 1</p>
                    <h2 className="mt-1 font-display text-xl font-bold text-ink">Hồ sơ đội trưởng</h2>
                    <p className="mt-2 text-sm leading-6 text-ink/55">
                      Hoàn thiện thông tin của bạn trước — đây là hồ sơ đội trưởng.
                    </p>
                    <div className="mt-4 overflow-hidden rounded-lg border border-[#DCD8CC]">
                      <CaptainProfileEditor
                        profile={profile}
                        fields={personFields}
                        open
                        saved={profileSaved}
                        saving={busyAction === 'save-profile'}
                        error={profileError}
                        onPatch={(patch) => setProfile((current) => ({ ...current, ...patch }))}
                        onSave={saveProfile}
                      />
                    </div>
                    <div className="mt-5">
                      <StepNav
                        onNext={() => gotoStep('members')}
                        nextDisabled={!profileComplete}
                        hint={!profileComplete ? 'Cần điền đủ thông tin hồ sơ để sang bước tiếp theo.' : undefined}
                      />
                    </div>
                  </div>
                )}

                {/* BƯỚC 2 — THÀNH VIÊN: nhập thành viên luôn ở khối danh sách
                    bên dưới (cùng activeStep); đội chưa có tên được tạo ngầm
                    khi vào bước này. */}

                {/* BƯỚC 3 — ĐỘI (đặt tên, sau khi đã có thành viên) */}
                {activeStep === 'team' && team && (
                  <div className={`${PARTICIPANT_CARD} p-5`}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Bước 3</p>
                        <h2 className="mt-1 font-display text-xl font-bold text-ink">Tên đội</h2>
                        {team.team_id && (
                          <p className="mt-1 text-xs leading-5 text-ink/45">
                            Mã đội: <span className="font-mono font-semibold text-ink/70">{team.team_id}</span>
                            <span className="text-ink/40"> — dùng mã này khi cần BTC hỗ trợ.</span>
                          </p>
                        )}
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
                    {isTeamNamed(team) && (rosterLocked || (team.approval_status === 'approved' && !team.naming_allowed)) ? (
                      <>
                        <div className="mt-5">
                          <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Tên đội</p>
                          <p className="mt-1 font-display text-lg font-bold text-ink">{team.team_name}</p>
                          <p className="mt-2 text-xs leading-5 text-ink/45">
                            Tên đội đã được đặt. Nếu cần thay đổi, hãy liên hệ BTC.
                          </p>
                        </div>
                        <div className="mt-5">
                          <StepNav
                            onBack={() => gotoStep('members')}
                            onNext={() => gotoStep(team.approval_status === 'approved' ? 'approved' : 'payment')}
                            nextLabel="Tiếp tục"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="mt-5">
                          <Field
                            label="Tên đội"
                            value={teamNameDraft}
                            disabled={(!editable && !team?.naming_allowed) || !canRenameTeam}
                            onChange={setTeamNameDraft}
                            required
                          />
                          {!canRenameTeam ? (
                            <p className="mt-1 text-xs leading-5 text-ink/45">{teamNameHint}</p>
                          ) : captainShouldNameTeam ? (
                            <p className="mt-1 text-xs leading-5 text-[#9A6B12]">
                              Đội vừa bầu xong và vẫn đang lấy mã đội làm tên. Bạn là đội trưởng — hãy đặt
                              tên chính thức cho đội.
                            </p>
                          ) : null}
                        </div>
                        {(editable || team?.naming_allowed) && canRenameTeam && teamNameDraft.trim() && teamNameDraft !== team.team_name && (
                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              onClick={() => withBusy('save-team-name', saveTeamNameIfNeeded)}
                              disabled={Boolean(busyAction)}
                              className={SECONDARY_BUTTON}
                            >
                              <Icon name="checkPlain" className="h-4 w-4" />
                              Lưu tên đội
                            </button>
                          </div>
                        )}
                        <div className="mt-5">
                          <StepNav
                            onBack={() => gotoStep('members')}
                            onNext={openPaymentConfirm}
                            nextLabel="Xác nhận & tiếp tục"
                            // A team that already paid (legacy flow) must not get
                            // stuck here just because size/name doesn't line up —
                            // advancing stays open then.
                            nextDisabled={
                              Boolean(busyAction)
                              || (!stepUnlocked('payment') && (
                                  !rosterSizeFinal
                                  || ((teamIsFull || team?.naming_allowed) && !teamNameDraft.trim())
                              ))
                            }
                            hint={
                              stepUnlocked('payment')
                                ? undefined
                                : !rosterSizeFinal
                                  ? `Đội cần ít nhất ${minMembers} và tối đa ${maxMembers} người mới sang được bước Thanh toán.`
                                  : ((teamIsFull || team?.naming_allowed) && !teamNameDraft.trim())
                                    ? 'Nhập tên đội để sang bước Thanh toán.'
                                    : undefined
                            }
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* BƯỚC 4 — THANH TOÁN (chỉ mở sau khi xác nhận đội — roster đã khóa) */}
                {activeStep === 'payment' && team && (
                  <>
                    {rosterLocked && (
                      <div className={`${PARTICIPANT_CARD} flex items-start gap-3 border-[#1F7A6B]/25 bg-[#1F7A6B]/[0.06] p-4`}>
                        <Icon name="checkPlain" className="mt-0.5 h-4 w-4 text-[#1F7A6B]" />
                        <p className="text-sm leading-6 text-ink/70">
                          Thông tin đội đã được xác nhận và khóa để số tiền chuyển khoản không bị chênh
                          lệch. Nếu cần thay đổi, hãy liên hệ BTC trước khi thanh toán.
                        </p>
                      </div>
                    )}
                    <PaymentSection team={team} editable={editable} isCaptain={amCaptain} onProofChange={loadDashboard} />
                    <div className={`${PARTICIPANT_CARD} p-5`}>
                      <StepNav
                        // The roster is locked from the confirm dialog on, so
                        // there is nothing to go back to — editing it here is
                        // exactly the amount-mismatch the lock prevents.
                        onBack={rosterLocked ? undefined : () => gotoStep('team')}
                        onNext={() => gotoStep('submit')}
                        nextDisabled={!team.has_payment_proof}
                        hint={!team.has_payment_proof ? 'Tải minh chứng thanh toán để sang bước Gửi duyệt.' : undefined}
                      />
                    </div>
                  </>
                )}

                {/* BƯỚC 5 — GỬI DUYỆT */}
                {activeStep === 'submit' && team && (
                  <div id="team-editor" className={`${PARTICIPANT_CARD} p-5`}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Bước 5</p>
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
                    <div className="mt-5 rounded-lg border border-[#DCD8CC] bg-[#F3F4F1]/70 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-ink">Tiến độ thành viên</p>
                        <p className="font-mono text-xs text-ink/45">{members.length}/{maxMembers}</p>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                        <div className="h-full" style={{ width: `${Math.min(100, (members.length / maxMembers) * 100)}%`, backgroundColor: status.color }} />
                      </div>
                    </div>
                    <div className="mt-5">
                      <button
                        type="button"
                        onClick={submitTeam}
                        disabled={!editable || !profileComplete || members.length === 0 || !team.has_payment_proof || !rosterSizeFinal || team.approval_status === 'pending_approval' || Boolean(busyAction)}
                        className={TRAIL_BUTTON}
                      >
                        <Icon name="checkPlain" className="h-4 w-4" />
                        {busyAction === 'submit-team' ? 'Đang gửi...' : 'Gửi duyệt'}
                      </button>
                    </div>
                    {editable && !rosterSizeFinal && (
                      <p className="mt-2 text-xs leading-5 text-[#9A6B12]">
                        Đội cần từ {minMembers} đến {maxMembers} người mới gửi duyệt được. Hiện {team?.member_count ?? members.length}/{maxMembers}.
                      </p>
                    )}
                    {editable && !team.has_payment_proof && (
                      <p className="mt-2 text-xs leading-5 text-[#9A6B12]">
                        Cần upload minh chứng thanh toán ở bước Thanh toán trước khi gửi duyệt.
                      </p>
                    )}
                    {apiError && (
                      <div className="mt-3 rounded-lg border border-[#D6492B]/25 bg-[#D6492B]/[0.06] px-4 py-3 text-sm text-[#D6492B]">
                        {apiError}
                      </div>
                    )}
                    <div className="mt-5">
                      <StepNav onBack={() => gotoStep('payment')} />
                    </div>
                  </div>
                )}

                {/* BƯỚC 6 — ĐƯỢC DUYỆT */}
                {activeStep === 'approved' && (
                  <div className={`${PARTICIPANT_CARD} p-5`}>
                    <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Bước 6</p>
                    <h2 className="mt-1 font-display text-xl font-bold text-ink">Đội đã được duyệt</h2>
                    <p className="mt-3 text-sm leading-6 text-ink/55">
                      Đội của bạn đã được BTC duyệt. Theo dõi Discord và thông báo từ BTC để nhận lịch.
                    </p>
                    <div className="mt-5">
                      <StepNav onBack={() => gotoStep('payment')} />
                    </div>
                  </div>
                )}
              </>
            ) : teamEditingOpen && team && !isFullyApproved ? (
              <>
              <PaymentSection team={team} editable={editable} isCaptain={amCaptain} onProofChange={loadDashboard} />
              <div id="team-editor" className={`${PARTICIPANT_CARD} p-5`}>
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

                <div className="mt-5">
                  <Field
                    label="Tên đội"
                    value={teamNameDraft}
                    disabled={(!editable && !team?.naming_allowed) || !canRenameTeam}
                    onChange={setTeamNameDraft}
                    required
                  />
                  {!canRenameTeam ? (
                    <p className="mt-1 text-xs leading-5 text-ink/45">{teamNameHint}</p>
                  ) : captainShouldNameTeam ? (
                    <p className="mt-1 text-xs leading-5 text-[#9A6B12]">
                      Đội vừa bầu xong và vẫn đang lấy mã đội làm tên. Bạn là đội trưởng — hãy đặt
                      tên chính thức cho đội.
                    </p>
                  ) : null}
                </div>
                {editable && canRenameTeam && teamNameDraft.trim() && teamNameDraft !== team.team_name && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => withBusy('save-team-name', saveTeamNameIfNeeded)}
                      disabled={Boolean(busyAction)}
                      className={SECONDARY_BUTTON}
                    >
                      <Icon name="checkPlain" className="h-4 w-4" />
                      Lưu tên đội
                    </button>
                  </div>
                )}

                <div className="mt-5 rounded-lg border border-[#DCD8CC] bg-[#F3F4F1]/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-ink">Tiến độ thành viên</p>
                    <p className="font-mono text-xs text-ink/45">{members.length}/{maxMembers}</p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                    <div className="h-full" style={{ width: `${Math.min(100, (members.length / maxMembers) * 100)}%`, backgroundColor: status.color }} />
                  </div>
                  <p className="mt-2 text-xs text-ink/45">
                    Thành viên chỉ nhìn thấy tên, MSSV và trường của nhau.
                  </p>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={submitTeam}
                    disabled={!editable || !profileComplete || members.length === 0 || !team.has_payment_proof || !rosterSizeFinal || team.approval_status === 'pending_approval' || Boolean(busyAction)}
                    className={TRAIL_BUTTON}
                  >
                    <Icon name="checkPlain" className="h-4 w-4" />
                    {busyAction === 'submit-team' ? 'Đang gửi...' : 'Gửi duyệt'}
                  </button>
                  {/* Thêm thành viên chỉ được thao tác ở mục Thành viên. Tại bước
                      Thanh toán/Gửi duyệt chỉ cho điều hướng về đó — không thêm
                      trực tiếp ở khu vực này. */}
                  {editable && members.length < maxMembers && (
                    <button
                      type="button"
                      onClick={() => document.getElementById('team-members')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className={SECONDARY_BUTTON}
                    >
                      <Icon name="chevronR" className="h-4 w-4" />
                      Đến mục Thành viên để thêm
                    </button>
                  )}
                </div>
                {editable && !rosterSizeFinal && (
                  <p className="mt-2 text-xs leading-5 text-[#9A6B12]">
                    Đội cần từ {minMembers} đến {maxMembers} người mới gửi duyệt được. Hiện {team?.member_count ?? members.length}/{maxMembers}.
                  </p>
                )}
                {editable && !team.has_payment_proof && (
                  <p className="mt-2 text-xs leading-5 text-[#9A6B12]">
                    Cần upload minh chứng thanh toán ở bước Thanh toán trước khi gửi duyệt.
                  </p>
                )}
                {apiError && (
                  <div className="mt-3 rounded-lg border border-[#D6492B]/25 bg-[#D6492B]/[0.06] px-4 py-3 text-sm text-[#D6492B]">
                    {apiError}
                  </div>
                )}
              </div>
              </>
            ) : (
              <div className={`${PARTICIPANT_CARD} p-5`}>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Phase hiện tại</p>
                <h2 className="mt-1 font-display text-lg font-bold text-ink">
                  {experience?.current_phase_label || currentPhase}
                </h2>
                <p className="mt-3 text-sm leading-6 text-ink/55">
                  Giai đoạn đăng ký đã đóng.
                </p>
              </div>
            )}

            {registrationOpen && activeStep === 'members' ? (
            <div className={`${PARTICIPANT_CARD} overflow-hidden`}>
              <div id="team-members" className="flex items-center justify-between gap-3 border-b border-[#DCD8CC] px-5 py-4">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Danh sách</p>
                  <h2 className="mt-1 font-display text-lg font-bold text-ink">Thành viên đội</h2>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-ink/40">{displayedMemberCount} người</span>
                  {editable && !rosterLocked && amCaptain && (
                    <button
                      type="button"
                      onClick={() => openMemberDialog()}
                      disabled={members.length >= maxMembers || Boolean(busyAction)}
                      className={SECONDARY_BUTTON}
                    >
                      <Icon name="plus" className="h-4 w-4" />
                      Thêm thành viên
                    </button>
                  )}
                </div>
              </div>

              <div className="divide-y divide-stone">
                {showProfileAsCaptain && (
                  <div id="captain-profile">
                    <div className={`grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center ${!profileComplete ? 'border-l-4 border-[#D6492B] bg-[#D6492B]/[0.04] pl-4' : ''}`}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className={`truncate text-sm font-semibold ${!profileComplete ? 'text-[#B93A23]' : 'text-ink'}`}>
                            {profile.full_name || user.username || 'Thông tin của bạn'}
                          </h3>
                          <Badge label="Đội trưởng" cls="bg-[#E0A23A]/15 text-[#9A6B12]" />
                          {!profileComplete && <Badge label="Thiếu thông tin" cls="bg-[#D6492B]/12 text-[#B93A23]" />}
                        </div>
                        <p className={`mt-1 text-xs ${!profileComplete ? 'font-semibold text-[#B93A23]' : 'text-ink/45'}`}>
                          {!profileComplete
                            ? 'Cần cập nhật đầy đủ thông tin trước khi tiếp tục đăng ký.'
                            : `${profile.mssv} · ${profile.school || 'Chưa có trường'}`}
                        </p>
                        {profile.email && <p className="mt-1 truncate text-xs text-ink/40">{profile.email}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setProfileDetailsOpen((open) => !open)}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${!profileComplete ? 'bg-[#D6492B] text-white hover:bg-[#B93A23]' : 'text-[#20312B]/55 hover:bg-[#F3F4F1] hover:text-[#20312B]'}`}
                      >
                        {profilePanelOpen ? 'Ẩn form' : !profileComplete ? 'Cập nhật ngay' : 'Sửa'}
                      </button>
                    </div>
                    <CaptainProfileEditor
                      profile={profile}
                      fields={personFields}
                      open={profilePanelOpen}
                      saved={profileSaved}
                      saving={busyAction === 'save-profile'}
                      error={profileError}
                      onPatch={(patch) => setProfile((current) => ({ ...current, ...patch }))}
                      onSave={saveProfile}
                    />
                  </div>
                )}

                {members.map((member, index) => {
                  const isIncompleteCaptain = member.is_captain && !profileComplete
                  return (
                    <div key={`${member.mssv}-${index}`} id={member.is_captain ? 'captain-profile' : undefined}>
                      <div className={`grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center ${isIncompleteCaptain ? 'border-l-4 border-[#D6492B] bg-[#D6492B]/[0.04] pl-4' : ''}`}>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className={`truncate text-sm font-semibold ${isIncompleteCaptain ? 'text-[#B93A23]' : 'text-ink'}`}>{member.full_name}</h3>
                            {member.is_captain && <Badge label="Đội trưởng" cls="bg-[#E0A23A]/15 text-[#9A6B12]" />}
                            {isIncompleteCaptain && <Badge label="Thiếu thông tin" cls="bg-[#D6492B]/12 text-[#B93A23]" />}
                            {typeof member.has_account === 'boolean' && !isIncompleteCaptain && (
                              <Badge
                                label={member.has_account ? 'Đã có tài khoản' : 'Chưa có tài khoản'}
                                cls={member.has_account ? 'bg-[#1F7A6B]/12 text-[#1F7A6B]' : 'bg-[#20312B]/[0.06] text-[#20312B]/40'}
                              />
                            )}
                          </div>
                          {isIncompleteCaptain ? (
                            <p className="mt-1 text-xs font-semibold text-[#B93A23]">
                              Cần cập nhật đầy đủ thông tin trước khi gửi duyệt.
                            </p>
                          ) : (
                            <p className="mt-1 font-mono text-xs text-ink/45">
                              {member.mssv} · {member.school || 'Chưa có trường'}
                            </p>
                          )}
                          {member.email && <p className="mt-1 truncate text-xs text-ink/40">{member.email}</p>}
                        </div>
                        <div className="flex items-center gap-1 sm:justify-end">
                          {member.is_captain ? (
                            <button
                              type="button"
                              onClick={() => setProfileDetailsOpen((open) => !open)}
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${isIncompleteCaptain ? 'bg-[#D6492B] text-white hover:bg-[#B93A23]' : 'text-[#20312B]/55 hover:bg-[#F3F4F1] hover:text-[#20312B]'}`}
                            >
                              {profilePanelOpen ? 'Ẩn form' : isIncompleteCaptain ? 'Cập nhật ngay' : 'Sửa'}
                            </button>
                          ) : (
                            <>
                              {member.email && (amCaptain || member.mssv === myMssv) && (
                                <button
                                  type="button"
                                  onClick={() => openMemberDialog(index)}
                                  disabled={!editable || Boolean(busyAction)}
                                  className="rounded-md px-3 py-1.5 text-xs font-semibold text-[#20312B]/55 transition hover:bg-[#F3F4F1] hover:text-[#20312B] disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Sửa
                                </button>
                              )}
                              {amCaptain && (
                                <button
                                  type="button"
                                  onClick={() => removeMember(index)}
                                  disabled={!editable || Boolean(busyAction)}
                                  className="rounded-md p-1.5 text-[#20312B]/25 transition hover:bg-[#D6492B]/10 hover:text-[#D6492B] disabled:cursor-not-allowed disabled:opacity-30"
                                  aria-label="Xóa thành viên"
                                >
                                  <Icon name="trash" className="h-4 w-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {member.is_captain && (
                        <CaptainProfileEditor
                          profile={profile}
                          fields={personFields}
                          open={profilePanelOpen}
                          saved={profileSaved}
                          saving={busyAction === 'save-profile'}
                          error={profileError}
                          onPatch={(patch) => setProfile((current) => ({ ...current, ...patch }))}
                          onSave={saveProfile}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="border-t border-[#DCD8CC] px-5 py-4">
                <StepNav
                  onBack={() => gotoStep('profile')}
                  onNext={() => gotoStep('team')}
                  nextDisabled={!stepUnlocked('team')}
                  hint={members.length === 0 ? 'Thêm ít nhất một thành viên để sang bước Đội.' : undefined}
                />
              </div>
            </div>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-5">
            <div className={`${PARTICIPANT_CARD} p-5`}>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink/35">Ngày thi</p>
              <h2 className="mt-1 font-display text-lg font-bold text-ink">Checklist nhanh</h2>
              <div className="mt-4 space-y-3">
                {[
                  ['Hồ sơ đội trưởng đầy đủ', profileComplete],
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
                {team?.approval_status === 'approved'
                  ? 'Đội đã được duyệt. BTC sẽ tiếp tục đồng bộ Discord và các thông tin vận hành liên quan đến ngày thi.'
                  : 'Sau khi đội được duyệt, hệ thống sẽ tạo Discord role và kênh đội. Thành viên chưa có tài khoản cần đăng ký bằng email hoặc MSSV đã khai báo.'}
                {team?.submitted_at ? ` Gửi duyệt lúc ${formatDateTime(team.submitted_at)}.` : ''}
              </div>
            </div>
          </aside>
        </section>
        )}
          </>
        )}
      </main>

      <MemberModal
        form={memberForm}
        fields={personFields}
        editing={memberDialog?.index !== null}
        saving={busyAction === 'save-member'}
        draft={memberDraft}
        error={apiError}
        onChange={setMemberForm}
        onClose={closeMemberDialog}
        onSave={saveMember}
      />

      <PaymentConfirmModal
        open={confirmOpen}
        teamName={teamNameDraft.trim() || team?.team_name}
        members={members}
        maxMembers={maxMembers}
        paymentInfo={confirmPayment}
        paymentLoading={confirmPaymentLoading}
        busy={busyAction === 'confirm-team'}
        error={apiError}
        onConfirm={confirmTeamForPayment}
        onClose={() => setConfirmOpen(false)}
        skipPayment={team?.approval_status === 'approved'}
      />
    </div>
  )
}

export default ParticipantDashboard
