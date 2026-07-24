import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import * as axialHook from '../hooks/useAxialSeries'
import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import type { AxialViewerContext } from '../model/axialViewer'
import { AxialViewerPage } from './AxialViewerPage'


const axialViewportRender = vi.hoisted(() => vi.fn())

vi.mock('../hooks/useAxialSeries', () => ({ useAxialSeries: vi.fn() }))
vi.mock('../components/AxialViewport', () => ({
  AxialViewport: ({ imageIds }: { imageIds: string[] }) => {
    axialViewportRender()
    return <div>viewport {imageIds.length}</div>
  },
}))
vi.mock('../../mpr-viewer/pages/MprViewerPage', () => ({
  MprViewerPage: ({ onClose }: { onClose: () => void }) => (
    <section>
      <h1>CT 三视图</h1>
      <button onClick={onClose} type="button">返回轴位查看器</button>
    </section>
  ),
}))
vi.mock('../../advanced-3d-viewer/pages/Advanced3dViewerPage', () => ({
  Advanced3dViewerPage: ({ onClose }: { onClose: () => void }) => (
    <section>
      <h1>CT 高级 3D</h1>
      <button onClick={onClose} type="button">返回轴位查看器</button>
    </section>
  ),
}))

const context = {
  patient: { medical_record_no: 'MR-DICOM-001', name: 'Teaching' },
  study: {
    id: 'internal-study-id',
    study_instance_uid: '1.2.3',
    dicom_patient_id: 'MR-DICOM-001',
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
    description: 'Axial',
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
      id: 'instance-1',
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
      id: 'instance-2',
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

it('shows safety notice, visible context, viewport, and returns', async () => {
  vi.mocked(axialHook.useAxialSeries).mockReturnValue({
    detail: null,
    error: null,
    imageIds: ['a', 'b', 'c'],
    reload: vi.fn(),
    status: 'success',
  })
  const onClose = vi.fn()
  const user = userEvent.setup()

  render(<AxialViewerPage context={context} onClose={onClose} />)

  expect(screen.getByText('教学演示软件，不用于临床诊断')).toBeVisible()
  expect(screen.getByText('Teaching')).toBeVisible()
  expect(screen.getByText('MR-DICOM-001')).toBeVisible()
  expect(screen.getByText('Teaching CT')).toBeVisible()
  expect(screen.getByText('Axial')).toBeVisible()
  expect(screen.getByText('viewport 3')).toBeVisible()
  expect(screen.queryByText(context.study.id)).not.toBeInTheDocument()
  expect(screen.queryByText(context.series.id)).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '返回病人管理' }))
  expect(onClose).toHaveBeenCalledOnce()
})

it('shows a loading state under the safety notice', () => {
  vi.mocked(axialHook.useAxialSeries).mockReturnValue({
    detail: null,
    error: null,
    imageIds: [],
    reload: vi.fn(),
    status: 'loading',
  })

  render(<AxialViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByText('正在加载轴位影像…')).toBeVisible()
  expect(screen.getByText('教学演示软件，不用于临床诊断')).toBeVisible()
})

it('creates a fresh viewport each time the page is reopened', () => {
  vi.mocked(axialHook.useAxialSeries).mockReturnValue({
    detail: null,
    error: null,
    imageIds: ['a', 'b', 'c'],
    reload: vi.fn(),
    status: 'success',
  })

  const first = render(<AxialViewerPage context={context} onClose={vi.fn()} />)
  expect(screen.getByText('viewport 3')).toBeVisible()
  first.unmount()

  render(<AxialViewerPage context={context} onClose={vi.fn()} />)
  expect(screen.getByText('viewport 3')).toBeVisible()
})

it('shows a retryable local-service error without internal details', async () => {
  const reload = vi.fn()
  vi.mocked(axialHook.useAxialSeries).mockReturnValue({
    detail: null,
    error: '无法连接本机服务，请确认服务已启动',
    imageIds: [],
    reload,
    status: 'error',
  })
  const user = userEvent.setup()

  render(<AxialViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByRole('alert')).toHaveTextContent('无法连接本机服务')
  expect(screen.getByRole('button', { name: '返回病人管理' })).toBeVisible()
  expect(screen.queryByText(/internal-series-id|private|codec/i)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重试' }))
  expect(reload).toHaveBeenCalledOnce()
})

it('provides named keyboard controls and non-color state text', () => {
  vi.mocked(axialHook.useAxialSeries).mockReturnValue({
    detail: null,
    error: '本机 DICOM 文件缺失',
    imageIds: [],
    reload: vi.fn(),
    status: 'error',
  })

  render(<AxialViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByRole('button', { name: '返回病人管理' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
  expect(screen.getByRole('alert')).toHaveTextContent('本机 DICOM 文件缺失')
})

it('offers MPR for eligible multiple positions and recreates axial defaults after returning', async () => {
  axialViewportRender.mockClear()
  vi.mocked(axialHook.useAxialSeries).mockReturnValue({
    detail,
    error: null,
    imageIds: ['a', 'b'],
    reload: vi.fn(),
    status: 'success',
  })
  const user = userEvent.setup()
  render(<AxialViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByRole('button', { name: '进入三视图' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '进入高级 3D' })).toBeEnabled()
  expect(axialViewportRender).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: '进入三视图' }))
  expect(screen.getByRole('heading', { name: 'CT 三视图' })).toBeVisible()

  await user.click(screen.getByRole('button', { name: '返回轴位查看器' }))
  expect(screen.getByRole('heading', { name: '轴位查看器' })).toBeVisible()
  expect(screen.getByText('viewport 2')).toBeVisible()
  expect(axialViewportRender).toHaveBeenCalledTimes(2)
})

it('opens advanced 3D independently and recreates axial viewing after returning', async () => {
  axialViewportRender.mockClear()
  vi.mocked(axialHook.useAxialSeries).mockReturnValue({
    detail,
    error: null,
    imageIds: ['a', 'b'],
    reload: vi.fn(),
    status: 'success',
  })
  const user = userEvent.setup()
  render(<AxialViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByRole('button', { name: '进入高级 3D' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '进入三视图' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '进入高级 3D' }))
  expect(screen.getByRole('heading', { name: 'CT 高级 3D' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'CT 三视图' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '返回轴位查看器' }))
  expect(screen.getByRole('heading', { name: '轴位查看器' })).toBeVisible()
  expect(screen.getByText('viewport 2')).toBeVisible()
  expect(axialViewportRender).toHaveBeenCalledTimes(2)
})

it('keeps axial viewing usable and explains why a single-position series cannot enter MPR', () => {
  vi.mocked(axialHook.useAxialSeries).mockReturnValue({
    detail: { ...detail, instance_count: 1, instances: [detail.instances[0]] },
    error: null,
    imageIds: ['a'],
    reload: vi.fn(),
    status: 'success',
  })

  render(<AxialViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByText('viewport 1')).toBeVisible()
  expect(screen.getByText('三视图暂不可用：至少需要两个不同空间位置的切片')).toBeVisible()
  expect(screen.getByRole('button', { name: '三视图暂不可用' })).toBeDisabled()
  expect(screen.getByText('高级 3D 暂不可用：至少需要两个不同空间位置的切片')).toBeVisible()
  expect(screen.getByRole('button', { name: '高级 3D 暂不可用' })).toBeDisabled()
})

it('keeps axial usable when multiple instances share one spatial position', () => {
  vi.mocked(axialHook.useAxialSeries).mockReturnValue({
    detail: {
      ...detail,
      instances: [
        detail.instances[0],
        { ...detail.instances[1], image_position_patient: [0, 0, 0] },
      ],
    },
    error: null,
    imageIds: ['a', 'b'],
    reload: vi.fn(),
    status: 'success',
  })

  render(<AxialViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByText('viewport 2')).toBeVisible()
  expect(screen.getByText('三视图暂不可用：至少需要两个不同空间位置的切片')).toBeVisible()
  expect(screen.getByRole('button', { name: '三视图暂不可用' })).toBeDisabled()
})

it('uses the safe fallback for an unknown viewability reason while axial remains available', () => {
  vi.mocked(axialHook.useAxialSeries).mockReturnValue({
    detail: {
      ...detail,
      viewability_reason: 'future_reason',
      viewability_status: 'unsupported',
    },
    error: null,
    imageIds: ['a', 'b'],
    reload: vi.fn(),
    status: 'success',
  })

  render(<AxialViewerPage context={context} onClose={vi.fn()} />)

  expect(screen.getByText('viewport 2')).toBeVisible()
  expect(screen.getByText('三视图暂不可用：查看条件不足')).toBeVisible()
  expect(screen.getByRole('button', { name: '三视图暂不可用' })).toBeDisabled()
})
