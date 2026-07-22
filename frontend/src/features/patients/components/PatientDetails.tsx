import type { RefObject } from 'react'

import type { Patient } from '../model/patient'
import {
  formatBirthDate,
  formatDateTime,
  formatLatestStudyDate,
  formatSex,
  formatStudyCount,
} from '../model/patientFormatters'


interface PatientDetailsProps {
  deleteButtonRef: RefObject<HTMLButtonElement | null>
  editButtonRef: RefObject<HTMLButtonElement | null>
  importButtonRef: RefObject<HTMLButtonElement | null>
  onDelete: () => void
  onEdit: () => void
  onImport: () => void
  patient: Patient
}

export function PatientDetails({
  deleteButtonRef,
  editButtonRef,
  importButtonRef,
  onDelete,
  onEdit,
  onImport,
  patient,
}: PatientDetailsProps) {
  const fields = [
    ['病历号', patient.medical_record_no],
    ['姓名', patient.name],
    ['性别', formatSex(patient.sex)],
    ['出生日期', formatBirthDate(patient.birth_date)],
    ['影像检查数量', formatStudyCount(patient.study_count)],
    ['最近检查日期', formatLatestStudyDate(patient.latest_study_date)],
    ['创建时间', formatDateTime(patient.created_at)],
    ['最近更新时间', formatDateTime(patient.updated_at)],
  ]

  return (
    <section aria-label="病人详情" className="patient-details">
      <div className="section-heading">
        <div>
          <p className="eyebrow">当前病人</p>
          <h2>病人详情</h2>
        </div>
        <div className="section-heading__actions">
          <button
            className="button button--primary"
            onClick={onImport}
            ref={importButtonRef}
            type="button"
          >
            导入 DICOM
          </button>
          <button
            className="button button--secondary"
            onClick={onEdit}
            ref={editButtonRef}
            type="button"
          >
            编辑病人
          </button>
          <button
            className="button button--danger"
            onClick={onDelete}
            ref={deleteButtonRef}
            type="button"
          >
            删除病人
          </button>
        </div>
      </div>
      <dl className="patient-details__grid">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
