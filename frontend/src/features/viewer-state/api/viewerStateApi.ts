import {
  parseViewerStatePayload,
  parseViewerStateRead,
  ViewerStateParseError,
  VIEWER_STATE_SCHEMA_VERSION,
} from '../model/viewerState'
import type { ViewerStatePayload, ViewerStateRead } from '../model/viewerState'


const SAFE_MESSAGES: Record<string, string> = {
  series_not_found: '未找到该序列',
  viewer_state_invalid: '查看器状态无效',
  validation_error: '请求参数无效',
  persistence_error: '无法保存查看器状态，请重试',
}

const STATUS_CODES: Record<number, string> = {
  404: 'series_not_found',
  422: 'viewer_state_invalid',
  500: 'persistence_error',
}
const MAX_KEEPALIVE_BODY_BYTES = 60 * 1024

export class ViewerStateApiError extends Error {
  readonly status: number | null
  readonly code: string

  constructor(status: number | null, code: string, message: string) {
    super(message)
    this.name = 'ViewerStateApiError'
    this.status = status
    this.code = code
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function responseCode(value: unknown, status: number): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'code' in value.error &&
    typeof value.error.code === 'string' &&
    Object.hasOwn(SAFE_MESSAGES, value.error.code)
  ) {
    return value.error.code
  }
  return STATUS_CODES[status] ?? 'request_error'
}

async function parseError(response: Response): Promise<ViewerStateApiError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // A malformed error body is replaced by a stable local message.
  }
  const code = responseCode(body, response.status)
  return new ViewerStateApiError(
    response.status,
    code,
    SAFE_MESSAGES[code] ?? '查看器状态请求失败，请重试',
  )
}

async function request(url: string, init: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    throw new ViewerStateApiError(
      null,
      'network_error',
      '无法连接本机服务，请确认服务已启动',
    )
  }
  if (!response.ok) {
    throw await parseError(response)
  }
  return response
}

function stateUrl(seriesId: string): string {
  return `/api/series/${encodeURIComponent(seriesId)}/viewer-state`
}

async function parseSuccessfulState(response: Response): Promise<ViewerStateRead | null> {
  try {
    return parseViewerStateRead(await response.json())
  } catch (error) {
    if (!(error instanceof ViewerStateParseError)) {
      throw error
    }
    throw new ViewerStateApiError(200, 'viewer_state_invalid', '查看器状态无效')
  }
}

export async function getViewerState(
  seriesId: string,
  signal?: AbortSignal,
): Promise<ViewerStateRead | null> {
  const response = await request(stateUrl(seriesId), { method: 'GET', signal })
  return parseSuccessfulState(response)
}

export async function putViewerState(
  seriesId: string,
  state: ViewerStatePayload,
  options?: { keepalive?: boolean },
): Promise<ViewerStateRead> {
  const safeState = parseViewerStatePayload(state)
  const body = JSON.stringify({
    schema_version: VIEWER_STATE_SCHEMA_VERSION,
    state: safeState,
  })
  const useKeepalive = options?.keepalive === true &&
    new TextEncoder().encode(body).byteLength <= MAX_KEEPALIVE_BODY_BYTES
  const response = await request(stateUrl(seriesId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
    ...(useKeepalive ? { keepalive: true } : {}),
  })
  const parsed = await parseSuccessfulState(response)
  if (parsed === null) {
    throw new ViewerStateApiError(200, 'viewer_state_invalid', '查看器状态无效')
  }
  return parsed
}

export async function deleteViewerState(
  seriesId: string,
  options?: { keepalive?: boolean },
): Promise<void> {
  await request(stateUrl(seriesId), {
    method: 'DELETE',
    ...(options?.keepalive === true ? { keepalive: true } : {}),
  })
}
