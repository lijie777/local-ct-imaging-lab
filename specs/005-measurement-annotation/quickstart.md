# Quickstart: 测量与标注

## Automated verification

Status: Passed on 2026-07-23.

- `cd frontend && npm test -- --run`: 35 test files passed, 254 tests passed.
- `cd frontend && npm run build`: TypeScript check and Vite production build passed;
  1,968 modules transformed.
- `cd backend && uv run python -m pytest -q -p no:cacheprovider`: 156 tests passed.
- Focused red/green regressions covered JavaScript MIME, complete metadata loading before
  calibration, real Mouse/Touch eraser activation, redraw after scoped deletion/clear,
  Cornerstone `usingDefaultValues` calibration rejection, and annotation input identity.

## Browser acceptance

Status: Passed on the production single-process app at `http://127.0.0.1:8876/`.

The in-app Browser route could not start because
`codex/sandbox-state-meta: missing field sandboxPolicy`. With the approved Chrome DevTools
fallback, acceptance used only generated, de-identified local CT fixtures. The screenshot API
did not complete on the WebGL viewport, so the recorded evidence uses fresh accessibility
snapshots, DOM state, SVG geometry, annotation counts, console state, and network state.

- Calibrated axial Series: all five DICOM instances had `PixelSpacing [0.7, 0.7]`.
  Length, Angle, Rectangle ROI, and Arrow Annotate were enabled and created real Cornerstone
  SVG geometry; count changed from 0 to 4. Arrow text `教学标注` saved and focus returned to
  the viewport. Reset preserved all four annotations; leaving/re-entering reset the count to 0.
- Scoped removal and clear: single deletion changed count from 1 to 0 and removed the SVG.
  Clear showed the exact count and irreversible warning; cancellation preserved the annotation
  and restored trigger focus, while confirmation removed annotation SVG without touching other
  Cornerstone state.
- MPR: axial, coronal, and sagittal viewports rendered. A length annotation was created in the
  axial viewport; after confirmed clear, annotation count was 0 and all three viewports still
  contained four Crosshairs SVG line segments.
- Uncalibrated axial Series: all five DICOM instances omitted Pixel Spacing. Images remained
  viewable; Length, Angle, and Rectangle ROI were disabled; Arrow Annotate remained enabled;
  `影像缺少可靠 Pixel Spacing，无法进行几何测量` was visible.
- Responsive layout: 1280×900 and 820×900 passed. At 820×900 there was no horizontal
  overflow or clipped button text, the viewport remained 746×512, and the arrow dialog stayed
  entirely inside the viewport with correct input and return focus.
- Final runtime health: no console error, warning, or issue; no unhandled promise rejection;
  every HTTP request was loopback and returned 200; no external resource request was observed.
- FastAPI served the current ES module with `text/javascript`; the production runtime loaded
  after adding the browser `events` implementation required by `xmlbuilder2`.

## Known non-blocking warnings

- Vite reports existing Cornerstone codec `fs`/`path`, XML URL, and chunk-size browser build
  warnings. The accepted uncompressed fixture paths produced no corresponding runtime error.
- Pytest reports one Starlette `TestClient` deprecation warning from the installed dependency.

## Final result

Status: Complete. T001–T016, automated verification, production build, and the required
end-to-end acceptance paths are closed.
