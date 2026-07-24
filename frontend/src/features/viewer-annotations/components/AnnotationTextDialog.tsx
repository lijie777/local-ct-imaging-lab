import { type FormEvent, type RefObject, useEffect, useState } from 'react'

import { ModalDialog } from '../../../components/ModalDialog'
import {
  ANNOTATION_TEXT_MAX_LENGTH,
  type AnnotationTextRequest,
  validateAnnotationText,
} from '../model/viewerAnnotation'


interface AnnotationTextDialogProps {
  request: AnnotationTextRequest | null
  returnFocusRef: RefObject<HTMLElement | null>
}

export function AnnotationTextDialog({
  request,
  returnFocusRef,
}: AnnotationTextDialogProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(request?.initialValue ?? '')
    setError(null)
  }, [request])

  const editing = request?.mode === 'edit'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request === null) {
      return
    }
    const result = validateAnnotationText(draft)
    if (result.error !== null || result.value === null) {
      setError(result.error)
      return
    }
    request.complete(result.value)
  }

  return (
    <ModalDialog
      onRequestClose={() => request?.cancel()}
      open={request !== null}
      returnFocusRef={returnFocusRef}
      title={editing ? '修改箭头标注' : '添加箭头标注'}
    >
      {request !== null ? (
        <form className="annotation-text-form" onSubmit={submit}>
          <label>
            标注文字
            <input
              aria-describedby={
                error === null ? undefined : 'annotation-text-error'
              }
              autoComplete="off"
              id="annotation-text"
              maxLength={ANNOTATION_TEXT_MAX_LENGTH + 1}
              name="annotationText"
              onChange={(event) => {
                setDraft(event.currentTarget.value)
                setError(null)
              }}
              type="text"
              value={draft}
            />
          </label>
          <p className="annotation-text-form__hint">
            请输入 1–{ANNOTATION_TEXT_MAX_LENGTH} 个字符，不支持换行或控制字符。
          </p>
          {error !== null ? (
            <p className="form-alert" id="annotation-text-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button
              className="button button--secondary"
              onClick={() => request.cancel()}
              type="button"
            >
              取消
            </button>
            <button className="button button--primary" type="submit">
              {editing ? '保存修改' : '保存标注'}
            </button>
          </div>
        </form>
      ) : null}
    </ModalDialog>
  )
}
