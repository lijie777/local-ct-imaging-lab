export type Sex = 'male' | 'female' | 'other' | 'unknown'

export interface Patient {
  id: string
  medical_record_no: string
  name: string
  sex: Sex
  birth_date: string | null
  study_count: number
  latest_study_date: string | null
  created_at: string
  updated_at: string
}

export interface PatientCreateInput {
  medical_record_no: string
  name: string
  sex: Sex
  birth_date: string | null
}

export type PatientPatchInput = Partial<PatientCreateInput>

export type PatientField =
  | 'medical_record_no'
  | 'name'
  | 'sex'
  | 'birth_date'
  | 'id'
  | 'request'

export interface PatientFieldError {
  field: PatientField
  code: string
  message: string
}

export interface PatientErrorResponse {
  error: {
    code: string
    message: string
    field_errors: PatientFieldError[]
  }
}
