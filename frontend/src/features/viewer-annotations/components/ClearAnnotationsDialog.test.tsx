import { beforeAll, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'

import { ClearAnnotationsDialog } from './ClearAnnotationsDialog'


const DISCLAIMER = '教学演示软件，不用于临床诊断'

beforeAll(() => {
  if (HTMLDialogElement.prototype.showModal === undefined) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
  }
})
function Harness({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(true)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        全部清空
      </button>
      <ClearAnnotationsDialog
        annotationCount={4}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          onConfirm()
          setOpen(false)
        }}
        open={open}
        returnFocusRef={triggerRef}
      />
    </>
  )
}

it('shows the exact count, irreversible consequence, and non-clinical banner', () => {
  render(<Harness onConfirm={vi.fn()} />)

  expect(screen.getByRole('dialog', { name: '清空测量与标注' })).toBeVisible()
  expect(screen.getByText(DISCLAIMER)).toBeVisible()
  expect(screen.getByText(/当前共有 4 项测量与标注/)).toBeVisible()
  expect(screen.getByText(/不可恢复/)).toBeVisible()
  expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
})

it('only confirms from the danger action and restores focus on cancellation', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn()
  render(<Harness onConfirm={onConfirm} />)

  fireEvent(screen.getByRole('dialog'), new Event('cancel'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onConfirm).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '全部清空' })).toHaveFocus()

  await user.click(screen.getByRole('button', { name: '全部清空' }))
  await user.click(screen.getByRole('button', { name: '确认清空' }))
  expect(onConfirm).toHaveBeenCalledOnce()
})
