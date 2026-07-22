import { describe, expect, it } from 'vitest'

import {
  formatBirthDate,
  formatDateTime,
  formatLatestStudyDate,
  formatSex,
  formatStudyCount,
} from './patientFormatters'
import type { Sex } from './patient'


const SEX_CASES: ReadonlyArray<readonly [Sex, string]> = [
  ['male', '男'],
  ['female', '女'],
  ['other', '其他'],
  ['unknown', '未知'],
]

describe('patient formatters', () => {
  it.each(SEX_CASES)('formats sex %s as %s', (value, expected) => {
    expect(formatSex(value)).toBe(expected)
  })

  it('displays a birth date without applying a time-zone conversion', () => {
    expect(formatBirthDate('1990-01-02')).toBe('1990-01-02')
  })

  it('displays an empty birth date explicitly', () => {
    expect(formatBirthDate(null)).toBe('—')
  })

  it('localizes a UTC date-time instead of displaying the raw API value', () => {
    const apiValue = '2026-07-17T02:00:00Z'
    const formatted = formatDateTime(apiValue)

    expect(formatted).not.toBe(apiValue)
    expect(formatted).toContain('2026')
    expect(formatted).toMatch(/7/)
    expect(formatted).toMatch(/17/)
  })

  it('displays the current study count as zero', () => {
    expect(formatStudyCount(0)).toBe('0')
  })

  it('displays an empty latest study date explicitly', () => {
    expect(formatLatestStudyDate(null)).toBe('—')
  })
})
