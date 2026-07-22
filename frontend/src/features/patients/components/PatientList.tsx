import {
  formatBirthDate,
  formatLatestStudyDate,
  formatSex,
  formatStudyCount,
} from '../model/patientFormatters'
import type { Patient } from '../model/patient'


interface PatientListProps {
  patients: Patient[]
  onSelect: (patientId: string) => void
}

export function PatientList({ patients, onSelect }: PatientListProps) {
  return (
    <section aria-label="病人列表" className="patient-list-section">
      <ul className="patient-list">
        {patients.map((patient) => (
          <li className="patient-card" key={patient.id}>
            <div className="patient-card__identity">
              <strong>{patient.name}</strong>
              <span>{patient.medical_record_no}</span>
            </div>
            <dl className="patient-card__summary">
              <div>
                <dt>性别</dt>
                <dd>{formatSex(patient.sex)}</dd>
              </div>
              <div>
                <dt>出生日期</dt>
                <dd>{formatBirthDate(patient.birth_date)}</dd>
              </div>
              <div>
                <dt>影像检查数量</dt>
                <dd>{formatStudyCount(patient.study_count)}</dd>
              </div>
              <div>
                <dt>最近检查日期</dt>
                <dd>{formatLatestStudyDate(patient.latest_study_date)}</dd>
              </div>
            </dl>
            <button
              className="button button--secondary"
              onClick={() => onSelect(patient.id)}
              type="button"
            >
              查看{patient.name}详情
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
