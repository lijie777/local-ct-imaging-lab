import type {
  ImportJob,
  ImportManifestFile,
  ImportUploadProgress,
} from '../model/importJob'
import { DicomApiError } from './dicomImportApi'


interface ErrorResponse {
  error: {
    code: string
    message: string
  }
}

const FALLBACK_MESSAGES: Record<number, string> = {
  404: '未找到该导入任务',
  409: '当前导入任务状态不允许此操作',
  413: '所选文件超过本机教学演示上限',
  422: '请求字段无效',
  500: '本机导入任务操作失败，请重试',
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

async function responseError(response: Response): Promise<DicomApiError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // A safe status-based message is used for malformed error bodies.
  }
  if (isErrorResponse(body)) {
    return new DicomApiError(response.status, body.error.code, body.error.message)
  }
  return new DicomApiError(
    response.status,
    'request_error',
    FALLBACK_MESSAGES[response.status] ?? '请求失败，请重试',
  )
}

async function fetchResponse(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
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
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetchResponse(url, init)
  if (!response.ok) {
    throw await responseError(response)
  }
  return (await response.json()) as T
}

export function createImportJob(
  patientId: string,
  files: readonly ImportManifestFile[],
  signal?: AbortSignal,
): Promise<ImportJob> {
  return requestJson<ImportJob>(
    `/api/patients/${encodeURIComponent(patientId)}/import-jobs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
      signal,
    },
  )
}

export function getLatestImportJob(
  patientId: string,
  signal?: AbortSignal,
): Promise<ImportJob | null> {
  return requestJson<ImportJob | null>(
    `/api/patients/${encodeURIComponent(patientId)}/import-jobs/latest`,
    { method: 'GET', signal },
  )
}

export function getImportJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<ImportJob> {
  return requestJson<ImportJob>(
    `/api/import-jobs/${encodeURIComponent(jobId)}`,
    { method: 'GET', signal },
  )
}

export function uploadImportChunk(
  jobId: string,
  fileId: string,
  file: File,
  offset: number,
  length: number,
  signal?: AbortSignal,
): Promise<ImportUploadProgress> {
  return requestJson<ImportUploadProgress>(
    `/api/import-jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileId)}/content`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Upload-Offset': String(offset),
      },
      body: file.slice(offset, offset + length),
      signal,
    },
  )
}

export function queueImportJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<ImportJob> {
  return requestJson<ImportJob>(
    `/api/import-jobs/${encodeURIComponent(jobId)}/queue`,
    { method: 'POST', signal },
  )
}

export async function deleteImportJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchResponse(
    `/api/import-jobs/${encodeURIComponent(jobId)}`,
    { method: 'DELETE', signal },
  )
  if (!response.ok) {
    throw await responseError(response)
  }
}
