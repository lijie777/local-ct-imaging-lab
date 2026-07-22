import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import * as patientApi from '../api/patientApi'
import type { Patient } from '../model/patient'
import { PatientManagementPage } from './PatientManagementPage'


vi.mock('../api/patientApi', () => ({
  listPatients: vi.fn(),
  createPatient: vi.fn(),
  getPatient: vi.fn(),
  updatePatient: vi.fn(),
}))

const DISCLAIMER = '教学演示软件，不用于临床诊断'
const ALPHA = {
  id: '11111111-1111-4111-8111-111111111111',
  medical_record_no: 'MR-ALPHA',
  name: 'Alpha Person',
  sex: 'unknown',
  birth_date: null,
  study_count: 0,
  latest_study_date: null,
  created_at: '2026-07-17T02:00:00Z',
  updated_at: '2026-07-17T02:00:00Z',
} satisfies Patient
const BETA = {
  ...ALPHA,
  id: '22222222-2222-4222-8222-222222222222',
  medical_record_no: 'MR-BETA',
  name: 'Beta Person',
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

async function submitSearch(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = screen.getByLabelText('搜索病人')
  await user.clear(input)
  await user.type(input, value)
  await user.click(screen.getByRole('button', { name: '搜索' }))
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('PatientManagementPage search flow', () => {
  it('shows case-insensitive search results and restores the full list on clear', async () => {
    const user = userEvent.setup()
    vi.mocked(patientApi.listPatients).mockImplementation((query = '') => {
      return Promise.resolve(query.toLowerCase() === 'alpha' ? [ALPHA] : [ALPHA, BETA])
    })

    render(<PatientManagementPage />)
    expect(await screen.findByText(BETA.name)).toBeVisible()

    await submitSearch(user, '  ALPHA  ')
    expect(await screen.findByText(ALPHA.name)).toBeVisible()
    expect(screen.queryByText(BETA.name)).not.toBeInTheDocument()
    expect(screen.getByText(DISCLAIMER)).toBeVisible()

    await user.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(await screen.findByText(BETA.name)).toBeVisible()
    expect(patientApi.listPatients).toHaveBeenLastCalledWith(
      '',
      expect.any(AbortSignal),
    )
  })

  it('shows search loading, no-result, and failure states with the disclaimer', async () => {
    const user = userEvent.setup()
    const pending = deferred<Patient[]>()
    vi.mocked(patientApi.listPatients)
      .mockResolvedValueOnce([ALPHA])
      .mockReturnValueOnce(pending.promise)

    render(<PatientManagementPage />)
    await screen.findByText(ALPHA.name)
    await submitSearch(user, 'missing')
    expect(screen.getByText(/正在搜索病人/)).toBeVisible()
    expect(screen.getByText(DISCLAIMER)).toBeVisible()

    pending.resolve([])
    expect(await screen.findByText(/未找到匹配的病人/)).toBeVisible()
    expect(screen.getByText(DISCLAIMER)).toBeVisible()

    vi.mocked(patientApi.listPatients).mockRejectedValueOnce(
      new Error('search failed'),
    )
    await submitSearch(user, 'broken')
    expect(await screen.findByRole('alert')).toHaveTextContent(/无法搜索病人/)
    expect(screen.getByText(DISCLAIMER)).toBeVisible()
  })

  it('does not let a late old response replace the latest search results', async () => {
    const user = userEvent.setup()
    const oldSearch = deferred<Patient[]>()
    const latestSearch = deferred<Patient[]>()
    vi.mocked(patientApi.listPatients).mockImplementation((query = '') => {
      if (query === 'old') return oldSearch.promise
      if (query === 'latest') return latestSearch.promise
      return Promise.resolve([ALPHA, BETA])
    })

    render(<PatientManagementPage />)
    await screen.findByText(ALPHA.name)
    await submitSearch(user, 'old')
    await submitSearch(user, 'latest')

    latestSearch.resolve([BETA])
    expect(await screen.findByText(BETA.name)).toBeVisible()
    oldSearch.resolve([ALPHA])

    await waitFor(() => {
      expect(screen.queryByText(ALPHA.name)).not.toBeInTheDocument()
      expect(screen.getByText(BETA.name)).toBeVisible()
    })
  })
})
