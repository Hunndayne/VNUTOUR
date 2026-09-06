import { Icon } from './ui.jsx'

export const LOW_CAPACITY_THRESHOLD = 10

export default function RegistrationCapacityNotice({ remaining, className = '' }) {
  const slots = Number(remaining)
  if (!Number.isFinite(slots) || slots <= 0 || slots > LOW_CAPACITY_THRESHOLD) return null

  return (
    <div className={`flex items-start gap-3 rounded-xl border border-[#E0A23A]/35 bg-[#E0A23A]/[0.09] px-4 py-3.5 text-[#76500B] ${className}`} role="status">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E0A23A]/20">
        <Icon name="flag" className="h-4 w-4" />
      </span>
      <div>
        <p className="text-sm font-bold">Chỉ còn {slots} suất đăng ký</p>
        <p className="mt-0.5 text-xs leading-5 text-[#76500B]/75">
          Số lượng còn lại đang rất ít. Hãy hoàn tất thông tin và gửi đăng ký sớm trước khi cổng đạt giới hạn.
        </p>
      </div>
    </div>
  )
}
