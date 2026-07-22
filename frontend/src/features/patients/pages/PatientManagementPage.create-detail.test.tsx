import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import * as patientApi from '../api/patientApi'
import type { Patient } from '../model/patient'
import { PatientManagementPage } from './PatientManagementPage'


vi.mock('../api/patientApi', () => ({
  listPatients: vi.fn(),
  createPatient: vi.fn(),
  getPatient: vi.fn(),
}))

const DISCLAIMER = '教学演示软件，不用于临床诊断'
const PATIENT = {
  id: '11111111-1111-4111-8111-111111111111',
  medical_record_no: 'MR-0001',
  name: '演示病人',
  sex: 'unknown',
  birth_date: '1990-01-02',
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
  if (HTMLDialogElement.prototype.close === undefined) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }
})

beforeEach(() => {
  vi.resetAllMocks()
})

describe('PatientManagementPage create and detail flow', () => {
  it('shows the full disclaimer while the patient list is loading', () => {
    vi.mocked(patientApi.listPatients).mockReturnValue(
      deferred<typeof PATIENT[]>().promise,
    )

    render(<PatientManagementPage />)

    expect(screen.getByText(DISCLAIMER)).toBeVisible()
    expect(screen.getByText(/正在加载病人/)).toBeVisible()
  })

  it('shows the disclaimer, empty state, and create entry for an empty list', async () => {
    vi.mocked(patientApi.listPatients).mockResolvedValue([])

    render(<PatientManagementPage />)

    expect(await screen.findByText(/暂无病人/)).toBeVisible()
    expect(screen.getByText(DISCLAIMER)).toBeVisible()
    expect(screen.getByRole('button', { name: '创建病人' })).toBeEnabled()
  })

  it('shows the disclaimer and patient summary for a populated list', async () => {
    vi.mocked(patientApi.listPatients).mockResolvedValue([PATIENT])

    render(<PatientManagementPage />)

    expect(await screen.findByText(PATIENT.medical_record_no)).toBeVisible()
    expect(screen.getByText(PATIENT.name)).toBeVisible()
    expect(screen.getByText('未知')).toBeVisible()
    expect(screen.getByText(DISCLAIMER)).toBeVisible()
  })

  it('shows the disclaimer and understandable failure state when loading fails', async () => {
    vi.mocked(patientApi.listPatients).mockRejectedValue(
      new Error('local persistence unavailable'),
    )

    render(<PatientManagementPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/加载.*失败|无法加载/)
    expect(screen.getByText(DISCLAIMER)).toBeVisible()
  })

  it('shows all eight detail fields without displaying the internal UUID', async () => {
    const user = userEvent.setup()
    vi.mocked(patientApi.listPatients).mockResolvedValue([PATIENT])
    vi.mocked(patientApi.getPatient).mockResolvedValue(PATIENT)

    render(<PatientManagementPage />)
    await user.click(
      await screen.findByRole('button', { name: /查看.*演示病人.*详情/ }),
    )

    const details = await screen.findByRole('region', { name: '病人详情' })
    for (const label of [
      '病历号',
      '姓名',
      '性别',
      '出生日期',
      '影像检查数量',
      '最近检查日期',
      '创建时间',
      '最近更新时间',
    ]) {
      expect(within(details).getByText(label)).toBeVisible()
    }
    expect(within(details).getByText(PATIENT.medical_record_no)).toBeVisible()
    expect(within(details).getByText(PATIENT.name)).toBeVisible()
    expect(within(details).getByText('未知')).toBeVisible()
    expect(within(details).getByText(PATIENT.birth_date)).toBeVisible()
    expect(within(details).getByText('0')).toBeVisible()
    expect(screen.queryByText(PATIENT.id)).not.toBeInTheDocument()
    expect(screen.getByText(DISCLAIMER)).toBeVisible()
  })

  it('opens an accessible create dialog with repeated disclaimer and restores focus', async () => {
    const user = userEvent.setup()
    vi.mocked(patientApi.listPatients).mockResolvedValue([])

    render(<PatientManagementPage />)
    const createButton = await screen.findByRole('button', { name: '创建病人' })
    await user.click(createButton)

    const dialog = screen.getByRole('dialog', { name: '创建病人' })
    expect(dialog).toBeVisible()
    expect(screen.getAllByText(DISCLAIMER)).toHaveLength(2)
    expect(dialog).toContainElement(document.activeElement as HTMLElement | null)

    await user.click(within(dialog).getByRole('button', { name: '取消' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '创建病人' })).not.toBeInTheDocument()
    })
    expect(createButton).toHaveFocus()
  })

  it('keeps the create dialog and every draft field after save failure', async () => {
    const user = userEvent.setup()
    vi.mocked(patientApi.listPatients).mockResolvedValue([])
    vi.mocked(patientApi.createPatient).mockRejectedValue(
      new Error('无法保存本次操作，请重试'),
    )

    render(<PatientManagementPage />)
    await user.click(await screen.findByRole('button', { name: '创建病人' }))
    const dialog = screen.getByRole('dialog', { name: '创建病人' })
    const medicalRecordInput = within(dialog).getByLabelText('病历号')
    const nameInput = within(dialog).getByLabelText('姓名')
    const sexInput = within(dialog).getByLabelText('性别')
    const birthDateInput = within(dialog).getByLabelText('出生日期')

    await user.type(medicalRecordInput, ' MR 09/A ')
    await user.type(nameInput, '草稿 病人')
    await user.selectOptions(sexInput, 'female')
    await user.type(birthDateInput, '2000-01-02')
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await within(dialog).findByRole('alert')).toBeVisible()
    expect(dialog).toBeInTheDocument()
    expect(medicalRecordInput).toHaveValue(' MR 09/A ')
    expect(nameInput).toHaveValue('草稿 病人')
    expect(sexInput).toHaveValue('female')
    expect(birthDateInput).toHaveValue('2000-01-02')
    expect(within(dialog).getByText(DISCLAIMER)).toBeVisible()
  })
})
