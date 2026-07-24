import type { ImportManifestFile } from '../model/importJob'


const FINGERPRINT_SAMPLE_BYTES = 32 * 1024
const MAX_FILES = 2_000
const MAX_FILE_BYTES = 512 * 1024 * 1024
const MAX_TOTAL_BYTES = 8 * 1024 ** 3
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u

export class ImportManifestError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ImportManifestError'
    this.code = code
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }
  if (signal.reason !== undefined) {
    throw signal.reason
  }
  throw new DOMException('操作已暂停', 'AbortError')
}

export function normalizeImportPath(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  if (
    normalized.length === 0 ||
    normalized.length > 1024 ||
    normalized.startsWith('/') ||
    WINDOWS_ABSOLUTE_PATH.test(normalized) ||
    CONTROL_CHARACTER.test(normalized)
  ) {
    throw new ImportManifestError('invalid_path', '文件相对路径无效')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new ImportManifestError('invalid_path', '文件相对路径无效')
  }
  return normalized
}

async function fingerprint(
  file: File,
  relativePath: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal)
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      relative_path: relativePath,
      size: file.size,
      last_modified_ms: file.lastModified,
    }),
  )
  let sample: Uint8Array
  if (file.size <= 2 * FINGERPRINT_SAMPLE_BYTES) {
    sample = new Uint8Array(await file.arrayBuffer())
  } else {
    const head = new Uint8Array(
      await file.slice(0, FINGERPRINT_SAMPLE_BYTES).arrayBuffer(),
    )
    throwIfAborted(signal)
    const tail = new Uint8Array(
      await file.slice(file.size - FINGERPRINT_SAMPLE_BYTES).arrayBuffer(),
    )
    sample = new Uint8Array(head.length + tail.length)
    sample.set(head)
    sample.set(tail, head.length)
  }
  throwIfAborted(signal)
  const input = new Uint8Array(metadata.length + sample.length)
  input.set(metadata)
  input.set(sample, metadata.length)
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', input),
  )
  throwIfAborted(signal)
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function buildImportManifest(
  files: readonly File[],
  signal?: AbortSignal,
): Promise<ImportManifestFile[]> {
  throwIfAborted(signal)
  if (files.length === 0) {
    throw new ImportManifestError('empty', '请选择至少一个 DICOM 文件或文件夹')
  }
  if (files.length > MAX_FILES) {
    throw new ImportManifestError('file_count', '单次最多选择 2,000 个文件')
  }

  const paths = new Set<string>()
  const normalizedPaths: string[] = []
  let totalBytes = 0
  for (const file of files) {
    const relativePath = normalizeImportPath(file.webkitRelativePath || file.name)
    if (paths.has(relativePath)) {
      throw new ImportManifestError('duplicate_path', '所选文件包含重复相对路径')
    }
    paths.add(relativePath)
    normalizedPaths.push(relativePath)
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      throw new ImportManifestError('file_size', '单个文件超过本机教学演示上限')
    }
    totalBytes += file.size
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new ImportManifestError('total_size', '所选文件总量超过本机教学演示上限')
  }

  const result: ImportManifestFile[] = []
  for (let ordinal = 0; ordinal < files.length; ordinal += 1) {
    throwIfAborted(signal)
    const file = files[ordinal]
    const relativePath = normalizedPaths[ordinal]
    result.push({
      relative_path: relativePath,
      size_bytes: file.size,
      last_modified_ms: file.lastModified,
      resume_fingerprint: await fingerprint(file, relativePath, signal),
    })
  }
  return result
}
