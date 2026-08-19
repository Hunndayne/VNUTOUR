import { useCallback, useRef, useState } from 'react'

/**
 * Tín hiệu form cho lớp chống bot: mốc thời gian form mở (time-trap) và giá
 * trị honeypot. `signals()` trả payload gửi kèm mỗi POST; `resetClock()` gọi
 * khi chuyển bước/mở lại form để thời gian tính lại từ đầu.
 */
export function useFormSignals() {
  const [honeypot, setHoneypot] = useState('')
  const openedAtRef = useRef(Date.now())

  const signals = useCallback(
    () => ({ company: honeypot, elapsed_ms: Date.now() - openedAtRef.current }),
    [honeypot],
  )
  const resetClock = useCallback(() => { openedAtRef.current = Date.now() }, [])

  return { honeypot, setHoneypot, signals, resetClock }
}

/** Thông báo tiếng Việt cho các mã lỗi chống bot từ backend. */
export const ANTIBOT_ERROR_TEXT = {
  turnstile_required: 'Vui lòng hoàn thành bước xác minh chống bot.',
  turnstile_invalid: 'Xác minh chống bot không thành công. Vui lòng thử lại.',
  turnstile_unreachable: 'Không kết nối được máy chủ xác minh. Vui lòng thử lại sau ít phút.',
  turnstile_error: 'Xác minh chống bot bị lỗi. Vui lòng thử lại.',
  turnstile_script_failed: 'Không tải được công cụ xác minh. Kiểm tra kết nối rồi thử lại.',
  bot_detected: 'Hệ thống phát hiện dấu hiệu thao tác tự động. Vui lòng điền lại form.',
  too_fast: 'Bạn nộp nhanh quá. Vui lòng chờ vài giây rồi thử lại.',
}

export const ANTIBOT_ERROR_CODES = new Set(Object.keys(ANTIBOT_ERROR_TEXT))
