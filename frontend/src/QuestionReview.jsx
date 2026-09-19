import { useEffect, useState } from 'react'
import { apiRequest, formatDateTime } from './api.js'

const answerText = value => Array.isArray(value) ? value.join(' / ') : String(value ?? '')

export function QuizSummary({ result, score }) {
  if (!result && score == null) return null
  return (
    <div className="my-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-xl bg-trail/10 px-4 py-4 text-trail" aria-live="polite">
      {result && result.total > 0 && <p><strong className="font-mono text-2xl">{result.correct_count}/{result.total}</strong> câu đúng</p>}
      {result && result.total === 0 && <p>Bài cần được coop chấm.</p>}
      {result?.total > 0 && result?.manual_count > 0 && <p className="text-sm">Còn {result.manual_count} câu chấm thủ công.</p>}
      <p className="text-sm">{score != null ? <>Điểm ghi nhận: <strong>{score}</strong></> : 'Chưa ghi nhận điểm'}</p>
    </div>
  )
}

export function AnswerReview({ items = [] }) {
  if (!items.length) return <p className="py-4 text-sm text-ink/60">Bài nộp này chưa có bản lưu đáp án chi tiết.</p>
  return <div className="divide-y divide-stone">
    {items.map((item, index) => <article key={item.id} className="py-5 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <h3 className="whitespace-pre-wrap text-base font-semibold text-ink">{index + 1}. {item.question}</h3>
        <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${item.is_correct === true ? 'bg-trail/10 text-trail' : item.is_correct === false ? 'bg-clay/10 text-clay' : 'bg-paper text-ink/60'}`}>
          {item.is_correct === true ? 'Đúng' : item.is_correct === false ? 'Sai' : 'Chấm thủ công'}
        </span>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-stone p-3">
          <dt className="text-xs font-medium text-ink/60">Đội chọn / trả lời</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{answerText(item.selected_answer) || 'Chưa trả lời'}</dd>
        </div>
        <div className="rounded-lg bg-trail/5 p-3">
          <dt className="text-xs font-medium text-trail">Đáp án đúng</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{answerText(item.correct_answer) || 'Theo hướng dẫn chấm của trạm'}</dd>
        </div>
      </dl>
      <div className="mt-3 border-l-2 border-trail/30 pl-3">
        <p className="text-xs font-semibold text-ink/70">Giải thích</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-ink/75">{item.explanation || 'Chưa có giải thích cho câu này.'}</p>
      </div>
    </article>)}
  </div>
}

export default function QuestionHistory() {
  const [attempts, setAttempts] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let inFlight = false
    const load = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const data = await apiRequest('/my-team/question-history')
        if (active) { setAttempts(data.attempts || []); setError('') }
      } catch (err) { if (active) setError(err.message || 'Không tải được lịch sử. Đang thử lại…') }
      finally { inFlight = false }
    }
    load()
    const timer = setInterval(load, 10000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  return <section className="space-y-4">
    <div>
      <h2 className="font-display text-xl font-semibold text-ink">Lịch sử câu hỏi</h2>
      <p className="mt-1 text-sm leading-6 text-ink/60">Xem lại từng lượt làm bài của đội. Đáp án và giải thích chỉ mở khi đến giờ kết thúc sự kiện.</p>
    </div>
    {error && <p role="alert" className="text-sm text-clay">{error}</p>}
    {!attempts && !error && <p className="text-sm text-ink/60">Đang tải lịch sử…</p>}
    {attempts?.length === 0 && <p className="rounded-xl border border-stone bg-white p-6 text-sm text-ink/60">Đội chưa nộp bài tại trạm nào.</p>}
    {attempts?.map(attempt => <details key={attempt.id} className="rounded-xl border border-stone bg-white p-4 sm:p-5">
      <summary className="cursor-pointer text-ink focus-visible:outline-trail">
        <span className="font-semibold">{attempt.station_name}</span>
        <span className="mt-1 block text-xs text-ink/60">{attempt.event_name} · {formatDateTime(attempt.submitted_at)}</span>
        <span className="mt-2 block text-sm text-trail">{attempt.quiz_result?.total > 0 ? `${attempt.quiz_result.correct_count}/${attempt.quiz_result.total} câu đúng` : 'Chấm thủ công'} · {attempt.review.available ? 'Xem đáp án và giải thích' : 'Chưa mở đáp án'}</span>
      </summary>
      <QuizSummary result={attempt.quiz_result} score={attempt.score} />
      {attempt.review.available ? <AnswerReview items={attempt.review.items} /> : <p className="text-sm leading-6 text-ink/60">{attempt.review.available_at ? `Đáp án và giải thích mở lúc ${formatDateTime(attempt.review.available_at)} (giờ kết thúc sự kiện).` : 'Sự kiện chưa có giờ kết thúc. Đáp án và giải thích chưa mở.'}</p>}
    </details>)}
  </section>
}
