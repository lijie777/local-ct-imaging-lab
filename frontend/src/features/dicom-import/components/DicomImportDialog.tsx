import { type ChangeEvent, type RefObject, useState } from 'react'

import { ModalDialog } from '../../../components/ModalDialog'
import type { Patient } from '../../patients/model/patient'
import { useImportJob } from '../hooks/useImportJob'
import type { ImportReport } from '../model/dicomImport'
import { ImportReport as ImportReportView } from './ImportReport'


interface DicomImportDialogProps {
  onCancel: () => void
  onImported: (report: ImportReport) => void
  open: boolean
  patient: Pick<Patient, 'id' | 'medical_record_no' | 'name'>
  returnFocusRef: RefObject<HTMLElement | null>
}

const DIRECTORY_INPUT_PROPS = {
  webkitdirectory: '',
} as React.InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string }

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KiB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

export function DicomImportDialog({
  onCancel,
  onImported,
  open,
  patient,
  returnFocusRef,
}: DicomImportDialogProps) {
  const [files, setFiles] = useState<File[]>([])
  const [inputVersion, setInputVersion] = useState(0)
  const importJob = useImportJob({
    onImported,
    open,
    patientId: patient.id,
  })

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.currentTarget.files ?? []))
    importJob.clearError()
  }

  function clearSelection() {
    setFiles([])
    setInputVersion((value) => value + 1)
  }

  function close() {
    clearSelection()
    onCancel()
  }

  async function beginNewImport() {
    if (importJob.job !== null && importJob.phase !== 'queued' && importJob.phase !== 'running') {
      const discarded = await importJob.discard()
      if (!discarded) {
        return
      }
    }
    clearSelection()
    importJob.clearError()
  }

  async function submit() {
    await importJob.prepareAndUpload(files)
  }

  const report = importJob.job?.report ?? null
  const isActiveUpload = importJob.phase === 'uploading'
  const isBackground = importJob.phase === 'queued' || importJob.phase === 'running'
  const canDiscard =
    importJob.job !== null &&
    !isActiveUpload &&
    !isBackground &&
    importJob.phase !== 'loading' &&
    importJob.phase !== 'completed' &&
    importJob.phase !== 'failed'

  return (
    <ModalDialog
      onRequestClose={close}
      open={open}
      returnFocusRef={returnFocusRef}
      title="导入 DICOM"
    >
      <div className="dicom-import-dialog">
        <p>
          当前病人：<strong>{patient.name}</strong>（{patient.medical_record_no}）
        </p>
        <label>
          选择 DICOM 文件
          <input
            accept=".dcm,application/dicom"
            disabled={isActiveUpload || isBackground}
            key={`files-${inputVersion}`}
            multiple
            onChange={selectFiles}
            type="file"
          />
        </label>
        <label>
          选择 DICOM 文件夹
          <input
            {...DIRECTORY_INPUT_PROPS}
            disabled={isActiveUpload || isBackground}
            key={`directory-${inputVersion}`}
            multiple
            onChange={selectFiles}
            type="file"
          />
        </label>
        <p className="dicom-import-dialog__selection">
          已选择 {files.length} 个文件
        </p>
        {importJob.phase === 'loading' ? <p>正在恢复本机导入任务…</p> : null}
        {importJob.phase === 'needs-selection' || importJob.phase === 'paused' ? (
          <p role="status">
            任务已保存。请重新选择同一批文件，系统会从服务端最后确认的位置继续上传。
          </p>
        ) : null}
        {isActiveUpload && importJob.progress !== null ? (
          <div
            aria-label="上传进度"
            aria-valuemax={importJob.progress.totalBytes}
            aria-valuemin={0}
            aria-valuenow={importJob.progress.uploadedBytes}
            className="dicom-import-dialog__progress"
            role="progressbar"
          >
            <strong>正在上传第 {importJob.progress.currentFile} / {importJob.progress.totalFiles} 个文件</strong>
            <span>
              {formatBytes(importJob.progress.uploadedBytes)} / {formatBytes(importJob.progress.totalBytes)}
            </span>
          </div>
        ) : null}
        {importJob.phase === 'queued' ? <p role="status">已入队，关闭窗口后仍会在后台继续处理。</p> : null}
        {importJob.phase === 'running' ? <p role="status">后台正在处理 DICOM，关闭窗口不会取消任务。</p> : null}
        {importJob.error !== null ? (
          <p className="form-alert" role="alert">
            {importJob.error}
          </p>
        ) : null}
        {report !== null ? <ImportReportView report={report} /> : null}
        {importJob.phase === 'failed' && importJob.job?.error_message !== null ? (
          <p className="form-alert" role="alert">{importJob.job?.error_message}</p>
        ) : null}
        <div className="dialog-actions">
          {canDiscard ? (
            <button
              className="button button--secondary"
              onClick={() => void beginNewImport()}
              type="button"
            >
              放弃任务
            </button>
          ) : null}
          {(importJob.phase === 'completed' || importJob.phase === 'failed') ? (
            <button
              className="button button--secondary"
              onClick={() => void beginNewImport()}
              type="button"
            >
              开始新导入
            </button>
          ) : null}
          <button
            className="button button--secondary"
            onClick={close}
            type="button"
          >
            关闭
          </button>
          <button
            className="button button--primary"
            disabled={isActiveUpload || isBackground || importJob.phase === 'loading'}
            onClick={() => void submit()}
            type="button"
          >
            {importJob.phase === 'needs-selection' || importJob.phase === 'paused'
              ? '继续上传'
              : '开始导入'}
          </button>
        </div>
      </div>
    </ModalDialog>
  )
}
