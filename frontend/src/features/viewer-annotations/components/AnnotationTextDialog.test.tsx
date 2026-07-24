import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'

import type { AnnotationTextRequest } from '../model/viewerAnnotation'
import { AnnotationTextDialog } from './AnnotationTextDialog'


const DISCLAIMER = '教学演示软件，不用于临床诊断'

beforeAll(() => {
  if (HTMLDialogElement.prototype.showModal === undefined) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
  }
})

function Harness({
  initialValue = '',
  mode = 'create',
  onCancel = vi.fn(),
  onComplete = vi.fn(),
}: {
  initialValue?: string
  mode?: AnnotationTextRequest['mode']
  onCancel?: () => void
  onComplete?: (value: string) => void
}) {
  const [request, setRequest] = useState<AnnotationTextRequest | null>({
    initialValue,
    mode,
    cancel: () => {
      onCancel()
      setRequest(null)
    },
    complete: (value) => {
      onComplete(value)
      setRequest(null)
    },
  })
  const viewportRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={viewportRef} type="button">影像视口</button>
      <AnnotationTextDialog request={request} returnFocusRef={viewportRef} />
    </>
  )
}

describe('AnnotationTextDialog', () => {
  it('creates trimmed text, repeats disclaimer, and restores viewport focus', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)

    expect(screen.getByRole('dialog', { name: '添加箭头标注' })).toBeVisible()
    expect(screen.getByText(DISCLAIMER)).toBeVisible()
    const input = screen.getByRole('textbox', { name: '标注文字' })
    expect(input).toHaveAttribute('id', 'annotation-text')
    expect(input).toHaveAttribute('name', 'annotationText')
    expect(input).toHaveFocus()
    await user.type(input, '  teaching target  ')
    await user.click(screen.getByRole('button', { name: '保存标注' }))

    expect(onComplete).toHaveBeenCalledWith('teaching target')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '影像视口' })).toHaveFocus()
  })

  it('loads edit text and keeps invalid input open with exact errors', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(
      <Harness
        initialValue="existing label"
        mode="edit"
        onComplete={onComplete}
      />,
    )

    const input = screen.getByRole('textbox', { name: '标注文字' })
    expect(input).toHaveValue('existing label')
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入标注文字')

    fireEvent.change(input, { target: { value: 'line\u0001break' } })
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '标注文字不能包含换行或控制字符',
    )
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it('accepts exactly 200 characters and rejects longer text', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    const { rerender } = render(<Harness onComplete={onComplete} />)
    const input = screen.getByRole('textbox', { name: '标注文字' })

    fireEvent.change(input, { target: { value: 'x'.repeat(201) } })
    await user.click(screen.getByRole('button', { name: '保存标注' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '标注文字不能超过 200 个字符',
    )

    rerender(<Harness key="boundary" onComplete={onComplete} />)
    fireEvent.change(screen.getByRole('textbox', { name: '标注文字' }), {
      target: { value: 'x'.repeat(200) },
    })
    await user.click(screen.getByRole('button', { name: '保存标注' }))
    expect(onComplete).toHaveBeenCalledWith('x'.repeat(200))
  })

  it('cancels create and edit through buttons or Escape without completing', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onComplete = vi.fn()
    const { rerender } = render(
      <Harness onCancel={onCancel} onComplete={onComplete} />,
    )

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()

    rerender(
      <Harness
        key="edit"
        initialValue="old"
        mode="edit"
        onCancel={onCancel}
        onComplete={onComplete}
      />,
    )
    fireEvent(screen.getByRole('dialog'), new Event('cancel'))
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onComplete).not.toHaveBeenCalled()
  })
})
