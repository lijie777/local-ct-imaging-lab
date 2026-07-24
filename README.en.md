[中文](README.md) | **English**

# Local CT Imaging Lab

> Educational demonstration software. Not for clinical diagnosis.

This is a single-user medical CT education project that runs entirely on the local machine. It demonstrates the complete data flow from patient record management, DICOM import and local persistence to background resumable upload, axial viewing, synchronized three-view MPR, measurements, annotations, viewer-state recovery, and advanced 3D visualization. It does not provide clinical diagnosis, treatment decisions, or public-network services.

## Background and Purpose

Medical imaging education needs to handle structured patient information, the DICOM file lifecycle, two-dimensional viewing tools, spatial synchronization, safe non-clinical measurements, recoverable viewing context, and local 3D visualization. This project uses a phased Spec Kit workflow to split patient management, DICOM import, axial viewing, three-view MPR, measurement/annotation, viewer-state persistence, background resumable import, and advanced 3D visualization into independently specified, implemented, and accepted features.

The main purposes are:

- Demonstrate the complete local DICOM data flow from import and indexing to managed storage and browser display.
- Validate data consistency and safe-failure behavior between SQLite metadata and managed DICOM files.
- Provide educational examples of axial browsing, synchronized axial/coronal/sagittal MPR, volume rendering, MIP, and true surface reconstruction.
- Reduce the risk of mishandling patient data and image files within a local, single-user boundary through automated testing and phased acceptance.

## Completed Features

| Feature | Details |
| --- | --- |
| **Patient management** | Create patient records, view details, search, edit, and delete with secondary confirmation. Medical record numbers remain unique after normalization, validation and duplicate errors are reported clearly, and records are stored in local SQLite so they remain available after service restarts. |
| **DICOM import and persistence** | Import local CT DICOM files or directories, build Study, Series, and Instance indexes, and report success, duplicate, skipped, unsupported, and failed files individually. Original files are copied into local managed storage, and deleting a Patient also processes the related indexes and managed images. |
| **Axial viewing** | Display slices from an `eligible` Series in the correct instance order, with wheel browsing, window width/level, pan, zoom, and one-step reset. Missing files, unsupported formats, and temporary service failures produce safe errors without exposing absolute local paths. |
| **Three-view MPR** | Display axial, coronal, and sagittal viewports from the same CT volume. It provides spatially synchronized Crosshairs, shared window width/level, independent pan and zoom for each viewport, crosshair visibility control, and full reset. |
| **Measurements and annotations** | Axial and all three MPR viewports support length, angle, rectangular ROI, arrow text, single-item deletion, and confirmed clearing. Geometry tools are disabled automatically without reliable Pixel Spacing, and clearing annotations never removes Crosshairs. |
| **Viewer-state persistence** | Store per-Series slice positions, active tools, window width/level, cameras, Crosshairs, and the four allowed annotation types in SQLite. Writes are coalesced over 500 ms, and state can be restored after reload, viewer exit, or backend restart. Corrupt, oversized, incompatible, or missing-image state degrades safely; failed saves can be retried, and reset deletes the saved state. |
| **Background import and resumable upload** | Persist the import job and ordered manifest first, then upload sequential 4 MiB chunks from the server-confirmed offset. A single-process worker continues after the dialog closes, while jobs, staged content, and five-category reports survive reloads and service restarts. Active jobs block deletion of the associated Patient. Resumption currently requires reselecting the same files on the same machine; cross-device resumption and parallel workers are not supported. |
| **3D volume rendering** | Enter from a spatially eligible CT axial page and reuse one local volume load. Bone, soft-tissue, and lung presets are available together with rotate, zoom, and pan interaction. All computation and display remain in the local browser, with the non-clinical notice continuously visible. |
| **MIP** | Maximum intensity projection supports six standard viewing directions: front, back, left, right, superior, and inferior. Projection thickness is adjustable in millimeters, and returning from MIP restores the previously selected volume-rendering preset. |
| **Surface reconstruction** | Generate a true surface mesh from the actual CT volume and HU threshold. Volumes above 4,000,000 sample points are downsampled automatically while preserving physical size, extent, and direction. If surface processing fails, volume rendering and MIP remain available without downloading the Series again. |
| **Reliable backend startup** | FastAPI automatically upgrades the current SQLite database to the Alembic head before residual cleanup and background-worker startup. This prevents missing tables in older databases from causing startup warnings, repeated task retries, or unavailable background import. |
| **Single-process delivery** | The frontend production build is written to `frontend/dist`, which FastAPI serves together with `/api`. A delivered installation therefore needs only one backend process and exposes the complete application through one local address. |
| **Safe-failure recovery** | Database write failures, Patient deletion cleanup failures, missing local DICOM files, interrupted imports, temporary backend outages, and viewer construction failures receive controlled rollback, isolation, retry, or safe messaging. Startup retries cleanup of isolated Patient-deletion remnants and interrupted-import temporary directories. |

## System Architecture and Data Flow

```text
Development: Browser -> Vite :5173 -> /api proxy -> FastAPI :8000
Production:  Browser -> FastAPI :8000 -> frontend/dist + /api
                                      -> SQLite + Managed DICOM
```

The frontend development server and backend API listen only on loopback addresses. Patient metadata, DICOM files, and pixel data remain on the local machine; the current implementation does not upload to external services, synchronize data, or send telemetry.

## Technology Stack

- Backend: Python 3.12, FastAPI, SQLAlchemy, Alembic, pydicom, SQLite, and pytest.
- Frontend: React 19, TypeScript, Vite, Vitest, Testing Library, Cornerstone3D 5.6.8, and vtk.js 36.4.1.
- Specifications and process: GitHub Spec Kit project structure and in-repository Superpowers design/implementation documents.

## Repository Structure

| Directory | Purpose |
| --- | --- |
| `backend/` | FastAPI APIs, SQLAlchemy models, Alembic migrations, DICOM parsing/import, managed storage, and backend tests. |
| `frontend/` | React pages; patient/DICOM/axial/MPR/viewer-state/advanced-3D features; Cornerstone3D and vtk.js runtimes; and frontend tests. |
| `specs/` | `spec.md`, `plan.md`, `tasks.md`, `quickstart.md`, and related design artifacts for eight implemented features. |
| `docs/` | Overall design, feature designs, code-review remediation, and implementation plans. |
| `.specify/` | Spec Kit constitution, templates, scripts, workflow, and current feature metadata. |
| `data/` | Default local runtime data directory containing SQLite, managed DICOM, and internal temporary/isolation directories; it must not be committed. |

## Requirements

- Windows 10/11 and PowerShell.
- Python 3.12.
- `uv`.
- Node.js 24.15.x and npm 11.12.x; the root `.node-version` and `frontend/package.json` define the version constraints.
- A modern Chrome or Edge browser with WebGL support; advanced 3D processing uses local browser CPU/GPU and memory.

## Development Quick Start

Open PowerShell at the repository root. The backend and frontend require separate terminals.

### 1. Start the backend

```powershell
cd backend
uv sync --locked --group dev
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Backend startup first upgrades the current SQLite database to the Alembic head, then runs residual cleanup and starts the background import worker. A separate migration command is not required. To inspect the current revision, run `uv run alembic current` from `backend/`.

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
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000` in the browser. If `frontend/dist/index.html` has not been generated, FastAPI still starts in API-only mode; `/api`, `/docs`, and `/openapi.json` remain available.

## Local Data Directory

The default data root is `data/` under the repository root:

```text
data/
├── patient-management.sqlite3  # Patient, Study, Series, Instance, and viewer state
├── dicom/                      # Managed original files organized by patient and DICOM UID
├── .imports/                   # Internal temporary directory for synchronous imports
├── .import-jobs/               # Resumable staging for background import jobs
└── .delete-staging/            # Internal isolation directory used during patient deletion
```

To use a separate local data directory, set the variable in the same backend terminal before starting the backend:

```powershell
$env:MEDICAL_CT_APP_DATA_DIR = Join-Path $env:TEMP 'local-ct-imaging-lab-data'
```

`.imports/` is used only for the existing synchronous import flow. `.import-jobs/` stores durable chunks for background jobs; each file is limited to 512 MiB, each batch to 2,000 files, and the total batch size to 8 GiB. Staging is cleaned after completion, failure, or discard, and interruption remnants are safely retried at the next application startup. When deleting a patient with images, the system first moves that patient's managed DICOM directory to `.delete-staging/` and then commits the database deletion, preventing accessible database records from pointing to deleted files. If cleanup after commit fails, the remaining files stay isolated and are retried individually at the next startup.

`.delete-staging/` is an internal directory exclusively owned by `ManagedStorage`: only the patient-deletion flow may create staging items there. Startup cleanup examines only direct child directories and rejects symbolic links, junctions, regular files, or paths outside the configured data root. Do not manually add or replace items in this directory or use it for other data. Failure to clean one item records a safe warning but does not prevent other items from being cleaned or the local service from starting.

Import only de-identified educational CT data, and do not enter real patient information. Stop the backend service before backing up, moving, or deleting `data/`.

## Basic Usage Flow

1. Create a fictional patient whose medical record number matches the DICOM `PatientID` of the de-identified CT data to import.
2. Select de-identified CT DICOM files or a directory under the current patient and start the background import; after a refresh or dialog close, select the same files again to resume from the confirmed offset.
3. Wait for the background job to finish, then review the per-file report and confirm successful, duplicate, skipped, unsupported, and failed items.
4. Open the axial viewer for an `eligible` Series from the study and series list.
5. Browse slices and use window width/level, pan, zoom, measurement, arrow annotation, and reset tools.
6. Open three-view MPR for an eligible multi-slice Series and use synchronized positioning, viewing, measurement, and annotation tools.
7. Leave, reload, or restart the local service and reopen the same Series to verify recovery of axial/MPR state, Crosshairs, and all four annotation types.
8. Use reset to restore defaults and delete saved state for that Series; use the confirmed “Clear all” action when only annotations should be removed.

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
| 005 Measurement and Annotation | [spec](specs/005-measurement-annotation/spec.md) | [tasks](specs/005-measurement-annotation/tasks.md) | [quickstart](specs/005-measurement-annotation/quickstart.md) |
| 006 Viewer-State Persistence | [spec](specs/006-viewer-state-persistence/spec.md) | [tasks](specs/006-viewer-state-persistence/tasks.md) | [quickstart](specs/006-viewer-state-persistence/quickstart.md) |
| 007 Background Import and Resume | [spec](specs/007-background-import-resume/spec.md) | [tasks](specs/007-background-import-resume/tasks.md) | [quickstart](specs/007-background-import-resume/quickstart.md) |
| 008 Advanced 3D Visualization | [spec](specs/008-advanced-3d-visualization/spec.md) | [tasks](specs/008-advanced-3d-visualization/tasks.md) | [quickstart](specs/008-advanced-3d-visualization/quickstart.md) |

- [Project constitution](.specify/memory/constitution.md)
- [Documentation status and navigation](docs/README.md)
- [Overall design](docs/superpowers/specs/2026-07-16-medical-ct-viewer-design.md)
- [Code-review remediation design](docs/superpowers/specs/2026-07-21-code-review-fixes-design.md)
- [Measurement and annotation design](docs/superpowers/specs/2026-07-23-measurement-annotation-design.md)
- [Viewer-state persistence design](docs/superpowers/specs/2026-07-23-viewer-state-persistence-design.md)
- [Advanced 3D visualization design](docs/superpowers/specs/2026-07-23-advanced-3d-visualization-design.md)

## Current Limitations and Explicit Exclusions

The current version does not provide:

- PACS, Orthanc, DICOMweb, HIS, RIS, or integration with other external medical systems.
- Login, accounts, authentication, roles, permissions, or multi-user concurrency.
- Cloud services, remote access, external backup, cross-device synchronization, or telemetry.
- Segmentation, automated lesion detection, diagnostic reports, or diagnostic recommendations.
- Surgical planning, 3D measurements, mesh export, surface editing, or cross-Series registration.
- Clinical diagnosis, treatment decisions, medical-device registration, regulatory certification, or any other clinical use.
- Bookmarks, recently viewed lists, deep links, screenshots, reports, or cross-device viewer-state synchronization.
- Cross-device import, remote directory scanning, parallel workers, or cross-device resumable uploads.

## Known Non-Blocking Warnings

- Backend tests emit a FastAPI/Starlette `TestClient` and `httpx` compatibility `StarletteDeprecationWarning`.
- The Cornerstone codec emits a Node module externalization warning during production builds, and Vite reports a large output chunk.
- Stress scenarios that create multiple browser/rendering contexts may emit WebGL context-limit warnings; the accepted normal single-instance and cleanup flows remain usable.

These warnings are recorded but are outside the scope of the repository publication and storage-cleanup work.
