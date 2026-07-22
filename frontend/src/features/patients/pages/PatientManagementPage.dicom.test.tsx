import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import * as patientApi from '../api/patientApi'
import * as dicomApi from '../../dicom-import/api/dicomImportApi'
import * as axialHook from '../../axial-viewer/hooks/useAxialSeries'
import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import type { Patient } from '../model/patient'
import { PatientManagementPage } from './PatientManagementPage'


vi.mock('../api/patientApi', () => ({
  listPatients: vi.fn(),
  getPatient: vi.fn(),
  createPatient: vi.fn(),
  updatePatient: vi.fn(),
  deletePatient: vi.fn(),
}))
vi.mock('../../dicom-import/api/dicomImportApi', () => ({
  listPatientStudies: vi.fn(),
  listStudySeries: vi.fn(),
  importDicom: vi.fn(),
}))
vi.mock('../../axial-viewer/hooks/useAxialSeries', () => ({ useAxialSeries: vi.fn() }))
vi.mock('../../axial-viewer/components/AxialViewport', () => ({
  AxialViewport: ({ imageIds }: { imageIds: string[] }) => (
    <div>轴位画布 {imageIds.length}</div>
  ),
}))
vi.mock('../../mpr-viewer/pages/MprViewerPage', () => ({
  MprViewerPage: ({ onClose }: { onClose: () => void }) => (
    <section>
      <h1>CT 三视图</h1>
      <button onClick={onClose} type="button">返回轴位查看器</button>
    </section>
  ),
}))

const PATIENT = {
  id: '11111111-1111-4111-8111-111111111111',
  medical_record_no: 'MR-DICOM-001',
  name: 'Teaching',
  sex: 'unknown',
  birth_date: null,
  study_count: 0,
  latest_study_date: null,
  created_at: '2026-07-20T09:30:00Z',
  updated_at: '2026-07-20T09:30:00Z',
} satisfies Patient

const AXIAL_DETAIL = {
  id: 'series-1',
  series_instance_uid: '1.2.4',
  modality: 'CT',
  series_number: 1,
  description: 'Axial',
  body_part_examined: 'CHEST',
  rows: 2,
  columns: 2,
  instance_count: 2,
  viewability_status: 'eligible',
  viewability_reason: null,
  instances: [
    {
      id: 'instance-1',
      sop_instance_uid: '1.2.4.1',
      sop_class_uid: '1.2.840',
      transfer_syntax_uid: '1.2.840.10008.1.2.1',
      instance_number: 1,
      image_position_patient: [0, 0, 0],
      image_orientation_patient: [1, 0, 0, 0, 1, 0],
      rows: 2,
      columns: 2,
    },
    {
      id: 'instance-2',
      sop_instance_uid: '1.2.4.2',
      sop_class_uid: '1.2.840',
      transfer_syntax_uid: '1.2.840.10008.1.2.1',
      instance_number: 2,
      image_position_patient: [0, 0, 1],
      image_orientation_patient: [1, 0, 0, 0, 1, 0],
      rows: 2,
      columns: 2,
    },
  ],
} satisfies SeriesDetail

beforeAll(() => {
  if (HTMLDialogElement.prototype.showModal === undefined) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
  }
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(patientApi.listPatients).mockResolvedValue([PATIENT])
  vi.mocked(patientApi.getPatient).mockResolvedValue(PATIENT)
  vi.mocked(dicomApi.listPatientStudies).mockResolvedValue([])
  vi.mocked(dicomApi.listStudySeries).mockResolvedValue([])
  vi.mocked(axialHook.useAxialSeries).mockReturnValue({
    detail: AXIAL_DETAIL,
    error: null,
    imageIds: ['a', 'b'],
    reload: vi.fn(),
    status: 'success',
  })
})

it('opens DICOM import only after selecting a patient and keeps disclaimer visible', async () => {
  const user = userEvent.setup()
  render(<PatientManagementPage />)

  expect(screen.queryByRole('button', { name: '导入 DICOM' })).not.toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: /查看.*Teaching.*详情/ }))
  await user.click(await screen.findByRole('button', { name: '导入 DICOM' }))

  expect(screen.getByRole('dialog', { name: '导入 DICOM' })).toBeVisible()
  expect(screen.getAllByText('教学演示软件，不用于临床诊断')).toHaveLength(2)
})

it('preserves context through Patient to Axial to MPR to Axial to Patient', async () => {
  const user = userEvent.setup()
  vi.mocked(dicomApi.listPatientStudies).mockResolvedValue([
    {
      id: 'study-1',
      study_instance_uid: '1.2.3',
      dicom_patient_id: PATIENT.medical_record_no,
      study_date: '2026-07-20',
      study_time: null,
      accession_number: null,
      description: 'Teaching CT',
      series_count: 1,
      instance_count: 3,
      created_at: '2026-07-20T09:30:00Z',
    },
  ])
  vi.mocked(dicomApi.listStudySeries).mockResolvedValue([
    {
      id: 'series-1',
      series_instance_uid: '1.2.4',
      modality: 'CT',
      series_number: 1,
      description: 'Axial',
      body_part_examined: 'CHEST',
      rows: 2,
      columns: 2,
      instance_count: 3,
      viewability_status: 'eligible',
      viewability_reason: null,
    },
  ])
  render(<PatientManagementPage />)

  await user.click(await screen.findByRole('button', { name: /查看.*Teaching.*详情/ }))
  await user.click(await screen.findByRole('button', { name: '打开轴位查看器' }))
  expect(screen.getByRole('heading', { name: '轴位查看器' })).toBeVisible()
  expect(screen.getByText('Teaching CT')).toBeVisible()

  await user.click(screen.getByRole('button', { name: '进入三视图' }))
  expect(screen.getByRole('heading', { name: 'CT 三视图' })).toBeVisible()

  await user.click(screen.getByRole('button', { name: '返回轴位查看器' }))
  expect(screen.getByRole('heading', { name: '轴位查看器' })).toBeVisible()

  await user.click(screen.getByRole('button', { name: '返回病人管理' }))
  expect(await screen.findByRole('region', { name: '病人详情' })).toBeVisible()
})
