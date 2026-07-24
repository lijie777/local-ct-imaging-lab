import type { Series, Study } from '../../dicom-import/model/dicomImport'
import type { Patient } from '../../patients/model/patient'
import type { ViewerAnnotationTool } from '../../viewer-annotations/model/viewerAnnotation'


export type ViewerTool = 'windowLevel' | 'pan' | 'zoom'
export type AxialTool = ViewerTool | ViewerAnnotationTool

export interface AxialViewerContext {
  patient: Pick<Patient, 'medical_record_no' | 'name'>
  study: Study
  series: Series
}

export type AxialSeriesStatus = 'idle' | 'loading' | 'success' | 'error'
