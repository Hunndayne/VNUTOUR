import { useMemo, useState } from 'react'
import { apiRequest } from './api.js'
import { AnswerReview, QuizSummary } from './QuestionReview.jsx'
import { useItemMarks } from './itemMarks.js'

export default function CheckoutReview({ result, onSaved, onNext }) {
  const submission = result.submission
  const quiz = submission?.response_payload?.quiz_result
  const [score, setScore] = useState(result.score ?? submission?.score ?? '')
  const [savedScore, setSavedScore] = useState(result.score ?? submission?.score ?? null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const binary = result.scoringMode === 'pass_fail'
  const reviewItems = useMemo(() => submission?.answer_review || submission?.response_payload?.answer_review || [], [submission])
  // Coop's verdict per question; sent with every score save so the backend keeps them.
  const markable = !binary && reviewItems.length > 0
  const { marks, setMarks, pointsFor, markedPoints, fullPoints: allPoints, markAll, summarize } = useItemMarks(reviewItems, submission?.item_marks)
  const markedSummary = reviewItems.length > 0 && quiz ? summarize(quiz) : quiz
  const fullPoints = reviewItems.length > 0 ? allPoints : quiz?.max_points
  const markQuestion = (id, mark) => {
    const next = { ...marks, [id]: mark }
    setMarks(next)
    // Keep the score box in step with the marks so the coop only has to press "Lưu điểm".
    setScore(pointsFor(next))
  }
  const save = async (body, nextMarks = marks) => {
    if (markable) body = { ...body, marks: nextMarks }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await apiRequest(`/station-sessions/${result.sessionId}/score`, { method: 'PATCH', body })
      if (markable) setMarks(nextMarks)
      setSavedScore(response.score)
      setScore(response.score)
      setMessage(`Đã lưu ${response.score} điểm cho ${result.teamName}.`)
      onSaved(response)
    } catch (err) {
      setError(err.data?.error === 'results_locked' ? 'Kết quả đã khóa, không thể sửa điểm.' : 'Không lưu được điểm. Kiểm tra kết nối và thử lại.')
    } finally { setSaving(false) }
  }
  return <section className="overflow-hidden rounded-xl border border-stone bg-white shadow-sm" aria-label="Chấm bài vừa checkout">
    <header className="border-b border-stone px-5 py-4">
      <p className="text-sm font-semibold text-trail">Đã checkout · Chấm bài</p>
      <h2 className="mt-1 font-display text-2xl font-bold text-ink">{result.teamName}</h2>
      <p className="mt-1 text-sm text-ink/60"><span className="font-mono">{result.teamId}</span> · {result.stationName}</p>
    </header>
    <div className="p-5">
      <QuizSummary result={markedSummary} score={savedScore} />
      {submission ? <AnswerReview items={reviewItems} marks={markable ? marks : undefined} onMark={markable ? markQuestion : undefined} /> : <p className="py-4 text-sm text-ink/60">Đội chưa có bài nộp trong lượt này. Chấm theo hoạt động tại trạm.</p>}
      {submission?.files?.length > 0 && <div className="mb-4 flex flex-wrap gap-3">{submission.files.map((file, i) => <a key={file.key || i} href={file.url} target="_blank" rel="noreferrer" className="text-sm text-trail underline">{file.name || `Tệp đính kèm ${i + 1}`}</a>)}</div>}
    </div>
    <div className="sticky bottom-0 border-t border-stone bg-paper p-4 sm:p-5">
      <h3 className="text-base font-semibold text-ink">Ghi nhận điểm</h3>
      {result.scoringMode === 'threshold' && <p className="mt-1 text-sm text-ink/60">Đạt trạm từ {result.passThreshold} điểm.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {binary ? <>
          <button disabled={saving} onClick={() => save({ outcome: 'passed' })} className="min-h-[48px] rounded-lg bg-trail px-4 font-semibold text-white disabled:opacity-50">Cho điểm · {result.passPoints ?? 0} đ</button>
          <button disabled={saving} onClick={() => save({ outcome: 'failed' })} className="min-h-[48px] rounded-lg border border-clay/30 bg-white px-4 font-semibold text-clay disabled:opacity-50">Không cho điểm · 0 đ</button>
        </> : <>
          {fullPoints > 0 && <button disabled={saving} onClick={() => save({ score: fullPoints }, markAll(true))} className="min-h-[48px] rounded-lg border border-trail/30 bg-white px-4 text-sm font-semibold text-trail disabled:opacity-50">Cho đủ {fullPoints} điểm</button>}
          <button disabled={saving} onClick={() => save({ score: 0 }, markAll(false))} className="min-h-[48px] rounded-lg border border-clay/30 bg-white px-4 text-sm font-semibold text-clay disabled:opacity-50">Không cho điểm</button>
          {reviewItems.length > 0
            ? <button disabled={saving} onClick={() => setScore(markedPoints)} className="min-h-[48px] rounded-lg border border-stone bg-white px-4 text-sm text-ink">Dùng điểm đã chấm: {markedPoints}</button>
            : quiz?.total > 0 && <button disabled={saving} onClick={() => setScore(quiz.points)} className="min-h-[48px] rounded-lg border border-stone bg-white px-4 text-sm text-ink">Dùng điểm đã chấm: {quiz.points}</button>}
        </>}
      </div>
      {!binary && <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (score !== '' && Number.isInteger(Number(score)) && Number(score) >= 0) save({ score: Number(score) }) }}>
        <label className="text-sm font-medium text-ink">Điểm của đội
          <input type="number" min="0" step="1" required disabled={saving} value={score} onChange={e => setScore(e.target.value)} className="mt-1 block min-h-[48px] w-32 rounded-lg border border-stone bg-white px-3 font-mono text-lg focus:outline-trail" />
        </label>
        <button disabled={saving || score === '' || !Number.isInteger(Number(score)) || Number(score) < 0} className="min-h-[48px] rounded-lg bg-trail px-5 font-semibold text-white disabled:opacity-50">{saving ? 'Đang lưu…' : 'Lưu điểm'}</button>
      </form>}
      {message && <p role="status" className="mt-3 text-sm font-semibold text-trail">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-clay">{error}</p>}
      <button type="button" disabled={saving} onClick={onNext} className="mt-4 min-h-[48px] w-full rounded-lg bg-ink px-4 font-semibold text-white disabled:opacity-50">Quét đội tiếp theo</button>
      {savedScore == null && <p className="mt-2 text-xs text-ink/60">Chưa lưu điểm. Bạn có thể chấm sau trong Nhật ký trạm.</p>}
    </div>
  </section>
}
