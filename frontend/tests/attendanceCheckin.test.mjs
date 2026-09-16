import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attendanceProgress,
  attendanceQrStatus,
  normalizeMinCheckinMembers,
} from '../src/attendanceCheckin.js'

test('individual attendance shows a QR only while its owner is unscanned', () => {
  assert.equal(attendanceQrStatus({ enabled: true, mode: 'individual', payload: 'p:signed' }), 'ready')
  assert.equal(attendanceQrStatus({ enabled: true, mode: 'individual', checked_in: true }), 'checked_in')
  assert.equal(attendanceQrStatus({ enabled: true, mode: 'individual', checked_out: true }), 'checked_out')
})

test('team mode and disabled attendance never invent an individual threshold', () => {
  assert.equal(attendanceQrStatus({ enabled: true, mode: 'team', payload: 't:signed' }), 'ready')
  assert.deepEqual(attendanceProgress({ checked_in_count: 0, required_count: 0, eligible: false }), {
    checkedIn: 0,
    required: 0,
    eligible: false,
  })
})

test('event minimum accepts only positive whole members and defaults to one', () => {
  assert.equal(normalizeMinCheckinMembers('3'), 3)
  assert.equal(normalizeMinCheckinMembers(0), 1)
  assert.equal(normalizeMinCheckinMembers(1.5), 1)
})
