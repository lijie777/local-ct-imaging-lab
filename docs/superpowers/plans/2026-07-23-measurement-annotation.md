# Measurement and Annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在轴位与三视图查看器中加入安全、可编辑、会话级的长度、角度、矩形 ROI 和箭头文字标注，并提供受限单项删除与确认清空。

**Architecture:** 新建共享 `viewer-annotations` 前端功能边界，集中处理 Cornerstone 原生工具注册、标定检查、annotation 事件、文字回调和 allowlist 清理。轴位与 MPR runtime 只负责把共享工具加入各自 tool group 并向 React 报告状态；Feature 005 不改后端或数据库，退出 runtime 时精确清理会话 annotation。

**Tech Stack:** React 19、TypeScript 5.9、Vitest、Testing Library、Cornerstone3D 5.6.8、Vite、Spec Kit

---

## File map

**Create**

- `specs/005-measurement-annotation/spec.md`：Feature 005 需求 source of truth。
- `specs/005-measurement-annotation/tasks.md`：Feature 005 完成状态 source of truth。
- `specs/005-measurement-annotation/quickstart.md`：自动化和真实浏览器验收记录。
- `frontend/src/features/viewer-annotations/model/viewerAnnotation.ts`：工具、标定和文字请求类型及纯校验函数。
- `frontend/src/features/viewer-annotations/model/viewerAnnotation.test.ts`：标定与文字校验测试。
- `frontend/src/features/viewer-annotations/core/ScopedAnnotationEraserTool.ts`：只删除 allowlist annotation 的 Cornerstone 工具工厂。
- `frontend/src/features/viewer-annotations/core/annotationTools.ts`：共享工具安装、事件、计数和清理 controller。
- `frontend/src/features/viewer-annotations/core/annotationTools.test.ts`：共享 controller 与 scoped eraser 测试。
- `frontend/src/features/viewer-annotations/components/MeasurementToolbar.tsx` 与测试：测量/标注工具栏。
- `frontend/src/features/viewer-annotations/components/AnnotationTextDialog.tsx` 与测试：箭头文字新建/修改对话框。
- `frontend/src/features/viewer-annotations/components/ClearAnnotationsDialog.tsx` 与测试：全部清空确认框。
- `frontend/src/styles/viewer-annotations.css`：共享工具栏和对话框样式。

**Modify**

- `.specify/feature.json`：当前 Feature 指向 `specs/005-measurement-annotation`。
- `frontend/src/features/axial-viewer/model/axialViewer.ts`：增加 `AxialTool` 联合类型。
- `frontend/src/features/axial-viewer/core/cornerstone.ts` 与测试：安装共享 annotation controller。
- `frontend/src/features/axial-viewer/components/AxialViewport.tsx` 与测试：接入工具栏、对话框和状态。
- `frontend/src/features/mpr-viewer/model/mprViewer.ts`：扩展 `MprTool`。
- `frontend/src/features/mpr-viewer/core/mprRuntimeTypes.ts`：增加 annotation callback 与 runtime 清理方法。
- `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 与测试：三个 viewport 接入共享 controller并保护 Crosshairs。
- `frontend/src/features/mpr-viewer/components/MprViewportGrid.tsx` 与测试：接入共享 UI。
- `frontend/src/app/App.tsx`：加载共享样式。
- `README.md`、`README.en.md`、`docs/README.md`：把测量与标注从排除项移到已完成功能并增加 Feature 005 导航。

### Task 1: Establish Feature 005 source-of-truth artifacts

**Files:**
- Create: `specs/005-measurement-annotation/spec.md`
- Create: `specs/005-measurement-annotation/tasks.md`
- Create: `specs/005-measurement-annotation/quickstart.md`
- Modify: `.specify/feature.json`

- [ ] **Step 1: Write the Feature 005 specification**

Create `spec.md` with these exact user stories and requirements:

```markdown
# Feature Specification: 测量与标注

**Feature Branch**: `005-measurement-annotation`
**Created**: 2026-07-23
**Status**: Approved

## User Story 1 - 几何测量 (Priority: P1)

用户在具有可靠 Pixel Spacing 的轴位或 MPR viewport 中创建、选择和编辑长度、角度与矩形 ROI；结果由 Cornerstone 原生统计提供。缺少可靠标定时禁用几何测量但保持查看和文字标注。

## User Story 2 - 箭头文字标注 (Priority: P2)

用户绘制箭头后通过可访问对话框输入 1–200 个可见字符；可拖动、双击修改，取消新建不留下空 annotation，取消编辑保留原文字。

## User Story 3 - 删除与生命周期 (Priority: P3)

用户可删除一个测量/标注或确认后清空当前 runtime 的全部四类 annotation；Crosshairs 不受影响，reset 不删除 annotation，退出或切换 Series 后不恢复 005 会话状态。

## Functional Requirements

- **FR-001**: 轴位与 MPR MUST 提供 Length、Angle、Rectangle ROI、Arrow Annotate。
- **FR-002**: 几何测量 MUST 只在全部 imagePlaneModule Pixel Spacing 有限、为正且一致时启用。
- **FR-003**: 结果 MUST 使用 Cornerstone 原生世界坐标、单位和 cached statistics，MUST NOT 伪造毫米、面积或 HU。
- **FR-004**: 箭头文字 MUST 使用应用内 ModalDialog，MUST NOT 调用浏览器 prompt。
- **FR-005**: 文字 trim 后 MUST 为 1–200 个可见字符且不含控制字符。
- **FR-006**: 单项删除 MUST 只检查 Length、Angle、RectangleROI、ArrowAnnotate，并只删除一个命中项。
- **FR-007**: 全部清空 MUST 二次确认并只删除 FR-006 四类 annotation。
- **FR-008**: Crosshairs MUST 保持可见且不得被单项删除或全部清空删除。
- **FR-009**: reset MUST NOT 删除测量或标注。
- **FR-010**: runtime destroy MUST 取消交互、关闭文字请求、移除监听并精确清理本 runtime annotation。
- **FR-011**: Feature 005 MUST NOT 新增后端 API、数据库、持久化、报告、分割或 3D。
- **FR-012**: 所有主要交互 MUST 可通过键盘聚焦且保留非临床提示。
```

- [ ] **Step 2: Create tasks and quickstart skeletons**

Create `tasks.md` with the exact initial checklist:

```markdown
# Tasks: 测量与标注

- [ ] T001 创建 Feature 005 spec、tasks、quickstart 并更新 feature pointer
- [ ] T002 编写文字校验、工具类型和 Pixel Spacing 标定失败测试
- [ ] T003 实现 viewerAnnotation 纯类型与纯函数
- [ ] T004 编写 scoped eraser 和共享 annotation controller 失败测试
- [ ] T005 实现 scoped eraser 和共享 annotation controller
- [ ] T006 编写共享工具栏、文字对话框和清空对话框失败测试
- [ ] T007 实现共享测量与标注 UI
- [ ] T008 编写轴位 runtime 与组件集成失败测试
- [ ] T009 在轴位查看器接入测量与标注
- [ ] T010 编写 MPR runtime 与组件集成失败测试
- [ ] T011 在三视图 MPR 接入测量与标注并保护 Crosshairs
- [ ] T012 增加响应式样式并同步中英文 README 与文档导航
- [ ] T013 运行完整前端 Vitest 并记录结果
- [ ] T014 运行 TypeScript 与 production build 并记录结果
- [ ] T015 运行完整后端 pytest 回归并记录结果
- [ ] T016 完成真实浏览器验收、关闭任务并记录最终结果
```

Create `quickstart.md` as:

```markdown
# Quickstart: 测量与标注

## Automated verification

Status: Not run. Record exact commands, counts, warnings, and date after execution.

## Browser acceptance

Status: Not run. Use only de-identified local CT data and record each acceptance flow separately.

## Known non-blocking warnings

Record only warnings observed in the final run; do not copy historical counts as current evidence.

## Final result

Status: Not complete until T001–T016 and all required evidence are closed.
```

- [ ] **Step 3: Point Spec Kit at Feature 005**

Set `.specify/feature.json` to:

```json
{
  "feature_directory": "specs/005-measurement-annotation"
}
```

- [ ] **Step 4: Verify artifacts**

Run:

```powershell
Get-Content -Raw .specify/feature.json | ConvertFrom-Json | Select-Object -ExpandProperty feature_directory
rg -n "待确认|未决项|占位内容" specs/005-measurement-annotation
```

Expected: feature path is `specs/005-measurement-annotation`; placeholder scan has no matches.

### Task 2: Implement annotation types, text validation, and calibration validation

**Files:**
- Create: `frontend/src/features/viewer-annotations/model/viewerAnnotation.ts`
- Create: `frontend/src/features/viewer-annotations/model/viewerAnnotation.test.ts`
- Modify: `frontend/src/features/axial-viewer/model/axialViewer.ts`
- Modify: `frontend/src/features/mpr-viewer/model/mprViewer.ts`

- [ ] **Step 1: Write failing pure-function tests**

Cover:

```typescript
expect(validateAnnotationText('  teaching target  ')).toEqual({
  error: null,
  value: 'teaching target',
})
expect(validateAnnotationText('')).toEqual({
  error: '请输入标注文字',
  value: null,
})
expect(validateAnnotationText('line\nbreak').error).toBe('标注文字不能包含换行或控制字符')
expect(validateAnnotationText('x'.repeat(201)).error).toBe('标注文字不能超过 200 个字符')

expect(deriveMeasurementCalibration([
  { rowPixelSpacing: 0.7, columnPixelSpacing: 0.7 },
  { rowPixelSpacing: 0.7, columnPixelSpacing: 0.7 },
])).toEqual({ available: true, reason: null })
expect(deriveMeasurementCalibration([{ rowPixelSpacing: undefined, columnPixelSpacing: 0.7 }]))
  .toEqual({ available: false, reason: CALIBRATION_UNAVAILABLE_MESSAGE })
expect(deriveMeasurementCalibration([
  { rowPixelSpacing: 0.7, columnPixelSpacing: 0.7 },
  { rowPixelSpacing: 0.8, columnPixelSpacing: 0.7 },
]).available).toBe(false)
```

- [ ] **Step 2: Run the failing model test**

Run:

```powershell
cd frontend
npm test -- --run src/features/viewer-annotations/model/viewerAnnotation.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact public model contracts**

`viewerAnnotation.ts` must export:

```typescript
export const ANNOTATION_TEXT_MAX_LENGTH = 200
export const CALIBRATION_UNAVAILABLE_MESSAGE =
  '影像缺少可靠 Pixel Spacing，无法进行几何测量'

export type ViewerAnnotationTool =
  | 'length'
  | 'angle'
  | 'rectangleRoi'
  | 'arrowAnnotate'
  | 'eraseAnnotation'

export type GeometryMeasurementTool = Exclude<
  ViewerAnnotationTool,
  'arrowAnnotate' | 'eraseAnnotation'
>

export interface MeasurementCalibration {
  available: boolean
  reason: string | null
}

export interface AnnotationTextRequest {
  initialValue: string
  mode: 'create' | 'edit'
  cancel(): void
  complete(value: string): void
}

export interface ViewerAnnotationCallbacks {
  onAnnotationCountChange(count: number): void
  onCalibrationChange(calibration: MeasurementCalibration): void
  onTextRequest(request: AnnotationTextRequest | null): void
}

export function validateAnnotationText(value: string): {
  error: string | null
  value: string | null
}

export function deriveMeasurementCalibration(
  modules: ReadonlyArray<{
    rowPixelSpacing?: unknown
    columnPixelSpacing?: unknown
  }>,
): MeasurementCalibration
```

Use a relative/absolute tolerance of `max(1e-6, reference * 1e-6)` for Series consistency. Empty metadata is unavailable.

- [ ] **Step 4: Extend viewer tool unions**

```typescript
export type AxialTool = ViewerTool | ViewerAnnotationTool
export type MprTool = 'crosshairs' | ViewerTool | ViewerAnnotationTool
```

- [ ] **Step 5: Run tests**

Expected: the new model test and existing `mprViewer.test.ts` pass.

### Task 3: Implement the scoped eraser and shared Cornerstone controller

**Files:**
- Create: `frontend/src/features/viewer-annotations/core/ScopedAnnotationEraserTool.ts`
- Create: `frontend/src/features/viewer-annotations/core/annotationTools.ts`
- Create: `frontend/src/features/viewer-annotations/core/annotationTools.test.ts`

- [ ] **Step 1: Write failing controller tests**

Mock Cornerstone modules and assert:

- native Length/Angle/RectangleROI/ArrowAnnotate and scoped eraser register once;
- all five names are added to the supplied tool group;
- Arrow `getTextCallback` emits a create request and cancel completes with an empty value;
- Arrow `changeTextCallback` emits an edit request initialized from `annotation.data.label` and edit cancel does not mutate it;
- Pixel Spacing metadata is checked for every image ID;
- completed/modified/removed events update a de-duplicated allowlist count;
- `clearAnnotations()` removes allowlist UIDs once and never removes `Crosshairs`;
- `destroy()` invalidates pending text requests, removes listeners, and clears only controller-owned annotations.

- [ ] **Step 2: Write failing scoped eraser tests**

Use overlapping mock annotations and assert reverse creation order deletes exactly one allowed UID; Crosshairs and non-allowlisted annotations are never queried or removed.

- [ ] **Step 3: Run focused tests and verify failure**

```powershell
cd frontend
npm test -- --run src/features/viewer-annotations/core/annotationTools.test.ts
```

Expected: FAIL because both core files do not exist.

- [ ] **Step 4: Implement the public controller contract**

`annotationTools.ts` must export:

```typescript
export const ANNOTATION_TOOL_NAMES: Record<ViewerAnnotationTool, string>

export interface ViewerAnnotationController {
  activate(tool: ViewerAnnotationTool): void
  clearAnnotations(): void
  destroy(): void
}

export function installViewerAnnotationTools(options: {
  callbacks: ViewerAnnotationCallbacks
  core: typeof import('@cornerstonejs/core')
  elements: readonly HTMLDivElement[]
  imageIds: readonly string[]
  toolGroup: import('@cornerstonejs/tools').Types.IToolGroup
  tools: typeof import('@cornerstonejs/tools')
}): ViewerAnnotationController
```

Implementation requirements:

- use `tools.store.hasTool()` before `tools.addTool()`;
- add Arrow tool with injected `getTextCallback` and `changeTextCallback` configuration;
- use `core.metaData.get('imagePlaneModule', imageId)` for calibration;
- attach annotation events to `core.eventTarget`;
- count and clear by `tools.annotation.state.getAnnotations(toolName, element)` and UID de-duplication;
- never call `removeAllAnnotations()`;
- controller `activate()` makes every annotation tool passive, then activates exactly one with the primary mouse binding;
- destroy is idempotent and sanitizes warnings without annotation text, patient data, paths, or stacks.

- [ ] **Step 5: Implement scoped eraser as a factory**

Export `scopedEraserToolClass(tools)` so the runtime class extends the same dynamically loaded `tools.BaseTool`. Its `preMouseDownCallback` and `preTouchStartCallback` must inspect only the four allowlisted tool instances returned by `toolGroup.getToolInstance()`, iterate annotations in reverse order, remove the first hit, prevent default only on deletion, and return whether deletion occurred.

- [ ] **Step 6: Run focused tests**

Expected: controller and eraser tests pass with no Crosshairs removal calls.

### Task 4: Build accessible shared measurement UI

**Files:**
- Create: `frontend/src/features/viewer-annotations/components/MeasurementToolbar.tsx`
- Create: `frontend/src/features/viewer-annotations/components/MeasurementToolbar.test.tsx`
- Create: `frontend/src/features/viewer-annotations/components/AnnotationTextDialog.tsx`
- Create: `frontend/src/features/viewer-annotations/components/AnnotationTextDialog.test.tsx`
- Create: `frontend/src/features/viewer-annotations/components/ClearAnnotationsDialog.tsx`
- Create: `frontend/src/features/viewer-annotations/components/ClearAnnotationsDialog.test.tsx`

- [ ] **Step 1: Write failing toolbar tests**

Assert labels `长度`、`角度`、`矩形 ROI`、`箭头标注`、`删除单项`、`全部清空`; `aria-pressed`; geometry buttons disabled on unavailable calibration; arrow remains enabled; erase/clear disabled at count zero; count is announced with `aria-live`.

- [ ] **Step 2: Write failing dialog tests**

Assert create/edit initial values, validation messages, 200-character boundary, cancel semantics, clear count and irreversible warning, keyboard cancel, non-clinical banner, and focus restoration.

- [ ] **Step 3: Run focused tests and verify failure**

```powershell
cd frontend
npm test -- --run src/features/viewer-annotations/components
```

- [ ] **Step 4: Implement components**

`MeasurementToolbar` accepts:

```typescript
interface MeasurementToolbarProps {
  activeTool: string
  annotationCount: number
  calibration: MeasurementCalibration
  clearButtonRef: RefObject<HTMLButtonElement | null>
  disabled: boolean
  onActivateTool(tool: ViewerAnnotationTool): void
  onRequestClear(): void
}
```

Both dialogs must compose the existing `ModalDialog`; `AnnotationTextDialog` keeps draft/error in React state and calls `validateAnnotationText()` before `request.complete()`. `ClearAnnotationsDialog` calls `onConfirm()` only from the danger button.

- [ ] **Step 5: Run focused tests**

Expected: all shared component tests pass.

### Task 5: Integrate Feature 005 into the axial viewer

**Files:**
- Modify: `frontend/src/features/axial-viewer/core/cornerstone.ts`
- Modify: `frontend/src/features/axial-viewer/core/cornerstone.test.ts`
- Modify: `frontend/src/features/axial-viewer/components/AxialViewport.tsx`
- Modify: `frontend/src/features/axial-viewer/components/AxialViewport.test.tsx`

- [ ] **Step 1: Add failing runtime tests**

Assert `installViewerAnnotationTools()` receives the axial element and image IDs; `AxialViewportRuntime.activateTool()` routes annotation tools to controller and base tools to existing names; base activation passivates annotation tools; reset returns WindowLevel without clearing; destroy calls controller destroy before tool-group/engine destruction; runtime exposes `clearAnnotations()`.

- [ ] **Step 2: Add failing component tests**

Assert runtime callbacks update calibration/count/text dialog; measurement activation calls runtime; clear confirmation calls `clearAnnotations`; reset preserves count; unmount closes text request and destroys runtime.

- [ ] **Step 3: Run axial tests and verify failure**

```powershell
cd frontend
npm test -- --run src/features/axial-viewer/core/cornerstone.test.ts src/features/axial-viewer/components/AxialViewport.test.tsx
```

- [ ] **Step 4: Extend runtime without changing existing image behavior**

Update the runtime contract to:

```typescript
export interface AxialViewportRuntime {
  activateTool(tool: AxialTool): void
  clearAnnotations(): void
  destroy(): void
  next(): Promise<void>
  previous(): Promise<void>
  reset(): Promise<void>
  resize(): void
  retry(): Promise<void>
}
```

Add optional `annotationCallbacks` after the existing `signal` argument so current callers/tests remain source-compatible. Initialize the shared controller only after tool group and viewport exist; destroy it before destroying the tool group.

- [ ] **Step 5: Integrate shared UI in `AxialViewport`**

Maintain `annotationCount`, `calibration`, `textRequest`, and clear-dialog state. Render `MeasurementToolbar` after `ViewerToolbar`; render both dialogs inside the shell; use `elementRef` as text-dialog return focus. Reset changes active tool to WindowLevel but does not change count.

- [ ] **Step 6: Run axial regression tests**

Expected: focused tests plus all axial viewer tests pass.

### Task 6: Integrate Feature 005 into three-view MPR

**Files:**
- Modify: `frontend/src/features/mpr-viewer/core/mprRuntimeTypes.ts`
- Modify: `frontend/src/features/mpr-viewer/core/mprCornerstone.ts`
- Modify: `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts`
- Modify: `frontend/src/features/mpr-viewer/components/MprViewportGrid.tsx`
- Modify: `frontend/src/features/mpr-viewer/components/MprViewportGrid.test.tsx`

- [ ] **Step 1: Add failing runtime tests**

Assert controller receives all three elements; annotation activation passivates base tools while Crosshairs remains enabled/visible; selecting Crosshairs restores its primary binding; clear never removes Crosshairs; reset does not clear; destroy order is controller → Crosshairs/tool group → engine/cache.

- [ ] **Step 2: Add failing MPR component tests**

Assert toolbar is disabled until `onReady`; measurement state callbacks render shared toolbar; active viewport is the text-dialog return focus; clear confirmation works; switching measurement tools does not change Crosshairs visibility; reset preserves annotation count.

- [ ] **Step 3: Run focused MPR tests and verify failure**

```powershell
cd frontend
npm test -- --run src/features/mpr-viewer/core/mprCornerstone.test.ts src/features/mpr-viewer/components/MprViewportGrid.test.tsx
```

- [ ] **Step 4: Extend runtime types and implementation**

Add `clearAnnotations()` to `MprRuntime`, add optional `annotationCallbacks` as the fifth `createMprRuntime` argument, install the shared controller after all viewports join the tool group, and include annotation tool names in the primary-tool passivation loop. Do not change volume loading, VOI synchronization, Crosshairs position, cancellation, or cache cleanup semantics.

- [ ] **Step 5: Integrate shared UI in `MprViewportGrid`**

Use the active viewport ref for text-dialog focus restoration. Keep Crosshairs state independent from measurement state. Reset selects Crosshairs and preserves annotation count; clear is the only batch-removal path.

- [ ] **Step 6: Run MPR regression tests**

Expected: focused tests plus all MPR viewer tests pass.

### Task 7: Add shared styles and update documentation

**Files:**
- Create: `frontend/src/styles/viewer-annotations.css`
- Modify: `frontend/src/app/App.tsx`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Add responsive styles**

Use existing button, toolbar, modal and safety-banner classes. New selectors must cover `.measurement-toolbar`, `.measurement-toolbar__tools`, `.measurement-toolbar__status`, `.annotation-text-form`, and `.clear-annotations-warning`; below 900 px the toolbar stacks vertically without covering viewport or SafetyBanner.

- [ ] **Step 2: Import styles once**

Add:

```typescript
import '../styles/viewer-annotations.css'
```

next to existing global feature-style imports in `frontend/src/app/App.tsx`.

- [ ] **Step 3: Update Chinese and English README in parity**

Add Feature 005 to completed features and documentation navigation. Remove measurement/annotation from explicit exclusions while retaining segmentation, reports, 3D, persistence and background import exclusions. State that Feature 005 annotations are session-only and non-clinical.

- [ ] **Step 4: Update docs navigation**

Document Feature 005 `spec.md`, `tasks.md`, and `quickstart.md` as current source of truth; historical plan checkboxes remain non-authoritative.

- [ ] **Step 5: Validate Markdown links**

Run:

```powershell
$missing = @()
foreach ($readme in 'README.md', 'README.en.md') {
    $base = Split-Path -Parent (Resolve-Path $readme)
    Select-String -Path $readme -Pattern '\[[^]]+\]\(([^)]+)\)' -AllMatches | ForEach-Object {
        foreach ($match in $_.Matches) {
            $target = $match.Groups[1].Value
            if ($target -notmatch '^(https?://|#|mailto:)' -and -not (Test-Path (Join-Path $base $target))) {
                $missing += "${readme}: $target"
            }
        }
    }
}
if ($missing.Count) { $missing; exit 1 } else { 'ALL_LOCAL_LINKS_EXIST' }
```

Expected: `ALL_LOCAL_LINKS_EXIST`.

### Task 8: Complete automated and browser acceptance

**Files:**
- Modify: `specs/005-measurement-annotation/tasks.md`
- Modify: `specs/005-measurement-annotation/quickstart.md`

- [ ] **Step 1: Run the full frontend suite**

```powershell
cd frontend
npm test -- --run
```

Expected: all tests pass; record exact file/test counts.

- [ ] **Step 2: Run production build**

```powershell
npm run build
```

Expected: `tsc --noEmit` and Vite build pass; record existing Cornerstone externalization/chunk warnings separately.

- [ ] **Step 3: Run backend regression**

```powershell
cd ../backend
uv run python -m pytest -q -p no:cacheprovider
```

Expected: all backend tests pass; only recorded deprecation warning is allowed.

- [ ] **Step 4: Perform real-browser acceptance**

Generate two de-identified local fixtures under `%TEMP%` without committing them:

```powershell
$env:MEASUREMENT_FIXTURE_DIR = Join-Path $env:TEMP 'local-ct-measurement-fixtures'
@'
import os
from pathlib import Path
from pydicom import dcmread
from tests.dicom_factory import write_dicom_file

root = Path(os.environ['MEASUREMENT_FIXTURE_DIR'])
for folder, calibrated in [('calibrated', True), ('uncalibrated', False)]:
    study_uid = series_uid = None
    for index in range(1, 6):
        fixture = write_dicom_file(
            root / folder / f'{index:03d}.dcm',
            study_uid=study_uid,
            series_uid=series_uid,
            instance_number=index,
        )
        study_uid, series_uid = fixture.study_uid, fixture.series_uid
        dataset = dcmread(fixture.path)
        dataset.RescaleSlope = 1
        dataset.RescaleIntercept = -1024
        if calibrated:
            dataset.PixelSpacing = [0.7, 0.7]
        dataset.save_as(fixture.path, enforce_file_format=True)
'@ | uv run python -
```

Import both folders into fictional patients. Record PASS/FAIL for the seven browser flows in the design: axial CRUD, ROI stats, three MPR viewports, scoped deletion/Crosshairs preservation, reset/exit cleanup, no-calibration downgrade, and loopback/Console safety. Delete the `%TEMP%` fixture directory after evidence is recorded.

- [ ] **Step 5: Close source-of-truth tasks**

Only after evidence exists, change all Feature 005 `tasks.md` items to `[X]`, write exact results in `quickstart.md`, and verify:

```powershell
rg -n "^- \[ \] T[0-9]+" specs/005-measurement-annotation/tasks.md
git diff --check
git status --short
```

Expected: no open Feature 005 task and no whitespace errors; working tree contains only Feature 005 design, plan, spec, implementation, tests and documentation.
