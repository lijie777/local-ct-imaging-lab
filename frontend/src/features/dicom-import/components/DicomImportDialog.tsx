import { type ChangeEvent, type RefObject, useState } from 'react'

import { ModalDialog } from '../../../components/ModalDialog'
import type { Patient } from '../../patients/model/patient'
import { importDicom } from '../api/dicomImportApi'
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

export function DicomImportDialog({
  onCancel,
  onImported,
  open,
  patient,
  returnFocusRef,
}: DicomImportDialogProps) {
  const [files, setFiles] = useState<File[]>([])
  const [report, setReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [inputVersion, setInputVersion] = useState(0)

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.currentTarget.files ?? []))
    setReport(null)
    setError(null)
  }

  function clearSelection() {
    setFiles([])
    setInputVersion((value) => value + 1)
  }

  function close() {
    if (importing) {
      return
    }
    clearSelection()
    setReport(null)
    setError(null)
    onCancel()
  }

  function beginNewImport() {
    clearSelection()
    setReport(null)
    setError(null)
  }

  async function submit() {
    if (files.length === 0) {
      setError('请选择至少一个 DICOM 文件或文件夹')
      return
    }

    setImporting(true)
    setError(null)
    try {
      const result = await importDicom(patient.id, files)
      setReport(result)
      if (result.failed === 0) {
        clearSelection()
      }
      onImported(result)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '导入失败，请重试',
      )
    } finally {
      setImporting(false)
    }
  }

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
            disabled={importing}
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
            disabled={importing}
            key={`directory-${inputVersion}`}
            multiple
            onChange={selectFiles}
            type="file"
          />
        </label>
        <p className="dicom-import-dialog__selection">
          已选择 {files.length} 个文件
        </p>
        {error !== null ? (
          <p className="form-alert" role="alert">
            {error}
          </p>
        ) : null}
        {report !== null ? <ImportReportView report={report} /> : null}
        <div className="dialog-actions">
          {report !== null ? (
            <button
              className="button button--secondary"
              disabled={importing}
              onClick={beginNewImport}
              type="button"
            >
              开始新导入
            </button>
          ) : null}
          <button
            className="button button--secondary"
            disabled={importing}
            onClick={close}
            type="button"
          >
            关闭
          </button>
          <button
            className="button button--primary"
            disabled={importing}
            onClick={() => void submit()}
            type="button"
          >
            {importing ? '正在导入…' : '开始导入'}
          </button>
        </div>
      </div>
    </ModalDialog>
  )
}
