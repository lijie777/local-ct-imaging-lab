import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '../api/importJobApi'
import { DicomApiError } from '../api/dicomImportApi'
import type { ImportJob } from '../model/importJob'
import { buildImportManifest } from './importManifest'
import {
  ImportSelectionMismatchError,
  resumeImportUpload,
} from './resumableUploader'


vi.mock('../api/importJobApi', () => ({
  queueImportJob: vi.fn(),
  uploadImportChunk: vi.fn(),
}))

const CHUNK_BYTES = 4 * 1024 * 1024

function file(name: string, bytes: Uint8Array, lastModified = 1): File {
  return new File([Uint8Array.from(bytes).buffer], name, { lastModified })
}

async function jobFor(
  files: readonly File[],
  offsets: readonly number[] = files.map(() => 0),
): Promise<ImportJob> {
  const manifest = await buildImportManifest(files)
  return {
    id: 'job-1',
    patient_id: 'patient-1',
    status: 'uploading',
    total_files: files.length,
    total_bytes: files.reduce((total, item) => total + item.size, 0),
    uploaded_bytes: offsets.reduce((total, item) => total + item, 0),
    files: manifest.map((item, ordinal) => ({
      ...item,
      id: `file-${ordinal}`,
      ordinal,
      confirmed_offset: offsets[ordinal],
    })),
    report: null,
    error_code: null,
    error_message: null,
    created_at: '2026-07-23T00:00:00Z',
    updated_at: '2026-07-23T00:00:00Z',
    started_at: null,
    completed_at: null,
  }
}

beforeEach(() => vi.resetAllMocks())

describe('resumeImportUpload', () => {
  it('matches reselected files one-to-one by identity, independent of selection order', async () => {
    const first = file('first.dcm', new Uint8Array([1]))
    const second = file('second.dcm', new Uint8Array([2]))
    const job = await jobFor([first, second], [1, 1])
    const queued = { ...job, status: 'queued' as const }
    vi.mocked(api.queueImportJob).mockResolvedValue(queued)

    await expect(
      resumeImportUpload({
        job,
        files: [second, first],
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      }),
    ).resolves.toBe(queued)
    expect(api.uploadImportChunk).not.toHaveBeenCalled()
    expect(api.queueImportJob).toHaveBeenCalledWith(job.id, expect.any(AbortSignal))
  })

  it('rejects missing, extra, path, metadata, and fingerprint mismatches before upload', async () => {
    const original = file('image.dcm', new Uint8Array([1, 2, 3]), 10)
    const job = await jobFor([original])
    const variants: File[][] = [
      [],
      [original, file('extra.dcm', new Uint8Array([1]))],
      [file('renamed.dcm', new Uint8Array([1, 2, 3]), 10)],
      [file('image.dcm', new Uint8Array([1, 2, 3]), 11)],
      [file('image.dcm', new Uint8Array([9, 9, 9]), 10)],
    ]

    for (const files of variants) {
      await expect(
        resumeImportUpload({
          job,
          files,
          signal: new AbortController().signal,
          onProgress: vi.fn(),
        }),
      ).rejects.toBeInstanceOf(ImportSelectionMismatchError)
    }
    expect(api.uploadImportChunk).not.toHaveBeenCalled()
    expect(api.queueImportJob).not.toHaveBeenCalled()
  })

  it('continues from confirmed offsets in sequential 4 MiB chunks and reports aggregate progress', async () => {
    const content = Uint8Array.from(
      { length: CHUNK_BYTES + 5 },
      (_, index) => index % 251,
    )
    const selected = file('large.dcm', content)
    const job = await jobFor([selected], [3])
    const progress = vi.fn()
    vi.mocked(api.uploadImportChunk)
      .mockResolvedValueOnce({
        file_id: 'file-0',
        confirmed_offset: CHUNK_BYTES + 3,
        uploaded_bytes: CHUNK_BYTES + 3,
        total_bytes: CHUNK_BYTES + 5,
      })
      .mockResolvedValueOnce({
        file_id: 'file-0',
        confirmed_offset: CHUNK_BYTES + 5,
        uploaded_bytes: CHUNK_BYTES + 5,
        total_bytes: CHUNK_BYTES + 5,
      })
    const queued = { ...job, status: 'queued' as const, uploaded_bytes: CHUNK_BYTES + 5 }
    vi.mocked(api.queueImportJob).mockResolvedValue(queued)

    await expect(
      resumeImportUpload({
        job,
        files: [selected],
        signal: new AbortController().signal,
        onProgress: progress,
      }),
    ).resolves.toBe(queued)

    expect(vi.mocked(api.uploadImportChunk).mock.calls.map((call) => call.slice(3, 5))).toEqual([
      [3, CHUNK_BYTES],
      [CHUNK_BYTES + 3, 2],
    ])
    expect(progress).toHaveBeenLastCalledWith({
      uploadedBytes: CHUNK_BYTES + 5,
      totalBytes: CHUNK_BYTES + 5,
      currentFile: 1,
      totalFiles: 1,
    })
    expect(api.queueImportJob).toHaveBeenCalledOnce()
  })

  it('accepts a server rollback to the durable disk offset and resumes from there', async () => {
    const selected = file(
      'rollback.dcm',
      Uint8Array.from({ length: 10 }, (_, index) => index),
    )
    const job = await jobFor([selected], [8])
    const progress = vi.fn()
    vi.mocked(api.uploadImportChunk)
      .mockResolvedValueOnce({
        file_id: 'file-0',
        confirmed_offset: 4,
        uploaded_bytes: 4,
        total_bytes: 10,
      })
      .mockResolvedValueOnce({
        file_id: 'file-0',
        confirmed_offset: 10,
        uploaded_bytes: 10,
        total_bytes: 10,
      })
    const queued = { ...job, status: 'queued' as const, uploaded_bytes: 10 }
    vi.mocked(api.queueImportJob).mockResolvedValue(queued)

    await expect(
      resumeImportUpload({
        job,
        files: [selected],
        signal: new AbortController().signal,
        onProgress: progress,
      }),
    ).resolves.toBe(queued)

    expect(vi.mocked(api.uploadImportChunk).mock.calls.map((call) => call.slice(3, 5))).toEqual([
      [8, 2],
      [4, 6],
    ])
    expect(progress).toHaveBeenCalledWith({
      uploadedBytes: 4,
      totalBytes: 10,
      currentFile: 1,
      totalFiles: 1,
    })
  })

  it('rejects non-monotonic or out-of-range server offsets', async () => {
    const selected = file('image.dcm', new Uint8Array([1, 2, 3]))
    const job = await jobFor([selected])
    vi.mocked(api.uploadImportChunk).mockResolvedValue({
      file_id: 'file-0',
      confirmed_offset: 0,
      uploaded_bytes: 0,
      total_bytes: 3,
    })

    await expect(
      resumeImportUpload({
        job,
        files: [selected],
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'server_offset' })
    expect(api.queueImportJob).not.toHaveBeenCalled()
  })

  it('preserves AbortError and retryable network failures without mutating the job', async () => {
    const selected = file('image.dcm', new Uint8Array([1, 2, 3]))
    const job = await jobFor([selected])
    const before = structuredClone(job)
    const aborted = new DOMException('stopped', 'AbortError')
    vi.mocked(api.uploadImportChunk).mockRejectedValueOnce(aborted)

    await expect(
      resumeImportUpload({
        job,
        files: [selected],
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      }),
    ).rejects.toBe(aborted)

    vi.mocked(api.uploadImportChunk).mockRejectedValueOnce(
      new DicomApiError(null, 'network_error', 'offline'),
    )
    await expect(
      resumeImportUpload({
        job,
        files: [selected],
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'network_error' })
    expect(job).toEqual(before)
    expect(api.queueImportJob).not.toHaveBeenCalled()
  })
})
