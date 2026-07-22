import { describe, expect, it } from 'vitest'

import {
  type PatientValidationErrors,
  validatePatientInput,
} from './patientValidation'


const TODAY = '2026-07-17'
type VisibleTextField = Extract<
  keyof PatientValidationErrors,
  'medical_record_no' | 'name'
>

const REQUIRED_CASES: ReadonlyArray<readonly [VisibleTextField, string]> = [
  ['medical_record_no', ''],
  ['name', '   '],
]

const MAXIMUM_LENGTH_CASES: ReadonlyArray<
  readonly [VisibleTextField, string]
> = [
  ['medical_record_no', 'M'.repeat(65)],
  ['name', '姓'.repeat(101)],
]

const CONTROL_CHARACTER_CASES: ReadonlyArray<
  readonly [VisibleTextField, string]
> = [
  ['medical_record_no', 'MR\n001'],
  ['medical_record_no', 'MR\t001'],
  ['name', '演示\r病人'],
  ['name', '演示\u0000病人'],
]

function validDraft(overrides: Record<string, unknown> = {}) {
  return {
    medical_record_no: 'MR-0001',
    name: '演示病人',
    sex: 'unknown',
    birth_date: '1990-01-02',
    ...overrides,
  }
}

describe('validatePatientInput', () => {
  it('accepts a valid draft', () => {
    expect(validatePatientInput(validDraft(), TODAY)).toEqual({})
  })

  it.each(REQUIRED_CASES)('requires %s after trimming outer whitespace', (field, value) => {
    const errors = validatePatientInput(validDraft({ [field]: value }), TODAY)

    expect(errors[field]).toMatch(/必填|不能为空/)
  })

  it.each(MAXIMUM_LENGTH_CASES)('enforces the maximum length of %s', (field, value) => {
    const errors = validatePatientInput(validDraft({ [field]: value }), TODAY)

    expect(errors[field]).toMatch(/长度|最多/)
  })

  it.each(CONTROL_CHARACTER_CASES)('rejects control characters in %s', (field, value) => {
    const errors = validatePatientInput(validDraft({ [field]: value }), TODAY)

    expect(errors[field]).toMatch(/控制字符|不可见字符|换行/)
  })

  it('accepts internal spaces, punctuation, and symbols', () => {
    expect(
      validatePatientInput(
        validDraft({
          medical_record_no: ' MR 01/A-2 ',
          name: " Anne-Marie  O'Neil（演示） ",
        }),
        TODAY,
      ),
    ).toEqual({})
  })

  it.each(['male', 'female', 'other', 'unknown'])(
    'accepts the sex value %s',
    (sex) => {
      expect(validatePatientInput(validDraft({ sex }), TODAY)).toEqual({})
    },
  )

  it('rejects an unsupported sex value', () => {
    const errors = validatePatientInput(validDraft({ sex: 'invalid' }), TODAY)

    expect(errors.sex).toMatch(/性别|选项/)
  })

  it.each(['0001-01-01', TODAY])(
    'accepts a valid date not later than today: %s',
    (birthDate) => {
      expect(
        validatePatientInput(validDraft({ birth_date: birthDate }), TODAY),
      ).toEqual({})
    },
  )

  it('rejects a future birth date', () => {
    const errors = validatePatientInput(
      validDraft({ birth_date: '2026-07-18' }),
      TODAY,
    )

    expect(errors.birth_date).toMatch(/未来|晚于今天/)
  })
})
