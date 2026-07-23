# DICOM Import and Persistence Implementation Plan

> **状态说明（2026-07-23）：** 本文件是历史实施计划，保留未勾选项用于过程追溯；当前需求与完成状态以对应 `specs/*/spec.md` 和 `specs/*/tasks.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local CT DICOM import, Study/Series/Instance persistence, five-category reporting, restart persistence, and patient-delete cleanup to the existing patient-management application.

**Architecture:** FastAPI receives multiple multipart files and streams them to a per-request temporary directory. Pure parsing produces metadata records, an import service groups them by Study UID and commits each Study independently, and a managed-storage service owns every filesystem mutation and compensation. React adds an import dialog, report, and Study/Series listing without initializing Cornerstone3D.

**Tech Stack:** Python 3.12, FastAPI, pydicom, python-multipart, SQLAlchemy 2, Alembic, SQLite, pytest, React 19, TypeScript, Vite, Vitest, React Testing Library.

---

### Task 1: Dependencies and isolated DICOM test fixtures

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/uv.lock`
- Create: `backend/tests/dicom_factory.py`
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: Add a failing fixture smoke test**

Create `backend/tests/unit/test_dicom_factory.py` with a test that writes a CT file and verifies `PatientID`, `Modality`, `StudyInstanceUID`, `SeriesInstanceUID`, `SOPInstanceUID`, `Rows`, and `Columns` through `pydicom.dcmread(..., defer_size=1024)` without accessing the pixel value.

- [ ] **Step 2: Verify dependency failure**

Run: `uv run pytest tests/unit/test_dicom_factory.py -v`

Expected: FAIL because `pydicom` and `tests.dicom_factory` are unavailable.

- [ ] **Step 3: Add minimal production dependencies**

Add only:

```toml
dependencies = [
    "alembic>=1.18.5",
    "fastapi>=0.139.2",
    "pydicom>=3,<4",
    "python-multipart>=0.0.20,<1",
    "sqlalchemy>=2,<3",
    "uvicorn>=0.51.0",
]
```

Run `uv lock` from `backend/`.

- [ ] **Step 4: Implement the fixture factory**

Expose this stable helper:

```python
def write_dicom_file(
    path: Path,
    *,
    patient_id: str = "MR-DICOM-001",
    modality: str = "CT",
    study_uid: str | None = None,
    series_uid: str | None = None,
    sop_uid: str | None = None,
    transfer_syntax_uid: str = ExplicitVRLittleEndian,
    include_pixel_data: bool = True,
    include_geometry: bool = True,
) -> DicomFixture:
    ...
```

Use `FileDataset`, generated UIDs, 2 × 2 unsigned 16-bit pixels, de-identified text, and deterministic geometry suitable for import tests.

- [ ] **Step 5: Run the fixture test**

Run: `uv run pytest tests/unit/test_dicom_factory.py -v`

Expected: PASS.

### Task 2: Study, Series, Instance schema and migration

**Files:**
- Create: `backend/app/models/study.py`
- Create: `backend/app/models/series.py`
- Create: `backend/app/models/instance.py`
- Modify: `backend/app/models/patient.py`
- Modify: `backend/app/db/base.py`
- Modify: `backend/app/db/session.py`
- Create: `backend/alembic/versions/002_create_dicom_index.py`
- Modify: `backend/tests/migration/test_alembic_upgrade.py`

- [ ] **Step 1: Write failing migration/model tests**

Assert that an empty database upgraded to head contains `studies`, `series`, and `instances`; unique indexes exist for all three DICOM UIDs; foreign keys cascade; no pixel BLOB column exists; and SQLite foreign keys are enabled.

- [ ] **Step 2: Run migration tests and confirm failure**

Run: `uv run pytest tests/migration/test_alembic_upgrade.py -v`

Expected: FAIL because revision 002 and mapped models do not exist.

- [ ] **Step 3: Implement focused ORM models**

Use these relationships and public invariants:

```python
class Study(Base):
    id: Mapped[UUID]
    patient_id: Mapped[UUID]
    study_instance_uid: Mapped[str]
    dicom_patient_id: Mapped[str]
    study_date: Mapped[date | None]
    study_time: Mapped[time | None]
    accession_number: Mapped[str | None]
    description: Mapped[str | None]
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

class Series(Base):
    id: Mapped[UUID]
    study_id: Mapped[UUID]
    series_instance_uid: Mapped[str]
    modality: Mapped[str]
    series_number: Mapped[int | None]
    description: Mapped[str | None]
    body_part_examined: Mapped[str | None]
    rows: Mapped[int | None]
    columns: Mapped[int | None]
    viewability_status: Mapped[str]
    viewability_reason: Mapped[str | None]

class Instance(Base):
    id: Mapped[UUID]
    series_id: Mapped[UUID]
    sop_instance_uid: Mapped[str]
    sop_class_uid: Mapped[str]
    transfer_syntax_uid: Mapped[str]
    instance_number: Mapped[int | None]
    image_position_patient: Mapped[str | None]
    image_orientation_patient: Mapped[str | None]
    rows: Mapped[int | None]
    columns: Mapped[int | None]
    managed_path: Mapped[str]
    file_size: Mapped[int]
    created_at: Mapped[datetime]
```

Add `Patient.studies` with `cascade="all, delete-orphan"` and database `ON DELETE CASCADE`.

- [ ] **Step 4: Enable SQLite foreign keys**

Register a SQLAlchemy connect event in `create_database`:

```python
@event.listens_for(engine, "connect")
def enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()
```

- [ ] **Step 5: Create revision 002**

Create tables in parent-to-child order, add named unique indexes, stable list indexes, viewability check constraint, and cascade foreign keys. Downgrade in reverse order.

- [ ] **Step 6: Run migration tests**

Run: `uv run pytest tests/migration/test_alembic_upgrade.py -v`

Expected: PASS.

### Task 3: Pure DICOM metadata parser

**Files:**
- Create: `backend/app/services/dicom_parser.py`
- Create: `backend/tests/unit/test_dicom_parser.py`

- [ ] **Step 1: Write parser behavior tests**

Cover valid CT, non-DICOM, damaged DICOM, non-CT, missing PatientID, missing required UIDs, unsupported transfer syntax, missing geometry, numeric parsing, and no pixel decoding.

- [ ] **Step 2: Run tests and confirm failure**

Run: `uv run pytest tests/unit/test_dicom_parser.py -v`

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement parser result types**

```python
class ParseCategory(StrEnum):
    CANDIDATE = "candidate"
    SKIPPED = "skipped"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"

@dataclass(frozen=True, slots=True)
class ParsedDicom:
    source_path: Path
    display_name: str
    category: ParseCategory
    code: str
    message: str
    patient_id: str | None = None
    study_instance_uid: str | None = None
    series_instance_uid: str | None = None
    sop_instance_uid: str | None = None
    metadata: DicomMetadata | None = None
```

Use `dcmread(path, defer_size=1024, force=False)`, never access or decode the PixelData value, apply strict UID validation and safe optional tag conversion, and use an explicit baseline transfer-syntax allowlist.

- [ ] **Step 4: Run parser tests**

Run: `uv run pytest tests/unit/test_dicom_parser.py -v`

Expected: PASS.

### Task 4: Managed storage service

**Files:**
- Modify: `backend/app/core/config.py`
- Create: `backend/app/services/managed_storage.py`
- Create: `backend/tests/unit/test_managed_storage.py`

- [ ] **Step 1: Write failing storage tests**

Test data-root derivation, temporary import cleanup, UID path validation, containment checks, duplicate target refusal, atomic move, cleanup of only files created by the current operation, and patient-directory staging/restoration.

- [ ] **Step 2: Run tests and confirm failure**

Run: `uv run pytest tests/unit/test_managed_storage.py -v`

Expected: FAIL because managed storage is absent.

- [ ] **Step 3: Extend settings**

Expose `imports_dir`, `dicom_dir`, and `delete_staging_dir` derived from `data_dir`; never accept these paths from request data.

- [ ] **Step 4: Implement storage API**

```python
class ManagedStorage:
    def create_import_session(self) -> ImportSession: ...
    def target_path(self, patient_id: UUID, metadata: DicomMetadata) -> Path: ...
    def store_new(self, source: Path, target: Path) -> StoredFile: ...
    def cleanup_created(self, files: Sequence[StoredFile]) -> None: ...
    def stage_patient_delete(self, patient_id: UUID) -> StagedPatientDirectory: ...
    def restore_patient_delete(self, staged: StagedPatientDirectory) -> None: ...
    def purge_patient_delete(self, staged: StagedPatientDirectory) -> None: ...
```

Every public path operation must call `resolve()` and `relative_to(expected_root)` before mutation.

- [ ] **Step 5: Run storage tests**

Run: `uv run pytest tests/unit/test_managed_storage.py -v`

Expected: PASS.

### Task 5: Study-group import service and five-category report

**Files:**
- Create: `backend/app/schemas/dicom_import.py`
- Create: `backend/app/services/dicom_import.py`
- Create: `backend/tests/integration/test_dicom_import_service.py`

- [ ] **Step 1: Write failing integration tests**

Cover one valid CT Study, multiple Series, duplicates, patient mismatch blocking one Study, mixed valid/damaged/non-CT files, unsupported files persisted as unviewable, target path collision, commit failure rollback, and restart persistence.

- [ ] **Step 2: Run tests and confirm failure**

Run: `uv run pytest tests/integration/test_dicom_import_service.py -v`

Expected: FAIL because the service and report schema do not exist.

- [ ] **Step 3: Implement report schemas**

```python
class ImportCategory(StrEnum):
    SUCCESS = "success"
    DUPLICATE = "duplicate"
    SKIPPED = "skipped"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"

class ImportItem(BaseModel):
    file_name: str
    category: ImportCategory
    code: str
    message: str
    study_instance_uid: str | None = None
    series_instance_uid: str | None = None
    sop_instance_uid: str | None = None

class ImportReport(BaseModel):
    total: int
    success: int
    duplicate: int
    skipped: int
    unsupported: int
    failed: int
    items: list[ImportItem]
```

Validate that category counts sum to `total`.

- [ ] **Step 4: Implement per-Study import orchestration**

The service must accept a Patient, parsed files, Session, and ManagedStorage; pre-classify file errors; group candidates; compare normalized PatientID; detect existing Study ownership and SOP duplicates; store files; flush records; commit; and clean only current-operation files on rollback.

- [ ] **Step 5: Run integration tests**

Run: `uv run pytest tests/integration/test_dicom_import_service.py -v`

Expected: PASS.

### Task 6: Multipart API and OpenAPI contract

**Files:**
- Create: `backend/app/api/dicom_import.py`
- Modify: `backend/app/api/__init__.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/core/errors.py`
- Modify: `specs/002-dicom-import/contracts/openapi.yaml`
- Create: `backend/tests/integration/test_dicom_import_api.py`
- Modify: `backend/tests/contract/test_openapi_contract.py`

- [ ] **Step 1: Write failing API and contract tests**

Test multipart import, multiple files, no files, invalid/unknown Patient UUID, mixed report, stable errors, no absolute path leakage, and runtime OpenAPI equivalence.

- [ ] **Step 2: Run tests and confirm failure**

Run: `uv run pytest tests/integration/test_dicom_import_api.py tests/contract/test_openapi_contract.py -v`

Expected: FAIL because the endpoint and design contract are absent.

- [ ] **Step 3: Implement streaming upload endpoint**

```python
@router.post(
    "/patients/{patient_id}/dicom-import",
    response_model=ImportReport,
    operation_id="importPatientDicom",
)
async def import_patient_dicom(
    request: Request,
    patient_id: UUID,
    files: Annotated[list[UploadFile], File(...)],
    session: Session = Depends(request_session),
) -> ImportReport:
    ...
```

Copy each `UploadFile` to the import session in fixed-size async chunks, close uploads, invoke the synchronous parsing/import service with `run_in_threadpool`, and clean the temporary session in `finally`.

- [ ] **Step 4: Extend stable error and OpenAPI enums**

Add only public codes/fields required by the new endpoint, keep `security: []`, and retain the loopback server.

- [ ] **Step 5: Run API and contract tests**

Run: `uv run pytest tests/integration/test_dicom_import_api.py tests/contract/test_openapi_contract.py -v`

Expected: PASS.

### Task 7: Study/Series queries and Patient summaries

**Files:**
- Create: `backend/app/api/studies.py`
- Create: `backend/app/services/study_service.py`
- Modify: `backend/app/schemas/dicom_import.py`
- Modify: `backend/app/api/__init__.py`
- Modify: `backend/app/schemas/patient.py`
- Modify: `backend/app/services/patient_service.py`
- Create: `backend/tests/integration/test_study_api.py`
- Modify: `backend/tests/integration/test_patient_api.py`

- [ ] **Step 1: Write failing query and summary tests**

Test empty Study lists, deterministic Study/Series/Instance ordering, counts, viewability reasons, 404/422/500 responses, and Patient `study_count`/`latest_study_date` before and after import.

- [ ] **Step 2: Run tests and confirm failure**

Run: `uv run pytest tests/integration/test_study_api.py tests/integration/test_patient_api.py -v`

Expected: FAIL because query endpoints and dynamic summaries do not exist.

- [ ] **Step 3: Implement query schemas and service**

Expose `StudyRead`, `SeriesRead`, `SeriesDetailRead`, and `InstanceRead` without managed absolute paths. Order Study by `study_date DESC NULLS LAST`, then `created_at DESC`, then UID; order Series by number then UID; order Instance by spatial position, instance number, then SOP UID.

- [ ] **Step 4: Derive Patient summary values**

Change `PatientRead.study_count` to `int` and `latest_study_date` to `date | None`. Construct them from aggregate queries in Patient service while preserving zero/null for patients without Studies.

- [ ] **Step 5: Run query and Patient tests**

Run: `uv run pytest tests/integration/test_study_api.py tests/integration/test_patient_api.py -v`

Expected: PASS.

### Task 8: Patient deletion with DICOM cleanup and compensation

**Files:**
- Modify: `backend/app/services/patient_service.py`
- Modify: `backend/app/api/patients.py`
- Create: `backend/tests/integration/test_patient_dicom_delete.py`
- Modify: `backend/tests/integration/test_patient_delete.py`

- [ ] **Step 1: Write failing deletion consistency tests**

Test successful cascade cleanup, no-directory deletion, staging failure, database commit failure with directory restoration, purge failure with database/index restoration, and restart after successful deletion.

- [ ] **Step 2: Run tests and confirm failure**

Run: `uv run pytest tests/integration/test_patient_dicom_delete.py tests/integration/test_patient_delete.py -v`

Expected: FAIL because delete does not coordinate managed storage.

- [ ] **Step 3: Add delete snapshot and compensation helpers**

Capture plain Study/Series/Instance row values before deletion. Stage the patient directory, delete and commit, then purge. On commit failure restore the staged directory. On purge failure restore row snapshots in a new transaction and restore the directory before raising `PersistenceError`.

- [ ] **Step 4: Inject ManagedStorage through application state**

Extend `create_app` with an optional storage dependency so tests can inject deterministic failure doubles without global monkeypatching.

- [ ] **Step 5: Run deletion tests**

Run: `uv run pytest tests/integration/test_patient_dicom_delete.py tests/integration/test_patient_delete.py -v`

Expected: PASS.

### Task 9: Frontend DICOM types, API, and Study state

**Files:**
- Modify: `frontend/src/features/patients/model/patient.ts`
- Create: `frontend/src/features/dicom-import/model/dicomImport.ts`
- Create: `frontend/src/features/dicom-import/api/dicomImportApi.ts`
- Create: `frontend/src/features/dicom-import/api/dicomImportApi.test.ts`
- Create: `frontend/src/features/dicom-import/hooks/usePatientStudies.ts`
- Create: `frontend/src/features/dicom-import/hooks/usePatientStudies.test.tsx`

- [ ] **Step 1: Write failing API/state tests**

Test multipart FormData construction, error mapping, Study/Series requests, request cancellation, import success refresh, and stale result suppression.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- --run src/features/dicom-import/api/dicomImportApi.test.ts src/features/dicom-import/hooks/usePatientStudies.test.tsx`

Expected: FAIL because feature modules do not exist.

- [ ] **Step 3: Implement exact public types**

Mirror backend field names and five categories. Change Patient summary fields to:

```typescript
study_count: number
latest_study_date: string | null
```

- [ ] **Step 4: Implement API and hook**

`importDicom(patientId, files)` must append every File under `files` without setting `Content-Type`; the browser supplies the multipart boundary. The hook must clear state when Patient changes and refresh Studies only after a completed import.

- [ ] **Step 5: Run frontend API/state tests**

Run: `npm test -- --run src/features/dicom-import/api/dicomImportApi.test.ts src/features/dicom-import/hooks/usePatientStudies.test.tsx`

Expected: PASS.

### Task 10: Import dialog, report, Study list, and page integration

**Files:**
- Create: `frontend/src/features/dicom-import/components/DicomImportDialog.tsx`
- Create: `frontend/src/features/dicom-import/components/ImportReport.tsx`
- Create: `frontend/src/features/dicom-import/components/StudyList.tsx`
- Create: `frontend/src/features/dicom-import/components/DicomImportDialog.test.tsx`
- Create: `frontend/src/features/dicom-import/components/ImportReport.test.tsx`
- Create: `frontend/src/features/dicom-import/components/StudyList.test.tsx`
- Modify: `frontend/src/features/patients/components/PatientDetails.tsx`
- Modify: `frontend/src/features/patients/pages/PatientManagementPage.tsx`
- Modify: `frontend/src/styles/patients.css`

- [ ] **Step 1: Write failing component/page tests**

Cover file and folder selectors, no-file validation, full disclaimer, initial/final focus, importing disabled state, report counts/details, Study loading/empty/error/list states, import refresh, and patient deletion refresh.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- --run src/features/dicom-import frontend/src/features/patients/pages`

Expected: FAIL because UI components are absent.

- [ ] **Step 3: Implement accessible import UI**

Use the existing `ModalDialog`. Keep two inputs: a standard multiple-file input and a directory input using a typed `webkitdirectory` attribute. Do not persist browser file objects after success/cancel. Keep the dialog and selected files after server failure.

- [ ] **Step 4: Integrate Studies below Patient details**

Show “导入 DICOM” only with a selected Patient. Keep Patient details visible during import and failures. After success, refresh Patient list/detail and Study list so counts and latest date update from server values.

- [ ] **Step 5: Run component/page tests**

Run: `npm test -- --run src/features/dicom-import src/features/patients/pages`

Expected: PASS.

### Task 11: Complete regression, documentation, and browser acceptance

**Files:**
- Modify: `specs/002-dicom-import/quickstart.md`
- Modify: `specs/002-dicom-import/tasks.md`
- Review: `specs/001-patient-management/quickstart.md`

- [ ] **Step 1: Run full backend tests**

Run: `uv run pytest`

Expected: all tests pass; any deprecation warning is recorded separately from functional failures.

- [ ] **Step 2: Run full frontend tests and build**

Run: `npm test -- --run`

Run: `npm run build`

Expected: all tests and TypeScript/Vite production build pass.

- [ ] **Step 3: Execute real-browser acceptance**

Use a fresh temporary data directory and a de-identified CT fixture. Verify:

```text
create/select patient
→ import valid CT Study
→ inspect report and Study/Series counts
→ reimport and receive duplicates
→ mixed valid/damaged/non-CT import preserves valid data
→ restart services and reload Studies
→ delete patient with confirmation
→ verify database rows and managed patient directory are both absent
```

- [ ] **Step 4: Record evidence and close tasks**

Write exact test counts, database path, browser steps, screenshot/log paths, loopback network check, five-category totals, restart result, and deletion cleanup result into `quickstart.md`. Mark a task complete only after its corresponding verification passes.

## Self-review result

- Every design requirement maps to at least one task.
- Parser, storage, import orchestration, query services, deletion compensation, API, and UI have separate files and tests.
- The plan contains no viewer, Cornerstone3D initialization, MPR, PACS, cloud, authentication, measurements, reports, or 3D rendering.
- No git commit, push, or upload step is included.
