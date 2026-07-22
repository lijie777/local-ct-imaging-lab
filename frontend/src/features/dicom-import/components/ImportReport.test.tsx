import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ImportReport as ImportReportModel } from '../model/dicomImport'
import { ImportReport } from './ImportReport'


const REPORT: ImportReportModel = {
  total: 5,
  success: 1,
  duplicate: 1,
  skipped: 1,
  unsupported: 1,
  failed: 1,
  items: [
    {
      file_name: 'success.dcm',
      category: 'success',
      code: 'imported',
      message: 'CT DICOM 已保存',
      study_instance_uid: null,
      series_instance_uid: null,
      sop_instance_uid: null,
    },
    ...(['duplicate', 'skipped', 'unsupported', 'failed'] as const).map(
      (category) => ({
        file_name: `${category}.dcm`,
        category,
        code: `${category}_code`,
        message: `${category} 原因`,
        study_instance_uid: null,
        series_instance_uid: null,
        sop_instance_uid: null,
      }),
    ),
  ],
}

it('shows five-category counts and accessible non-success details', async () => {
  const user = userEvent.setup()
  render(<ImportReport report={REPORT} />)

  expect(screen.getByRole('region', { name: 'DICOM 导入报告' })).toBeVisible()
  for (const text of ['成功 1', '重复 1', '跳过 1', '不支持 1', '失败 1']) {
    expect(screen.getByText(text)).toBeVisible()
  }
  expect(screen.getByText(/合计 5/)).toBeVisible()
  expect(screen.queryByText('success.dcm')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: /查看非成功文件明细/ }))
  expect(screen.getByText('failed.dcm')).toBeVisible()
  expect(screen.getByText('failed 原因')).toBeVisible()
  expect(screen.getByText('failed_code')).toBeVisible()
})
