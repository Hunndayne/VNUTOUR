import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from './api.js'
import { AnswerReview, QuizSummary } from './QuestionReview.jsx'
import { useItemMarks } from './itemMarks.js'
import { clearDraft, readDraft, writeDraft } from './drafts.jsx'
import ChallengeScores from './ChallengeScores.jsx'
import {
  challengeInitialValues, challengeMaxSum, challengePayload, challengeSum, challengeValuesValid, fillChallenges,
} from './challengeScores.js'

export default function CheckoutReview({ result, onSaved, onNext }) {
  const submission = result.submission
  const quiz = submission?.response_payload?.quiz_result
  const binary = result.scoringMode === 'pass_fail'
  // Offline challenges: scored here per challenge and added to the form's points.
  const challenges = useMemo(() => (binary ? [] : result.challenges || []), [binary, result.challenges])
  const hasChallenges = challenges.length > 0
  // A challenge-only visit has no form, so there is no "bài làm" part to score.
  const hasFormPart = !hasChallenges || Boolean(submission)
  const reviewItems = useMemo(() => submission?.answer_review || submission?.response_payload?.answer_review || [], [submission])
  // Coop's verdict per question; sent with every score save so the backend keeps them.
  const markable = !binary && reviewItems.length > 0
  // Unsaved grading (marks + score box + challenges) is kept per session so a
  // reload mid-review does not throw it away; cleared once saved or moved on.
  const draftKey = `coop:checkoutGrading:${result.sessionId}`
  const [draft] = useState(() => readDraft(draftKey)?.value || null)
  const { marks, setMarks, pointsFor, markedPoints, fullPoints: allPoints, markAll, summarize } = useItemMarks(reviewItems, draft?.marks ?? submission?.item_marks)
  // At a challenge station the box holds only the form part; the total is derived.
  const initialScore = hasChallenges
    ? (result.formScore ?? submission?.score ?? null)
    : (result.score ?? submission?.score ?? null)
  // Until someone grades per question, the score box starts at what the
  // right answers add up to, so the coop can usually just press "Lưu điểm".
  const [score, setScore] = useState(() => {
    if (draft && 'score' in draft) return draft.score
    return markable && !submission?.item_marks && !initialScore ? markedPoints : (initialScore ?? '')
  })
  const [challengeValues, setChallengeValues] = useState(() => draft?.challenges ?? challengeInitialValues(challenges))
  const [dirty, setDirty] = useState(Boolean(draft))
  useEffect(() => {
    if (dirty) writeDraft(draftKey, { marks, score, challenges: challengeValues })
  }, [dirty, draftKey, marks, score, challengeValues])
  const [savedScore, setSavedScore] = useState(result.score ?? submission?.score ?? null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const markedSummary = reviewItems.length > 0 && quiz ? summarize(quiz) : quiz
  const fullPoints = reviewItems.length > 0 ? allPoints : quiz?.max_points
  const scoreValid = !hasFormPart || (score !== '' && Number.isInteger(Number(score)) && Number(score) >= 0)
  const challengesValid = challengeValuesValid(challenges, challengeValues)
  const total = (hasFormPart ? Number(score) || 0 : 0) + challengeSum(challenges, challengeValues)
  const markQuestion = (id, mark) => {
    const next = { ...marks, [id]: mark }
    setMarks(next)
    // Keep the score box in step with the marks so the coop only has to press "Lưu điểm".
    setScore(pointsFor(next))
    setDirty(true)
  }
  const save = async (body, nextMarks = marks, nextChallenges = challengeValues) => {
    if (markable) body = { ...body, marks: nextMarks }
    if (hasChallenges) body = { ...body, challenges: challengePayload(challenges, nextChallenges) }
    if (!hasFormPart) delete body.score
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await apiRequest(`/station-sessions/${result.sessionId}/score`, { method: 'PATCH', body })
      if (markable) setMarks(nextMarks)
      setDirty(false)
      clearDraft(draftKey)
      setSavedScore(response.score)
      if (hasChallenges) {
        setScore(response.form_score ?? (hasFormPart ? 0 : ''))
        setChallengeValues(challengeInitialValues(challenges, response.challenge_scores))
      } else {
        setScore(response.score)
      }
      setMessage(`Đã lưu ${response.score} điểm cho ${result.teamName}.`)
      onSaved(response)
    } catch (err) {
      const code = err.data?.error
      setError(code === 'results_locked'
        ? 'Kết quả đã khóa, không thể sửa điểm.'
        : code === 'invalid_challenge_score'
          ? 'Điểm thử thách phải là số nguyên từ 0 đến điểm tối đa.'
          : 'Không lưu được điểm. Kiểm tra kết nối và thử lại.')
    } finally { setSaving(false) }
  }
  const saveAll = full => {
    const nextChallenges = fillChallenges(challenges, full)
    setChallengeValues(nextChallenges)
    save({ score: full ? (fullPoints || 0) : 0 }, markAll(full), nextChallenges)
  }
  const fullTotal = (hasFormPart ? fullPoints || 0 : 0) + challengeMaxSum(challenges)
  return <section className="overflow-hidden rounded-xl border border-stone bg-white shadow-sm" aria-label="Chấm bài vừa checkout">
    <header className="border-b border-stone px-5 py-4">
      <p className="text-sm font-semibold text-trail">Đã checkout · Chấm bài</p>
      <h2 className="mt-1 font-display text-2xl font-bold text-ink">{result.teamName}</h2>
      <p className="mt-1 text-sm text-ink/60"><span className="font-mono">{result.teamId}</span> · {result.stationName}</p>
    </header>
    <div className="p-5">
      <QuizSummary result={markedSummary} score={savedScore} />
      {submission
        ? <AnswerReview items={reviewItems} marks={markable ? marks : undefined} onMark={markable ? markQuestion : undefined} />
        : <p className="py-4 text-sm text-ink/60">{hasChallenges ? 'Trạm này chỉ có thử thách, không có bài nộp trên web.' : 'Đội chưa có bài nộp trong lượt này. Chấm theo hoạt động tại trạm.'}</p>}
      {submission?.files?.length > 0 && <div className="mb-4 flex flex-wrap gap-3">{submission.files.map((file, i) => <a key={file.key || i} href={file.url} target="_blank" rel="noreferrer" className="text-sm text-trail underline">{file.name || `Tệp đính kèm ${i + 1}`}</a>)}</div>}
      {hasChallenges && <div className="mt-4">
        <h3 className="mb-2 text-base font-semibold text-ink">Thử thách</h3>
        <ChallengeScores challenges={challenges} values={challengeValues} disabled={saving}
          onChange={next => { setChallengeValues(next); setDirty(true) }} />
      </div>}
    </div>
    <div className="sticky bottom-0 border-t border-stone bg-paper p-4 sm:p-5">
      <h3 className="text-base font-semibold text-ink">Ghi nhận điểm</h3>
      {result.scoringMode === 'threshold' && <p className="mt-1 text-sm text-ink/60">Đạt trạm từ {result.passThreshold} điểm{hasChallenges ? ' (tính trên tổng)' : ''}.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {binary ? <>
          <button disabled={saving} onClick={() => save({ outcome: 'passed' })} className="min-h-[48px] rounded-lg bg-trail px-4 font-semibold text-white disabled:opacity-50">Cho điểm · {result.passPoints ?? 0} đ</button>
          <button disabled={saving} onClick={() => save({ outcome: 'failed' })} className="min-h-[48px] rounded-lg border border-clay/30 bg-white px-4 font-semibold text-clay disabled:opacity-50">Không cho điểm · 0 đ</button>
        </> : <>
          {fullTotal > 0 && <button disabled={saving} onClick={() => saveAll(true)} className="min-h-[48px] rounded-lg border border-trail/30 bg-white px-4 text-sm font-semibold text-trail disabled:opacity-50">Cho đủ {fullTotal} điểm</button>}
          <button disabled={saving} onClick={() => saveAll(false)} className="min-h-[48px] rounded-lg border border-clay/30 bg-white px-4 text-sm font-semibold text-clay disabled:opacity-50">Không cho điểm</button>
          {hasFormPart && (reviewItems.length > 0
            ? <button disabled={saving} onClick={() => { setScore(markedPoints); setDirty(true) }} className="min-h-[48px] rounded-lg border border-stone bg-white px-4 text-sm text-ink">Dùng điểm đã chấm: {markedPoints}</button>
            : quiz?.total > 0 && <button disabled={saving} onClick={() => { setScore(quiz.points); setDirty(true) }} className="min-h-[48px] rounded-lg border border-stone bg-white px-4 text-sm text-ink">Dùng điểm đã chấm: {quiz.points}</button>)}
        </>}
      </div>
      {!binary && <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (scoreValid && challengesValid) save({ score: Number(score) }) }}>
        {hasFormPart && <label className="text-sm font-medium text-ink">{hasChallenges ? 'Điểm phần bài làm' : 'Điểm của đội'}
          <input type="number" min="0" step="1" required disabled={saving} value={score} onChange={e => { setScore(e.target.value); setDirty(true) }} className="mt-1 block min-h-[48px] w-32 rounded-lg border border-stone bg-white px-3 font-mono text-lg focus:outline-trail" />
        </label>}
        {hasChallenges && <p className="min-h-[48px] self-end py-3 text-sm text-ink/70">
          {hasFormPart ? <>Tổng = {Number(score) || 0} + {challengeSum(challenges, challengeValues)} thử thách = </> : 'Tổng điểm trạm = '}
          <strong className="font-mono text-lg text-ink">{total}</strong>
        </p>}
        <button disabled={saving || !scoreValid || !challengesValid} className="min-h-[48px] rounded-lg bg-trail px-5 font-semibold text-white disabled:opacity-50">{saving ? 'Đang lưu…' : 'Lưu điểm'}</button>
      </form>}
      {message && <p role="status" className="mt-3 text-sm font-semibold text-trail">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-clay">{error}</p>}
      <button type="button" disabled={saving} onClick={() => { clearDraft(draftKey); onNext() }} className="mt-4 min-h-[48px] w-full rounded-lg bg-ink px-4 font-semibold text-white disabled:opacity-50">Quét đội tiếp theo</button>
      {savedScore == null && <p className="mt-2 text-xs text-ink/60">Chưa lưu điểm. Bạn có thể chấm sau trong Nhật ký trạm.</p>}
    </div>
  </section>
}
