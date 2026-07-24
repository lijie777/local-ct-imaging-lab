import type { ImportReport } from './dicomImport'


export type ImportJobStatus =
  | 'uploading'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'

export interface ImportManifestFile {
  relative_path: string
  size_bytes: number
  last_modified_ms: number
  resume_fingerprint: string
}

export interface ImportJobFile extends ImportManifestFile {
  id: string
  ordinal: number
  confirmed_offset: number
}

export interface ImportJob {
  id: string
  patient_id: string
  status: ImportJobStatus
  total_files: number
  total_bytes: number
  uploaded_bytes: number
  files: ImportJobFile[]
  report: ImportReport | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
}

export interface ImportUploadProgress {
  file_id: string
  confirmed_offset: number
  uploaded_bytes: number
  total_bytes: number
}

export interface UploadProgress {
  uploadedBytes: number
  totalBytes: number
  currentFile: number
  totalFiles: number
}
