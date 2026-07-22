import {
  type FormEvent,
  type RefObject,
  useEffect,
  useState,
} from 'react'

import { ModalDialog } from '../../../components/ModalDialog'
import { createPatient, updatePatient } from '../api/patientApi'
import type {
  Patient,
  PatientCreateInput,
  PatientField,
  PatientFieldError,
  Sex,
} from '../model/patient'
import {
  type PatientValidationErrors,
  validatePatientInput,
} from '../model/patientValidation'


interface PatientFormDialogProps {
  patient: Patient | null
  open: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  onCancel: () => void
  onSaved: (patient: Patient) => void
}

interface PatientDraft {
  medical_record_no: string
  name: string
  sex: Sex
  birth_date: string
}

const EMPTY_DRAFT: PatientDraft = {
  medical_record_no: '',
  name: '',
  sex: 'unknown',
  birth_date: '',
}

function draftFromPatient(patient: Patient | null): PatientDraft {
  if (patient === null) {
    return EMPTY_DRAFT
  }
  return {
    medical_record_no: patient.medical_record_no,
    name: patient.name,
    sex: patient.sex,
    birth_date: patient.birth_date ?? '',
  }
}

const EDITABLE_FIELDS = new Set<PatientField>([
  'medical_record_no',
  'name',
  'sex',
  'birth_date',
])

function hasFieldErrors(
  error: unknown,
): error is Error & { fieldErrors: PatientFieldError[] } {
  return (
    error instanceof Error &&
    'fieldErrors' in error &&
    Array.isArray(error.fieldErrors)
  )
}

export function PatientFormDialog({
  open,
  patient,
  returnFocusRef,
  onCancel,
  onSaved,
}: PatientFormDialogProps) {
  const [draft, setDraft] = useState<PatientDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<PatientValidationErrors>({})
  const [requestError, setRequestError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    setDraft(draftFromPatient(patient))
    setErrors({})
    setRequestError(null)
  }, [open, patient])

  function clearDraft() {
    setDraft(EMPTY_DRAFT)
    setErrors({})
    setRequestError(null)
  }

  function cancel() {
    if (saving) {
      return
    }
    clearDraft()
    onCancel()
  }

  function updateDraft(field: keyof PatientDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setRequestError(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationErrors = validatePatientInput(draft)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      setRequestError('请修正表单中的字段错误')
      return
    }

    const input: PatientCreateInput = {
      medical_record_no: draft.medical_record_no,
      name: draft.name,
      sex: draft.sex,
      birth_date: draft.birth_date || null,
    }

    setSaving(true)
    setRequestError(null)
    try {
      const savedPatient =
        patient === null
          ? await createPatient(input)
          : await updatePatient(patient.id, input)
      clearDraft()
      onSaved(savedPatient)
    } catch (error) {
      if (hasFieldErrors(error)) {
        const fieldErrors: PatientValidationErrors = {}
        for (const fieldError of error.fieldErrors) {
          if (EDITABLE_FIELDS.has(fieldError.field)) {
            const field = fieldError.field as keyof PatientValidationErrors
            fieldErrors[field] = fieldError.message
          }
        }
        setErrors(fieldErrors)
      }
      setRequestError(
        error instanceof Error ? error.message : '创建失败，请重试',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalDialog
      onRequestClose={cancel}
      open={open}
      returnFocusRef={returnFocusRef}
      title={patient === null ? '创建病人' : '编辑病人'}
    >
      <form className="patient-form" noValidate onSubmit={submit}>
        {requestError !== null ? (
          <p className="form-alert" role="alert">
            {requestError}
          </p>
        ) : null}

        <label>
          <span>病历号</span>
          <input
            aria-describedby={errors.medical_record_no ? 'medical-record-error' : undefined}
            aria-invalid={errors.medical_record_no ? true : undefined}
            autoComplete="off"
            onChange={(event) => updateDraft('medical_record_no', event.target.value)}
            value={draft.medical_record_no}
          />
        </label>
        {errors.medical_record_no ? (
          <p className="field-error" id="medical-record-error">
            {errors.medical_record_no}
          </p>
        ) : null}

        <label>
          <span>姓名</span>
          <input
            aria-describedby={errors.name ? 'name-error' : undefined}
            aria-invalid={errors.name ? true : undefined}
            autoComplete="off"
            onChange={(event) => updateDraft('name', event.target.value)}
            value={draft.name}
          />
        </label>
        {errors.name ? (
          <p className="field-error" id="name-error">
            {errors.name}
          </p>
        ) : null}

        <label>
          <span>性别</span>
          <select
            aria-describedby={errors.sex ? 'sex-error' : undefined}
            aria-invalid={errors.sex ? true : undefined}
            onChange={(event) => updateDraft('sex', event.target.value)}
            value={draft.sex}
          >
            <option value="unknown">未知</option>
            <option value="male">男</option>
            <option value="female">女</option>
            <option value="other">其他</option>
          </select>
        </label>
        {errors.sex ? (
          <p className="field-error" id="sex-error">
            {errors.sex}
          </p>
        ) : null}

        <label>
          <span>出生日期</span>
          <input
            aria-describedby={errors.birth_date ? 'birth-date-error' : undefined}
            aria-invalid={errors.birth_date ? true : undefined}
            onChange={(event) => updateDraft('birth_date', event.target.value)}
            type="date"
            value={draft.birth_date}
          />
        </label>
        {errors.birth_date ? (
          <p className="field-error" id="birth-date-error">
            {errors.birth_date}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button
            className="button button--secondary"
            disabled={saving}
            onClick={cancel}
            type="button"
          >
            取消
          </button>
          <button className="button button--primary" disabled={saving} type="submit">
            {saving ? '正在保存…' : '保存'}
          </button>
        </div>
      </form>
    </ModalDialog>
  )
}
