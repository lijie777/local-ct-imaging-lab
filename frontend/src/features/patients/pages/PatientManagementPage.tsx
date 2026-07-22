import { useRef, useState } from 'react'

import { AppShell } from '../../../app/AppShell'
import { DicomImportDialog } from '../../dicom-import/components/DicomImportDialog'
import { StudyList } from '../../dicom-import/components/StudyList'
import { usePatientStudies } from '../../dicom-import/hooks/usePatientStudies'
import { AxialViewerPage } from '../../axial-viewer/pages/AxialViewerPage'
import type { AxialViewerContext } from '../../axial-viewer/model/axialViewer'
import { PatientDetails } from '../components/PatientDetails'
import { DeletePatientDialog } from '../components/DeletePatientDialog'
import { PatientFormDialog } from '../components/PatientFormDialog'
import { PatientList } from '../components/PatientList'
import { PatientPageState } from '../components/PatientPageState'
import { PatientSearchForm } from '../components/PatientSearchForm'
import { usePatientDetail } from '../hooks/usePatientDetail'
import { usePatientList } from '../hooks/usePatientList'
import type { Patient } from '../model/patient'
import { deletePatient } from '../api/patientApi'


export function PatientManagementPage() {
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const importButtonRef = useRef<HTMLButtonElement>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [viewerContext, setViewerContext] = useState<AxialViewerContext | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const list = usePatientList()
  const detail = usePatientDetail(selectedPatientId)
  const patientStudies = usePatientStudies(selectedPatientId)

  if (viewerContext !== null) {
    return (
      <AxialViewerPage
        context={viewerContext}
        onClose={() => setViewerContext(null)}
      />
    )
  }

  function patientCreated(patient: Patient) {
    setCreateDialogOpen(false)
    setSelectedPatientId(patient.id)
    void list.reload()
  }

  function patientUpdated(patient: Patient) {
    setEditDialogOpen(false)
    setSelectedPatientId(patient.id)
    void list.reload()
    void detail.reload()
  }

  function search(query: string) {
    setSelectedPatientId(null)
    setEditDialogOpen(false)
    setDeleteDialogOpen(false)
    setImportDialogOpen(false)
    void list.search(query)
  }

  function dicomImported() {
    void Promise.all([
      list.reload(),
      detail.reload(),
      patientStudies.reload(),
    ])
  }

  function cancelDelete() {
    if (deleting) {
      return
    }
    setDeleteError(null)
    setDeleteDialogOpen(false)
  }

  async function confirmDelete() {
    if (detail.patient === null) {
      return
    }
    setDeleting(true)
    setDeleteError(null)
    try {
      await deletePatient(detail.patient.id)
      setDeleteDialogOpen(false)
      setSelectedPatientId(null)
      await list.reload()
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : '删除失败，请重试',
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AppShell>
      <div className="patient-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">本机病人资料</p>
            <h1>病人管理</h1>
            <p>创建虚构病人并查看当前已保存的信息。</p>
          </div>
          <button
            className="button button--primary"
            onClick={() => setCreateDialogOpen(true)}
            ref={createButtonRef}
            type="button"
          >
            创建病人
          </button>
        </header>

        <PatientSearchForm
          onSearch={search}
          searching={list.status === 'loading' && list.query.length > 0}
        />

        {list.status === 'loading' ? (
          <PatientPageState
            kind="loading"
            message={list.query ? '正在搜索病人…' : '正在加载病人…'}
          />
        ) : null}
        {list.status === 'error' ? (
          <PatientPageState
            kind="error"
            message={`${list.query ? '无法搜索病人' : '无法加载病人列表'}：${list.error ?? '请重试'}`}
          />
        ) : null}
        {list.status === 'success' && list.patients.length === 0 && !list.query ? (
          <PatientPageState kind="empty" message="暂无病人，请创建第一位虚构病人。" />
        ) : null}
        {list.status === 'success' && list.patients.length === 0 && list.query ? (
          <PatientPageState kind="empty" message="未找到匹配的病人，请清空搜索后重试。" />
        ) : null}
        {list.status === 'success' && list.patients.length > 0 ? (
          <PatientList patients={list.patients} onSelect={setSelectedPatientId} />
        ) : null}

        {detail.status === 'loading' ? (
          <PatientPageState kind="loading" message="正在加载病人详情…" />
        ) : null}
        {detail.status === 'error' ? (
          <PatientPageState
            kind="error"
            message={`无法加载病人详情：${detail.error ?? '请重试'}`}
          />
        ) : null}
        {selectedPatientId !== null &&
        detail.status === 'success' &&
        detail.patient !== null ? (
          <PatientDetails
            deleteButtonRef={deleteButtonRef}
            editButtonRef={editButtonRef}
            importButtonRef={importButtonRef}
            onDelete={() => {
              setDeleteError(null)
              setDeleteDialogOpen(true)
            }}
            onEdit={() => setEditDialogOpen(true)}
            onImport={() => setImportDialogOpen(true)}
            patient={detail.patient}
          />
        ) : null}
        {selectedPatientId !== null && detail.status === 'success' ? (
          <StudyList
            error={patientStudies.error}
            onOpenSeries={(study, series) => {
              if (detail.patient === null) {
                return
              }
              setViewerContext({
                patient: {
                  medical_record_no: detail.patient.medical_record_no,
                  name: detail.patient.name,
                },
                study,
                series,
              })
            }}
            onRetry={() => void patientStudies.reload()}
            seriesByStudy={patientStudies.seriesByStudy}
            status={patientStudies.status}
            studies={patientStudies.studies}
          />
        ) : null}
      </div>

      <PatientFormDialog
        onCancel={() => setCreateDialogOpen(false)}
        onSaved={patientCreated}
        open={createDialogOpen}
        patient={null}
        returnFocusRef={createButtonRef}
      />
      <PatientFormDialog
        onCancel={() => setEditDialogOpen(false)}
        onSaved={patientUpdated}
        open={editDialogOpen}
        patient={selectedPatientId === null ? null : detail.patient}
        returnFocusRef={editButtonRef}
      />
      <DeletePatientDialog
        deleting={deleting}
        error={deleteError}
        onCancel={cancelDelete}
        onConfirm={() => void confirmDelete()}
        open={deleteDialogOpen}
        patient={detail.patient}
        returnFocusRef={deleteButtonRef}
      />
      {detail.patient !== null ? (
        <DicomImportDialog
          onCancel={() => setImportDialogOpen(false)}
          onImported={dicomImported}
          open={importDialogOpen}
          patient={detail.patient}
          returnFocusRef={importButtonRef}
        />
      ) : null}
    </AppShell>
  )
}
