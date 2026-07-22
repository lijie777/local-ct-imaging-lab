import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import * as api from '../api/dicomImportApi'
import type { Study } from '../model/dicomImport'
import { usePatientStudies } from './usePatientStudies'


vi.mock('../api/dicomImportApi', () => ({
  listPatientStudies: vi.fn(),
  listStudySeries: vi.fn(),
}))

const STUDY = {
  id: 'study-1',
  study_instance_uid: '1.2.3',
  dicom_patient_id: 'MR-DICOM-001',
  study_date: '2026-07-20',
  study_time: '09:30:00',
  accession_number: null,
  description: 'Teaching CT',
  series_count: 1,
  instance_count: 2,
  created_at: '2026-07-20T09:30:00Z',
} satisfies Study

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listPatientStudies).mockResolvedValue([STUDY])
  vi.mocked(api.listStudySeries).mockResolvedValue([])
})

it('loads studies for the selected patient and refreshes on demand', async () => {
  const { result } = renderHook(() => usePatientStudies('patient-1'))

  await waitFor(() => expect(result.current.status).toBe('success'))
  expect(result.current.studies).toEqual([STUDY])
  expect(api.listPatientStudies).toHaveBeenCalledWith(
    'patient-1',
    expect.any(AbortSignal),
  )

  await act(async () => {
    await result.current.reload()
  })
  expect(api.listPatientStudies).toHaveBeenCalledTimes(2)
})

it('clears study state when patient selection is cleared', async () => {
  const { result, rerender } = renderHook(
    ({ patientId }) => usePatientStudies(patientId),
    { initialProps: { patientId: 'patient-1' as string | null } },
  )
  await waitFor(() => expect(result.current.status).toBe('success'))

  rerender({ patientId: null })

  await waitFor(() => expect(result.current.status).toBe('idle'))
  expect(result.current.studies).toEqual([])
})
