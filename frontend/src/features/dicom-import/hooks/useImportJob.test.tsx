import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../api/importJobApi'
import { resumeImportUpload } from '../core/resumableUploader'
import type { ImportJob } from '../model/importJob'
import { useImportJob } from './useImportJob'


vi.mock('../api/importJobApi', () => ({
  createImportJob: vi.fn(),
  deleteImportJob: vi.fn(),
  getImportJob: vi.fn(),
  getLatestImportJob: vi.fn(),
}))
vi.mock('../core/resumableUploader', () => ({
  resumeImportUpload: vi.fn(),
}))

const report = {
  total: 1,
  success: 1,
  duplicate: 0,
  skipped: 0,
  unsupported: 0,
  failed: 0,
  items: [],
}

function job(status: ImportJob['status'] = 'uploading'): ImportJob {
  const uploaded = status !== 'uploading'
  const started = status === 'running' || status === 'completed' || status === 'failed'
  const terminal = status === 'completed' || status === 'failed'
  return {
    id: 'job-1',
    patient_id: 'patient-1',
    status,
    total_files: 1,
    total_bytes: 4,
    uploaded_bytes: uploaded ? 4 : 0,
    files: [
      {
        id: 'file-1',
        ordinal: 0,
        relative_path: 'image.dcm',
        size_bytes: 4,
        last_modified_ms: 1,
        resume_fingerprint: '0'.repeat(64),
        confirmed_offset: uploaded ? 4 : 0,
      },
    ],
    report: status === 'completed' ? report : null,
    error_code: status === 'failed' ? 'import_failed' : null,
    error_message: status === 'failed' ? '后台导入失败' : null,
    created_at: '2026-07-23T00:00:00Z',
    updated_at: '2026-07-23T00:00:00Z',
    started_at: started ? '2026-07-23T00:00:01Z' : null,
    completed_at: terminal ? '2026-07-23T00:00:02Z' : null,
  }
}

beforeEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
  vi.mocked(api.getLatestImportJob).mockResolvedValue(null)
  vi.mocked(api.getImportJob).mockResolvedValue(job('queued'))
  vi.mocked(api.createImportJob).mockResolvedValue(job('uploading'))
  vi.mocked(api.deleteImportJob).mockResolvedValue()
  vi.mocked(resumeImportUpload).mockResolvedValue(job('queued'))
})

describe('useImportJob', () => {
  it('loads latest uploading task and resumes it with the same selected files', async () => {
    const existing = job('uploading')
    vi.mocked(api.getLatestImportJob).mockResolvedValue(existing)
    vi.mocked(api.getImportJob).mockResolvedValue(existing)
    const file = new File([new Uint8Array([1, 2, 3, 4]).buffer], 'image.dcm', {
      lastModified: 1,
    })
    const { result } = renderHook(() =>
      useImportJob({ patientId: 'patient-1', open: true, onImported: vi.fn() }),
    )

    await waitFor(() => expect(result.current.phase).toBe('needs-selection'))
    expect(result.current.job).toEqual(existing)

    await act(async () => {
      await result.current.prepareAndUpload([file])
    })
    expect(resumeImportUpload).toHaveBeenCalledWith({
      job: existing,
      files: [file],
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function),
    })
    expect(result.current.phase).toBe('queued')
  })

  it('creates a job when no latest task exists and retains progress after abort', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4]).buffer], 'image.dcm', {
      lastModified: 1,
    })
    let pending: Promise<ImportJob> | undefined
    vi.mocked(resumeImportUpload).mockImplementation(({ signal }) => {
      pending = new Promise<ImportJob>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      })
      return pending
    })
    const { result, rerender } = renderHook(
      ({ open }) => useImportJob({ patientId: 'patient-1', open, onImported: vi.fn() }),
      { initialProps: { open: true } },
    )

    await waitFor(() => expect(api.getLatestImportJob).toHaveBeenCalledOnce())
    await act(async () => {
      void result.current.prepareAndUpload([file])
      await Promise.resolve()
    })
    await waitFor(() => expect(api.createImportJob).toHaveBeenCalledOnce())
    expect(result.current.phase).toBe('uploading')

    rerender({ open: false })
    await waitFor(() => expect(result.current.phase).toBe('paused'))
    expect(result.current.job?.status).toBe('uploading')
  })

  it('returns an upload failure to a retryable and discardable state', async () => {
    const existing = job('uploading')
    const file = new File([new Uint8Array([1, 2, 3, 4]).buffer], 'image.dcm', {
      lastModified: 1,
    })
    vi.mocked(api.getLatestImportJob).mockResolvedValue(existing)
    vi.mocked(api.getImportJob).mockResolvedValue(existing)
    vi.mocked(resumeImportUpload).mockRejectedValue(new Error('网络暂时不可用'))
    const { result } = renderHook(() =>
      useImportJob({ patientId: 'patient-1', open: true, onImported: vi.fn() }),
    )

    await waitFor(() => expect(result.current.phase).toBe('needs-selection'))
    await act(async () => {
      await result.current.prepareAndUpload([file])
    })

    expect(result.current.phase).toBe('needs-selection')
    expect(result.current.error).toBe('网络暂时不可用')
    expect(result.current.job).toEqual(existing)
    await act(async () => {
      await result.current.discard()
    })
    expect(api.deleteImportJob).toHaveBeenCalledWith(existing.id, expect.any(AbortSignal))
  })

  it('refreshes the durable server offset before retrying an existing upload', async () => {
    const existing = job('uploading')
    const refreshed = {
      ...existing,
      uploaded_bytes: 2,
      files: [{ ...existing.files[0], confirmed_offset: 2 }],
    }
    const file = new File([new Uint8Array([1, 2, 3, 4]).buffer], 'image.dcm', {
      lastModified: 1,
    })
    vi.mocked(api.getLatestImportJob).mockResolvedValue(existing)
    vi.mocked(api.getImportJob).mockResolvedValue(refreshed)
    const { result } = renderHook(() =>
      useImportJob({ patientId: 'patient-1', open: true, onImported: vi.fn() }),
    )

    await waitFor(() => expect(result.current.phase).toBe('needs-selection'))
    await act(async () => {
      await result.current.prepareAndUpload([file])
    })

    expect(api.getImportJob).toHaveBeenCalledWith(
      existing.id,
      expect.any(AbortSignal),
    )
    expect(resumeImportUpload).toHaveBeenCalledWith({
      job: refreshed,
      files: [file],
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function),
    })
  })

  it('polls queued/running once per second and notifies completion only once', async () => {
    const onImported = vi.fn()
    const queued = job('queued')
    const running = job('running')
    const completed = job('completed')
    vi.mocked(api.getLatestImportJob).mockResolvedValue(queued)
    vi.mocked(api.getImportJob)
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(completed)
      .mockResolvedValue(completed)
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useImportJob({ patientId: 'patient-1', open: true, onImported }),
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.phase).toBe('queued')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phase).toBe('running')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.phase).toBe('completed')
    expect(onImported).toHaveBeenCalledOnce()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(onImported).toHaveBeenCalledOnce()
  })

  it('discards uploading and terminal jobs but leaves backend work untouched', async () => {
    const existing = job('failed')
    vi.mocked(api.getLatestImportJob).mockResolvedValue(existing)
    const { result } = renderHook(() =>
      useImportJob({ patientId: 'patient-1', open: true, onImported: vi.fn() }),
    )
    await waitFor(() => expect(result.current.phase).toBe('failed'))

    await act(async () => {
      await result.current.discard()
    })
    expect(api.deleteImportJob).toHaveBeenCalledWith(existing.id, expect.any(AbortSignal))
    expect(result.current.job).toBeNull()

    vi.mocked(api.getLatestImportJob).mockResolvedValue(job('running'))
    await act(async () => {
      await result.current.refresh()
    })
    await act(async () => {
      await result.current.discard()
    })
    expect(result.current.error).toMatch(/后台处理中/)
    expect(api.deleteImportJob).toHaveBeenCalledTimes(1)
  })
})
