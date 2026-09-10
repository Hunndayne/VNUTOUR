import { useEffect, useMemo, useState } from 'react'
import { buildAccountDetailsPatch, getAccountDetailsForm, getEditableExtraFields, validateAccountDetailsPatch } from './accountDetailsForm.js'

const INPUT_CLASS = 'w-full rounded-lg border border-stone bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-trail/50 focus:ring-2 focus:ring-trail/10 disabled:bg-paper disabled:text-ink/50'
const ACCOUNT_FIELDS = [
  { key: 'full_name', label: 'Họ tên', maxLength: 255 },
  { key: 'email', label: 'Email đăng nhập', type: 'email', maxLength: 255 },
  { key: 'mssv', label: 'MSSV', maxLength: 20 },
  { key: 'phone', label: 'Số điện thoại', type: 'tel', maxLength: 20 },
  { key: 'school', label: 'Trường', maxLength: 255 },
  { key: 'faculty', label: 'Khoa', maxLength: 255 },
  { key: 'avatar', label: 'Địa chỉ ảnh đại diện', maxLength: 500 },
]
const PROFILE_FIELDS = [
  { key: 'cccd', label: 'CCCD', maxLength: 20 },
  { key: 'date_of_birth', label: 'Ngày sinh', type: 'date' },
  { key: 'facebook', label: 'Facebook', maxLength: 255 },
]

function FormSection({ title, children }) {
  return <section className="rounded-xl border border-stone bg-white p-5">
    <h3 className="mb-4 border-b border-stone/60 pb-3 font-display text-base font-semibold text-ink">{title}</h3>
    {children}
  </section>
}

function EditField({ field, value, onChange, prefix = 'account' }) {
  const id = `${prefix}-edit-${field.key}`
  const options = (Array.isArray(field.options) ? field.options : []).flatMap(option => {
    const item = typeof option === 'object' && option !== null ? option : { value: option, label: option }
    return item.value === null || item.value === undefined ? [] : [{ value: String(item.value), label: String(item.label ?? item.value) }]
  })
  const isSelect = field.type === 'select' && options.length > 0
  const inputType = ['email', 'date', 'tel', 'number'].includes(field.type) ? field.type : 'text'
  return <label htmlFor={id} className="block min-w-0">
    <span className="mb-1.5 block text-xs font-medium text-ink/65">{field.label}</span>
    {field.type === 'boolean' ? <select id={id} className={INPUT_CLASS} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Chưa có</option>
      <option value="true">Có</option>
      <option value="false">Không</option>
    </select> : isSelect ? <select id={id} className={INPUT_CLASS} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Chưa có</option>
      {value && !options.some(option => option.value === value) && <option value={value}>{value} (giá trị hiện tại)</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select> : field.type === 'textarea' ? <textarea id={id} className={INPUT_CLASS} value={value} rows={3}
      onChange={event => onChange(event.target.value)} /> : <input id={id} type={inputType} className={INPUT_CLASS} value={value}
      maxLength={field.maxLength} step={inputType === 'number' ? 'any' : undefined}
      onChange={event => onChange(event.target.value)} />}
  </label>
}

export default function AccountDetailsEditor({ details, canGrantMasterAdmin, saving, onSave, onDirtyChange }) {
  // Sensitive fields and password drafts stay in this mounted form only.
  const [form, setForm] = useState(() => getAccountDetailsForm(details))
  const [touched, setTouched] = useState({})
  const [validationError, setValidationError] = useState('')
  const extraFields = useMemo(() => getEditableExtraFields(details), [details])
  const patch = useMemo(() => buildAccountDetailsPatch(details, form, touched), [details, form, touched])
  const dirty = Object.keys(patch).length > 0
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  const changeField = (key, value) => {
    setForm(previous => ({ ...previous, [key]: value }))
    setTouched(previous => ({ ...previous, [key]: true }))
    setValidationError('')
  }
  const changeExtra = (key, value) => {
    setForm(previous => ({ ...previous, extra: { ...previous.extra, [key]: value } }))
    setTouched(previous => ({ ...previous, [`extra.${key}`]: true }))
    setValidationError('')
  }
  const submit = event => {
    event.preventDefault()
    if (saving || !dirty) return
    const invalid = validateAccountDetailsPatch(patch, details)
    setValidationError(invalid)
    if (!invalid) onSave(patch)
  }
  const extra = details.participant?.extra
  const canEditExtra = extra == null || (typeof extra === 'object' && !Array.isArray(extra))
  const hasStructuredExtra = canEditExtra && extra && Object.values(extra).some(value => value !== null && typeof value === 'object')

  return <form id="account-details-editor" noValidate onSubmit={submit} className="space-y-4">
    {validationError && <p role="alert" className="rounded-lg border border-clay/20 bg-clay/10 p-4 text-sm text-clay">{validationError}</p>}
    <fieldset disabled={saving} className="min-w-0 space-y-4">
      <FormSection title="Thông tin tài khoản">
        {details.participant && <p className="mb-4 text-sm leading-relaxed text-ink/60">
          Họ tên, email, MSSV, số điện thoại, trường và khoa khi sửa sẽ được cập nhật cho cả tài khoản và hồ sơ đã liên kết.
        </p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ACCOUNT_FIELDS.map(field => <EditField key={field.key} field={field} value={form[field.key]} onChange={value => changeField(field.key, value)} />)}
        </div>
      </FormSection>
      <FormSection title="Quyền và đăng nhập">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label htmlFor="account-edit-role" className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink/65">Vai trò</span>
            <select id="account-edit-role" value={form.role} onChange={event => changeField('role', event.target.value)} className={INPUT_CLASS}>
              {canGrantMasterAdmin && <option value="master_admin">Master admin</option>}
              <option value="admin">Admin</option>
              <option value="collab">Collab</option>
              <option value="participant">Participant</option>
            </select>
          </label>
          <label htmlFor="account-edit-password" className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink/65">Mật khẩu mới</span>
            <input id="account-edit-password" type="password" autoComplete="new-password" value={form.password}
              onChange={event => changeField('password', event.target.value)} className={INPUT_CLASS}
              aria-describedby="account-edit-password-help" />
            <span id="account-edit-password-help" className="mt-1.5 block text-xs text-ink/50">Để trống để giữ nguyên mật khẩu.</span>
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-ink/75">
          <input type="checkbox" checked={form.is_active} onChange={event => changeField('is_active', event.target.checked)}
            className="h-4 w-4 rounded border-stone text-trail focus:ring-trail" />
          Tài khoản hoạt động
        </label>
      </FormSection>
      <FormSection title="Hồ sơ đăng ký">
        {details.participant ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PROFILE_FIELDS.map(field => <EditField key={field.key} field={field} value={form[field.key]} onChange={value => changeField(field.key, value)} />)}
        </div> : <p className="text-sm text-ink/55">Tài khoản chưa liên kết hồ sơ đăng ký. Có thể chỉnh sửa thông tin tài khoản ở phía trên.</p>}
      </FormSection>
      {details.participant && (extraFields.length > 0 || !canEditExtra || hasStructuredExtra) && <FormSection title="Thông tin đăng ký bổ sung">
        {canEditExtra ? <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {extraFields.map(field => <EditField key={field.key} prefix="extra" field={field} value={form.extra[field.key]}
              onChange={value => changeExtra(field.key, value)} />)}
          </div>
          {hasStructuredExtra && <p className="mt-4 text-xs leading-relaxed text-ink/55">Các mục gồm nhiều giá trị được giữ nguyên khi lưu.</p>}
        </> : <p className="text-sm text-ink/55">Thông tin bổ sung cũ cần được đối chiếu trước khi chỉnh sửa.</p>}
      </FormSection>}
      {details.team && <p className="px-1 text-sm text-ink/55">Đội hiện tại: <span className="font-medium text-ink">{details.team.name}</span>. Quản lý thành viên tại trang Đội.</p>}
    </fieldset>
  </form>
}
