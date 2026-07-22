import type { Sex } from './patient'


const SEX_LABELS: Record<Sex, string> = {
  male: '男',
  female: '女',
  other: '其他',
  unknown: '未知',
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatSex(value: Sex): string {
  return SEX_LABELS[value]
}

export function formatBirthDate(value: string | null): string {
  return value ?? '—'
}

export function formatDateTime(value: string): string {
  return DATE_TIME_FORMATTER.format(new Date(value))
}

export function formatStudyCount(value: number): string {
  return String(value)
}

export function formatLatestStudyDate(value: string | null): string {
  return value ?? '—'
}
