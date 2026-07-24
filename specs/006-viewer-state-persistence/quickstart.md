# Quickstart: 查看器状态持久化

## Prerequisites

- 使用脱敏、本机 CT Series；至少一个 Series 可构建三视图。
- production 前端由同一 FastAPI 进程托管，浏览器只访问 loopback。

## Automated verification

Status: Passed on 2026-07-23.

- `cd frontend && npm test -- --run`: 40 test files passed, 326 tests passed.
- `cd frontend && npm run build`: TypeScript check and Vite production build passed;
  1,974 modules transformed.
- `cd backend && uv run python -m pytest -q -p no:cacheprovider`: 167 tests passed,
  with one existing Starlette `TestClient` deprecation warning.
- Empty isolated database: `uv run alembic upgrade head` completed
  `001_create_patients -> 002_create_dicom_index -> 003_create_viewer_states`;
  `alembic_version=003_create_viewer_states` and all six product tables were present.
- Focused viewer-state regressions: seven codec, writer, annotation, axial, and MPR suites passed
  84/84 tests.
- Measurable-criteria closure: an automated axial component path alternated Series A/B 20 times
  with zero state reuse; codec/API/component tests covered corrupt, old-version, oversized, and
  missing-image annotation fallback; a two-lifespan `TestClient` path confirmed DELETE remained
  effective after application restart.

## Browser acceptance

Status: Passed on the production single-FastAPI-process app at
`http://127.0.0.1:8877/` with Chrome 150 on Windows.

The in-app Browser route could not start because
`codex/sandbox-state-meta: missing field sandboxPolicy`. The previously approved Chrome
DevTools fallback used only generated, de-identified local CT fixtures. The WebGL screenshot
path was not used; evidence came from accessibility snapshots, DOM/SVG state, API payloads,
SQLite counts, console, and network inspection.

Evidence directory during acceptance:
`%TEMP%\LocalCT-006-Final-20260723-1745`.

Final-review remediation evidence directory:
`%TEMP%\LocalCT-006-Remediation-20260723-1858`.

- Data setup: one fictitious Patient, one Study, and two eligible CT Series with five instances
  each; both imports were 5/5 successful and all instances used `PixelSpacing [0.7, 0.7]`.
- Axial persistence: Series A saved slice 4/5, Arrow Annotate as the active tool, modified
  zoom/pan/VOI, and Length, Angle, Rectangle ROI, and Arrow Annotate. GET returned exactly four
  allowlisted annotations and the arrow text `状态持久化教学标注`. Refresh/re-entry restored all
  fields; Series B remained at slice 3/5, default WindowLevel, and zero annotations.
- MPR persistence: the first-entry acceptance exposed and fixed an annotation overwrite defect.
  A Series with axial annotations but no prior MPR snapshot now hydrates those annotations before
  the first MPR write. The final payload preserved axial state and five annotations, restored
  `active_viewport=coronal`, `active_tool=length`, hidden Crosshairs at the saved finite world
  position, and distinct zoom/pan state for all three viewports. Crosshairs annotation count was 0.
- Final-review annotation remediation: coronal and sagittal annotations were captured with their
  correct orientation and restored into their original canvases. An annotations-only payload with
  `axial=null` restored its axial annotation when the user returned to the axial viewer. Real MPR
  volume annotations without `referencedImageId` used the current Series image anchor; hydration
  wrote that identity back to runtime metadata, so restoring three annotations and then adding a
  new coronal annotation produced a complete four-annotation snapshot instead of dropping the
  restored items.
- Image-identity degradation: after one persisted annotation was changed to a nonexistent image
  identity, the viewer restored the other three and displayed the partial-restore notice for the
  skipped item.
- Large hidden-page flush: a valid 300-annotation MPR snapshot produced a 64,617-byte PUT body.
  Entering hidden state started a normal flush with `keepalive=false`; all 300 annotations remained
  saved and restored after refreshing the final production build, split 150 coronal and 150
  sagittal. The final console contained no warning or error.
- Concurrent page-exit fallback: an automated writer regression held the hidden-page normal PUT
  in flight, rejected it as the pagehide fallback arrived, and verified the restored latest
  snapshot was retried with `keepalive=true` instead of inheriting the first request failure.
- Exact size boundary: a valid state serialized to exactly 2,097,152 bytes was accepted even though
  its GET/PUT response envelope was larger; the frontend continued to enforce the limit on `state`
  itself, matching the backend contract.
- Restart persistence: after stopping the original FastAPI process and restarting the same
  production command against the same isolated data directory, axial and MPR state, annotations,
  active viewport/tool, Crosshairs position/visibility, and camera state restored again.
- Corrupt-state fallback: a deliberately malformed stored payload returned the safe 422 path;
  images still opened at defaults, retry remained available, and clear issued DELETE 204 with
  focus restored to the status region.
- Reset deletion: acceptance exposed and fixed a post-DELETE passive-event race. After reset,
  resize/camera events no longer recreate a default snapshot; GET remained `null` after
  1280×900 → 820×900 resize. A later explicit Next action resumed persistence, and a second reset
  plus re-entry restored slice 3/5, WindowLevel, and zero annotations with no saved state.
- Responsive layout: 1280×900 and 820×900 both had no horizontal overflow, no overlap between
  viewer/measurement toolbars and persistence status, all controls stayed inside the viewport,
  and the non-clinical banner remained visible.
- Runtime health: every resource origin was `http://127.0.0.1:8877`; no external request occurred.
  The only console error was the two deliberately injected 422 corrupt-state reads; all other
  observed HTTP requests were expected loopback 2xx/304 responses or local blob resources.
- Cascade deletion: `viewer_states` count was 1 immediately before Patient deletion and 0 after;
  associated Series count was also 0.

## Known non-blocking warnings

- Vite reports existing Cornerstone codec `fs`/`path`/`url` externalization warnings and the
  existing large-chunk warning. The accepted fixture path produced no related runtime failure.
- Pytest reports one existing Starlette `TestClient` deprecation warning from the installed
  dependency.

## Final result

Status: Complete. T028 remediation closed annotation orientation and limits, annotations-only axial
recovery, hidden/pagehide flush and DELETE tracking, Series image identity validation, and
post-hydration identity retention. Full automated regression, production build, and production
browser re-verification passed.
