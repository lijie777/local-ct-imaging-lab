import type { RefObject } from 'react'

import { ModalDialog } from '../../../components/ModalDialog'


interface ClearAnnotationsDialogProps {
  annotationCount: number
  onCancel(): void
  onConfirm(): void
  open: boolean
  returnFocusRef: RefObject<HTMLElement | null>
}
export function ClearAnnotationsDialog({
  annotationCount,
  onCancel,
  onConfirm,
  open,
  returnFocusRef,
}: ClearAnnotationsDialogProps) {
  return (
    <ModalDialog
      onRequestClose={onCancel}
      open={open}
      returnFocusRef={returnFocusRef}
      title="清空测量与标注"
    >
      <div className="clear-annotations-warning">
        <p>当前共有 {annotationCount} 项测量与标注。</p>
        <p>
          确认后将清空当前查看器中的全部长度、角度、矩形 ROI 和箭头标注，且不可恢复。
          MPR 十字定位线不会被删除。
        </p>
        <div className="dialog-actions">
          <button
            className="button button--secondary"
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="button button--danger"
            onClick={onConfirm}
            type="button"
          >
            确认清空
          </button>
        </div>
      </div>
    </ModalDialog>
  )
}
