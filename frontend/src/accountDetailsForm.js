const SHARED_FIELDS = ['email', 'mssv', 'full_name', 'phone', 'school', 'faculty']
const ACCOUNT_FIELDS = [...SHARED_FIELDS, 'avatar', 'role', 'is_active']
const PROFILE_FIELDS = ['facebook', 'cccd', 'date_of_birth']
const PROFILE_PREFERRED = new Set(['phone', 'school', 'faculty'])
const FIELD_LABELS = {
  email: 'Email', mssv: 'MSSV', full_name: 'Họ tên', phone: 'Số điện thoại',
  school: 'Trường', faculty: 'Khoa', avatar: 'Địa chỉ ảnh đại diện',
  facebook: 'Facebook', cccd: 'CCCD', date_of_birth: 'Ngày sinh',
  role: 'Vai trò', is_active: 'Trạng thái', password: 'Mật khẩu mới', extra: 'Thông tin đăng ký bổ sung',
}
const FIELD_LIMITS = {
  email: 255, mssv: 20, full_name: 255, phone: 20, school: 255,
  faculty: 255, avatar: 500, facebook: 255, cccd: 20,
}
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isPrimitive = value => value === null || ['string', 'number', 'boolean'].includes(typeof value)
const text = value => value === null || value === undefined ? '' : String(value)

function normalized(field, value) {
  if (field === 'is_active') return Boolean(value)
  const result = text(value).trim()
  if (field === 'email') return result.toLowerCase()
  if (field === 'mssv') return result.toUpperCase()
  return result
}

export function getEditableExtraFields(details) {
  const stored = isRecord(details.participant?.extra) ? details.participant.extra : {}
  const fields = new Map()
  for (const field of details.extra_fields || []) {
    if (!field || typeof field.key !== 'string' || !field.key) continue
    fields.set(field.key, { ...field, label: field.label || field.key })
  }
  for (const [key, value] of Object.entries(stored)) {
    if (!fields.has(key) && isPrimitive(value)) {
      fields.set(key, { key, label: details.extra_labels?.[key] || key })
    }
  }
  return [...fields.values()].filter(field => !(field.key in stored) || isPrimitive(stored[field.key])).map(field => {
    const value = stored[field.key]
    let type = field.type || 'text'
    if (typeof value === 'boolean' || ['checkbox', 'boolean'].includes(type)) type = 'boolean'
    else if (typeof value === 'number') type = 'number'
    return { ...field, type }
  })
}

export function getAccountDetailsForm(details) {
  const account = details.account || {}
  const profile = details.participant
  const form = { password: '', extra: {} }
  for (const field of ACCOUNT_FIELDS) {
    const value = PROFILE_PREFERRED.has(field) && profile?.[field] ? profile[field] : account[field]
    form[field] = field === 'is_active' ? Boolean(value) : text(value)
  }
  for (const field of PROFILE_FIELDS) form[field] = text(profile?.[field])
  for (const field of getEditableExtraFields(details)) form.extra[field.key] = text(profile?.extra?.[field.key])
  return form
}

// Only deliberate edits are sent. Comparing both linked records allows an admin
// to reconcile a profile value even when the chosen value equals the account.
export function buildAccountDetailsPatch(details, form, touched = {}) {
  const patch = {}
  for (const field of ACCOUNT_FIELDS) {
    if (!touched[field]) continue
    const value = normalized(field, form[field])
    const differentFromAccount = value !== normalized(field, details.account?.[field])
    const differentFromProfile = details.participant && SHARED_FIELDS.includes(field)
      && value !== normalized(field, details.participant[field])
    if (differentFromAccount || differentFromProfile) patch[field] = value
  }
  if (touched.password && form.password) patch.password = form.password
  if (details.participant) {
    for (const field of PROFILE_FIELDS) {
      if (!touched[field]) continue
      const value = normalized(field, form[field])
      if (value !== normalized(field, details.participant[field])) patch[field] = value
    }
    const changes = {}
    for (const field of getEditableExtraFields(details)) {
      if (!touched[`extra.${field.key}`]) continue
      const input = form.extra[field.key]
      const original = details.participant.extra?.[field.key]
      let value = text(input)
      if (field.type === 'number') value = input === '' ? null : Number(input)
      if (field.type === 'boolean') value = input === '' ? null : input === 'true'
      if (value !== original && !(original == null && value === '')) changes[field.key] = value
    }
    if (Object.keys(changes).length) patch.extra = changes
  }
  return patch
}

export function validateAccountDetailsPatch(patch, details) {
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (patch[field]?.length > limit) return `${FIELD_LABELS[field]} không được vượt quá ${limit} ký tự.`
  }
  if ('email' in patch && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) return 'Vui lòng nhập địa chỉ email hợp lệ.'
  if ('mssv' in patch && !patch.mssv && details.participant) return 'Hồ sơ đã liên kết cần có MSSV.'
  if (patch.password && patch.password.length < 8) return 'Mật khẩu mới cần ít nhất 8 ký tự.'
  if (patch.date_of_birth) {
    const date = new Date(`${patch.date_of_birth}T00:00:00`)
    const [year, month, day] = patch.date_of_birth.split('-').map(Number)
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() + 1 !== month
      || date.getDate() !== day || date > new Date()) return 'Ngày sinh phải là ngày hợp lệ và không ở tương lai.'
  }
  for (const value of Object.values(patch.extra || {})) {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'Thông tin đăng ký bổ sung có giá trị số không hợp lệ.'
  }
  return ''
}

export function explainAccountSaveError(error, details) {
  const code = error?.data?.error || error?.message
  const messages = {
    conflict: 'Email hoặc MSSV đã tồn tại. Vui lòng đối chiếu tài khoản và hồ sơ đăng ký.',
    account_email_conflict: 'Email này đang được tài khoản khác sử dụng, kể cả tài khoản đã khóa. Chưa lưu thay đổi.',
    account_mssv_conflict: 'MSSV này đang được tài khoản khác sử dụng, kể cả tài khoản đã khóa. Chưa lưu thay đổi.',
    participant_identity_conflict: 'Email hoặc MSSV này thuộc hồ sơ thí sinh khác. Chưa lưu thay đổi.',
    identity_review_required: 'Liên kết tài khoản và hồ sơ cần được đối chiếu trước khi sửa thông tin định danh. Chưa lưu thay đổi.',
    linked_profile_mssv_required: 'Không thể xóa MSSV của tài khoản đã liên kết hồ sơ đăng ký.',
    master_admin_required: 'Chỉ Master admin mới được chỉnh sửa tài khoản hoặc cấp vai trò Master admin.',
    password_too_short: 'Mật khẩu mới chưa đủ độ dài yêu cầu.',
    invalid_email: 'Địa chỉ email không hợp lệ.',
    invalid_date_of_birth: 'Ngày sinh không hợp lệ hoặc ở tương lai.',
    invalid_profile_extra: 'Thông tin đăng ký bổ sung không hợp lệ. Vui lòng kiểm tra lại các giá trị đã nhập.',
    profile_not_linked: 'Tài khoản chưa liên kết hồ sơ đăng ký nên chưa thể sửa thông tin hồ sơ.',
    profile_extra_review_required: 'Thông tin bổ sung cũ cần được đối chiếu trước khi chỉnh sửa. Các giá trị đã nhập vẫn được giữ lại.',
    edit_session_expired: 'Phiên chỉnh sửa đã hết hạn. Hãy tải lại chi tiết để đối chiếu trước khi sửa tiếp; các giá trị đang nhập vẫn được giữ lại.',
    account_changed: 'Tài khoản hoặc hồ sơ đã được người khác cập nhật. Hãy tải lại để đối chiếu trước khi lưu; các giá trị đang nhập vẫn được giữ lại.',
    invalid_encrypted_request: 'Không thể xác minh dữ liệu chỉnh sửa đã mã hóa. Hãy tải lại chi tiết và thử lại.',
    forbidden: 'Bạn không có quyền chỉnh sửa tài khoản này.',
    not_found: 'Không tìm thấy tài khoản này. Có thể tài khoản đã được đổi tên hoặc xóa.',
  }
  if (code === 'invalid_field') {
    const key = error?.data?.field
    const label = FIELD_LABELS[key] || details?.extra_labels?.[key] || key || 'Thông tin'
    return `${label} không hợp lệ. Vui lòng kiểm tra lại giá trị đã nhập.`
  }
  if (messages[code]) return messages[code]
  if (error?.status === 403) return messages.forbidden
  if (error?.status === 404) return messages.not_found
  return 'Chưa xác nhận được kết quả lưu. Kiểm tra kết nối và tải lại chi tiết trước khi thử lưu lại.'
}
