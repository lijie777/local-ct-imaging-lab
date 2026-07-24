import { describe, expect, it } from 'vitest'

import {
  ImportManifestError,
  buildImportManifest,
  normalizeImportPath,
} from './importManifest'


function file(
  name: string,
  bytes: Uint8Array,
  options: { lastModified?: number; relativePath?: string } = {},
): File {
  const result = new File([Uint8Array.from(bytes).buffer], name, {
    lastModified: options.lastModified ?? 1,
    type: 'application/dicom',
  })
  if (options.relativePath !== undefined) {
    Object.defineProperty(result, 'webkitRelativePath', {
      configurable: true,
      value: options.relativePath,
    })
  }
  return result
}

describe('importManifest', () => {
  it('normalizes safe relative paths and rejects ambiguous paths', () => {
    expect(normalizeImportPath('study\\series\\image.dcm')).toBe(
      'study/series/image.dcm',
    )
    for (const unsafe of [
      '',
      '/image.dcm',
      'C:/image.dcm',
      'study//image.dcm',
      'study/./image.dcm',
      'study/../image.dcm',
      'study/\u0000image.dcm',
    ]) {
      expect(() => normalizeImportPath(unsafe)).toThrow(ImportManifestError)
    }
  })

  it('uses webkitRelativePath, preserves input order, and hashes small files', async () => {
    const first = file('image.dcm', new Uint8Array([0, 1, 2, 3]), {
      lastModified: 123,
      relativePath: '图像\\image.dcm',
    })
    const second = file('plain.dcm', new Uint8Array([9]), {
      lastModified: 124,
    })

    const manifest = await buildImportManifest([first, second])

    expect(manifest.map((item) => item.relative_path)).toEqual([
      '图像/image.dcm',
      'plain.dcm',
    ])
    expect(manifest[0]).toEqual({
      relative_path: '图像/image.dcm',
      size_bytes: 4,
      last_modified_ms: 123,
      resume_fingerprint:
        'c13a94cf063fc11a83c770cc3ef354b41142f74b3060395ba45bda2ee7265aab',
    })
  })

  it('hashes only the first and last 32 KiB for large files', async () => {
    const bytes = Uint8Array.from(
      { length: 70 * 1024 },
      (_, index) => index % 251,
    )
    const manifest = await buildImportManifest([
      file('large.dcm', bytes, { lastModified: 456 }),
    ])

    expect(manifest[0].resume_fingerprint).toBe(
      '297e912d539bc4b388221ff2da6dd4b212df618845f718769af674b7b76269f6',
    )
  })

  it('enforces empty, duplicate, file-count, file-size, and total-size limits', async () => {
    await expect(buildImportManifest([])).rejects.toMatchObject({ code: 'empty' })
    const duplicate = file('same.dcm', new Uint8Array([1]))
    await expect(buildImportManifest([duplicate, duplicate])).rejects.toMatchObject({
      code: 'duplicate_path',
    })

    const tooMany = Array.from(
      { length: 2001 },
      (_, index) => file(`${index}.dcm`, new Uint8Array([1])),
    )
    await expect(buildImportManifest(tooMany)).rejects.toMatchObject({
      code: 'file_count',
    })

    const oversized = file('large.dcm', new Uint8Array([1]))
    Object.defineProperty(oversized, 'size', { configurable: true, value: 512 * 1024 * 1024 + 1 })
    await expect(buildImportManifest([oversized])).rejects.toMatchObject({
      code: 'file_size',
    })

    const overTotal = Array.from({ length: 17 }, (_, index) => {
      const item = file(`total-${index}.dcm`, new Uint8Array([1]))
      Object.defineProperty(item, 'size', {
        configurable: true,
        value: 512 * 1024 * 1024,
      })
      return item
    })
    await expect(buildImportManifest(overTotal)).rejects.toMatchObject({
      code: 'total_size',
    })
  })

  it('stops before reading when aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      buildImportManifest(
        [file('image.dcm', new Uint8Array([1]))],
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
