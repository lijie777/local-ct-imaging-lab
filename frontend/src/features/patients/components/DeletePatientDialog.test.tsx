import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'

import type { Patient } from '../model/patient'
import { DeletePatientDialog } from './DeletePatientDialog'


const DISCLAIMER = '教学演示软件，不用于临床诊断'
const PATIENT = {
  id: '11111111-1111-4111-8111-111111111111',
  medical_record_no: 'MR-DELETE',
  name: '待删除病人',
  sex: 'unknown',
  birth_date: null,
  study_count: 0,
  latest_study_date: null,
  created_at: '2026-07-17T02:00:00Z',
  updated_at: '2026-07-17T02:00:00Z',
} satisfies Patient

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
        删除病人
      </button>
      <DeletePatientDialog
        deleting={false}
        error={null}
        onCancel={() => setOpen(false)}
        onConfirm={onConfirm}
        open={open}
        patient={PATIENT}
        returnFocusRef={triggerRef}
      />
    </>
  )
}

describe('DeletePatientDialog', () => {
  it('shows identity, consequences, disclaimer, and focuses cancel first', () => {
    render(<Harness onConfirm={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: '删除病人' })

    expect(within(dialog).getByText(DISCLAIMER)).toBeVisible()
    expect(within(dialog).getByText(PATIENT.name)).toBeVisible()
    expect(within(dialog).getByText(PATIENT.medical_record_no)).toBeVisible()
    expect(within(dialog).getByText(/不可恢复/)).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
  })

  it('Escape and cancel never confirm deletion and restore trigger focus', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)

    fireEvent(screen.getByRole('dialog', { name: '删除病人' }), new Event('cancel'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '删除病人' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: '删除病人' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
