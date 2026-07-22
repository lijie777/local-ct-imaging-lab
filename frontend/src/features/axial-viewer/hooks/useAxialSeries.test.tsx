import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import * as api from '../api/axialViewerApi'
import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import { useAxialSeries } from './useAxialSeries'


vi.mock('../api/axialViewerApi', () => ({
  getSeriesDetails: vi.fn(),
  instanceImageId: (id: string) => `wadouri:local/${id}`,
}))

const DETAIL = {
  id: 'series-1',
  series_instance_uid: '1.2.3',
  modality: 'CT',
  series_number: 1,
  description: 'Axial',
  body_part_examined: 'CHEST',
  rows: 2,
  columns: 2,
  instance_count: 2,
  viewability_status: 'eligible',
  viewability_reason: null,
  instances: [
    {
      id: 'instance-2',
      sop_instance_uid: '1.2.3.2',
      sop_class_uid: '1.2.840',
      transfer_syntax_uid: '1.2.840.10008.1.2.1',
      instance_number: 2,
      image_position_patient: [0, 0, 2],
      image_orientation_patient: [1, 0, 0, 0, 1, 0],
      rows: 2,
      columns: 2,
    },
    {
      id: 'instance-1',
      sop_instance_uid: '1.2.3.1',
      sop_class_uid: '1.2.840',
      transfer_syntax_uid: '1.2.840.10008.1.2.1',
      instance_number: 1,
      image_position_patient: [0, 0, 1],
      image_orientation_patient: [1, 0, 0, 0, 1, 0],
      rows: 2,
      columns: 2,
    },
  ],
} satisfies SeriesDetail

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.getSeriesDetails).mockResolvedValue(DETAIL)
})

it('preserves backend instance ordering in image ids and reloads', async () => {
  const { result } = renderHook(() => useAxialSeries('series-1'))

  await waitFor(() => expect(result.current.status).toBe('success'))
  expect(result.current.imageIds).toEqual([
    'wadouri:local/instance-2',
    'wadouri:local/instance-1',
  ])

  await act(async () => result.current.reload())
  expect(api.getSeriesDetails).toHaveBeenCalledTimes(2)
})

it('reports an empty series without producing image ids', async () => {
  vi.mocked(api.getSeriesDetails).mockResolvedValue({
    ...DETAIL,
    instance_count: 0,
    instances: [],
  })

  const { result } = renderHook(() => useAxialSeries('series-1'))

  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.error).toMatch(/没有可显示/)
  expect(result.current.imageIds).toEqual([])
})

it('rejects a series that is no longer eligible', async () => {
  vi.mocked(api.getSeriesDetails).mockResolvedValue({
    ...DETAIL,
    viewability_status: 'unsupported',
    viewability_reason: 'missing_geometry',
  })

  const { result } = renderHook(() => useAxialSeries('series-1'))

  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.error).toBe(
    '该序列暂不可查看：DICOM 缺少空间位置或方向信息',
  )
})

it('does not expose an unknown viewability reason code', async () => {
  vi.mocked(api.getSeriesDetails).mockResolvedValue({
    ...DETAIL,
    viewability_status: 'unsupported',
    viewability_reason: 'future_reason',
  })

  const { result } = renderHook(() => useAxialSeries('series-1'))

  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.error).toBe('该序列暂不可查看：查看条件不足')
  expect(result.current.error).not.toContain('future_reason')
})

it('shows a local-service failure and recovers on retry', async () => {
  vi.mocked(api.getSeriesDetails)
    .mockRejectedValueOnce(new Error('无法连接本机服务，请确认服务已启动'))
    .mockResolvedValueOnce(DETAIL)
  const { result } = renderHook(() => useAxialSeries('series-1'))

  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.error).toMatch(/本机服务/)

  await act(async () => result.current.reload())
  expect(result.current.status).toBe('success')
})
