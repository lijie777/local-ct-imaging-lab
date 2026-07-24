import { useState, type ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import type { AxialViewerContext } from '../../axial-viewer/model/axialViewer'
import * as advancedHook from '../hooks/useAdvanced3dSeries'
import { Advanced3dViewerPage } from './Advanced3dViewerPage'


vi.mock('../hooks/useAdvanced3dSeries', () => ({
  useAdvanced3dSeries: vi.fn(),
}))
vi.mock('../components/Advanced3dViewport', () => ({
  Advanced3dViewport: ({
    imageIds,
    metadata,
    onRetry,
  }: {
    imageIds: readonly string[]
    metadata?: ReactNode
    onRetry?: () => void | Promise<void>
  }) => (
    <section aria-label="mock advanced 3D viewport">
      <p>{`高级 3D 画布 ${imageIds.length}`}</p>
      <button onClick={() => void onRetry?.()} type="button">
        模拟 runtime 错误后重试
      </button>
      <aside aria-label="高级 3D 元数据">{metadata}</aside>
    </section>
  ),
}))

const context = {
  patient: { medical_record_no: 'MR-3D-001', name: 'Teaching' },
  study: {
    id: 'internal-study-id',
    study_instance_uid: '1.2.3',
    dicom_patient_id: 'MR-3D-001',
    study_date: '2026-07-20',
    study_time: '09:30:00',
    accession_number: null,
    description: 'Teaching CT',
    series_count: 1,
    instance_count: 3,
    created_at: '2026-07-20T09:30:00Z',
  },
  series: {
    id: 'internal-series-id',
    series_instance_uid: '1.2.4',
    modality: 'CT',
    series_number: 1,
    description: 'Volume source',
    body_part_examined: 'CHEST',
    rows: 512,
    columns: 512,
    instance_count: 3,
    viewability_status: 'eligible',
    viewability_reason: null,
  },
} satisfies AxialViewerContext

const detail = {
  ...context.series,
  instances: [
    {
      id: 'internal-instance-1',
      sop_instance_uid: '1.2.4.1',
      sop_class_uid: '1.2.840',
      transfer_syntax_uid: '1.2.840.10008.1.2.1',
      instance_number: 1,
      image_position_patient: [0, 0, 0],
      image_orientation_patient: [1, 0, 0, 0, 1, 0],
      rows: 512,
      columns: 512,
    },
    {
      id: 'internal-instance-2',
      sop_instance_uid: '1.2.4.2',
      sop_class_uid: '1.2.840',
      transfer_syntax_uid: '1.2.840.10008.1.2.1',
      instance_number: 2,
      image_position_patient: [0, 0, 1],
      image_orientation_patient: [1, 0, 0, 0, 1, 0],
      rows: 512,
      columns: 512,
    },
  ],
} satisfies SeriesDetail

function loadingState() {
  return {
    detail: null,
    eligibility: null,
    error: null,
    errorKind: null,
    imageIds: [],
    reload: vi.fn(),
    status: 'loading' as const,
  }
}

function successState() {
  return {
    detail,
    eligibility: { eligible: true, reason: null, sliceSpacing: 1 },
    error: null,
    errorKind: null,
    imageIds: ['wadouri:private/1', 'wadouri:private/2'],
    reload: vi.fn(),
    status: 'success' as const,
  }
}

function errorState(
  errorKind: 'notFound' | 'notViewable' | 'geometry' | 'service' | 'validation' | 'persistence' | 'unknown',
  error: string,
) {
  return {
    detail: errorKind === 'geometry' ? detail : null,
    eligibility: errorKind === 'geometry'
      ? { eligible: false, reason: '至少需要两个不同空间位置的切片', sliceSpacing: null }
      : null,
    error,
    errorKind,
    imageIds: [],
    reload: vi.fn(),
    status: 'error' as const,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

it('revalidates on entry while keeping titles, SafetyBanner, and return available', async () => {
  vi.mocked(advancedHook.useAdvanced3dSeries).mockReturnValue(loadingState())
  const onClose = vi.fn()
  const user = userEvent.setup()

  render(<Advanced3dViewerPage context={context} onClose={onClose} />)

  expect(advancedHook.useAdvanced3dSeries).toHaveBeenCalledWith('internal-series-id')
  expect(screen.getByText('教学演示软件，不用于临床诊断')).toBeVisible()
  expect(screen.getByText('本机 CT 三维可视化')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'CT 高级 3D' })).toBeVisible()
  expect(screen.getByText('仅供教学演示，请勿用于诊断或治疗决策。')).toBeVisible()
  expect(screen.getByText('正在校验高级 3D 数据…')).toBeVisible()

  await user.click(screen.getByRole('button', { name: '返回轴位查看器' }))
  expect(onClose).toHaveBeenCalledOnce()
})

it('renders only eligible success data and exposes no internal identifiers', () => {
  vi.mocked(advancedHook.useAdvanced3dSeries).mockReturnValue(successState())

  render(<Advanced3dViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByText('高级 3D 画布 2')).toBeVisible()
  const metadata = screen.getByRole('complementary', { name: '高级 3D 元数据' })
  for (const value of [
    'Teaching',
    'MR-3D-001',
    'Teaching CT',
    '2026-07-20',
    'Volume source',
    'CT',
    '512 × 512',
    '3',
    '1.0 mm',
  ]) {
    expect(within(metadata).getByText(value)).toBeVisible()
  }
  expect(document.body).not.toHaveTextContent(
    /internal-study-id|internal-series-id|internal-instance|1\.2\.3|1\.2\.4|wadouri:|private/i,
  )
})

it('offers retry only for a retryable series error', async () => {
  const state = errorState('service', '无法连接本机服务，请确认服务已启动')
  vi.mocked(advancedHook.useAdvanced3dSeries).mockReturnValue(state)
  const user = userEvent.setup()

  render(<Advanced3dViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByRole('alert')).toHaveTextContent('无法连接本机服务')
  expect(screen.queryByLabelText('mock advanced 3D viewport')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重试高级 3D' }))
  expect(state.reload).toHaveBeenCalledOnce()
})

it('re-requests the series after a runtime retry and returns to validation loading', async () => {
  const reload = vi.fn()
  let state: ReturnType<typeof successState> | ReturnType<typeof loadingState> = {
    ...successState(),
    reload,
  }
  vi.mocked(advancedHook.useAdvanced3dSeries).mockImplementation(() => state)
  const user = userEvent.setup()

  function Harness() {
    const [, forceRender] = useState(0)
    reload.mockImplementation(() => {
      state = { ...loadingState(), reload }
      forceRender((current) => current + 1)
    })
    return <Advanced3dViewerPage context={context} onClose={vi.fn()} />
  }

  render(<Harness />)
  expect(screen.getByLabelText('mock advanced 3D viewport')).toBeVisible()

  await user.click(screen.getByRole('button', { name: '模拟 runtime 错误后重试' }))

  expect(reload).toHaveBeenCalledOnce()
  expect(screen.getByText('正在校验高级 3D 数据…')).toBeVisible()
  expect(screen.queryByLabelText('mock advanced 3D viewport')).not.toBeInTheDocument()
})

it('keeps a geometry-blocked series out of the runtime without a false retry', () => {
  vi.mocked(advancedHook.useAdvanced3dSeries).mockReturnValue(errorState(
    'geometry',
    '高级 3D 暂不可用：至少需要两个不同空间位置的切片',
  ))

  render(<Advanced3dViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByRole('alert')).toHaveTextContent(
    '高级 3D 暂不可用：至少需要两个不同空间位置的切片',
  )
  expect(screen.queryByRole('button', { name: '重试高级 3D' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('mock advanced 3D viewport')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '返回轴位查看器' })).toBeEnabled()
})
