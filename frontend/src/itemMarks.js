import { useState } from 'react'

export const reviewItemPoints = item => Number(item.points ?? 1) || 0

/**
 * Grader-side state for per-question verdicts: the auto-grading overlaid with
 * the verdicts saved earlier (`savedMarks`), plus the score they add up to.
 * Remount the owner (key) when the attempt changes — the seed is read once.
 */
export function useItemMarks(reviewItems, savedMarks) {
  const [marks, setMarks] = useState(() => {
    const saved = savedMarks || {}
    return Object.fromEntries(reviewItems.map(item => [item.id, saved[item.id] ?? item.is_correct ?? null]))
  })
  const pointsFor = next => reviewItems.reduce((sum, item) => sum + (next[item.id] === true ? reviewItemPoints(item) : 0), 0)
  return {
    marks,
    setMarks,
    pointsFor,
    markedPoints: pointsFor(marks),
    fullPoints: reviewItems.reduce((sum, item) => sum + reviewItemPoints(item), 0),
    markAll: mark => Object.fromEntries(reviewItems.map(item => [item.id, mark])),
    // quiz_result recounted from the current marks, in the shape QuizSummary reads.
    summarize: quiz => ({
      ...(quiz || {}),
      total: reviewItems.length,
      correct_count: reviewItems.filter(item => marks[item.id] === true).length,
      manual_count: reviewItems.filter(item => marks[item.id] == null).length,
      points: pointsFor(marks),
      max_points: reviewItems.reduce((sum, item) => sum + reviewItemPoints(item), 0),
    }),
  }
}
