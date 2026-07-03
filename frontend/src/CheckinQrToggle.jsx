import { useCallback, useEffect, useState } from 'react'
import { apiRequest, formatDateTime, logoutAndRedirect } from './api.js'
import { CARD, Badge, Icon } from './ui.jsx'

export default function CheckinQrToggle() {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [apiError, setApiError] = useState('')
  const [rotatedTeams, setRotatedTeams] = useState(null)

  const load = useCallback(async () => {
    const payload = await apiRequest('/admin/checkin-qr')
    setState(payload)
  }, [])

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      try {
        setLoading(true)
        await load()
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          logoutAndRedirect('/')
          return
        }
        setApiError('Không tải được trạng thái QR điểm danh.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [load])

  const enabled = Boolean(state?.enabled)

  const toggle = async () => {
    const next = !enabled
    if (next && !window.confirm(
      'Bật điểm danh sẽ tạo QR mới cho tất cả đội trong phase hiện tại. QR cũ (kể cả ảnh đã gửi) sẽ hết hiệu lực. Tiếp tục?',
    )) return

    setBusy(true)
    setApiError('')
    setRotatedTeams(null)
    try {
      const payload = await apiRequest('/admin/checkin-qr', { method: 'POST', body: { enabled: next } })
      setState({ enabled: payload.enabled, phase_key: payload.phase_key, rotated_at: payload.rotated_at })
      if (next) setRotatedTeams(payload.rotated_teams ?? 0)
    } catch (error) {
      if (error?.status === 401) {
        logoutAndRedirect('/')
        return
      }
      setApiError(error?.data?.error === 'no_current_phase'
        ? 'Chưa đặt phase hiện tại nên không thể mở điểm danh.'
        : 'Không thể đổi trạng thái QR điểm danh.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">Điểm danh bằng QR</p>
            <Badge
              label={enabled ? 'Đang mở' : 'Đang đóng'}
              cls={enabled ? 'bg-trail/12 text-trail' : 'bg-ink/[0.07] text-ink/55'}
            />
          </div>
          <h3 className="mt-2 font-display text-xl font-semibold text-ink">
            QR điểm danh cho đội trong phase hiện tại
          </h3>
          <p className="mt-1 text-sm leading-6 text-ink/55">
            Mỗi lần bật tạo QR mới cho toàn bộ đội trong phase hiện tại (QR cũ hết hiệu lực). Mỗi đội dùng một QR cho mọi trạm.
          </p>
          {enabled && state?.rotated_at && (
            <p className="mt-1 text-xs text-ink/40">
              Mở lần cuối: {formatDateTime(state.rotated_at)}{state.phase_key ? ` · phase ${state.phase_key}` : ''}
            </p>
          )}
          {rotatedTeams != null && (
            <p className="mt-1 text-xs text-trail">Đã tạo QR mới cho {rotatedTeams} đội.</p>
          )}
          {apiError && <p className="mt-1 text-xs text-clay">{apiError}</p>}
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={loading || busy}
          className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
            enabled
              ? 'border border-stone bg-white text-ink/65 hover:bg-paper hover:text-ink'
              : 'bg-ink text-white hover:brightness-[0.92]'
          }`}
        >
          <Icon name={enabled ? 'close' : 'check'} className="h-4 w-4" />
          {busy ? 'Đang xử lý...' : enabled ? 'Đóng điểm danh' : 'Mở điểm danh (tạo QR mới)'}
        </button>
      </div>
    </div>
  )
}
