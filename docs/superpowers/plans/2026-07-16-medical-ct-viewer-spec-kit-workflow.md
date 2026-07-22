# Medical CT Viewer Spec Kit Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to follow this plan task-by-task. Spec Kit's generated `spec.md`, `plan.md`, and `tasks.md` remain the authoritative implementation artifacts.

**Goal:** Use four complete Spec Kit feature cycles to build and verify a local Web application for patient management, real CT DICOM import, axial viewing, and linked three-view MPR.

**Architecture:** The application uses a React/TypeScript/Vite frontend with Cornerstone3D and a local Python/FastAPI backend with pydicom, SQLite, and managed DICOM file storage. The work is divided into independently testable feature cycles so the first Spec Kit exercise does not produce one oversized specification.

**Tech Stack:** React, TypeScript, Vite, Cornerstone3D, Python, FastAPI, pydicom, SQLAlchemy, SQLite, pytest, Vitest, React Testing Library

---

## Plan boundary

This document orchestrates Spec Kit. It does not replace Spec Kit's own artifacts.

For each feature cycle:

```text
$speckit-specify
→ $speckit-clarify
→ $speckit-checklist
→ $speckit-plan
→ $speckit-tasks
→ $speckit-analyze
→ review generated artifacts
→ $speckit-implement
→ run acceptance checks
```

Do not start the next cycle until the current cycle produces working, testable software.

### Target source structure

Spec Kit should keep the implementation within this structure:

```text
TestProj/
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── patients/
│   │   │   ├── dicom-import/
│   │   │   └── viewer/
│   │   ├── pages/
│   │   └── test/
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── db/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   ├── tests/
│   └── pyproject.toml
├── data/
│   └── dicom/
├── docs/
├── .agents/
└── .specify/
```

---

### Task 1: Prepare the Spec Kit exercise

**Files:**
- Verify: `.specify/`
- Verify: `.agents/skills/`
- Create later through Spec Kit: `.specify/memory/constitution.md`

- [ ] **Step 1: Open a new terminal in the project**

Run:

```powershell
cd D:\work\TestAI\TestProj
```

Expected: the prompt is located at `D:\work\TestAI\TestProj`.

- [ ] **Step 2: Verify the Spec Kit integration**

Run:

```powershell
specify integration status
```

Expected:

```text
Integration status: OK
Default integration: codex
Installed integrations: codex
```

- [ ] **Step 3: Verify all project skills**

Run:

```powershell
Get-ChildItem .agents\skills -Directory | Select-Object -ExpandProperty Name
```

Expected: ten directories from `speckit-analyze` through `speckit-taskstoissues`.

- [ ] **Step 4: Initialize a local Git repository**

Run:

```powershell
git init
git status --short --branch
```

Expected: a new local repository with no remote and no commits. Do not commit or push during this task.

- [ ] **Step 5: Start Codex from the project root**

Run:

```powershell
codex
```

Expected: the new Codex session discovers the project-level `$speckit-*` skills.

---

### Task 2: Establish the project constitution

**Files:**
- Create or update: `.specify/memory/constitution.md`
- Review: `.specify/templates/spec-template.md`
- Review: `.specify/templates/plan-template.md`
- Review: `.specify/templates/tasks-template.md`

- [ ] **Step 1: Invoke the constitution skill in Codex**

Enter:

```text
$speckit-constitution

Create the governing principles for a local educational medical CT viewer.

The application is a teaching demonstration and MUST NOT be used for clinical
diagnosis. All major pages must display that limitation.

The system is local-only and single-user. Patient and DICOM data must not leave
the computer. The first release must not add cloud services, authentication,
PACS, DICOMweb, reports, measurements, or 3D volume rendering.

Use small, independently testable modules. Backend business rules must have
pytest coverage. Frontend behavior must have Vitest or React Testing Library
coverage. Each feature must include an end-to-end acceptance path.

DICOM imports must never silently discard failures. Duplicate, skipped,
unsupported, and failed files must be reported separately. Database and managed
file storage must remain consistent after failures and deletions.

Prefer the minimum dependencies needed for React, Cornerstone3D, FastAPI,
pydicom, SQLAlchemy, and SQLite. Do not refactor unrelated modules.
```

- [ ] **Step 2: Review the generated constitution**

Run after the skill finishes:

```powershell
Get-Content -Raw .specify\memory\constitution.md
```

Expected:

- no unresolved square-bracket template tokens remain;
- the non-diagnostic warning is mandatory;
- privacy, local-only execution, testing, import reporting, and storage consistency are explicit.

- [ ] **Step 3: Check for unresolved template tokens**

Run:

```powershell
Select-String -Path .specify\memory\constitution.md -Pattern '\[[A-Z0-9_]+\]'
```

Expected: no output.

---

### Task 3: Feature cycle 001 — Patient management foundation

**Files generated by Spec Kit:**
- Create: `specs/001-patient-management/spec.md`
- Create: `specs/001-patient-management/plan.md`
- Create: `specs/001-patient-management/tasks.md`

**Target implementation files:**
- Create: `backend/app/main.py`
- Create: `backend/app/db/session.py`
- Create: `backend/app/models/patient.py`
- Create: `backend/app/schemas/patient.py`
- Create: `backend/app/api/patients.py`
- Create: `backend/tests/test_patients_api.py`
- Create: `frontend/src/api/patients.ts`
- Create: `frontend/src/features/patients/PatientList.tsx`
- Create: `frontend/src/features/patients/PatientForm.tsx`
- Create: `frontend/src/pages/PatientsPage.tsx`
- Create: `frontend/src/features/patients/PatientList.test.tsx`

- [ ] **Step 1: Create the patient-management specification**

Enter in Codex:

```text
$speckit-specify

Feature name: patient-management.

Build the first working feature of a local educational CT application: patient
management.

A user can create, view, edit, search, and delete patients. Each patient has a
unique medical record number, name, optional sex, and optional birth date.
The patient list shows the number of imaging studies and the latest study date,
even though the first feature initially has no DICOM import.

Deleting a patient requires explicit confirmation. Validation errors must name
the affected field. The page must display that this is a teaching demonstration
and is not for clinical diagnosis.

This feature is complete when patient data survives backend restarts and all
patient operations can be completed from the browser.
```

- [ ] **Step 2: Clarify patient rules**

Enter:

```text
$speckit-clarify

Focus on medical record number uniqueness, optional demographic fields, search
behavior, delete confirmation, empty states, validation messages, and what the
study-count columns display before DICOM import exists.
```

- [ ] **Step 3: Generate the requirements checklist**

Enter:

```text
$speckit-checklist

Create a checklist for patient CRUD completeness, validation clarity,
persistence, destructive-action confirmation, privacy, and the non-diagnostic
warning.
```

- [ ] **Step 4: Generate the technical plan**

Enter:

```text
$speckit-plan

Use a React 19 TypeScript frontend created with Vite and a Python FastAPI
backend. Use SQLAlchemy 2 and SQLite for persistence. Keep frontend and backend
in separate top-level directories. Use pytest for backend tests and Vitest or
React Testing Library for frontend tests. Document and execute the complete browser
acceptance path without adding another test framework. Do not add DICOM libraries in this feature.
```

- [ ] **Step 5: Generate and analyze tasks**

Enter these commands one at a time:

```text
$speckit-tasks
$speckit-analyze
```

Expected: analyze reports no unresolved coverage or consistency errors before implementation.

- [ ] **Step 6: Review generated artifacts**

Run:

```powershell
Get-Content -Raw .\specs\001-patient-management\spec.md
Get-Content -Raw .\specs\001-patient-management\plan.md
Get-Content -Raw .\specs\001-patient-management\tasks.md
```

Expected: scope contains patient management only and does not introduce DICOM or viewer work.

- [ ] **Step 7: Implement the feature**

Enter:

```text
$speckit-implement

Implement only the patient-management feature. Stop after its tests and
end-to-end acceptance path pass. Do not start DICOM import or CT viewing.
```

- [ ] **Step 8: Verify the feature**

Run the exact commands produced by `plan.md` and `tasks.md`. At minimum verify:

```text
Create patient
→ edit patient
→ search by name and medical record number
→ reject duplicate medical record number
→ confirm before delete
→ restart backend
→ patient data remains
```

---

### Task 4: Feature cycle 002 — Real DICOM import and persistence

**Files generated by Spec Kit:**
- Create: `specs/002-dicom-import/spec.md`
- Create: `specs/002-dicom-import/plan.md`
- Create: `specs/002-dicom-import/tasks.md`

**Target implementation files:**
- Create: `backend/app/models/study.py`
- Create: `backend/app/models/series.py`
- Create: `backend/app/models/instance.py`
- Create: `backend/app/services/dicom_parser.py`
- Create: `backend/app/services/dicom_import.py`
- Create: `backend/app/services/managed_storage.py`
- Create: `backend/app/api/dicom_import.py`
- Create: `backend/app/api/studies.py`
- Create: `backend/tests/test_dicom_import.py`
- Create: `frontend/src/features/dicom-import/DicomImportDialog.tsx`
- Create: `frontend/src/features/dicom-import/ImportReport.tsx`
- Create: `frontend/src/features/dicom-import/DicomImportDialog.test.tsx`

- [ ] **Step 1: Create the DICOM-import specification**

Enter:

```text
$speckit-specify

Feature name: dicom-import.

Add real local CT DICOM import to the existing patient-management application.

The user imports files or a folder under a selected patient. The system reads
DICOM metadata, accepts CT instances, groups them by StudyInstanceUID and
SeriesInstanceUID, detects duplicate SOPInstanceUID values, stores managed
copies locally, and indexes metadata in SQLite.

The import result separately reports successful, duplicate, skipped, and failed
files. Non-DICOM, damaged, non-CT, unsupported, and patient-mismatched files
must have explicit reasons. Patient mismatch blocks the affected group.

Successful files may remain when unrelated files fail. A database transaction
failure rolls back its records and removes only files newly copied by that
failed transaction.

This feature is complete when a real CT dataset can be imported, listed under
the correct patient, and reopened after restarting the services.
```

- [ ] **Step 2: Clarify import semantics**

Enter:

```text
$speckit-clarify

Focus on DICOM PatientID matching, missing tags, duplicate behavior, partial
success, unsupported transfer syntax, managed file naming, transaction
rollback, import progress, and delete cleanup.
```

- [ ] **Step 3: Generate the import checklist**

Enter:

```text
$speckit-checklist

Create a checklist for DICOM grouping, UID uniqueness, patient matching,
partial-failure reporting, database/file consistency, privacy, restart
persistence, and destructive cleanup.
```

- [ ] **Step 4: Generate the import plan**

Enter:

```text
$speckit-plan

Extend the FastAPI backend with pydicom and SQLAlchemy models for Study, Series,
and Instance. Store metadata in SQLite and managed DICOM files below
data/dicom/{patient_uuid}/{study_uid}/{series_uid}/{sop_uid}.dcm. Add React
import progress and result reporting. Use pytest fixtures containing a small
de-identified real CT series and synthetic invalid files. Do not add the image
viewer in this feature.
```

- [ ] **Step 5: Generate, analyze, review, and implement**

Enter one at a time:

```text
$speckit-tasks
$speckit-analyze
$speckit-implement

Implement only DICOM import, metadata persistence, study/series listing, import
reporting, and cleanup behavior. Do not initialize Cornerstone3D.
```

- [ ] **Step 6: Verify the DICOM-import acceptance path**

Verify:

```text
Select patient
→ import de-identified real CT folder
→ see Study and Series records
→ reimport same folder
→ instances reported as duplicates
→ import a damaged file with valid files
→ valid files remain and damaged file is reported
→ restart services
→ study and series remain available
```

---

### Task 5: Feature cycle 003 — Axial CT viewer and image tools

**Files generated by Spec Kit:**
- Create: `specs/003-axial-viewer/spec.md`
- Create: `specs/003-axial-viewer/plan.md`
- Create: `specs/003-axial-viewer/tasks.md`

**Target implementation files:**
- Create: `backend/app/api/instances.py`
- Create: `backend/tests/test_instance_file_api.py`
- Create: `frontend/src/features/viewer/cornerstone/initCornerstone.ts`
- Create: `frontend/src/features/viewer/cornerstone/createImageIds.ts`
- Create: `frontend/src/features/viewer/AxialViewport.tsx`
- Create: `frontend/src/features/viewer/ViewerToolbar.tsx`
- Create: `frontend/src/pages/ViewerPage.tsx`
- Create: `frontend/src/features/viewer/AxialViewport.test.tsx`

- [ ] **Step 1: Create the axial-viewer specification**

Enter:

```text
$speckit-specify

Feature name: axial-viewer.

Add an axial CT viewer for imported, viewable CT series.

The user opens a series from a patient's study. The viewer displays axial
slices in spatial order and shows patient, study, series, current slice, zoom,
window width, and window level information.

The user can scroll slices, change window width and level, pan, zoom, and reset
the viewport. Loading and unsupported-series errors must preserve navigation
back to the patient and study.

This feature is complete when a real imported CT series can be reopened and
interactively viewed after restarting the application.
```

- [ ] **Step 2: Clarify viewer behavior**

Enter:

```text
$speckit-clarify

Focus on slice ordering, default window width and level, tool activation,
mouse and wheel controls, loading progress, unsupported transfer syntax,
series eligibility, viewport reset, and error recovery.
```

- [ ] **Step 3: Create checklist, plan, tasks, and analysis**

Enter one at a time:

```text
$speckit-checklist
$speckit-plan

Use Cornerstone3D with the existing React/TypeScript frontend. Add the minimum
required Cornerstone packages and codecs. The FastAPI backend exposes DICOM
instance files through local HTTP endpoints. Build one axial stack or volume
viewport only. Add unit tests around image-id ordering and viewer state, and execute the
documented browser acceptance path using the de-identified CT fixture.

$speckit-tasks
$speckit-analyze
```

- [ ] **Step 4: Implement and verify**

Enter:

```text
$speckit-implement

Implement only the axial viewer and its tools. Do not add coronal, sagittal,
crosshair, measurements, or 3D rendering.
```

Verify:

```text
Open imported series
→ axial image appears
→ wheel changes slice
→ window/level changes contrast
→ pan and zoom work
→ reset restores defaults
→ reload page
→ same series opens again
```

---

### Task 6: Feature cycle 004 — Linked three-view MPR

**Files generated by Spec Kit:**
- Create: `specs/004-three-view-mpr/spec.md`
- Create: `specs/004-three-view-mpr/plan.md`
- Create: `specs/004-three-view-mpr/tasks.md`

**Target implementation files:**
- Create: `frontend/src/features/viewer/MprViewportGrid.tsx`
- Create: `frontend/src/features/viewer/cornerstone/createVolume.ts`
- Create: `frontend/src/features/viewer/cornerstone/createToolGroup.ts`
- Create: `frontend/src/features/viewer/ViewportOverlay.tsx`
- Create: `frontend/src/features/viewer/MprViewportGrid.test.tsx`
- Create: `frontend/e2e/three-view-mpr.spec.ts`

- [ ] **Step 1: Create the MPR specification**

Enter:

```text
$speckit-specify

Feature name: three-view-mpr.

Extend the existing axial CT viewer with linked axial, coronal, and sagittal
MPR viewports.

All three viewports display the same CT volume. Crosshair movement or slice
navigation in one viewport updates the spatial position of the other two.
Each viewport shows its orientation label and current position. Window width,
window level, pan, zoom, and reset remain available.

Series that lack sufficient spatial orientation or position metadata remain
listed but cannot enter MPR, and the user sees the reason.

This feature is complete when a real CT volume opens in three linked views and
the linked position remains consistent during interaction.
```

- [ ] **Step 2: Clarify MPR rules**

Enter:

```text
$speckit-clarify

Focus on MPR eligibility, volume construction, orientation labels, crosshair
synchronization, active viewport indication, shared versus per-viewport
windowing, reset behavior, layout responsiveness, and loading failure recovery.
```

- [ ] **Step 3: Generate quality artifacts**

Enter one at a time:

```text
$speckit-checklist
$speckit-plan

Use Cornerstone3D volume viewports and the crosshair tool with the existing
image-id source. Use a two-by-two grid: axial, coronal, sagittal, and a DICOM
metadata panel. Do not add 3D volume rendering or measurements. Add component
tests for viewport configuration and a documented browser acceptance path that moves the linked
position in each viewport.

$speckit-tasks
$speckit-analyze
```

- [ ] **Step 4: Implement and verify**

Enter:

```text
$speckit-implement

Implement only linked three-view MPR, orientation overlays, the metadata panel,
and existing image-tool integration. Stop when the complete acceptance path
passes.
```

Verify:

```text
Open a viewable CT series
→ axial, coronal, and sagittal images appear
→ move crosshair in axial
→ coronal and sagittal update
→ move position in coronal
→ axial and sagittal update
→ window/level, pan, zoom, and reset work
→ restart services
→ reopen the same three-view study
```

---

### Task 7: Final convergence against the approved design

**Files:**
- Review: `docs/superpowers/specs/2026-07-16-medical-ct-viewer-design.md`
- Review: `specs/001-patient-management/spec.md`
- Review: `specs/001-patient-management/plan.md`
- Review: `specs/001-patient-management/tasks.md`
- Review: `specs/002-dicom-import/spec.md`
- Review: `specs/002-dicom-import/plan.md`
- Review: `specs/002-dicom-import/tasks.md`
- Review: `specs/003-axial-viewer/spec.md`
- Review: `specs/003-axial-viewer/plan.md`
- Review: `specs/003-axial-viewer/tasks.md`
- Review: `specs/004-three-view-mpr/spec.md`
- Review: `specs/004-three-view-mpr/plan.md`
- Review: `specs/004-three-view-mpr/tasks.md`

- [ ] **Step 1: Ask Spec Kit to find remaining work**

Enter:

```text
$speckit-converge

Compare the implemented patient management, DICOM import, axial viewer, and
linked MPR features against the approved design document at
docs/superpowers/specs/2026-07-16-medical-ct-viewer-design.md.

Append only concrete missing work to the relevant tasks. Do not introduce
authentication, cloud storage, PACS, DICOMweb, measurements, reports, or 3D
rendering.
```

- [ ] **Step 2: Run the complete acceptance path**

Verify:

```text
Create patient
→ import real de-identified CT
→ inspect import report
→ open Study and Series
→ view axial slices
→ enter linked MPR
→ use image tools
→ restart frontend and backend
→ reopen the same data
→ delete the patient with confirmation
→ database and managed files are both removed
```

- [ ] **Step 3: Confirm the safety boundary**

Check every primary page for the exact visible meaning:

```text
教学演示软件，不用于临床诊断。
```

- [ ] **Step 4: Summarize generated and modified files**

Run:

```powershell
git status --short
git diff --stat
```

Expected: only project implementation, tests, Spec Kit artifacts, and planned documentation are present. Do not commit or push unless separately requested.
