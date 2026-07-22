import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createPatient,
  getPatient,
  listPatients,
  PatientApiError,
} from './patientApi'
import type { Patient, PatientCreateInput } from '../model/patient'


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

const CREATE_INPUT = {
  medical_record_no: 'MR-0001',
  name: '演示病人',
  sex: 'unknown',
  birth_date: null,
} satisfies PatientCreateInput

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function errorBody(
  code: string,
  fieldErrors: Array<Record<string, string>> = [],
) {
  return {
    error: {
      code,
      message: `error:${code}`,
      field_errors: fieldErrors,
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('patientApi', () => {
  it('lists patients from the relative loopback API path', async () => {
    const fetchMock = stubFetch(jsonResponse([PATIENT]))

    await expect(listPatients()).resolves.toEqual([PATIENT])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/patients',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('creates a patient with JSON and returns the server representation', async () => {
    const fetchMock = stubFetch(jsonResponse(PATIENT, 201))

    await expect(createPatient(CREATE_INPUT)).resolves.toEqual(PATIENT)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/patients',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(CREATE_INPUT),
      }),
    )
  })

  it('gets patient details by internal API id', async () => {
    const fetchMock = stubFetch(jsonResponse(PATIENT))

    await expect(getPatient(PATIENT.id)).resolves.toEqual(PATIENT)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/patients/${PATIENT.id}`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('maps a 422 response and preserves field errors', async () => {
    stubFetch(
      jsonResponse(
        errorBody('validation_error', [
          {
            field: 'birth_date',
            code: 'date_in_future',
            message: '出生日期不得晚于今天',
          },
        ]),
        422,
      ),
    )

    const promise = createPatient(CREATE_INPUT)

    await expect(promise).rejects.toBeInstanceOf(PatientApiError)
    await expect(promise).rejects.toMatchObject({
      status: 422,
      code: 'validation_error',
      fieldErrors: [
        expect.objectContaining({
          field: 'birth_date',
          code: 'date_in_future',
        }),
      ],
    })
  })

  it('maps a 409 medical record number conflict', async () => {
    stubFetch(jsonResponse(errorBody('medical_record_no_conflict'), 409))

    await expect(createPatient(CREATE_INPUT)).rejects.toMatchObject({
      status: 409,
      code: 'medical_record_no_conflict',
    })
  })

  it('maps a 404 patient-not-found response', async () => {
    stubFetch(jsonResponse(errorBody('patient_not_found'), 404))

    await expect(getPatient(PATIENT.id)).rejects.toMatchObject({
      status: 404,
      code: 'patient_not_found',
    })
  })

  it('maps a fetch rejection to a stable network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    await expect(listPatients()).rejects.toMatchObject({
      status: null,
      code: 'network_error',
      fieldErrors: [],
    })
  })

  it('does not mutate or clear caller-owned data after an error response', async () => {
    const callerOwnedPatients = [{ ...PATIENT }]
    const snapshot = structuredClone(callerOwnedPatients)
    stubFetch(jsonResponse(errorBody('medical_record_no_conflict'), 409))

    await expect(createPatient(CREATE_INPUT)).rejects.toBeInstanceOf(PatientApiError)

    expect(callerOwnedPatients).toEqual(snapshot)
    expect(callerOwnedPatients).toHaveLength(1)
  })
})
