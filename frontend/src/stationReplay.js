export function canReplay(station) {
  return typeof station?.can_replay === 'boolean'
    ? station.can_replay
    : station?.replay_locked === false
}

export function explainReplayLock(reason) {
  const messages = {
    passed: 'Đội đã đạt trạm này nên không thể chơi lại.',
    incomplete: 'Đội phải đi hết tất cả các trạm khác rồi mới được quay lại trạm này.',
    attempts_exhausted: 'Đội đã dùng hết số lượt chơi của trạm này.',
    pending_result: 'Đội đang trong một lượt chơi chưa kết thúc ở trạm này.',
  }
  return messages[reason] || 'Trạm này hiện đang khóa lượt chơi lại.'
}

export function attemptLabel(station) {
  if (typeof station?.attempts_used !== 'number') return ''
  const count = station.attempts_used
  // Lượt còn lại chỉ có nghĩa khi đội thật sự dùng được. Trạm đã đạt (hoặc
  // đang chờ chấm) vẫn còn số dư trên giấy nhưng bị khoá — in ra "Còn 2 lượt"
  // ngay cạnh dòng "không thể chơi lại" thì hai câu đá nhau.
  const spendable = count === 0 || station.can_replay !== false
  if (station.max_attempts == null) {
    return spendable
      ? `Đã chơi ${count} lượt · Không giới hạn số lượt`
      : `Đã chơi ${count} lượt`
  }
  return spendable
    ? `Đã chơi ${count}/${station.max_attempts} lượt · Còn ${station.attempts_remaining ?? 0} lượt`
    : `Đã chơi ${count}/${station.max_attempts} lượt`
}

// The polled detail owns live rights. Never merge a late response for another station.
export function withReplayState(station, state) {
  if (!station || !state || state.station_id !== station.station_id) return station
  const next = { ...station }
  for (const key of ['can_replay', 'replay_locked', 'replay_reason', 'attempts_used', 'max_attempts', 'attempts_remaining', 'replay_after_all', 'all_visited']) {
    if (Object.prototype.hasOwnProperty.call(state, key)) next[key] = state[key]
  }
  return next
}
