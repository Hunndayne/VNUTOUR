// Điểm thử thách của một lượt tại trạm: giá trị ô nhập <-> payload API.

export function challengeInitialValues(challenges, saved) {
  const stored = saved && typeof saved === 'object' ? saved : {}
  return Object.fromEntries((challenges || []).map(item => {
    const value = item.id in stored ? stored[item.id] : item.points
    return [item.id, value == null ? '' : value]
  }))
}

export function isValidPoints(value, max) {
  if (value === '' || value == null) return true
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n <= max
}

export function challengeValuesValid(challenges, values) {
  return (challenges || []).every(item => isValidPoints(values?.[item.id], item.maxPoints))
}

export function challengeSum(challenges, values) {
  return (challenges || []).reduce((total, item) => {
    const value = values?.[item.id]
    return total + (value === '' || value == null ? 0 : Number(value) || 0)
  }, 0)
}

export function challengeMaxSum(challenges) {
  return (challenges || []).reduce((total, item) => total + (Number(item.maxPoints) || 0), 0)
}

/** `{id: points}` for the API; an empty box clears that challenge's score. */
export function challengePayload(challenges, values) {
  return Object.fromEntries((challenges || []).map(item => {
    const value = values?.[item.id]
    return [item.id, value === '' || value == null ? null : Number(value)]
  }))
}

export function fillChallenges(challenges, full) {
  return Object.fromEntries((challenges || []).map(item => [item.id, full ? item.maxPoints : 0]))
}
