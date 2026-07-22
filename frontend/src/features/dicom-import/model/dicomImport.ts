export type ImportCategory =
  | 'success'
  | 'duplicate'
  | 'skipped'
  | 'unsupported'
  | 'failed'

export interface ImportItem {
  file_name: string
  category: ImportCategory
  code: string
  message: string
  study_instance_uid: string | null
  series_instance_uid: string | null
  sop_instance_uid: string | null
}

export interface ImportReport {
  total: number
  success: number
  duplicate: number
  skipped: number
  unsupported: number
  failed: number
  items: ImportItem[]
}

export interface Study {
  id: string
  study_instance_uid: string
  dicom_patient_id: string
  study_date: string | null
  study_time: string | null
  accession_number: string | null
  description: string | null
  series_count: number
  instance_count: number
  created_at: string
}

export type ViewabilityStatus = 'eligible' | 'unsupported'

export interface Series {
  id: string
  series_instance_uid: string
  modality: 'CT'
  series_number: number | null
  description: string | null
  body_part_examined: string | null
  rows: number | null
  columns: number | null
  instance_count: number
  viewability_status: ViewabilityStatus
  viewability_reason: string | null
}

export interface Instance {
  id: string
  sop_instance_uid: string
  sop_class_uid: string
  transfer_syntax_uid: string
  instance_number: number | null
  image_position_patient: number[] | null
  image_orientation_patient: number[] | null
  rows: number | null
  columns: number | null
}

export interface SeriesDetail extends Series {
  instances: Instance[]
}
