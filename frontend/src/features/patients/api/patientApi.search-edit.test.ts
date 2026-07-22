import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  listPatients,
  PatientApiError,
  updatePatient,
} from './patientApi'
import type { Patient, PatientPatchInput } from '../model/patient'


const PATIENT = {
  id: '11111111-1111-4111-8111-111111111111',
  medical_record_no: 'MR-0001',
  name: '演示病人',
  sex: 'unknown',
  birth_date: null,
  study_count: 0,
  latest_study_date: null,
  created_at: '2026-07-17T02:00:00Z',
  updated_at: '2026-07-17T02:00:00Z',
} satisfies Patient

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function errorBody(code: string) {
  return {
    error: {
      code,
      message: `error:${code}`,
      field_errors: [],
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('patientApi search and edit', () => {
  it('trims and encodes the search query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([PATIENT]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listPatients('  MR %_A  ')).resolves.toEqual([PATIENT])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/patients?q=MR%20%25_A',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('passes AbortController cancellation through unchanged', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
      ),
    )

    const request = listPatients('old search', controller.signal)
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('patches only the supplied fields', async () => {
    const input = { name: '更新后的姓名' } satisfies PatientPatchInput
    const updated = { ...PATIENT, name: input.name }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updated))
    vi.stubGlobal('fetch', fetchMock)

    await expect(updatePatient(PATIENT.id, input)).resolves.toEqual(updated)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/patients/${PATIENT.id}`,
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(input),
      }),
    )
  })

  it.each([
    [404, 'patient_not_found'],
    [409, 'medical_record_no_conflict'],
    [422, 'validation_error'],
    [500, 'persistence_error'],
  ])('maps PATCH %s responses', async (status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(errorBody(code), status)),
    )

    await expect(updatePatient(PATIENT.id, { name: '失败草稿' })).rejects.toMatchObject({
      status,
      code,
    })
  })

  it('maps PATCH network failures without mutating caller data', async () => {
    const input = { name: '调用方草稿' } satisfies PatientPatchInput
    const snapshot = structuredClone(input)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    await expect(updatePatient(PATIENT.id, input)).rejects.toBeInstanceOf(
      PatientApiError,
    )
    expect(input).toEqual(snapshot)
  })
})
