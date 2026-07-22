import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from 'react'

import { SafetyBanner } from './SafetyBanner'


interface ModalDialogProps {
  children: ReactNode
  open: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  title: string
  onRequestClose: () => void
}

export function ModalDialog({
  children,
  open,
  returnFocusRef,
  title,
  onRequestClose,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false
        returnFocusRef.current?.focus()
      }
      return
    }

    const dialog = dialogRef.current
    if (dialog === null) {
      return
    }

    wasOpenRef.current = true
    if (!dialog.open) {
      dialog.showModal()
    }
    dialog
      .querySelector<HTMLElement>('input, select, textarea, button')
      ?.focus()
  }, [open, returnFocusRef])

  if (!open) {
    return null
  }

  return (
    <dialog
      aria-labelledby={titleId}
      className="modal-dialog"
      onCancel={(event) => {
        event.preventDefault()
        onRequestClose()
      }}
      ref={dialogRef}
    >
      <div className="modal-dialog__content">
        <h2 id={titleId}>{title}</h2>
        <SafetyBanner />
        {children}
      </div>
    </dialog>
  )
}
