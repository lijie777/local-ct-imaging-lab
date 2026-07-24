import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deleteViewerState,
  getViewerState,
  putViewerState,
  ViewerStateApiError,
} from './viewerStateApi'
import type { ViewerStatePayload, ViewerStateRead } from '../model/viewerState'


const STATE: ViewerStatePayload = {
  axial: null,
  mpr: null,
  annotations: [],
}

const READ: ViewerStateRead = {
  series_id: '11111111-1111-4111-8111-111111111111',
  schema_version: 1,
  state: STATE,
  created_at: '2026-07-23T01:00:00Z',
  updated_at: '2026-07-23T01:00:00Z',
}

function jsonResponse(body: unknown, status = 200): Response {
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('viewerStateApi', () => {
  it('gets a valid state or null from the encoded local Series path', async () => {
    const fetchMock = stubFetch(jsonResponse(READ))
    await expect(getViewerState('series/id')).resolves.toEqual(READ)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/series/series%2Fid/viewer-state',
      { method: 'GET', signal: undefined },
    )

    fetchMock.mockResolvedValueOnce(jsonResponse(null))
    await expect(getViewerState('series/id')).resolves.toBeNull()
  })

  it('puts the exact v1 snapshot and supports final keepalive flush', async () => {
    const fetchMock = stubFetch(jsonResponse(READ))

    await expect(
      putViewerState('series/id', STATE, { keepalive: true }),
    ).resolves.toEqual(READ)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/series/series%2Fid/viewer-state',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema_version: 1, state: STATE }),
        keepalive: true,
      },
    )
  })

  it('uses a normal request for a valid snapshot above the browser keepalive quota', async () => {
    const fetchMock = stubFetch(jsonResponse(READ))
    const largeState: ViewerStatePayload = {
      axial: null,
      mpr: null,
      annotations: Array.from({ length: 500 }, (_, index) => ({
        viewport: 'axial',
        tool_name: 'ArrowAnnotate',
        referenced_image_id: `image-${index}`,
        points: [[0, 0, 0], [1, 1, 0]],
        label: 'x'.repeat(200),
        text_box: null,
      })),
    }

    await expect(
      putViewerState('series/id', largeState, { keepalive: true }),
    ).resolves.toEqual(READ)

    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(new TextEncoder().encode(request.body as string).byteLength).toBeGreaterThan(64 * 1024)
    expect(request.keepalive).toBeUndefined()
  })

  it('deletes state through the local API and accepts 204', async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }))
    await expect(
      deleteViewerState('series/id', { keepalive: true }),
    ).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/series/series%2Fid/viewer-state',
      { method: 'DELETE', keepalive: true },
    )
  })

  it.each([
    [404, 'series_not_found', '未找到该序列'],
    [422, 'viewer_state_invalid', '查看器状态无效'],
    [500, 'persistence_error', '无法保存查看器状态，请重试'],
  ])('maps safe %s errors without preserving private server text', async (
    status,
    code,
    message,
  ) => {
    stubFetch(jsonResponse({
      error: {
        code,
        message: 'sqlite D:/private/secret',
        field_errors: [],
      },
    }, status))

    const promise = getViewerState('series')
    await expect(promise).rejects.toBeInstanceOf(ViewerStateApiError)
    await expect(promise).rejects.toMatchObject({ status, code, message })
  })

  it('maps network and invalid successful responses to stable safe errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline private')))
    await expect(getViewerState('series')).rejects.toMatchObject({
      status: null,
      code: 'network_error',
    })

    stubFetch(jsonResponse({ ...READ, schema_version: 2 }))
    await expect(getViewerState('series')).rejects.toMatchObject({
      status: 200,
      code: 'viewer_state_invalid',
    })
  })
})
