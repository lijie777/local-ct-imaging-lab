import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'

import * as api from '../api/dicomImportApi'
import { createDicomFile } from '../test/fileFixtures'
import { DicomImportDialog } from './DicomImportDialog'


vi.mock('../api/dicomImportApi', () => ({ importDicom: vi.fn() }))

const DISCLAIMER = '教学演示软件，不用于临床诊断'
const patient = {
  id: 'patient-1',
  medical_record_no: 'MR-DICOM-001',
  name: 'Teaching',
}

beforeAll(() => {
  if (HTMLDialogElement.prototype.showModal === undefined) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
  }
})

beforeEach(() => vi.resetAllMocks())

it('shows patient identity, file and folder entries, and repeated disclaimer', () => {
  render(
    <DicomImportDialog
      onCancel={vi.fn()}
      onImported={vi.fn()}
      open
      patient={patient}
      returnFocusRef={createRef()}
    />,
  )

  const dialog = screen.getByRole('dialog', { name: '导入 DICOM' })
  expect(within(dialog).getByText(DISCLAIMER)).toBeVisible()
  expect(within(dialog).getByText(/Teaching/)).toBeVisible()
  expect(within(dialog).getByText(/MR-DICOM-001/)).toBeVisible()
  expect(within(dialog).getByLabelText('选择 DICOM 文件')).toHaveAttribute(
    'multiple',
  )
  expect(within(dialog).getByLabelText('选择 DICOM 文件夹')).toHaveAttribute(
    'webkitdirectory',
  )
})

it('requires files and imports the selected file', async () => {
  const user = userEvent.setup()
  const onImported = vi.fn()
  vi.mocked(api.importDicom).mockResolvedValue({
    total: 1,
    success: 1,
    duplicate: 0,
    skipped: 0,
    unsupported: 0,
    failed: 0,
    items: [],
  })
  render(
    <DicomImportDialog
      onCancel={vi.fn()}
      onImported={onImported}
      open
      patient={patient}
      returnFocusRef={createRef()}
    />,
  )
  const dialog = screen.getByRole('dialog', { name: '导入 DICOM' })

  await user.click(within(dialog).getByRole('button', { name: '开始导入' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/请选择/)

  const file = createDicomFile()
  await user.upload(within(dialog).getByLabelText('选择 DICOM 文件'), file)
  await user.click(within(dialog).getByRole('button', { name: '开始导入' }))

  await waitFor(() => expect(api.importDicom).toHaveBeenCalledWith('patient-1', [file]))
  expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ success: 1 }))
  expect(within(dialog).getByText(/成功 1/)).toBeVisible()
})

it('keeps failed files and report until a new import is started', async () => {
  const user = userEvent.setup()
  vi.mocked(api.importDicom).mockResolvedValue({
    total: 1,
    success: 0,
    duplicate: 0,
    skipped: 0,
    unsupported: 0,
    failed: 1,
    items: [
      {
        file_name: 'failed.dcm',
        category: 'failed',
        code: 'damaged_dicom',
        message: 'DICOM 文件已损坏',
        study_instance_uid: null,
        series_instance_uid: null,
        sop_instance_uid: null,
      },
    ],
  })
  render(
    <DicomImportDialog
      onCancel={vi.fn()}
      onImported={vi.fn()}
      open
      patient={patient}
      returnFocusRef={createRef()}
    />,
  )
  const dialog = screen.getByRole('dialog', { name: '导入 DICOM' })
  const input = within(dialog).getByLabelText('选择 DICOM 文件')
  const file = createDicomFile('failed.dcm')

  await user.upload(input, file)
  await user.click(within(dialog).getByRole('button', { name: '开始导入' }))

  expect(await within(dialog).findByText('失败 1')).toBeVisible()
  await user.click(
    within(dialog).getByRole('button', { name: /查看非成功文件明细/ }),
  )
  expect(within(dialog).getByText('DICOM 文件已损坏')).toBeVisible()
  expect(within(dialog).getByText(/已选择 1 个文件/)).toBeVisible()
  expect((input as HTMLInputElement).files).toHaveLength(1)
  expect((input as HTMLInputElement).files?.[0]).toBe(file)

  await user.click(within(dialog).getByRole('button', { name: '开始新导入' }))
  expect(within(dialog).queryByText('失败 1')).not.toBeInTheDocument()
  expect(within(dialog).getByText(/已选择 0 个文件/)).toBeVisible()
})
