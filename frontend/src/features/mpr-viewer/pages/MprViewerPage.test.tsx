import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import type { AxialViewerContext } from '../../axial-viewer/model/axialViewer'
import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import * as mprHook from '../hooks/useMprSeries'
import { MprViewerPage } from './MprViewerPage'


vi.mock('../hooks/useMprSeries', () => ({ useMprSeries: vi.fn() }))
vi.mock('../components/MprViewportGrid', () => ({
  MprViewportGrid: ({ imageIds, metadata }: { imageIds: string[]; metadata?: ReactNode }) => (
    <div>
      <div aria-label="CT 轴位图像画布">轴位 {imageIds.length}</div>
      <div aria-label="CT 冠状位图像画布">冠状位</div>
      <div aria-label="CT 矢状位图像画布">矢状位</div>
      <aside aria-label="三视图元数据">{metadata}</aside>
    </div>
  ),
}))

const context = {
  patient: { medical_record_no: 'MR-MPR-001', name: 'Teaching' },
  study: {
    id: 'internal-study-id',
    study_instance_uid: '1.2.3',
    dicom_patient_id: 'MR-MPR-001',
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
    description: 'MPR source',
    body_part_examined: 'CHEST',
    rows: 2,
    columns: 2,
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
      rows: 2,
      columns: 2,
    },
    {
      id: 'internal-instance-2',
      sop_instance_uid: '1.2.4.2',
      sop_class_uid: '1.2.840',
      transfer_syntax_uid: '1.2.840.10008.1.2.1',
      instance_number: 2,
      image_position_patient: [0, 0, 1],
      image_orientation_patient: [1, 0, 0, 0, 1, 0],
      rows: 2,
      columns: 2,
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

function successState(sliceSpacing: number | null = 1) {
  return {
    detail,
    eligibility: { eligible: true, reason: null, sliceSpacing },
    error: null,
    errorKind: null,
    imageIds: ['a', 'b'],
    reload: vi.fn(),
    status: 'success' as const,
  }
}

function errorState(
  errorKind: 'notFound' | 'notViewable' | 'geometry' | 'service' | 'validation' | 'persistence' | 'unknown',
  error: string,
) {
  return {
    detail: null,
    eligibility: null,
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

it('revalidates the series on entry and keeps return plus SafetyBanner available while loading', () => {
  vi.mocked(mprHook.useMprSeries).mockReturnValue(loadingState())

  render(<MprViewerPage context={context} onClose={vi.fn()} />)

  expect(mprHook.useMprSeries).toHaveBeenCalledWith('internal-series-id')
  expect(screen.getByText('正在校验三视图数据…')).toBeVisible()
  expect(screen.getByRole('button', { name: '返回轴位查看器' })).toBeEnabled()
  expect(screen.getByText('教学演示软件，不用于临床诊断')).toBeVisible()
})

it('moves from validation to the three-view success state without exposing internal ids', async () => {
  vi.mocked(mprHook.useMprSeries).mockReturnValue(loadingState())
  const { rerender } = render(
    <MprViewerPage context={context} onClose={vi.fn()} />,
  )
  expect(screen.getByText('正在校验三视图数据…')).toBeVisible()

  vi.mocked(mprHook.useMprSeries).mockReturnValue(successState())
  rerender(<MprViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByRole('heading', { name: 'CT 三视图' })).toBeVisible()
  expect(screen.getByLabelText('CT 轴位图像画布')).toBeVisible()
  expect(screen.getByLabelText('CT 冠状位图像画布')).toBeVisible()
  expect(screen.getByLabelText('CT 矢状位图像画布')).toBeVisible()
  const metadata = screen.getByRole('complementary', { name: '三视图元数据' })
  expect(within(metadata).getByText('Teaching')).toBeVisible()
  expect(within(metadata).getByText('MR-MPR-001')).toBeVisible()
  expect(within(metadata).getByText('Teaching CT')).toBeVisible()
  expect(within(metadata).getByText('2026-07-20')).toBeVisible()
  expect(within(metadata).getByText('MPR source')).toBeVisible()
  expect(within(metadata).getByText('CT')).toBeVisible()
  expect(within(metadata).getByText('2 × 2')).toBeVisible()
  expect(within(metadata).getByText('3')).toBeVisible()
  expect(within(metadata).getByText('1.0 mm')).toBeVisible()
  expect(screen.queryByText('internal-study-id')).not.toBeInTheDocument()
  expect(screen.queryByText('internal-series-id')).not.toBeInTheDocument()
  expect(screen.queryByText('internal-instance-1')).not.toBeInTheDocument()
  expect(screen.queryByText('1.2.3')).not.toBeInTheDocument()
  expect(screen.queryByText('1.2.4')).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent(/wadouri:|codec|C:\\private|managed_path/i)
})

it('shows unavailable spacing safely in the metadata panel', () => {
  vi.mocked(mprHook.useMprSeries).mockReturnValue(successState(null))
  render(<MprViewerPage context={context} onClose={vi.fn()} />)

  const metadata = screen.getByRole('complementary', { name: '三视图元数据' })
  expect(within(metadata).getByText('不可推导')).toBeVisible()
})

it('returns to the axial viewer from the success state', async () => {
  vi.mocked(mprHook.useMprSeries).mockReturnValue(successState())
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<MprViewerPage context={context} onClose={onClose} />)

  await user.click(screen.getByRole('button', { name: '返回轴位查看器' }))

  expect(onClose).toHaveBeenCalledOnce()
})

it.each([
  ['notFound', '未找到该本机 CT 序列，请返回轴位查看器', false],
  ['notViewable', '该序列暂不可查看，请返回轴位查看器', false],
  ['geometry', '三视图暂不可用：至少需要两个不同空间位置的切片', false],
  ['validation', '影像请求无效，请返回轴位查看器', false],
  ['service', '无法连接本机服务，请确认服务已启动', true],
  ['persistence', '本机影像数据暂时不可用，请重试或返回轴位查看器', true],
  ['unknown', '无法加载三视图，请重试或返回轴位查看器', true],
] as const)('shows safe %s recovery actions without leaking internals', async (
  kind,
  message,
  retryable,
) => {
  const state = errorState(kind, message)
  vi.mocked(mprHook.useMprSeries).mockReturnValue(state)
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<MprViewerPage context={context} onClose={onClose} />)

  expect(screen.getByRole('alert')).toHaveTextContent(message)
  expect(screen.getByText('教学演示软件，不用于临床诊断')).toBeVisible()
  expect(screen.getByRole('button', { name: '返回轴位查看器' })).toBeEnabled()
  expect(document.body).not.toHaveTextContent(
    /internal-series-id|internal-study-id|wadouri:|https?:|codec|stack|C:\\private/i,
  )
  const retry = screen.queryByRole('button', { name: '重试三视图' })
  if (retryable) {
    expect(retry).toBeEnabled()
    await user.click(retry!)
    expect(state.reload).toHaveBeenCalledOnce()
  } else {
    expect(retry).not.toBeInTheDocument()
  }

  await user.click(screen.getByRole('button', { name: '返回轴位查看器' }))
  expect(onClose).toHaveBeenCalledOnce()
})
