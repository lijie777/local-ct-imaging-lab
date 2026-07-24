import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import * as api from '../../dicom-import/api/dicomImportApi'
import { DicomApiError } from '../../dicom-import/api/dicomImportApi'
import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import { useAdvanced3dSeries } from './useAdvanced3dSeries'


vi.mock('../../dicom-import/api/dicomImportApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../dicom-import/api/dicomImportApi')>()
  return { ...actual, getSeriesDetails: vi.fn() }
})
vi.mock('../../axial-viewer/api/axialViewerApi', () => ({
  instanceImageId: (id: string) => `wadouri:local/${id}`,
}))

const DETAIL = {
  id: 'series-1',
  series_instance_uid: '1.2.3',
  modality: 'CT',
  series_number: 1,
  description: 'Advanced 3D',
  body_part_examined: null,
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

it('re-requests details, preserves instance order, and exposes volume eligibility', async () => {
  const { result } = renderHook(() => useAdvanced3dSeries('series-1'))

  await waitFor(() => expect(result.current.status).toBe('success'))
  expect(api.getSeriesDetails).toHaveBeenCalledWith('series-1', expect.any(AbortSignal))
  expect(result.current.imageIds).toEqual([
    'wadouri:local/instance-2',
    'wadouri:local/instance-1',
  ])
  expect(result.current.eligibility).toEqual({
    eligible: true,
    reason: null,
    sliceSpacing: 1,
  })
})

it('aborts an older request and prevents stale data from winning', async () => {
  let resolveOld!: (detail: SeriesDetail) => void
  vi.mocked(api.getSeriesDetails)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    .mockResolvedValueOnce(DETAIL)
  const { result } = renderHook(() => useAdvanced3dSeries('series-1'))
  await waitFor(() => expect(api.getSeriesDetails).toHaveBeenCalledOnce())
  const oldSignal = vi.mocked(api.getSeriesDetails).mock.calls[0][1]!

  await act(async () => result.current.reload())
  expect(oldSignal.aborted).toBe(true)
  expect(result.current.status).toBe('success')

  resolveOld({ ...DETAIL, id: 'stale-series' })
  await act(async () => Promise.resolve())
  expect(result.current.detail?.id).toBe('series-1')
})

it('keeps image ids empty for unsupported and insufficient geometry', async () => {
  vi.mocked(api.getSeriesDetails).mockResolvedValueOnce({
    ...DETAIL,
    viewability_status: 'unsupported',
    viewability_reason: 'missing_geometry',
  })
  const unsupported = renderHook(() => useAdvanced3dSeries('series-1'))
  await waitFor(() => expect(unsupported.result.current.status).toBe('error'))
  expect(unsupported.result.current.errorKind).toBe('notViewable')
  expect(unsupported.result.current.error).toBe('该序列暂不可用于高级 3D，请返回轴位查看器')
  expect(unsupported.result.current.imageIds).toEqual([])
  unsupported.unmount()

  vi.mocked(api.getSeriesDetails).mockResolvedValueOnce({
    ...DETAIL,
    instances: [DETAIL.instances[0]],
    instance_count: 1,
  })
  const geometry = renderHook(() => useAdvanced3dSeries('series-1'))
  await waitFor(() => expect(geometry.result.current.status).toBe('error'))
  expect(geometry.result.current.errorKind).toBe('geometry')
  expect(geometry.result.current.error).toBe(
    '高级 3D 暂不可用：至少需要两个不同空间位置的切片',
  )
})

it.each([
  [new DicomApiError(404, 'series_not_found', 'private id'), 'notFound', '未找到该本机 CT 序列，请返回轴位查看器'],
  [new DicomApiError(409, 'series_not_viewable', 'private reason'), 'notViewable', '该序列暂不可用于高级 3D，请返回轴位查看器'],
  [new DicomApiError(410, 'instance_file_missing', 'private path'), 'persistence', '本机 DICOM 文件缺失，请恢复文件后重试'],
  [new DicomApiError(422, 'validation_error', 'private field'), 'validation', '影像请求无效，请返回轴位查看器'],
  [new DicomApiError(500, 'persistence_error', 'private db'), 'persistence', '本机影像数据暂时不可用，请重试或返回轴位查看器'],
  [new DicomApiError(500, 'request_error', 'private stack'), 'service', '本机影像服务异常，请重试或返回轴位查看器'],
  [new DicomApiError(null, 'network_error', 'private URL'), 'service', '无法连接本机服务，请确认服务已启动'],
  [new Error(String.raw`codec C:\private\decoder.dll`), 'unknown', '无法加载高级 3D，请重试或返回轴位查看器'],
] as const)('maps request failure to a safe advanced 3D error %#', async (requestError, kind, message) => {
  vi.mocked(api.getSeriesDetails).mockRejectedValueOnce(requestError)
  const { result } = renderHook(() => useAdvanced3dSeries('series-1'))

  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.errorKind).toBe(kind)
  expect(result.current.error).toBe(message)
  expect(result.current.error).not.toContain('private')
})
