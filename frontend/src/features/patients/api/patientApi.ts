import type {
  Patient,
  PatientCreateInput,
  PatientErrorResponse,
  PatientFieldError,
  PatientPatchInput,
} from '../model/patient'


const FALLBACK_CODES: Record<number, string> = {
  404: 'patient_not_found',
  409: 'medical_record_no_conflict',
  422: 'validation_error',
  500: 'persistence_error',
}

const FALLBACK_MESSAGES: Record<number, string> = {
  404: '未找到该病人',
  409: '病历号已存在',
  422: '请求字段无效',
  500: '无法保存本次操作，请重试',
}

export class PatientApiError extends Error {
  readonly status: number | null
  readonly code: string
  readonly fieldErrors: PatientFieldError[]

  constructor({
    status,
    code,
    message,
    fieldErrors = [],
  }: {
    status: number | null
    code: string
    message: string
    fieldErrors?: PatientFieldError[]
  }) {
    super(message)
    this.name = 'PatientApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isErrorResponse(value: unknown): value is PatientErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false
  }

  const detail = value.error
  return (
    typeof detail === 'object' &&
    detail !== null &&
    'code' in detail &&
    typeof detail.code === 'string' &&
    'message' in detail &&
    typeof detail.message === 'string' &&
    'field_errors' in detail &&
    Array.isArray(detail.field_errors)
  )
}

async function parseError(response: Response): Promise<PatientApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (isErrorResponse(body)) {
    return new PatientApiError({
      status: response.status,
      code: body.error.code,
      message: body.error.message,
      fieldErrors: body.error.field_errors,
    })
  }

  return new PatientApiError({
    status: response.status,
    code: FALLBACK_CODES[response.status] ?? 'request_error',
    message: FALLBACK_MESSAGES[response.status] ?? '请求失败，请重试',
  })
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    throw new PatientApiError({
      status: null,
      code: 'network_error',
      message: '无法连接本机服务，请确认服务已启动',
    })
  }

  if (!response.ok) {
    throw await parseError(response)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export function listPatients(
  query = '',
  signal?: AbortSignal,
): Promise<Patient[]> {
  const trimmedQuery = query.trim()
  const url = trimmedQuery
    ? `/api/patients?q=${encodeURIComponent(trimmedQuery)}`
    : '/api/patients'
  return request<Patient[]>(url, {
    method: 'GET',
    signal,
  })
}

export function createPatient(input: PatientCreateInput): Promise<Patient> {
  return request<Patient>('/api/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function getPatient(
  id: string,
  signal?: AbortSignal,
): Promise<Patient> {
  return request<Patient>(`/api/patients/${encodeURIComponent(id)}`, {
    method: 'GET',
    signal,
  })
}

export function updatePatient(
  id: string,
  input: PatientPatchInput,
): Promise<Patient> {
  return request<Patient>(`/api/patients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deletePatient(id: string): Promise<void> {
  return request<void>(`/api/patients/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
