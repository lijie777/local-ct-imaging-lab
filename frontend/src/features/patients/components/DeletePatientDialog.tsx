import type { RefObject } from 'react'

import { ModalDialog } from '../../../components/ModalDialog'
import type { Patient } from '../model/patient'


interface DeletePatientDialogProps {
  deleting: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  patient: Patient | null
  returnFocusRef: RefObject<HTMLElement | null>
}

export function DeletePatientDialog({
  deleting,
  error,
  onCancel,
  onConfirm,
  open,
  patient,
  returnFocusRef,
}: DeletePatientDialogProps) {
  if (patient === null) {
    return null
  }

  return (
    <ModalDialog
      onRequestClose={onCancel}
      open={open}
      returnFocusRef={returnFocusRef}
      title="删除病人"
    >
      <div className="delete-confirmation">
        {error !== null ? (
          <p className="form-alert" role="alert">
            {error}
          </p>
        ) : null}
        <p>即将永久删除以下病人：</p>
        <dl>
          <div>
            <dt>姓名</dt>
            <dd>{patient.name}</dd>
          </div>
          <div>
            <dt>病历号</dt>
            <dd>{patient.medical_record_no}</dd>
          </div>
        </dl>
        <p className="delete-confirmation__warning">
          此操作会同步删除病人、检查、序列、实例索引和受管 DICOM 文件，且不可恢复。
          只有收到服务器删除成功响应后，病人才会从页面移除。
        </p>
        <div className="dialog-actions">
          <button
            className="button button--secondary"
            disabled={deleting}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="button button--danger"
            disabled={deleting}
            onClick={onConfirm}
            type="button"
          >
            {deleting ? '正在删除…' : '确认删除'}
          </button>
        </div>
      </div>
    </ModalDialog>
  )
}
