import {
  queueImportJob,
  uploadImportChunk,
} from '../api/importJobApi'
import type {
  ImportJob,
  ImportJobFile,
  ImportManifestFile,
  UploadProgress,
} from '../model/importJob'
import { buildImportManifest } from './importManifest'


export const IMPORT_CHUNK_BYTES = 4 * 1024 * 1024

export class ImportSelectionMismatchError extends Error {
  readonly code = 'selection_mismatch'

  constructor() {
    super('重新选择的文件与当前导入任务不匹配')
    this.name = 'ImportSelectionMismatchError'
  }
}

export class ImportUploadProtocolError extends Error {
  readonly code: string

  constructor(code: string) {
    super('服务端返回了无效的上传确认位置，请重试')
    this.name = 'ImportUploadProtocolError'
    this.code = code
  }
}

function sameIdentity(
  remote: ImportJobFile,
  local: ImportManifestFile,
): boolean {
  return (
    remote.relative_path === local.relative_path &&
    remote.size_bytes === local.size_bytes &&
    remote.last_modified_ms === local.last_modified_ms &&
    remote.resume_fingerprint === local.resume_fingerprint
  )
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return
  }
  if (signal.reason !== undefined) {
    throw signal.reason
  }
  throw new DOMException('操作已暂停', 'AbortError')
}

export async function resumeImportUpload(options: {
  job: ImportJob
  files: readonly File[]
  manifest?: readonly ImportManifestFile[]
  signal: AbortSignal
  onProgress(progress: UploadProgress): void
}): Promise<ImportJob> {
  const { job, files, signal, onProgress } = options
  throwIfAborted(signal)
  if (
    job.status !== 'uploading' ||
    files.length !== job.total_files ||
    job.files.length !== job.total_files
  ) {
    throw new ImportSelectionMismatchError()
  }

  const manifest = options.manifest ?? (await buildImportManifest(files, signal))
  const selectedByPath = new Map(
    manifest.map((item, index) => [
      item.relative_path,
      { file: files[index], manifest: item },
    ]),
  )
  const orderedFiles = [...job.files].sort(
    (left, right) => left.ordinal - right.ordinal,
  )
  for (const remote of orderedFiles) {
    const local = selectedByPath.get(remote.relative_path)
    if (local === undefined || !sameIdentity(remote, local.manifest)) {
      throw new ImportSelectionMismatchError()
    }
  }
  if (selectedByPath.size !== orderedFiles.length) {
    throw new ImportSelectionMismatchError()
  }

  const confirmedOffsets = new Map(
    orderedFiles.map((item) => [item.id, item.confirmed_offset]),
  )
  let uploadedBytes = job.uploaded_bytes
  onProgress({
    uploadedBytes,
    totalBytes: job.total_bytes,
    currentFile: orderedFiles.findIndex(
      (item) => item.confirmed_offset < item.size_bytes,
    ) + 1,
    totalFiles: job.total_files,
  })

  for (let index = 0; index < orderedFiles.length; index += 1) {
    const remote = orderedFiles[index]
    const local = selectedByPath.get(remote.relative_path)
    if (local === undefined) {
      throw new ImportSelectionMismatchError()
    }
    let offset = confirmedOffsets.get(remote.id) ?? 0
    while (offset < remote.size_bytes) {
      throwIfAborted(signal)
      const length = Math.min(IMPORT_CHUNK_BYTES, remote.size_bytes - offset)
      const progress = await uploadImportChunk(
        job.id,
        remote.id,
        local.file,
        offset,
        length,
        signal,
      )
      const rolledBack = progress.confirmed_offset < offset
      if (
        progress.file_id !== remote.id ||
        progress.total_bytes !== job.total_bytes ||
        progress.confirmed_offset === offset ||
        progress.confirmed_offset < 0 ||
        (!rolledBack && progress.confirmed_offset > offset + length) ||
        progress.confirmed_offset > remote.size_bytes
      ) {
        throw new ImportUploadProtocolError('server_offset')
      }
      confirmedOffsets.set(remote.id, progress.confirmed_offset)
      const expectedUploadedBytes = orderedFiles.reduce(
        (total, item) => total + (confirmedOffsets.get(item.id) ?? 0),
        0,
      )
      if (
        progress.uploaded_bytes !== expectedUploadedBytes ||
        (!rolledBack && progress.uploaded_bytes < uploadedBytes) ||
        progress.uploaded_bytes > job.total_bytes
      ) {
        throw new ImportUploadProtocolError('server_progress')
      }
      offset = progress.confirmed_offset
      uploadedBytes = progress.uploaded_bytes
      onProgress({
        uploadedBytes,
        totalBytes: job.total_bytes,
        currentFile: index + 1,
        totalFiles: job.total_files,
      })
    }
  }

  throwIfAborted(signal)
  return queueImportJob(job.id, signal)
}
