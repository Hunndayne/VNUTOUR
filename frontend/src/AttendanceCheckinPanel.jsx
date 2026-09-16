import { QRCodeSVG } from 'qrcode.react'
import { attendanceProgress, attendanceQrStatus } from './attendanceCheckin.js'

const CARD = 'rounded-xl border border-[#DCD8CC] bg-white shadow-[0_1px_3px_rgba(32,49,43,0.05)]'
const PRIMARY_BUTTON = 'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[#20312B] px-5 py-3 text-base font-semibold text-white transition hover:bg-[#20312B]/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45'
const SECONDARY_BUTTON = 'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-[#DCD8CC] bg-white px-5 py-3 text-base font-semibold text-[#20312B]/70 transition hover:bg-[#F3F4F1] hover:text-[#20312B] disabled:cursor-not-allowed disabled:opacity-45'

function Panel({ tone = 'gold', eyebrow, title, body, children }) {
  const chip = {
    gold: 'bg-[#E0A23A]/20 text-[#9A6B12]',
    trail: 'bg-[#1F7A6B]/14 text-[#1F7A6B]',
    clay: 'bg-[#D6492B]/14 text-[#D6492B]',
  }[tone] || 'bg-[#20312B]/[0.07] text-[#20312B]/55'

  return (
    <section className={CARD}>
      <div className="px-5 py-7 text-center sm:px-7">
        <span className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] ${chip}`}>
          {eyebrow}
        </span>
        <h2 className="mt-3 font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">{title}</h2>
        {body && <p className="mx-auto mt-3 max-w-md text-base leading-7 text-ink/60">{body}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </section>
  )
}

/**
 * Renders the event attendance QR returned for the signed-in account. The
 * parent owns fetching/polling so a failed refresh can clear the previous
 * person's identity and QR before this component renders another state.
 */
export function AttendanceCheckinPanel({ data, loading, error, onRefresh }) {
  if (!data && !error) {
    return <div className={`${CARD} px-5 py-14 text-center text-base text-ink/45`}>Đang lấy QR điểm danh...</div>
  }

  if (error) {
    return (
      <Panel tone="clay" eyebrow="Điểm danh sự kiện" title="Chưa tải được QR điểm danh" body={error}>
        <button type="button" disabled={loading} onClick={onRefresh} className={`w-full ${PRIMARY_BUTTON}`}>Thử lại</button>
      </Panel>
    )
  }

  const status = attendanceQrStatus(data)
  const individual = data?.mode === 'individual'
  const { checkedIn, required, eligible } = attendanceProgress(data)
  const participantName = data?.participant_name || 'Thành viên'
  const participantMssv = data?.mssv || ''
  const team = data?.team_name || data?.team_code || 'Đội của bạn'
  const eventName = data?.event_name || 'Event hiện tại'

  const summary = (
    <div className="rounded-xl border border-[#DCD8CC] bg-[#F3F4F1] px-4 py-3 text-left text-sm leading-6 text-[#20312B]/70">
      {individual && <p><span className="font-semibold text-ink">{participantName}</span>{participantMssv && ` · ${participantMssv}`}</p>}
      <p>{team}{data?.team_code && data.team_name ? ` · ${data.team_code}` : ''}</p>
      <p>{eventName}</p>
      {individual && required > 0 && !data?.checked_out && (
        <p className={`mt-2 font-semibold ${eligible ? 'text-[#1F7A6B]' : 'text-[#9A6B12]'}`}>
          {checkedIn}/{required} thành viên đã check-in · {eligible ? 'Đủ điều kiện vào trạm' : 'Chưa đủ điều kiện vào trạm'}
        </p>
      )}
    </div>
  )

  if (status === 'checked_out') {
    return <Panel tone="trail" eyebrow="Điểm danh sự kiện" title="Đội đã checkout" body="QR điểm danh đã được đóng sau khi checkout sự kiện.">{summary}</Panel>
  }

  if (status === 'loading') {
    return <div className={`${CARD} px-5 py-14 text-center text-base text-ink/45`}>Đang lấy QR điểm danh...</div>
  }

  if (status === 'checked_in') {
    return (
      <Panel
        tone="trail"
        eyebrow="Điểm danh sự kiện"
        title={individual ? 'Bạn đã check-in sự kiện' : 'Đội đã check-in sự kiện'}
        body={individual ? 'Lượt check-in của bạn đã được ghi nhận.' : 'Lượt check-in của đội đã được ghi nhận.'}
      >
        {summary}
      </Panel>
    )
  }

  if (status === 'disabled' || status === 'unavailable') {
    return (
      <Panel tone="gold" eyebrow="Điểm danh sự kiện" title="Điểm danh chưa mở" body="BTC chưa mở QR điểm danh cho event hiện tại. Màn hình sẽ tự cập nhật khi điểm danh được bật.">
        {summary}
      </Panel>
    )
  }

  return (
    <Panel
      tone="gold"
      eyebrow="Điểm danh sự kiện"
      title={individual ? 'QR điểm danh cá nhân' : 'QR check-in đội'}
      body={individual
        ? 'Đây là QR của riêng bạn. CTV quét mã này chỉ ghi nhận bạn, không thay cho các thành viên khác.'
        : 'Đưa QR đội này cho CTV quét để check-in cả đội theo chế độ của event.'}
    >
      {summary}
      <div className="mt-5 flex justify-center">
        <div className="rounded-2xl border-2 border-[#20312B]/10 bg-white p-4 shadow-[0_2px_12px_rgba(32,49,43,0.10)]">
          <QRCodeSVG value={data.payload} size={280} level="M" className="h-auto w-full max-w-[280px]" />
        </div>
      </div>
      <button type="button" disabled={loading} onClick={onRefresh} className={`mt-5 w-full ${SECONDARY_BUTTON}`}>
        Làm mới trạng thái điểm danh
      </button>
    </Panel>
  )
}

export default AttendanceCheckinPanel
