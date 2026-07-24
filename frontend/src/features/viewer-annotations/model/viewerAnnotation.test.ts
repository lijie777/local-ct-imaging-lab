import { describe, expect, it } from 'vitest'

import {
  CALIBRATION_UNAVAILABLE_MESSAGE,
  deriveMeasurementCalibration,
  isViewerAnnotationTool,
  validateAnnotationText,
} from './viewerAnnotation'


describe('annotation text validation', () => {
  it('trims valid text and accepts the 200 character boundary', () => {
    expect(validateAnnotationText('  teaching target  ')).toEqual({
      error: null,
      value: 'teaching target',
    })
    expect(validateAnnotationText('x'.repeat(200))).toEqual({
      error: null,
      value: 'x'.repeat(200),
    })
  })

  it('rejects empty, control-character, and overlong text', () => {
    expect(validateAnnotationText('')).toEqual({
      error: '请输入标注文字',
      value: null,
    })
    expect(validateAnnotationText('line\nbreak')).toEqual({
      error: '标注文字不能包含换行或控制字符',
      value: null,
    })
    expect(validateAnnotationText('x'.repeat(201))).toEqual({
      error: '标注文字不能超过 200 个字符',
      value: null,
    })
  })
})

describe('measurement calibration', () => {
  it('accepts finite, positive, consistent pixel spacing', () => {
    expect(deriveMeasurementCalibration([
      { rowPixelSpacing: 0.7, columnPixelSpacing: 0.8 },
      { rowPixelSpacing: 0.7000001, columnPixelSpacing: 0.8000001 },
    ])).toEqual({ available: true, reason: null })
  })

  it.each([
    { modules: [] },
    { modules: [{ rowPixelSpacing: undefined, columnPixelSpacing: 0.7 }] },
    { modules: [{ rowPixelSpacing: 0, columnPixelSpacing: 0.7 }] },
    { modules: [{ rowPixelSpacing: Number.NaN, columnPixelSpacing: 0.7 }] },
    { modules: [{
      rowPixelSpacing: 1,
      columnPixelSpacing: 1,
      usingDefaultValues: true,
    }] },
    { modules: [
      { rowPixelSpacing: 0.7, columnPixelSpacing: 0.7 },
      { rowPixelSpacing: 0.8, columnPixelSpacing: 0.7 },
    ] },
  ])('rejects unavailable or inconsistent spacing %#', ({ modules }) => {
    expect(deriveMeasurementCalibration(modules)).toEqual({
      available: false,
      reason: CALIBRATION_UNAVAILABLE_MESSAGE,
    })
  })
})

it('recognizes only the five viewer annotation tools', () => {
  expect(isViewerAnnotationTool('length')).toBe(true)
  expect(isViewerAnnotationTool('eraseAnnotation')).toBe(true)
  expect(isViewerAnnotationTool('windowLevel')).toBe(false)
  expect(isViewerAnnotationTool('crosshairs')).toBe(false)
})
