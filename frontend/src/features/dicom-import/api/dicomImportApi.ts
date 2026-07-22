import type {
  ImportReport,
  Series,
  SeriesDetail,
  Study,
} from '../model/dicomImport'


interface ErrorResponse {
  error: {
    code: string
    message: string
  }
}

const FALLBACK_MESSAGES: Record<number, string> = {
  404: '未找到请求的本机影像数据',
  422: '所选文件或请求参数无效',
  500: '本机影像数据操作失败，请重试',
}

export class DicomApiError extends Error {
  readonly status: number | null
  readonly code: string

  constructor(status: number | null, code: string, message: string) {
    super(message)
    this.name = 'DicomApiError'
    this.status = status
    this.code = code
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isErrorResponse(value: unknown): value is ErrorResponse {
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
    typeof detail.message === 'string'
  )
}

async function parseError(response: Response): Promise<DicomApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (isErrorResponse(body)) {
    return new DicomApiError(
      response.status,
      body.error.code,
      body.error.message,
    )
  }

  return new DicomApiError(
    response.status,
    'request_error',
    FALLBACK_MESSAGES[response.status] ?? '请求失败，请重试',
  )
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    throw new DicomApiError(
      null,
      'network_error',
      '无法连接本机服务，请确认服务已启动',
    )
  }

  if (!response.ok) {
    throw await parseError(response)
  }

  return (await response.json()) as T
}

function displayName(file: File): string {
  return file.webkitRelativePath || file.name
}

export function importDicom(
  patientId: string,
  files: readonly File[],
): Promise<ImportReport> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file, displayName(file))
  }

  return request<ImportReport>(
    `/api/patients/${encodeURIComponent(patientId)}/dicom-import`,
    {
      method: 'POST',
      body: formData,
    },
  )
}

export function listPatientStudies(
  patientId: string,
  signal?: AbortSignal,
): Promise<Study[]> {
  return request<Study[]>(
    `/api/patients/${encodeURIComponent(patientId)}/studies`,
    { method: 'GET', signal },
  )
}

export function listStudySeries(
  studyId: string,
  signal?: AbortSignal,
): Promise<Series[]> {
  return request<Series[]>(
    `/api/studies/${encodeURIComponent(studyId)}/series`,
    { method: 'GET', signal },
  )
}

export function getSeriesDetails(
  seriesId: string,
  signal?: AbortSignal,
): Promise<SeriesDetail> {
  return request<SeriesDetail>(
    `/api/series/${encodeURIComponent(seriesId)}`,
    { method: 'GET', signal },
  )
}
