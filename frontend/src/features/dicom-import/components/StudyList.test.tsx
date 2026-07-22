import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Series, Study } from '../model/dicomImport'
import { StudyList } from './StudyList'


const study: Study = {
  id: 'internal-study-id',
  study_instance_uid: '1.2.3',
  dicom_patient_id: 'MR-DICOM-001',
  study_date: '2026-07-20',
  study_time: '09:30:00',
  accession_number: null,
  description: 'Teaching CT',
  series_count: 1,
  instance_count: 2,
  created_at: '2026-07-20T09:30:00Z',
}
const series: Series = {
  id: 'internal-series-id',
  series_instance_uid: '1.2.4',
  modality: 'CT',
  series_number: 1,
  description: 'Axial',
  body_part_examined: 'CHEST',
  rows: 2,
  columns: 2,
  instance_count: 2,
  viewability_status: 'eligible',
  viewability_reason: null,
}
const unsupportedSeries: Series = {
  ...series,
  id: 'unsupported-series-id',
  viewability_status: 'unsupported',
  viewability_reason: 'missing_geometry',
}

it('shows loading, empty, and failure study states', () => {
  const { rerender } = render(
    <StudyList error={null} onOpenSeries={vi.fn()} onRetry={vi.fn()} seriesByStudy={{}} status="loading" studies={[]} />,
  )
  expect(screen.getByText(/正在加载影像检查/)).toBeVisible()

  rerender(
    <StudyList error={null} onOpenSeries={vi.fn()} onRetry={vi.fn()} seriesByStudy={{}} status="success" studies={[]} />,
  )
  expect(screen.getByText(/暂无影像检查/)).toBeVisible()

  rerender(
    <StudyList error="本机服务失败" onOpenSeries={vi.fn()} onRetry={vi.fn()} seriesByStudy={{}} status="error" studies={[]} />,
  )
  expect(screen.getByRole('alert')).toHaveTextContent(/本机服务失败/)
})

it('shows study and series summaries without internal UUIDs', () => {
  render(
    <StudyList
      error={null}
      onOpenSeries={vi.fn()}
      onRetry={vi.fn()}
      seriesByStudy={{ [study.id]: [series] }}
      status="success"
      studies={[study]}
    />,
  )

  expect(screen.getByRole('region', { name: '影像检查' })).toBeVisible()
  expect(screen.getByText('Teaching CT')).toBeVisible()
  expect(screen.getByText(/2026-07-20/)).toBeVisible()
  expect(screen.getByText(/2 个实例/)).toBeVisible()
  expect(screen.getByText(/可供后续查看/)).toBeVisible()
  expect(screen.queryByText(study.id)).not.toBeInTheDocument()
  expect(screen.queryByText(series.id)).not.toBeInTheDocument()
})

it('opens an eligible series with its study context', async () => {
  const onOpenSeries = vi.fn()
  const user = userEvent.setup()
  render(
    <StudyList
      error={null}
      onOpenSeries={onOpenSeries}
      onRetry={vi.fn()}
      seriesByStudy={{ [study.id]: [series] }}
      status="success"
      studies={[study]}
    />,
  )

  await user.click(screen.getByRole('button', { name: '打开轴位查看器' }))

  expect(onOpenSeries).toHaveBeenCalledWith(study, series)
})

it('keeps unsupported series disabled with its stable reason', async () => {
  const onOpenSeries = vi.fn()
  const user = userEvent.setup()
  render(
    <StudyList
      error={null}
      onOpenSeries={onOpenSeries}
      onRetry={vi.fn()}
      seriesByStudy={{ [study.id]: [unsupportedSeries] }}
      status="success"
      studies={[study]}
    />,
  )

  expect(
    screen.getByText('暂不可查看：DICOM 缺少空间位置或方向信息'),
  ).toBeVisible()
  const button = screen.getByRole('button', { name: '暂不可查看' })
  expect(button).toBeDisabled()
  await user.click(button)
  expect(onOpenSeries).not.toHaveBeenCalled()
})

it('explains inconsistent series dimensions without exposing the reason code', () => {
  render(
    <StudyList
      error={null}
      onOpenSeries={vi.fn()}
      onRetry={vi.fn()}
      seriesByStudy={{
        [study.id]: [{ ...unsupportedSeries, viewability_reason: 'inconsistent_dimensions' }],
      }}
      status="success"
      studies={[study]}
    />,
  )

  expect(screen.getByText('暂不可查看：同一序列的图像尺寸不一致')).toBeVisible()
  expect(screen.queryByText(/inconsistent_dimensions/)).not.toBeInTheDocument()
})

it('uses a safe understandable fallback for an unknown unsupported reason', () => {
  render(
    <StudyList
      error={null}
      onOpenSeries={vi.fn()}
      onRetry={vi.fn()}
      seriesByStudy={{
        [study.id]: [{ ...unsupportedSeries, viewability_reason: 'future_reason' }],
      }}
      status="success"
      studies={[study]}
    />,
  )

  expect(screen.getByText('暂不可查看：查看条件不足')).toBeVisible()
  expect(screen.queryByText(/future_reason/)).not.toBeInTheDocument()
})

it('uses the safe fallback for reason codes that match object prototype keys', () => {
  render(
    <StudyList
      error={null}
      onOpenSeries={vi.fn()}
      onRetry={vi.fn()}
      seriesByStudy={{
        [study.id]: [{ ...unsupportedSeries, viewability_reason: 'constructor' }],
      }}
      status="success"
      studies={[study]}
    />,
  )

  expect(screen.getByText('暂不可查看：查看条件不足')).toBeVisible()
  expect(screen.queryByText(/constructor/)).not.toBeInTheDocument()
})
