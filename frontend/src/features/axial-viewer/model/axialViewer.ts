import type { Series, Study } from '../../dicom-import/model/dicomImport'
import type { Patient } from '../../patients/model/patient'


export type ViewerTool = 'windowLevel' | 'pan' | 'zoom'

export interface AxialViewerContext {
  patient: Pick<Patient, 'medical_record_no' | 'name'>
  study: Study
  series: Series
}

export type AxialSeriesStatus = 'idle' | 'loading' | 'success' | 'error'
