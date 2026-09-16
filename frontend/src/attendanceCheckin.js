export function normalizeMinCheckinMembers(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

export function attendanceQrStatus(payload) {
  if (!payload) return 'loading'
  if (payload.checked_out) return 'checked_out'
  if (payload.checked_in) return 'checked_in'
  if (!payload.enabled) return 'disabled'
  if (payload.payload) return 'ready'
  return 'unavailable'
}

export function attendanceProgress(payload) {
  const checkedIn = Number(payload?.checked_in_count) || 0
  const requiredValue = Number(payload?.required_count)
  const required = Number.isInteger(requiredValue) && requiredValue > 0 ? requiredValue : 0
  return { checkedIn, required, eligible: Boolean(payload?.eligible) }
}
