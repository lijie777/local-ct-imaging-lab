# Viewer State Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and safely restore per-Series axial, MPR, Crosshairs, and four allowlisted
annotation types across viewer exits, reloads, and local service restarts.

**Architecture:** A versioned SQLite row and local FastAPI GET/PUT/DELETE API are the canonical
state source. A frontend `viewer-state` feature validates JSON, converts Cornerstone public view
presentation/VOI and annotations to safe DTOs, and coalesces writes; axial/MPR runtimes only expose
capture/apply hooks.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, SQLAlchemy 2, Alembic, React 19, TypeScript 5.9,
Cornerstone3D 5.6.8, pytest, Vitest, React Testing Library.

---

### Task 1: Database model and migration

**Files:**
- Create: `backend/app/models/viewer_state.py`
- Create: `backend/alembic/versions/003_create_viewer_states.py`
- Modify: `backend/app/db/base.py`
- Modify: `backend/app/models/series.py`
- Test: `backend/tests/migration/test_alembic_upgrade.py`

- [ ] **Step 1: Write failing migration assertions**

Extend the migration test to assert `viewer_states` has `series_id`, `schema_version`, `payload`,
`created_at`, `updated_at`, a primary key on `series_id`, a cascade FK to `series.id`, version and
timestamp checks, then run:

```powershell
uv run python -m pytest tests/migration/test_alembic_upgrade.py -q -p no:cacheprovider
```

Expected: fail because revision `003_create_viewer_states` and the table do not exist.

- [ ] **Step 2: Add the one-to-one model and revision**

Use this public model shape and a matching Alembic revision:

```python
class ViewerState(Base):
    __tablename__ = "viewer_states"
    series_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("series.id", ondelete="CASCADE"), primary_key=True
    )
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
```

Add `Series.viewer_state` with `cascade="all, delete-orphan"`, `single_parent=True`, and
`passive_deletes=True`; import the model in `db/base.py`.

- [ ] **Step 3: Verify migration and metadata**

Run the migration test and the backend tests that create/drop `Base.metadata`. Expected: pass.

### Task 2: Strict backend schemas, service, and API

**Files:**
- Create: `backend/app/schemas/viewer_state.py`
- Create: `backend/app/services/viewer_state_service.py`
- Create: `backend/app/api/viewer_states.py`
- Modify: `backend/app/api/__init__.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/integration/test_viewer_state_api.py`
- Test: `backend/tests/contract/test_openapi_contract.py`

- [ ] **Step 1: Write failing API and validation tests**

Cover `GET -> null`, PUT create/update/idempotence, restart persistence, DELETE idempotence,
Patient cascade deletion, unknown Series 404, unknown key/version/tool, wrong point count,
non-finite number, invalid VOI/text, 501st annotation, payload over 2 MiB, and safe 500 mapping.

```powershell
uv run python -m pytest tests/integration/test_viewer_state_api.py tests/contract/test_openapi_contract.py -q -p no:cacheprovider
```

Expected: fail because the router and schemas do not exist.

- [ ] **Step 2: Implement strict Pydantic DTOs**

Every model uses `ConfigDict(extra="forbid", allow_inf_nan=False)`. Define the wire contract:

```python
class ViewerStateWrite(BaseModel):
    schema_version: Literal[1]
    state: ViewerStatePayload

class ViewerStatePayload(BaseModel):
    axial: AxialState | None = None
    mpr: MprState | None = None
    annotations: list[PersistedAnnotation] = Field(default_factory=list, max_length=500)
```

Use fixed tuples for Point2/Point3, enums/literals for tools and viewports, a model validator for
`voi.lower < voi.upper`, and per-tool point/label rules. Arrow text reuses the Feature 005 semantic
limits. Do not accept aliases or arbitrary metadata.

- [ ] **Step 3: Implement service transactions and size check**

`get_viewer_state`, `put_viewer_state`, and `delete_viewer_state` first verify Series existence.
Serialize `state.model_dump(mode="json")` using compact JSON with `allow_nan=False`; reject more
than `2 * 1024 * 1024` UTF-8 bytes before mutating the session. PUT updates one row and timestamp;
commit errors rollback and map to existing safe persistence errors.

- [ ] **Step 4: Add GET/PUT/DELETE router and OpenAPI contract**

Mount `/series/{series_id}/viewer-state`, return `200 null`, `200 ViewerStateRead`, and `204` as
specified. Extend the existing contract schema with stable 404/422/500 responses and operation IDs.

- [ ] **Step 5: Run focused backend tests**

Expected: all new integration, migration, and contract tests pass.

### Task 3: Frontend state model and API client

**Files:**
- Create: `frontend/src/features/viewer-state/model/viewerState.ts`
- Create: `frontend/src/features/viewer-state/model/viewerState.test.ts`
- Create: `frontend/src/features/viewer-state/api/viewerStateApi.ts`
- Create: `frontend/src/features/viewer-state/api/viewerStateApi.test.ts`

- [ ] **Step 1: Write failing codec and API tests**

Test a valid v1 response, every unknown/invalid/NaN/Infinity/tool/point/text/count boundary,
`200 null`, safe 404/422/500 messages, DELETE 204, and request body identity.

```powershell
npm test -- --run src/features/viewer-state/model/viewerState.test.ts src/features/viewer-state/api/viewerStateApi.test.ts
```

Expected: fail because the feature files do not exist.

- [ ] **Step 2: Implement mirrored DTOs and a defensive parser**

Export these stable roots:

```ts
export const VIEWER_STATE_SCHEMA_VERSION = 1 as const
export interface ViewerStatePayload {
  axial: AxialViewerState | null
  mpr: MprViewerState | null
  annotations: PersistedViewerAnnotation[]
}
export function parseViewerStateRead(value: unknown): ViewerStateRead | null
```

The parser builds fresh plain objects, checks own keys exactly, rejects non-finite numbers and
unsafe arrays, and never casts unchecked JSON into runtime state.

- [ ] **Step 3: Implement the local API client**

Expose `getViewerState(seriesId)`, `putViewerState(seriesId, state, options?)`, and
`deleteViewerState(seriesId)`. Use existing `fetch`/safe-error style; `options.keepalive` is used
only for final flush. No external URL or dependency is added.

- [ ] **Step 4: Run focused model/API tests**

Expected: pass.

### Task 4: Coalesced writer

**Files:**
- Create: `frontend/src/features/viewer-state/core/viewerStateWriter.ts`
- Create: `frontend/src/features/viewer-state/core/viewerStateWriter.test.ts`

- [ ] **Step 1: Write fake-timer failure tests**

Cover 500 ms trailing debounce, 20 changes yielding one PUT, latest snapshot queued during an
in-flight request, `flush()` waiting for the latest snapshot, keepalive flush, retry after failure,
delete cancelling pending writes, and destroy preventing new work.

- [ ] **Step 2: Implement the writer state machine**

```ts
export interface ViewerStateWriter {
  schedule(state: ViewerStatePayload): void
  flush(options?: { keepalive?: boolean }): Promise<void>
  clear(): Promise<void>
  destroy(): Promise<void>
}
```

Maintain only `latest`, `timer`, and `inFlight`; after a request finishes, immediately send a newer
snapshot if present. Report `saving | saved | error | idle` through a callback without retaining
runtime/DOM references.

- [ ] **Step 3: Run writer tests**

Expected: pass and no dangling fake timers.

### Task 5: Safe annotation capture and hydration

**Files:**
- Create: `frontend/src/features/viewer-state/core/annotationPersistence.ts`
- Create: `frontend/src/features/viewer-state/core/annotationPersistence.test.ts`
- Modify: `frontend/src/features/viewer-annotations/core/annotationTools.ts`
- Modify: `frontend/src/features/viewer-annotations/core/annotationTools.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create realistic Length/Angle/RectangleROI/Arrow objects and Crosshairs/unknown objects. Assert
allowlist-only DTOs, exact point counts, safe Arrow label/text box, no cachedStats/internal fields,
partial skip for missing image references, hydrate calls with the correct viewport, invalidated
statistics, render trigger, and no restore-time state-change callback.

- [ ] **Step 2: Implement DTO conversion and hydration**

Use `tools.utilities.annotationHydration(viewport, toolName, points)` instead of global manager
restore. After hydration, set only validated Arrow `data.label` and optional text-box world values,
set `invalidated = true`, then render the target viewport. Crosshairs is never queried or restored.

- [ ] **Step 3: Extend the annotation controller**

Add `capture(viewportById)`/`restore(...)` or narrow callbacks needed by both runtimes. Annotation
completed/modified/removed events request a new viewer snapshot only after restore suppression ends.

- [ ] **Step 4: Run annotation tests**

Expected: pass with Crosshairs exclusion preserved.

### Task 6: Axial runtime and component integration

**Files:**
- Modify: `frontend/src/features/axial-viewer/core/cornerstone.ts`
- Modify: `frontend/src/features/axial-viewer/core/cornerstone.test.ts`
- Modify: `frontend/src/features/axial-viewer/components/AxialViewport.tsx`
- Modify: `frontend/src/features/axial-viewer/components/AxialViewport.test.tsx`
- Modify: `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx`

- [ ] **Step 1: Write failing axial capture/apply tests**

Assert capture of image index, active tool, public view presentation/VOI and annotations; restore
order after `setStack`/cache load; index clamping; geometry-tool fallback without calibration;
CAMERA/VOI/STACK/annotation changes; restore suppression; reset clearing annotations and state.

- [ ] **Step 2: Add runtime snapshot interface**

Extend `AxialViewportRuntime` with `captureState()` and `applyState(state)`; use
`getViewPresentation`, `setViewPresentation`, `getProperties`, `setProperties`, and the existing
bounded image-index setter. Register/removes only necessary Cornerstone listeners.

- [ ] **Step 3: Wire Series state load/write/reset**

Pass `seriesId` from `AxialViewerPage`. Load state before runtime restore, create one writer per
Series, schedule after runtime state changes, flush on cleanup/pagehide, and delete saved state on
reset. Keep runtime usable and show a safe status if GET/PUT/DELETE fails.

- [ ] **Step 4: Run all axial and viewer-state tests**

Expected: pass.

### Task 7: MPR runtime and component integration

**Files:**
- Modify: `frontend/src/features/mpr-viewer/core/mprRuntimeTypes.ts`
- Modify: `frontend/src/features/mpr-viewer/core/mprCornerstone.ts`
- Modify: `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts`
- Modify: `frontend/src/features/mpr-viewer/components/MprViewportGrid.tsx`
- Modify: `frontend/src/features/mpr-viewer/components/MprViewportGrid.test.tsx`
- Modify: `frontend/src/features/mpr-viewer/pages/MprViewerPage.tsx`

- [ ] **Step 1: Write failing MPR capture/apply tests**

Assert three public presentations/VOI values, active viewport/tool, Crosshairs visibility and
`toolCenter`, annotations by viewport, restore order after volume/tool setup, setToolCenter use,
Crosshairs exclusion, restore suppression, reset/delete, and a missing-image annotation skip.

- [ ] **Step 2: Implement MPR runtime capture/apply**

Expose `captureState()` and `applyState(state)`. Restore per-viewport presentation/VOI, call
`crosshairsTool.setToolCenter(position, true)`, set visibility, hydrate annotations, activate the
saved safe tool, render, then emit final callbacks.

- [ ] **Step 3: Wire the same per-Series writer**

Pass `seriesId` into `MprViewportGrid`, merge the MPR snapshot with the most recently loaded axial
state, and preserve one shared annotation list. Switching axial/MPR must not erase the other mode.

- [ ] **Step 4: Run all MPR and viewer-state tests**

Expected: pass.

### Task 8: Accessible status UI and documentation

**Files:**
- Create: `frontend/src/features/viewer-state/components/ViewerStateStatus.tsx`
- Create: `frontend/src/features/viewer-state/components/ViewerStateStatus.test.tsx`
- Modify: `frontend/src/styles/viewer-state.css`
- Modify: `frontend/src/app/App.tsx`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Write failing status tests**

Assert `aria-live` messages for loading/restored/saving/saved/error/cleared/partial restore, no
clinical wording, retry/clear action focus, and no toolbar overlap at narrow width.

- [ ] **Step 2: Implement the small status surface**

Render only current state and applicable retry/clear action. Do not add settings pages, history,
bookmarks, or a generic notification framework.

- [ ] **Step 3: Update bilingual docs**

Move viewer-state persistence from “not implemented” to “implemented”, keep annotation limits and
local/non-clinical boundary exact, and leave Features 007/008 listed as pending.

### Task 9: Full verification and evidence

**Files:**
- Modify: `specs/006-viewer-state-persistence/quickstart.md`
- Modify: `specs/006-viewer-state-persistence/tasks.md`

- [ ] **Step 1: Run complete automated gates**

```powershell
cd frontend
npm test -- --run
npm run build
cd ../backend
uv run python -m pytest -q -p no:cacheprovider
uv run alembic upgrade head
```

- [ ] **Step 2: Execute production browser acceptance**

Use two generated de-identified Series. Prove axial and MPR restore across exit/reload/service
restart, Series isolation, annotation recovery, Crosshairs safety, reset deletion, corrupt/old state
fallback, Patient cascade deletion, desktop/narrow layout, loopback-only network, and clean console.

- [ ] **Step 3: Record evidence and run final hygiene**

Write exact counts/warnings/fallbacks to quickstart, mark tasks only after evidence closes, run
`git diff --check`, inspect the complete working-tree diff, and do not commit or push.
