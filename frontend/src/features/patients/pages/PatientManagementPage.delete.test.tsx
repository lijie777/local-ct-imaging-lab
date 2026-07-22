import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import * as patientApi from '../api/patientApi'
import * as dicomApi from '../../dicom-import/api/dicomImportApi'
import type { Patient } from '../model/patient'
import { PatientManagementPage } from './PatientManagementPage'


vi.mock('../api/patientApi', () => ({
  listPatients: vi.fn(),
  createPatient: vi.fn(),
  getPatient: vi.fn(),
  updatePatient: vi.fn(),
  deletePatient: vi.fn(),
}))
vi.mock('../../dicom-import/api/dicomImportApi', () => ({
  listPatientStudies: vi.fn(),
  listStudySeries: vi.fn(),
}))

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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeAll(() => {
  if (HTMLDialogElement.prototype.showModal === undefined) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
  }
})

async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /查看.*待删除病人.*详情/ }))
  await user.click(await screen.findByRole('button', { name: '删除病人' }))
  return screen.getByRole('dialog', { name: '删除病人' })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(patientApi.listPatients).mockResolvedValue([PATIENT])
  vi.mocked(patientApi.getPatient).mockResolvedValue(PATIENT)
  vi.mocked(dicomApi.listPatientStudies).mockResolvedValue([])
  vi.mocked(dicomApi.listStudySeries).mockResolvedValue([])
})

describe('PatientManagementPage delete flow', () => {
  it('cancel keeps the patient and sends no DELETE', async () => {
    const user = userEvent.setup()
    render(<PatientManagementPage />)
    const dialog = await openDeleteDialog(user)
    expect(within(dialog).getByText(/受管 DICOM 文件/)).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: '取消' }))

    expect(patientApi.deletePatient).not.toHaveBeenCalled()
    expect(
      within(screen.getByRole('region', { name: '病人列表' })).getByText(PATIENT.name),
    ).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: '病人详情' })).getByText(PATIENT.name),
    ).toBeVisible()
  })

  it('does not remove the patient until DELETE succeeds', async () => {
    const user = userEvent.setup()
    const deletion = deferred<void>()
    vi.mocked(patientApi.deletePatient).mockReturnValue(deletion.promise)
    vi.mocked(patientApi.listPatients)
      .mockResolvedValueOnce([PATIENT])
      .mockResolvedValueOnce([])
    render(<PatientManagementPage />)
    const dialog = await openDeleteDialog(user)

    await user.click(within(dialog).getByRole('button', { name: '确认删除' }))
    expect(
      within(screen.getByRole('region', { name: '病人列表' })).getByText(PATIENT.name),
    ).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: '病人详情' })).getByText(PATIENT.name),
    ).toBeVisible()

    deletion.resolve()
    expect(await screen.findByText(/暂无病人/)).toBeVisible()
    expect(screen.queryByText(PATIENT.name)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '病人详情' })).not.toBeInTheDocument()
  })

  it('keeps list, details, and dialog when DELETE fails', async () => {
    const user = userEvent.setup()
    vi.mocked(patientApi.deletePatient).mockRejectedValue(
      new Error('无法保存本次操作，请重试'),
    )
    render(<PatientManagementPage />)
    const dialog = await openDeleteDialog(user)

    await user.click(within(dialog).getByRole('button', { name: '确认删除' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/无法保存/)
    expect(dialog).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: '病人列表' })).getByText(PATIENT.name),
    ).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: '病人详情' })).getByText(PATIENT.name),
    ).toBeVisible()
    await waitFor(() => expect(patientApi.deletePatient).toHaveBeenCalledWith(PATIENT.id))
  })
})
