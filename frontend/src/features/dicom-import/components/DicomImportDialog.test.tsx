import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'

import * as api from '../api/importJobApi'
import * as uploader from '../core/resumableUploader'
import type { ImportReport } from '../model/dicomImport'
import type { ImportJob } from '../model/importJob'
import { createDicomFile } from '../test/fileFixtures'
import { DicomImportDialog } from './DicomImportDialog'


vi.mock('../api/importJobApi', () => ({
  createImportJob: vi.fn(),
  deleteImportJob: vi.fn(),
  getImportJob: vi.fn(),
  getLatestImportJob: vi.fn(),
}))
vi.mock('../core/resumableUploader', () => ({
  resumeImportUpload: vi.fn(),
}))

const DISCLAIMER = '教学演示软件，不用于临床诊断'
const patient = {
  id: 'patient-1',
  medical_record_no: 'MR-DICOM-001',
  name: 'Teaching',
}

const report: ImportReport = {
  total: 1,
  success: 1,
  duplicate: 0,
  skipped: 0,
  unsupported: 0,
  failed: 0,
  items: [],
}

function job(status: ImportJob['status'], file: File, nextReport = report): ImportJob {
  const uploaded = status !== 'uploading'
  const started = status === 'running' || status === 'completed' || status === 'failed'
  const terminal = status === 'completed' || status === 'failed'
  return {
    id: 'job-1',
    patient_id: patient.id,
    status,
    total_files: 1,
    total_bytes: file.size,
    uploaded_bytes: uploaded ? file.size : 0,
    files: [{
      id: 'file-1',
      ordinal: 0,
      relative_path: file.name,
      size_bytes: file.size,
      last_modified_ms: file.lastModified,
      resume_fingerprint: '0'.repeat(64),
      confirmed_offset: uploaded ? file.size : 0,
    }],
    report: status === 'completed' ? nextReport : null,
    error_code: status === 'failed' ? 'import_failed' : null,
    error_message: status === 'failed' ? '后台导入失败' : null,
    created_at: '2026-07-23T00:00:00Z',
    updated_at: '2026-07-23T00:00:00Z',
    started_at: started ? '2026-07-23T00:00:01Z' : null,
    completed_at: terminal ? '2026-07-23T00:00:02Z' : null,
  }
}

beforeAll(() => {
  if (HTMLDialogElement.prototype.showModal === undefined) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
  }
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.getLatestImportJob).mockResolvedValue(null)
  vi.mocked(api.getImportJob).mockResolvedValue(null as never)
  vi.mocked(api.deleteImportJob).mockResolvedValue()
})

it('shows patient identity, file and folder entries, and repeated disclaimer', async () => {
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
  await waitFor(() => expect(api.getLatestImportJob).toHaveBeenCalledOnce())
})

it('requires files and starts a resumable import for the selected file', async () => {
  const user = userEvent.setup()
  const onImported = vi.fn()
  const file = createDicomFile('image.dcm')
  const created = job('uploading', file)
  const completed = job('completed', file)
  vi.mocked(api.createImportJob).mockResolvedValue(created)
  vi.mocked(uploader.resumeImportUpload).mockResolvedValue(completed)
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

  await user.upload(within(dialog).getByLabelText('选择 DICOM 文件'), file)
  await user.click(within(dialog).getByRole('button', { name: '开始导入' }))

  await waitFor(() => expect(api.createImportJob).toHaveBeenCalledWith(
    'patient-1',
    expect.arrayContaining([
      expect.objectContaining({ relative_path: 'image.dcm', size_bytes: file.size }),
    ]),
    expect.any(AbortSignal),
  ))
  expect(uploader.resumeImportUpload).toHaveBeenCalled()
  expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ success: 1 }))
  expect(within(dialog).getByText(/成功 1/)).toBeVisible()
})

it('keeps failed report until the user abandons the task and starts a new import', async () => {
  const user = userEvent.setup()
  const failedReport = {
    ...report,
    success: 0,
    failed: 1,
    items: [{
      file_name: 'failed.dcm',
      category: 'failed' as const,
      code: 'damaged_dicom',
      message: 'DICOM 文件已损坏',
      study_instance_uid: null,
      series_instance_uid: null,
      sop_instance_uid: null,
    }],
  }
  const file = createDicomFile('failed.dcm')
  const created = job('uploading', file)
  const failed = job('completed', file, failedReport)
  vi.mocked(api.createImportJob).mockResolvedValue(created)
  vi.mocked(uploader.resumeImportUpload).mockResolvedValue(failed)
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
  await user.upload(within(dialog).getByLabelText('选择 DICOM 文件'), file)
  await user.click(within(dialog).getByRole('button', { name: '开始导入' }))

  expect(await within(dialog).findByText('失败 1')).toBeVisible()
  await user.click(
    within(dialog).getByRole('button', { name: /查看非成功文件明细/ }),
  )
  expect(within(dialog).getByText('DICOM 文件已损坏')).toBeVisible()
  expect(within(dialog).getByText(/已选择 1 个文件/)).toBeVisible()

  await user.click(within(dialog).getByRole('button', { name: '开始新导入' }))
  expect(api.deleteImportJob).toHaveBeenCalledWith('job-1', expect.any(AbortSignal))
  expect(within(dialog).queryByText('失败 1')).not.toBeInTheDocument()
  expect(within(dialog).getByText(/已选择 0 个文件/)).toBeVisible()
})

it('allows retry or discard immediately after an upload error', async () => {
  const user = userEvent.setup()
  const file = createDicomFile('image.dcm')
  const existing = job('uploading', file)
  vi.mocked(api.getLatestImportJob).mockResolvedValue(existing)
  vi.mocked(api.getImportJob).mockResolvedValue(existing)
  vi.mocked(uploader.resumeImportUpload).mockRejectedValue(
    new Error('无法连接本机服务，请确认服务已启动'),
  )
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
  await waitFor(() => expect(api.getLatestImportJob).toHaveBeenCalledOnce())
  await user.upload(within(dialog).getByLabelText('选择 DICOM 文件'), file)
  await user.click(within(dialog).getByRole('button', { name: '继续上传' }))

  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/无法连接本机服务/)
  expect(within(dialog).getByLabelText('选择 DICOM 文件')).toBeEnabled()
  expect(within(dialog).getByRole('button', { name: '继续上传' })).toBeEnabled()
  expect(within(dialog).getByRole('button', { name: '放弃任务' })).toBeEnabled()
})
