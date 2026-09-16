import assert from 'node:assert/strict'
import test from 'node:test'
import { canReplay, withReplayState } from '../src/stationReplay.js'

test('a fresh lock revokes cached permission while a fresh unlock restores it', () => {
  const base = {station_id:1, can_replay:true, replay_locked:false, max_attempts:3}
  const locked = withReplayState(base, {station_id:1, can_replay:false, replay_locked:true, replay_reason:'passed'})
  assert.equal(canReplay(locked), false)
  assert.equal(base.can_replay, true)
  const unlocked = withReplayState(locked, {station_id:1, can_replay:true, replay_locked:false, replay_reason:null})
  assert.equal(canReplay(unlocked), true)
  assert.equal(unlocked.max_attempts, 3)
})

test('late response for another station cannot change the selected station rights', () => {
  const base = {station_id:2, can_replay:false, replay_reason:'attempts_exhausted'}
  assert.equal(withReplayState(base, {station_id:1, can_replay:true}), base)
})

test('explicit can_replay denial takes priority over a legacy unlocked field', () => {
  assert.equal(canReplay({can_replay:false, replay_locked:false}), false)
  assert.equal(canReplay({replay_locked:false}), true)
  assert.equal(canReplay({}), false)
})
