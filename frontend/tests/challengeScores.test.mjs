import test from 'node:test'
import assert from 'node:assert/strict'

import {
  challengeInitialValues, challengeMaxSum, challengePayload, challengeSum, challengeValuesValid, fillChallenges,
} from '../src/challengeScores.js'

const challenges = [
  { id: 'c1', index: 1, title: 'Kéo co', maxPoints: 10, points: 7 },
  { id: 'c2', index: 2, title: 'Nhảy bao', maxPoints: 20, points: null },
]

test('starts from saved points, preferring a fresher saved map', () => {
  assert.deepEqual(challengeInitialValues(challenges), { c1: 7, c2: '' })
  assert.deepEqual(challengeInitialValues(challenges, { c2: 5 }), { c1: 7, c2: 5 })
})

test('sums and validates the boxes against each max', () => {
  assert.equal(challengeSum(challenges, { c1: '7', c2: '' }), 7)
  assert.equal(challengeMaxSum(challenges), 30)
  assert.ok(challengeValuesValid(challenges, { c1: 10, c2: '' }))
  assert.ok(!challengeValuesValid(challenges, { c1: 11 }))
  assert.ok(!challengeValuesValid(challenges, { c2: '2.5' }))
  assert.ok(!challengeValuesValid(challenges, { c2: -1 }))
})

test('empty boxes clear a score in the API payload', () => {
  assert.deepEqual(challengePayload(challenges, { c1: '4', c2: '' }), { c1: 4, c2: null })
  assert.deepEqual(fillChallenges(challenges, true), { c1: 10, c2: 20 })
  assert.deepEqual(fillChallenges(challenges, false), { c1: 0, c2: 0 })
})
