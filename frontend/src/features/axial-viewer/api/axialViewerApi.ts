export { getSeriesDetails } from '../../dicom-import/api/dicomImportApi'


export function instanceImageId(instanceId: string): string {
  const path = `/api/instances/${encodeURIComponent(instanceId)}/file`
  return `wadouri:${new URL(path, window.location.origin).toString()}`
}
