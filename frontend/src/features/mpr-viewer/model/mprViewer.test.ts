import { describe, expect, it } from 'vitest'

import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import { deriveMprEligibility } from './mprViewer'


const ORIENTATION = [1, 0, 0, 0, 1, 0]

function detailAt(positions: number[][]): SeriesDetail {
  return {
    id: 'series-1',
    series_instance_uid: '1.2.3',
    modality: 'CT',
    series_number: 1,
    description: 'CT',
    body_part_examined: null,
    rows: 512,
    columns: 512,
    instance_count: positions.length,
    viewability_status: 'eligible',
    viewability_reason: null,
    instances: positions.map((position, index) => ({
      id: `instance-${index}`,
      sop_instance_uid: `1.2.3.${index}`,
      sop_class_uid: '1.2.840',
      transfer_syntax_uid: '1.2.840.10008.1.2.1',
      instance_number: index + 1,
      image_position_patient: position,
      image_orientation_patient: [...ORIENTATION],
      rows: 512,
      columns: 512,
    })),
  }
}

describe('deriveMprEligibility', () => {
  it('accepts multiple distinct slices and derives uniform spacing', () => {
    expect(deriveMprEligibility(detailAt([[0, 0, 0], [0, 0, 1], [0, 0, 2]])))
      .toEqual({ eligible: true, reason: null, sliceSpacing: 1 })
  })

  it('rejects a single slice and slices at only one projected position', () => {
    const expected = {
      eligible: false,
      reason: '至少需要两个不同空间位置的切片',
      sliceSpacing: null,
    }
    expect(deriveMprEligibility(detailAt([[0, 0, 0]]))).toEqual(expected)
    expect(deriveMprEligibility(detailAt([[0, 0, 1], [4, 5, 1]]))).toEqual(expected)
  })

  it.each([
    ['null position', 'image_position_patient', null],
    ['short position', 'image_position_patient', [0, 0]],
    ['NaN position', 'image_position_patient', [0, 0, Number.NaN]],
    ['infinite position', 'image_position_patient', [0, 0, Number.POSITIVE_INFINITY]],
    ['null orientation', 'image_orientation_patient', null],
    ['short orientation', 'image_orientation_patient', [1, 0, 0]],
    ['NaN orientation', 'image_orientation_patient', [1, 0, 0, 0, 1, Number.NaN]],
    ['infinite orientation', 'image_orientation_patient', [1, 0, 0, 0, 1, Number.NEGATIVE_INFINITY]],
  ] satisfies Array<[
    string,
    'image_position_patient' | 'image_orientation_patient',
    number[] | null,
  ]>)('rejects %s safely', (_name, field, value) => {
    const detail = detailAt([[0, 0, 0], [0, 0, 1]])
    detail.instances[1][field] = value

    expect(deriveMprEligibility(detail)).toEqual({
      eligible: false,
      reason: '影像空间信息不完整，无法构建三视图',
      sliceSpacing: null,
    })
  })

  it('rejects a degenerate orientation normal', () => {
    const detail = detailAt([[0, 0, 0], [0, 0, 1]])
    for (const instance of detail.instances) {
      instance.image_orientation_patient = [1, 0, 0, 1, 0, 0]
    }

    expect(deriveMprEligibility(detail).eligible).toBe(false)
    expect(deriveMprEligibility(detail).reason).toBe(
      '影像方向无效，无法构建三视图',
    )
  })

  it.each([
    ['rows', null],
    ['rows', 0],
    ['rows', 1.5],
    ['rows', Number.NaN],
    ['rows', Number.POSITIVE_INFINITY],
    ['columns', null],
    ['columns', -1],
    ['columns', 2.5],
    ['columns', Number.NaN],
    ['columns', Number.NEGATIVE_INFINITY],
  ] satisfies Array<['rows' | 'columns', number | null]>)('rejects invalid %s value %s', (field, value) => {
    const detail = detailAt([[0, 0, 0], [0, 0, 1]])
    detail.instances[0][field] = value

    expect(deriveMprEligibility(detail)).toEqual({
      eligible: false,
      reason: '图像尺寸无效或不一致，无法构建三视图',
      sliceSpacing: null,
    })
  })

  it.each([
    ['rows', 256],
    ['columns', 256],
  ] satisfies Array<['rows' | 'columns', number]>)('rejects inconsistent %s', (field, value) => {
    const detail = detailAt([[0, 0, 0], [0, 0, 1]])
    detail.instances[1][field] = value

    expect(deriveMprEligibility(detail).reason).toBe(
      '图像尺寸无效或不一致，无法构建三视图',
    )
  })

  it('rejects inconsistent orientation beyond the component tolerance', () => {
    const detail = detailAt([[0, 0, 0], [0, 0, 1]])
    detail.instances[1].image_orientation_patient = [1, 0, 0, 0, 0.999998, 0]

    expect(deriveMprEligibility(detail)).toEqual({
      eligible: false,
      reason: '图像方向不一致，无法构建三视图',
      sliceSpacing: null,
    })
  })

  it('accepts a valid oblique orientation within component tolerance', () => {
    const value = Math.SQRT1_2
    const detail = detailAt([[0, 0, 0], [value, -value, 0], [2 * value, -2 * value, 0]])
    for (const instance of detail.instances) {
      instance.image_orientation_patient = [value, value, 0, 0, 0, 1]
    }
    detail.instances[1].image_orientation_patient![0] += 0.0000005

    expect(deriveMprEligibility(detail)).toEqual({
      eligible: true,
      reason: null,
      sliceSpacing: 1,
    })
  })

  it('returns median spacing only when adjacent spacing is approximately uniform', () => {
    expect(deriveMprEligibility(detailAt([[0, 0, 0], [0, 0, 1], [0, 0, 2.005]])))
      .toEqual({ eligible: true, reason: null, sliceSpacing: 1.0025 })
    expect(deriveMprEligibility(detailAt([[0, 0, 0], [0, 0, 1], [0, 0, 3]])))
      .toEqual({ eligible: true, reason: null, sliceSpacing: null })
  })

  it('deduplicates projected positions at 1e-3 mm but accepts a value just above it', () => {
    expect(deriveMprEligibility(detailAt([[0, 0, 0], [0, 0, 0.001]]))).toEqual({
      eligible: false,
      reason: '至少需要两个不同空间位置的切片',
      sliceSpacing: null,
    })
    expect(deriveMprEligibility(detailAt([[0, 0, 0], [0, 0, 0.0010001]]))).toEqual({
      eligible: true,
      reason: null,
      sliceSpacing: 0.0010001,
    })
  })

  it('keeps spacing just inside 1% uniform tolerance and rejects spacing just outside it', () => {
    expect(deriveMprEligibility(detailAt([
      [0, 0, 0],
      [0, 0, 0.9901],
      [0, 0, 1.9901],
      [0, 0, 3],
    ]))).toEqual({ eligible: true, reason: null, sliceSpacing: 1 })
    expect(deriveMprEligibility(detailAt([
      [0, 0, 0],
      [0, 0, 0.9899],
      [0, 0, 1.9899],
      [0, 0, 3],
    ]))).toEqual({ eligible: true, reason: null, sliceSpacing: null })
  })

  it('uses the existing viewability label for unsupported series', () => {
    const detail = detailAt([[0, 0, 0], [0, 0, 1]])
    detail.viewability_status = 'unsupported'
    detail.viewability_reason = 'missing_geometry'

    expect(deriveMprEligibility(detail)).toEqual({
      eligible: false,
      reason: 'DICOM 缺少空间位置或方向信息',
      sliceSpacing: null,
    })
  })
})
