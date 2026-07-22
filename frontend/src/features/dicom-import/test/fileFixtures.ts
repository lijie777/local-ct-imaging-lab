export function createDicomFile(
  name = 'image-001.dcm',
  contents: BlobPart = new Uint8Array([0, 1, 2, 3]),
): File {
  return new File([contents], name, { type: 'application/dicom' })
}

export function createDirectoryDicomFile(
  relativePath = 'study/series/image-001.dcm',
): File {
  const name = relativePath.split('/').at(-1) ?? 'image-001.dcm'
  const file = createDicomFile(name)
  Object.defineProperty(file, 'webkitRelativePath', {
    configurable: true,
    value: relativePath,
  })
  return file
}

export function createEmptyFile(name = 'empty.dcm'): File {
  return new File([], name, { type: 'application/dicom' })
}
