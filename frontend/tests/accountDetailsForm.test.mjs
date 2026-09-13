import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAccountDetailsPatch, getAccountDetailsForm, getEditableExtraFields, validateAccountDetailsPatch } from '../src/accountDetailsForm.js'

function linkedDetails() {
  return {
    account: {
      email: 'student@example.com', mssv: '26520013', full_name: 'Nguyễn Bảo Ân',
      phone: '', school: 'Account school', faculty: 'Account faculty', role: 'participant', is_active: true,
    },
    participant: {
      email: 'student@example.com', mssv: '26520013', full_name: 'Nguyễn Bảo Ân',
      phone: '0900123456', school: 'Profile school', faculty: 'Profile faculty',
      cccd: '012345678901', date_of_birth: '2008-02-20',
      extra: { shirt_size: 'M', agreed: true, transport_seats: 2, nested: { proof: ['keep', 'all'] }, legacy_note: 'Keep note' },
    },
    extra_fields: [
      { key: 'shirt_size', label: 'Cỡ áo', type: 'select', options: ['M', 'L'] },
      { key: 'diet', label: 'Ăn uống', type: 'text' },
      { key: 'nested', label: 'Minh chứng', type: 'text' },
    ],
  }
}

test('opening and saving an unrelated field never copies profile defaults over account data', () => {
  const details = linkedDetails()
  const form = getAccountDetailsForm(details)
  assert.equal(form.phone, '0900123456')
  assert.equal(form.school, 'Profile school')
  assert.equal(form.faculty, 'Profile faculty')
  assert.deepEqual(buildAccountDetailsPatch(details, form), {})
  form.role = 'collab'
  assert.deepEqual(buildAccountDetailsPatch(details, form, { role: true }), { role: 'collab' })
})

test('editing shared fields back to the account value still reconciles a differing linked profile', () => {
  const details = linkedDetails()
  details.participant.email = 'old@example.com'
  const form = getAccountDetailsForm(details)
  form.school = 'Account school'
  form.email = ' STUDENT@EXAMPLE.COM '
  assert.deepEqual(buildAccountDetailsPatch(details, form, { school: true, email: true }), {
    school: 'Account school', email: 'student@example.com',
  })
})

test('extra updates merge only changed primitives, support absent schema fields and retain unknown nested data', () => {
  const details = linkedDetails()
  const before = structuredClone(details)
  const fields = getEditableExtraFields(details)
  assert.ok(fields.some(field => field.key === 'diet'))
  assert.ok(fields.some(field => field.key === 'legacy_note'))
  assert.ok(!fields.some(field => field.key === 'nested'))
  const form = getAccountDetailsForm(details)
  form.extra.shirt_size = 'L'
  form.extra.diet = 'Chay'
  form.extra.agreed = 'false'
  form.extra.transport_seats = '0'
  assert.deepEqual(buildAccountDetailsPatch(details, form, {
    'extra.shirt_size': true, 'extra.diet': true, 'extra.agreed': true, 'extra.transport_seats': true,
  }), { extra: { shirt_size: 'L', diet: 'Chay', agreed: false, transport_seats: 0 } })
  assert.deepEqual(details, before)
})

test('clearing editable fields is explicit and profile fields are never sent for an unlinked account', () => {
  const details = linkedDetails()
  const form = getAccountDetailsForm(details)
  form.cccd = ''
  form.date_of_birth = ''
  assert.deepEqual(buildAccountDetailsPatch(details, form, { cccd: true, date_of_birth: true }), { cccd: '', date_of_birth: '' })
  details.participant = null
  assert.deepEqual(buildAccountDetailsPatch(details, form, { cccd: true, date_of_birth: true, 'extra.diet': true }), {})
})

test('password stays absent unless deliberately changed and ordinary reversions do not create writes', () => {
  const details = linkedDetails()
  const form = getAccountDetailsForm(details)
  assert.equal(form.password, '')
  assert.deepEqual(buildAccountDetailsPatch(details, form, { password: true, full_name: true }), {})
  form.password = '  New password  '
  assert.deepEqual(buildAccountDetailsPatch(details, form, { password: true }), { password: '  New password  ' })
})

test('validation rejects identity loss and impossible dates while permitting unrelated edits to legacy records', () => {
  const details = linkedDetails()
  details.account.email = 'legacy-invalid-email'
  assert.equal(validateAccountDetailsPatch({ role: 'collab' }, details), '')
  assert.notEqual(validateAccountDetailsPatch({ email: 'invalid' }, details), '')
  assert.notEqual(validateAccountDetailsPatch({ mssv: '' }, details), '')
  assert.notEqual(validateAccountDetailsPatch({ date_of_birth: '2008-02-31' }, details), '')
  assert.notEqual(validateAccountDetailsPatch({ date_of_birth: '2999-01-01' }, details), '')
  assert.equal(validateAccountDetailsPatch({ date_of_birth: '2008-02-29' }, details), '')
  assert.notEqual(validateAccountDetailsPatch({ phone: '1'.repeat(21) }, details), '')
})
