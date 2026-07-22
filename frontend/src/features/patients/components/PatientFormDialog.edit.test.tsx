import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'

import * as patientApi from '../api/patientApi'
import type { Patient } from '../model/patient'
import { PatientFormDialog } from './PatientFormDialog'


vi.mock('../api/patientApi', () => ({
  createPatient: vi.fn(),
  updatePatient: vi.fn(),
}))

const DISCLAIMER = '教学演示软件，不用于临床诊断'
const PATIENT = {
  id: '11111111-1111-4111-8111-111111111111',
  medical_record_no: 'MR-EDIT',
  name: '编辑前姓名',
  sex: 'female',
  birth_date: '1990-01-02',
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

beforeEach(() => {
  vi.resetAllMocks()
})

function Harness({ onSaved = vi.fn() }: { onSaved?: (patient: Patient) => void }) {
  const [open, setOpen] = useState(true)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={editButtonRef} type="button" onClick={() => setOpen(true)}>
        编辑病人
      </button>
      <PatientFormDialog
        onCancel={() => setOpen(false)}
        onSaved={(patient) => {
          onSaved(patient)
          setOpen(false)
        }}
        open={open}
        patient={PATIENT}
        returnFocusRef={editButtonRef}
      />
    </>
  )
}

describe('PatientFormDialog edit flow', () => {
  it('opens with accessible identity, repeated disclaimer, focus, and initial values', () => {
    render(<Harness />)

    const dialog = screen.getByRole('dialog', { name: '编辑病人' })
    expect(within(dialog).getByText(DISCLAIMER)).toBeVisible()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(within(dialog).getByLabelText('病历号')).toHaveValue('MR-EDIT')
    expect(within(dialog).getByLabelText('姓名')).toHaveValue('编辑前姓名')
    expect(within(dialog).getByLabelText('性别')).toHaveValue('female')
    expect(within(dialog).getByLabelText('出生日期')).toHaveValue('1990-01-02')
  })

  it('keeps the entire edit draft after a server failure', async () => {
    const user = userEvent.setup()
    vi.mocked(patientApi.updatePatient).mockRejectedValue(
      new Error('无法保存本次操作，请重试'),
    )
    render(<Harness />)
    const dialog = screen.getByRole('dialog', { name: '编辑病人' })
    const nameInput = within(dialog).getByLabelText('姓名')
    const birthDateInput = within(dialog).getByLabelText('出生日期')

    await user.clear(nameInput)
    await user.type(nameInput, '失败后保留姓名')
    await user.clear(birthDateInput)
    await user.type(birthDateInput, '2000-02-03')
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await within(dialog).findByRole('alert')).toBeVisible()
    expect(nameInput).toHaveValue('失败后保留姓名')
    expect(birthDateInput).toHaveValue('2000-02-03')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(within(dialog).getByText(DISCLAIMER)).toBeVisible()
  })

  it('validates immediately and clears temporary edits on cancel', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    let dialog = screen.getByRole('dialog', { name: '编辑病人' })
    const nameInput = within(dialog).getByLabelText('姓名')

    await user.clear(nameInput)
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(await within(dialog).findByText(/必填/)).toBeVisible()
    expect(patientApi.updatePatient).not.toHaveBeenCalled()

    await user.type(nameInput, '临时姓名')
    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '编辑病人' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: '编辑病人' }))
    dialog = screen.getByRole('dialog', { name: '编辑病人' })
    expect(within(dialog).getByLabelText('姓名')).toHaveValue('编辑前姓名')
  })

  it('submits edited fields and reports the server result', async () => {
    const user = userEvent.setup()
    const updated = { ...PATIENT, name: '保存后的姓名' }
    const onSaved = vi.fn()
    vi.mocked(patientApi.updatePatient).mockResolvedValue(updated)
    render(<Harness onSaved={onSaved} />)
    const dialog = screen.getByRole('dialog', { name: '编辑病人' })
    const nameInput = within(dialog).getByLabelText('姓名')

    await user.clear(nameInput)
    await user.type(nameInput, updated.name)
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
    expect(patientApi.updatePatient).toHaveBeenCalledWith(
      PATIENT.id,
      expect.objectContaining({ name: updated.name }),
    )
  })

  it('cannot be cancelled while a save request is pending', async () => {
    const user = userEvent.setup()
    const updated = { ...PATIENT, name: '保存后的姓名' }
    const onSaved = vi.fn()
    let resolveUpdate!: (patient: Patient) => void
    vi.mocked(patientApi.updatePatient).mockReturnValue(
      new Promise<Patient>((resolve) => {
        resolveUpdate = resolve
      }),
    )
    render(<Harness onSaved={onSaved} />)
    const dialog = screen.getByRole('dialog', { name: '编辑病人' })

    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    const cancelButton = within(dialog).getByRole('button', { name: '取消' })
    expect(cancelButton).toBeDisabled()
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
    expect(screen.getByRole('dialog', { name: '编辑病人' })).toBeVisible()
    expect(onSaved).not.toHaveBeenCalled()

    resolveUpdate(updated)

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(onSaved).toHaveBeenCalledWith(updated)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
