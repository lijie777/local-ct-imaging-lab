import type { Sex } from './patient'


export type PatientValidationErrors = Partial<
  Record<'medical_record_no' | 'name' | 'sex' | 'birth_date', string>
>

interface PatientInput {
  medical_record_no?: unknown
  name?: unknown
  sex?: unknown
  birth_date?: unknown
}

const ALLOWED_SEX_VALUES = new Set<Sex>([
  'male',
  'female',
  'other',
  'unknown',
])
const NON_VISIBLE_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

function localToday(): string {
  const today = new Date()
  const year = today.getFullYear().toString().padStart(4, '0')
  const month = (today.getMonth() + 1).toString().padStart(2, '0')
  const day = today.getDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) {
    return false
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function validateVisibleText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return '此字段为必填项'
  }

  const trimmed = value.trim()
  if (trimmed.length > maximumLength) {
    return `此字段最多允许 ${maximumLength} 个字符`
  }
  if (NON_VISIBLE_CHARACTER.test(trimmed)) {
    return '此字段不得包含换行符或其他控制字符'
  }

  return undefined
}

export function validatePatientInput(
  input: PatientInput,
  today = localToday(),
): PatientValidationErrors {
  const errors: PatientValidationErrors = {}
  const medicalRecordError = validateVisibleText(input.medical_record_no, 64)
  const nameError = validateVisibleText(input.name, 100)

  if (medicalRecordError !== undefined) {
    errors.medical_record_no = medicalRecordError
  }
  if (nameError !== undefined) {
    errors.name = nameError
  }

  if (
    typeof input.sex !== 'string' ||
    !ALLOWED_SEX_VALUES.has(input.sex as Sex)
  ) {
    errors.sex = '性别选项无效'
  }

  if (input.birth_date !== null && input.birth_date !== '') {
    if (
      typeof input.birth_date !== 'string' ||
      !isValidDateOnly(input.birth_date)
    ) {
      errors.birth_date = '出生日期无效'
    } else if (input.birth_date > today) {
      errors.birth_date = '出生日期不得晚于今天'
    }
  }

  return errors
}
