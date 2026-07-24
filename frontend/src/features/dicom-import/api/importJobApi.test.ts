import { afterEach, describe, expect, it, vi } from 'vitest'

import { DicomApiError } from './dicomImportApi'
import {
  createImportJob,
  deleteImportJob,
  getImportJob,
  getLatestImportJob,
  queueImportJob,
  uploadImportChunk,
} from './importJobApi'


const job = {
  id: 'job-1',
  patient_id: 'patient-1',
  status: 'uploading',
  total_files: 1,
  total_bytes: 5,
  uploaded_bytes: 0,
  files: [],
  report: null,
  error_code: null,
  error_message: null,
  created_at: '2026-07-23T00:00:00Z',
  updated_at: '2026-07-23T00:00:00Z',
  started_at: null,
  completed_at: null,
}

afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('importJobApi', () => {
  it('encodes resource ids and sends the strict manifest JSON', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse(job, 201)),
    )
    vi.stubGlobal('fetch', fetchMock)
    const files = [
      {
        relative_path: 'study/image.dcm',
        size_bytes: 5,
        last_modified_ms: 1,
        resume_fingerprint: '0'.repeat(64),
      },
    ]

    await createImportJob('patient/id', files)
    await getLatestImportJob('patient/id')
    await getImportJob('job/id')
    await queueImportJob('job/id')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteImportJob('job/id')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/patients/patient%2Fid/import-jobs',
      '/api/patients/patient%2Fid/import-jobs/latest',
      '/api/import-jobs/job%2Fid',
      '/api/import-jobs/job%2Fid/queue',
      '/api/import-jobs/job%2Fid',
    ])
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    })
  })

  it('uploads one binary slice with offset and abort signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        file_id: 'file-1',
        confirmed_offset: 7,
        uploaded_bytes: 7,
        total_bytes: 10,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const file = new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])], 'x.dcm')
    const controller = new AbortController()

    await uploadImportChunk('job/id', 'file/id', file, 3, 4, controller.signal)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/import-jobs/job%2Fid/files/file%2Fid/content')
    expect(init).toMatchObject({
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Upload-Offset': '3',
      },
      signal: controller.signal,
    })
    expect(init.body).toBeInstanceOf(Blob)
    expect(Array.from(new Uint8Array(await (init.body as Blob).arrayBuffer()))).toEqual([
      3, 4, 5, 6,
    ])
  })

  it.each([
    [409, 'import_offset_conflict', '上传位置不一致'],
    [413, 'request_error', '所选文件超过本机教学演示上限'],
    [422, 'validation_error', '请求字段无效'],
    [500, 'persistence_error', '无法保存'],
  ])('maps %s responses to safe DicomApiError', async (status, code, message) => {
    const body = code === 'request_error'
      ? 'not json'
      : JSON.stringify({ error: { code, message, field_errors: [] } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })))

    await expect(getImportJob('job')).rejects.toMatchObject({
      name: 'DicomApiError',
      status,
      code,
      message,
    })
  })

  it('preserves AbortError and maps other fetch failures to network_error', async () => {
    const aborted = new DOMException('stopped', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValueOnce(aborted).mockRejectedValueOnce(new Error('private'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getImportJob('job')).rejects.toBe(aborted)
    await expect(getImportJob('job')).rejects.toEqual(
      new DicomApiError(null, 'network_error', '无法连接本机服务，请确认服务已启动'),
    )
  })
})
