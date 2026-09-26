import { isValidPoints } from './challengeScores.js'

// Chấm điểm thử thách (hoạt động ngoài web) cho một lượt tại trạm. Coop thấy
// tên thật + hướng dẫn chấm; thí sinh chỉ bao giờ thấy "Thử thách N".

export default function ChallengeScores({ challenges, values, onChange, disabled = false }) {
  if (!challenges?.length) return null
  const setValue = (id, value) => onChange({ ...values, [id]: value })
  return (
    <div className="space-y-2" aria-label="Điểm thử thách">
      {challenges.map(item => {
        const value = values?.[item.id] ?? ''
        const valid = isValidPoints(value, item.maxPoints)
        return (
          <div key={item.id} className="rounded-lg border border-stone bg-white px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  <span className="text-ink/45">Thử thách {item.index} · </span>{item.title || 'Chưa đặt tên'}
                </p>
                {item.description && <p className="mt-0.5 whitespace-pre-line text-xs leading-5 text-ink/60">{item.description}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" disabled={disabled} onClick={() => setValue(item.id, 0)}
                  className="min-h-[40px] rounded-lg border border-clay/30 bg-white px-2.5 text-xs font-semibold text-clay disabled:opacity-50">0</button>
                <input
                  type="number" min="0" max={item.maxPoints} step="1" inputMode="numeric"
                  disabled={disabled}
                  value={value}
                  onChange={event => setValue(item.id, event.target.value)}
                  aria-label={`Điểm thử thách ${item.index}`}
                  aria-invalid={!valid}
                  className={`min-h-[40px] w-20 rounded-lg border bg-white px-2 text-center font-mono text-base focus:outline-trail ${valid ? 'border-stone' : 'border-clay text-clay'}`}
                />
                <span className="font-mono text-xs text-ink/50">/{item.maxPoints}</span>
                <button type="button" disabled={disabled} onClick={() => setValue(item.id, item.maxPoints)}
                  className="min-h-[40px] rounded-lg border border-trail/30 bg-white px-2.5 text-xs font-semibold text-trail disabled:opacity-50">Đủ {item.maxPoints}</button>
              </div>
            </div>
            {!valid && <p className="mt-1 text-xs text-clay" role="alert">Nhập số nguyên từ 0 đến {item.maxPoints}.</p>}
          </div>
        )
      })}
    </div>
  )
}
