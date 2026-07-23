[中文](README.md) | **English**

# Local CT Imaging Lab

> Educational demonstration software. Not for clinical diagnosis.

This is a single-user medical CT education project that runs entirely on the local machine. It demonstrates the complete data flow from patient record management, DICOM import, and local persistence to axial viewing and synchronized three-view MPR. It does not provide clinical diagnosis, treatment decisions, or public-network services.

## Background and Purpose

Medical imaging education needs to handle structured patient information, the DICOM file lifecycle, two-dimensional viewing tools, and spatial synchronization. This project uses a phased Spec Kit workflow to split patient management, DICOM import, axial viewing, and three-view MPR into independently specified, implemented, and accepted features.

The main purposes are:

- Demonstrate the complete local DICOM data flow from import and indexing to managed storage and browser display.
- Validate data consistency and safe-failure behavior between SQLite metadata and managed DICOM files.
- Provide an educational example of axial browsing and synchronized axial, coronal, and sagittal MPR views.
- Reduce the risk of mishandling patient data and image files within a local, single-user boundary through automated testing and phased acceptance.

## Completed Features

- **Patient management**: Create, view, search, edit, and delete with secondary confirmation; normalized unique medical record numbers; data remains available after service restarts.
- **DICOM import and persistence**: Import local CT DICOM files or directories, organize data by Study, Series, and Instance, report success, duplicate, skipped, unsupported, and failed files individually, and copy original DICOM files into local managed storage.
- **Axial viewing**: Display axial slices for `eligible` Series, with slice browsing, window width/level, pan, zoom, and reset.
- **Three-view MPR**: Display axial, coronal, and sagittal viewports with synchronized Crosshairs, shared window width/level, independent pan/zoom, crosshair visibility control, and full reset.
- **Safe-failure recovery**: Controlled rollback, isolation, retry, or safe messaging for database write failures, patient deletion cleanup failures, missing local DICOM files, temporary backend unavailability, and viewer build failures. On startup, the application retries cleanup of isolated patient-deletion remnants and interrupted import temporary directories.

## System Architecture and Data Flow

```text
Development: Browser -> Vite :5173 -> /api proxy -> FastAPI :8000
Production:  Browser -> FastAPI :8000 -> frontend/dist + /api
                                      -> SQLite + Managed DICOM
```

The frontend development server and backend API listen only on loopback addresses. Patient metadata, DICOM files, and pixel data remain on the local machine; the current implementation does not upload to external services, synchronize data, or send telemetry.

## Technology Stack

- Backend: Python 3.12, FastAPI, SQLAlchemy, Alembic, pydicom, SQLite, and pytest.
- Frontend: React 19, TypeScript, Vite, Vitest, Testing Library, and Cornerstone3D 5.6.8.
- Specifications and process: GitHub Spec Kit project structure and in-repository Superpowers design/implementation documents.

## Repository Structure

| Directory | Purpose |
| --- | --- |
| `backend/` | FastAPI APIs, SQLAlchemy models, Alembic migrations, DICOM parsing/import, managed storage, and backend tests. |
| `frontend/` | React pages, patient/DICOM/axial/MPR features, the Cornerstone3D runtime, and frontend tests. |
| `specs/` | `spec.md`, `tasks.md`, `quickstart.md`, and related design artifacts for four phased features. |
| `docs/` | Overall design, feature designs, code-review remediation, and implementation plans. |
| `.specify/` | Spec Kit constitution, templates, scripts, workflow, and current feature metadata. |
| `data/` | Default local runtime data directory containing SQLite, managed DICOM, and internal temporary/isolation directories; it must not be committed. |

## Requirements

- Windows 10/11 and PowerShell.
- Python 3.12.
- `uv`.
- Node.js 24.15.x and npm 11.12.x; the root `.node-version` and `frontend/package.json` define the version constraints.
- Chrome or Edge with WebGL support.

## Development Quick Start

Open PowerShell at the repository root. The backend and frontend require separate terminals.

### 1. Start the backend

```powershell
cd backend
uv sync --locked --group dev
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### 2. Start the frontend

Open another PowerShell terminal at the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173` in the browser.

## Production Single-Process Operation

Build the frontend first, then start the backend. FastAPI serves `frontend/dist` from `/` on the same origin, so only one backend process is required at runtime:

```powershell
cd frontend
npm ci
npm run build

cd ../backend
uv sync --locked --group dev
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000` in the browser. If `frontend/dist/index.html` has not been generated, FastAPI still starts in API-only mode; `/api`, `/docs`, and `/openapi.json` remain available.

## Local Data Directory

The default data root is `data/` under the repository root:

```text
data/
├── patient-management.sqlite3  # Patient, Study, Series, and Instance metadata
├── dicom/                      # Managed original files organized by patient and DICOM UID
├── .imports/                   # Internal temporary directory for one upload operation
└── .delete-staging/            # Internal isolation directory used during patient deletion
```

To use a separate local data directory, set the variable in the same backend terminal before running Alembic and starting the backend:

```powershell
$env:MEDICAL_CT_APP_DATA_DIR = Join-Path $env:TEMP 'local-ct-imaging-lab-data'
```

`.imports/` is used only for temporary storage during the current import operation. Each file is limited to 512 MiB, each batch to 2,000 files, and the total batch size to 8 GiB. It is cleaned after the operation, and remnants from interruptions are safely retried at the next application startup. When deleting a patient with images, the system first moves that patient's managed DICOM directory to `.delete-staging/` and then commits the database deletion, preventing accessible database records from pointing to deleted files. If cleanup after commit fails, the remaining files stay isolated and are retried individually at the next startup.

`.delete-staging/` is an internal directory exclusively owned by `ManagedStorage`: only the patient-deletion flow may create staging items there. Startup cleanup examines only direct child directories and rejects symbolic links, junctions, regular files, or paths outside the configured data root. Do not manually add or replace items in this directory or use it for other data. Failure to clean one item records a safe warning but does not prevent other items from being cleaned or the local service from starting.

Import only de-identified educational CT data, and do not enter real patient information. Stop the backend service before backing up, moving, or deleting `data/`.

## Basic Usage Flow

1. Create a fictional patient whose medical record number matches the DICOM `PatientID` of the de-identified CT data to import.
2. Select de-identified CT DICOM files or a directory under the current patient and start the import.
3. Review the per-file report and confirm successful, duplicate, skipped, unsupported, and failed items.
4. Open the axial viewer for an `eligible` Series from the study and series list.
5. Browse slices and use window width/level, pan, zoom, and reset tools.
6. Open three-view MPR for an eligible multi-slice Series and use synchronized positioning and viewing tools.

## Tests and Production Build

Backend:

```powershell
cd backend
uv run pytest -q -p no:cacheprovider
```

Frontend:

```powershell
cd frontend
npm test -- --run
npm run build
```

`npm run build` runs both TypeScript `tsc --noEmit` checks and the Vite production build.
`frontend/package.json` also uses `overrides` to pin patched transitive versions of `adm-zip` and `uuid`. CI runs `npm audit --audit-level=moderate` to prevent the lockfile from reintroducing known medium- or high-severity vulnerabilities.

## Documentation

| Feature | Specification | Tasks | Setup and Acceptance |
| --- | --- | --- | --- |
| 001 Patient Management | [spec](specs/001-patient-management/spec.md) | [tasks](specs/001-patient-management/tasks.md) | [quickstart](specs/001-patient-management/quickstart.md) |
| 002 DICOM Import | [spec](specs/002-dicom-import/spec.md) | [tasks](specs/002-dicom-import/tasks.md) | [quickstart](specs/002-dicom-import/quickstart.md) |
| 003 Axial Viewer | [spec](specs/003-axial-viewer/spec.md) | [tasks](specs/003-axial-viewer/tasks.md) | [quickstart](specs/003-axial-viewer/quickstart.md) |
| 004 Three-View MPR | [spec](specs/004-three-view-mpr/spec.md) | [tasks](specs/004-three-view-mpr/tasks.md) | [quickstart](specs/004-three-view-mpr/quickstart.md) |

- [Project constitution](.specify/memory/constitution.md)
- [Documentation status and navigation](docs/README.md)
- [Overall design](docs/superpowers/specs/2026-07-16-medical-ct-viewer-design.md)
- [Code-review remediation design](docs/superpowers/specs/2026-07-21-code-review-fixes-design.md)

## Current Limitations and Explicit Exclusions

The current version does not provide:

- PACS, Orthanc, DICOMweb, HIS, RIS, or integration with other external medical systems.
- Login, accounts, authentication, roles, permissions, or multi-user concurrency.
- Cloud services, remote access, external backup, cross-device synchronization, or telemetry.
- Length, angle, or area measurements; annotations, segmentation, or diagnostic reports.
- 3D volume rendering, surface reconstruction, MIP, or surgical planning.
- Clinical diagnosis, treatment decisions, medical-device registration, regulatory certification, or any other clinical use.
- Viewer-state persistence, bookmarks, recently viewed lists, or deep links.
- Background import queues, resumable uploads, cross-device import, or remote directory scanning.

## Known Non-Blocking Warnings

- Backend tests emit a FastAPI/Starlette `TestClient` and `httpx` compatibility `StarletteDeprecationWarning`.
- The Cornerstone codec emits a Node module externalization warning during production builds, and Vite reports a large output chunk.
- Stress scenarios that create multiple browser/rendering contexts may emit WebGL context-limit warnings; the accepted normal single-instance and cleanup flows remain usable.

These warnings are recorded but are outside the scope of the repository publication and storage-cleanup work.
