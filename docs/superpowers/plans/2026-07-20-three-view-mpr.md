# 本地 CT 三视图 MPR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已完成的单轴位查看页中增加可进入、可返回、可重试的轴位/冠状位/矢状位联动 MPR，并保留轴位降级路径。

**Architecture:** 复用现有 Series API、image ID 和 Cornerstone 初始化，但由独立 `useMprSeries` 在进入时重新请求并校验，不新增后端接口或数据库变更。新增 MPR eligibility、volume runtime、三视图 grid/toolbar/overlay/page；runtime 拥有一个 streaming volume、三个正交 viewport、一个 tool group 和可完整移除的 VOI 事件监听，并在卸载或失败时统一释放。

**Tech Stack:** React 19、TypeScript 5.9、Vite、Vitest、React Testing Library、Cornerstone3D 5.6.8、真实 Chrome、真实本机 DICOM CT。

---

## 文件结构

- Create `frontend/src/features/mpr-viewer/model/mprViewer.ts`: MPR 类型、空间 eligibility 和稳定原因。
- Create `frontend/src/features/mpr-viewer/model/mprViewer.test.ts`: eligibility 和空间计算测试。
- Create `frontend/src/features/mpr-viewer/hooks/useMprSeries.ts`: 重新加载、校验、错误分类、retry 和 abort。
- Create `frontend/src/features/mpr-viewer/core/mprCornerstone.ts`: volume、三个 viewport、工具、VOI 事件和 cleanup。
- Create `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts`: adapter 合同、失败回滚和幂等销毁测试。
- Create `frontend/src/features/mpr-viewer/components/MprToolbar.tsx`: 工具、十字线和重置控制。
- Create `frontend/src/features/mpr-viewer/components/MprToolbar.test.tsx`: 可观察工具行为测试。
- Create `frontend/src/features/mpr-viewer/components/ViewportOverlay.tsx`: 中文视图名、方向和位置覆盖层。
- Create `frontend/src/features/mpr-viewer/components/MprViewportGrid.tsx`: 三个 DOM viewport 和 runtime 生命周期。
- Create `frontend/src/features/mpr-viewer/components/MprViewportGrid.test.tsx`: UI/runtime 编排测试。
- Create `frontend/src/features/mpr-viewer/pages/MprViewerPage.tsx`: 三视图页面、上下文、元数据和错误恢复。
- Create `frontend/src/features/mpr-viewer/pages/MprViewerPage.test.tsx`: 页面和隐私边界测试。
- Modify `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx`: MPR 入口和返回编排。
- Modify `frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx`: 入口、禁用原因和轴位回归。
- Create `frontend/src/styles/mpr-viewer.css`: 二乘二布局、窄屏、活动状态和覆盖层。
- Modify `frontend/src/app/App.tsx`: 引入 MPR 样式。
- Create `specs/004-three-view-mpr/quickstart.md`: 自动化和真实浏览器验收记录。

### Task 1: 定义 MPR 可用性与共享类型

**Files:**
- Create: `frontend/src/features/mpr-viewer/model/mprViewer.ts`
- Create: `frontend/src/features/mpr-viewer/model/mprViewer.test.ts`

- [ ] **Step 1: 写 eligibility 失败测试**

```typescript
import { expect, it } from 'vitest'
import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import { evaluateMprEligibility } from './mprViewer'

const detail = {
  id: 'series-id',
  modality: 'CT',
  rows: 2,
  columns: 2,
  instance_count: 3,
  viewability_status: 'eligible',
  viewability_reason: null,
  instances: [0, 1, 2].map((z) => ({
    id: `instance-${z}`,
    rows: 2,
    columns: 2,
    image_position_patient: [0, 0, z],
    image_orientation_patient: [1, 0, 0, 0, 1, 0],
  })),
} as SeriesDetail

it('allows at least two distinct positions with consistent geometry', () => {
  expect(evaluateMprEligibility(detail)).toEqual({ eligible: true, reason: null })
})

it('rejects a single slice with an understandable reason', () => {
  expect(evaluateMprEligibility({ ...detail, instances: detail.instances.slice(0, 1) })).toEqual({
    eligible: false,
    reason: '至少需要两个不同空间位置的切片',
  })
})

it('rejects duplicate spatial positions', () => {
  const instances = detail.instances.map((instance) => ({
    ...instance,
    image_position_patient: [0, 0, 0],
  }))
  expect(evaluateMprEligibility({ ...detail, instances })).toEqual({
    eligible: false,
    reason: '至少需要两个不同空间位置的切片',
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd frontend; npm test -- --run src/features/mpr-viewer/model/mprViewer.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现最小 eligibility 和类型**

```typescript
import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import type { ViewerTool } from '../../axial-viewer/model/axialViewer'
import { viewabilityReasonLabel } from '../../dicom-import/model/viewability'

export type MprViewportId = 'axial' | 'coronal' | 'sagittal'
export type MprTool = 'crosshairs' | ViewerTool
export type Point3 = [number, number, number]

export interface MprEligibility {
  eligible: boolean
  reason: string | null
}

function cross(a: readonly number[], b: readonly number[]): Point3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function evaluateMprEligibility(detail: SeriesDetail): MprEligibility {
  if (detail.viewability_status !== 'eligible') {
    return { eligible: false, reason: viewabilityReasonLabel(detail.viewability_reason) }
  }
  if (detail.instances.length < 2) {
    return { eligible: false, reason: '至少需要两个不同空间位置的切片' }
  }
  const first = detail.instances[0]
  const orientation = first.image_orientation_patient
  if (orientation === null || orientation.length !== 6) {
    return { eligible: false, reason: 'DICOM 缺少空间位置或方向信息' }
  }
  const normal = cross(orientation.slice(0, 3), orientation.slice(3, 6))
  const positions = detail.instances.map((instance) => instance.image_position_patient)
  if (positions.some((position) => position === null || position.length !== 3)) {
    return { eligible: false, reason: 'DICOM 缺少空间位置或方向信息' }
  }
  const offsets = new Set(
    positions.map((position) => Math.round(dot(position as number[], normal) * 1000)),
  )
  return offsets.size >= 2
    ? { eligible: true, reason: null }
    : { eligible: false, reason: '至少需要两个不同空间位置的切片' }
}
```

- [ ] **Step 4: 运行模型测试并确认通过**

Run: `cd frontend; npm test -- --run src/features/mpr-viewer/model/mprViewer.test.ts`

Expected: PASS。

### Task 2: 创建可取消和可销毁的 MPR runtime

**Files:**
- Create: `frontend/src/features/mpr-viewer/core/mprCornerstone.ts`
- Create: `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts`
- Modify: `frontend/src/features/axial-viewer/core/cornerstone.ts`

- [ ] **Step 1: 写 runtime 合同失败测试**

测试 mock `initializeCornerstone()` 返回的 core/tools，断言：

```typescript
it('creates one volume and three orthographic viewports', async () => {
  const runtime = await createMprRuntime(elements, ['a', 'b', 'c'], callbacks)

  expect(createAndCacheVolume).toHaveBeenCalledOnce()
  expect(setViewports).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ viewportId: expect.stringContaining('axial') }),
    expect.objectContaining({ viewportId: expect.stringContaining('coronal') }),
    expect.objectContaining({ viewportId: expect.stringContaining('sagittal') }),
  ]))
  expect(setVolumesForViewports).toHaveBeenCalledOnce()
  runtime.destroy()
})

it('cancels volume loading and destroys resources exactly once', async () => {
  const runtime = await createMprRuntime(elements, ['a', 'b'], callbacks)
  runtime.destroy()
  runtime.destroy()
  expect(cancelLoading).toHaveBeenCalledOnce()
  expect(removeVoiListeners).toHaveBeenCalledOnce()
  expect(destroyToolGroup).toHaveBeenCalledOnce()
  expect(destroyRenderingEngine).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: 运行 runtime 测试并确认失败**

Run: `cd frontend; npm test -- --run src/features/mpr-viewer/core/mprCornerstone.test.ts`

Expected: FAIL，runtime 尚不存在。

- [ ] **Step 3: 公开现有 Cornerstone 初始化模块**

把 `CornerstoneModules` 改为导出接口，继续保留单次初始化和 active XHR 跟踪：

```typescript
export interface CornerstoneModules {
  core: typeof import('@cornerstonejs/core')
  loader: typeof import('@cornerstonejs/dicom-image-loader')
  tools: typeof import('@cornerstonejs/tools')
}
```

- [ ] **Step 4: 实现 MPR runtime 小接口**

```typescript
import { initializeCornerstone, toSafeViewerError } from '../../axial-viewer/core/cornerstone'
import type { MprTool, MprViewportId, Point3 } from '../model/mprViewer'

export interface MprRuntimeElements {
  axial: HTMLDivElement
  coronal: HTMLDivElement
  sagittal: HTMLDivElement
}

export interface MprRuntimeCallbacks {
  onActiveViewport(viewport: MprViewportId): void
  onPosition(viewport: MprViewportId, point: Point3): void
  onError(message: string): void
  onReady(): void
}

export interface MprRuntime {
  activateTool(tool: MprTool): void
  destroy(): void
  reset(): void
  resize(): void
  setCrosshairsVisible(visible: boolean): void
}
```

`createMprRuntime()` 必须按以下固定顺序实现：

1. `initializeCornerstone()`；若 `AbortSignal` 已取消则抛 `AbortError`。
2. 创建唯一 `renderingEngineId`、三个 viewport IDs、`toolGroupId` 和
   `cornerstoneStreamingImageVolume:<unique>` volume ID。
3. `RenderingEngine.setViewports()` 创建三个 `ORTHOGRAPHIC` viewport，方向分别为
   `OrientationAxis.AXIAL/CORONAL/SAGITTAL`。
4. `volumeLoader.createAndCacheVolume(volumeId, { imageIds: [...imageIds] })`，调用 streaming volume
   的 `load()`，再用 `setVolumesForViewports()` 将同一 volume 绑定到三个 viewport。
5. 注册并加入 `CrosshairsTool`、`WindowLevelTool`、`PanTool`、`ZoomTool` 和 `StackScrollTool`；滚轮工具
   始终绑定 `MouseBindings.Wheel`，四个主工具只允许一个绑定 `Primary`。
6. 在三个 element 安装保存函数引用的 `VOI_MODIFIED` listener；用递归保护把来源 `voiRange` 写入另外
   两个 viewport。不要使用 5.6.8 存在 `ELEMENT_DISABLED` handler 清理缺陷的全局 synchronizer。
7. 在 viewport 元素监听 `pointerdown`、`focusin`、`CAMERA_MODIFIED` 和 `VOLUME_NEW_IMAGE`，回调活动
   viewport 和相机 `focalPoint`；在 `eventTarget` 监听 `IMAGE_LOAD_ERROR`、`VOLUME_LOADED_FAILED`。
8. 初始工具为 Crosshairs，调用 `resetCamera()`、CrosshairsTool `resetCrosshairs()` 并 render。
9. `destroy()` 必须幂等：abort 活跃 XHR，`cancelLoading()`、`clearLoadCallbacks()`，移除全部 listener，
   disable Crosshairs，销毁 rendering engine/tool group，并安全移除专属 volume load object。

任何失败都先执行同一 cleanup，再通过 `toSafeViewerError()` 或 MPR 固定安全文案报告，禁止返回内部 ID、
URL、路径或 codec 堆栈。

- [ ] **Step 5: 运行 runtime 定向测试**

Run: `cd frontend; npm test -- --run src/features/mpr-viewer/core/mprCornerstone.test.ts src/features/axial-viewer/core/cornerstone.test.ts`

Expected: PASS，轴位初始化和清理测试无回归。

### Task 3: 实现工具栏和 viewport 覆盖层

**Files:**
- Create: `frontend/src/features/mpr-viewer/components/MprToolbar.tsx`
- Create: `frontend/src/features/mpr-viewer/components/MprToolbar.test.tsx`
- Create: `frontend/src/features/mpr-viewer/components/ViewportOverlay.tsx`

- [ ] **Step 1: 写工具栏失败测试**

```typescript
it('reports the active viewport and emits tool, visibility, and reset actions', async () => {
  const user = userEvent.setup()
  const onToolChange = vi.fn()
  const onCrosshairsVisibleChange = vi.fn()
  const onReset = vi.fn()
  render(
    <MprToolbar
      activeTool="crosshairs"
      activeViewport="coronal"
      crosshairsVisible
      onCrosshairsVisibleChange={onCrosshairsVisibleChange}
      onReset={onReset}
      onToolChange={onToolChange}
    />,
  )
  expect(screen.getByText('当前视图：冠状位')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '平移' }))
  expect(onToolChange).toHaveBeenCalledWith('pan')
  await user.click(screen.getByRole('button', { name: '隐藏十字定位线' }))
  expect(onCrosshairsVisibleChange).toHaveBeenCalledWith(false)
  await user.click(screen.getByRole('button', { name: '重置三视图' }))
  expect(onReset).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: 实现工具栏**

工具顺序固定为“十字定位、窗宽窗位、平移、缩放”；每个工具按钮使用 `aria-pressed` 表达激活状态。
十字线按钮名称随可见性切换，活动 viewport 同时用文字显示，不得只靠边框颜色。

- [ ] **Step 3: 实现覆盖层**

`ViewportOverlay` 接受 `label`、`position`、`orientation` 和 `active`，输出：

```tsx
<div aria-label={`${label}视图信息`} className="mpr-overlay">
  <strong>{label}</strong>
  <span>{active ? '当前活动视图' : '非活动视图'}</span>
  <span>{`位置：${position.map((value) => value.toFixed(1)).join(', ')} mm`}</span>
  <span>{`${orientation.top} / ${orientation.right} / ${orientation.bottom} / ${orientation.left}`}</span>
</div>
```

- [ ] **Step 4: 运行组件测试**

Run: `cd frontend; npm test -- --run src/features/mpr-viewer/components/MprToolbar.test.tsx`

Expected: PASS。

### Task 4: 实现三视图 Grid 生命周期

**Files:**
- Create: `frontend/src/features/mpr-viewer/components/MprViewportGrid.tsx`
- Create: `frontend/src/features/mpr-viewer/components/MprViewportGrid.test.tsx`

- [ ] **Step 1: 写 grid 失败测试**

```typescript
it('creates the runtime with three elements and destroys it on unmount', async () => {
  const runtime = fakeMprRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const { unmount } = render(<MprViewportGrid imageIds={['a', 'b', 'c']} />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledWith(
    { axial: expect.any(HTMLDivElement), coronal: expect.any(HTMLDivElement), sagittal: expect.any(HTMLDivElement) },
    ['a', 'b', 'c'],
    expect.any(Object),
    expect.any(AbortSignal),
  ))
  unmount()
  expect(runtime.destroy).toHaveBeenCalledOnce()
})

it('aborts pending creation and exposes only a safe retry error', async () => {
  vi.mocked(createMprRuntime).mockRejectedValue(new Error('codec stack C:/secret/path'))
  render(<MprViewportGrid imageIds={['a', 'b']} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('无法构建三视图')
  expect(screen.queryByText(/secret|codec stack/i)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重试三视图' })).toBeVisible()
})
```

- [ ] **Step 2: 实现 grid 状态**

`MprViewportGrid` 使用三个 ref、一个 `MprRuntime` ref、一个 `AbortController`、`attempt`、`ready`、
`activeViewport`、`activeTool`、`crosshairsVisible`、每个 viewport 的 position/orientation 和 safe error。
effect 只依赖 `attempt` 与 `imageIds`，cleanup 中先 abort，再 destroy runtime 和 ResizeObserver。

- [ ] **Step 3: 连接工具栏和覆盖层**

工具切换只调用 runtime；隐藏十字线时将活动工具自动切换到 `windowLevel`；重置同时把 React 状态恢复为
`crosshairs`、可见和 axial active，然后调用 runtime.reset()。每个 viewport 容器必须有可理解的
`aria-label` 和 `tabIndex={0}`。

- [ ] **Step 4: 运行 grid 测试**

Run: `cd frontend; npm test -- --run src/features/mpr-viewer/components/MprViewportGrid.test.tsx`

Expected: PASS，pending creation cleanup、重试和三元素编排均通过。

### Task 5: 增加三视图页面和轴位入口

**Files:**
- Create: `frontend/src/features/mpr-viewer/pages/MprViewerPage.tsx`
- Create: `frontend/src/features/mpr-viewer/pages/MprViewerPage.test.tsx`
- Modify: `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx`
- Modify: `frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx`

- [ ] **Step 1: 写页面与入口失败测试**

覆盖：eligible 多切片显示“进入三视图”；单切片显示稳定原因且按钮禁用；进入后显示三个视图、元数据和
“返回轴位查看器”；返回后轴位组件重新从默认状态创建；页面不显示 Series/Instance UUID。

```typescript
it('enters linked MPR and returns to the axial viewer', async () => {
  const user = userEvent.setup()
  render(<AxialViewerPage context={context} onClose={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: '进入三视图' }))
  expect(screen.getByRole('heading', { name: 'CT 三视图' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '返回轴位查看器' }))
  expect(screen.getByRole('heading', { name: '轴位查看器' })).toBeVisible()
})
```

- [ ] **Step 2: 实现 `MprViewerPage`**

Props 固定为：

```typescript
interface MprViewerPageProps {
  context: AxialViewerContext
  onClose: () => void
}
```

页面使用 `useMprSeries(context.series.id)` 重新请求和校验。成功后显示 Patient/Study/Series 可见摘要和
Modality、Rows、Columns、实例数、可推导 slice spacing，并渲染 `MprViewportGrid`；加载/失败提供返回和
适用的重试。顶部返回按钮名称为“返回轴位查看器”。

- [ ] **Step 3: 在轴位页编排进入/返回**

`AxialViewerPage` 增加 `mprOpen` state。Series 成功后调用 `evaluateMprEligibility(series.detail)`：eligible
显示可用入口；unsupported 显示 `三视图暂不可用：<reason>` 和 disabled 按钮。`mprOpen` 为 true 时直接
return `MprViewerPage`，退出仅设置 false，不改变 `PatientManagementPage` 的 viewerContext。

- [ ] **Step 4: 运行页面测试**

Run: `cd frontend; npm test -- --run src/features/mpr-viewer/pages/MprViewerPage.test.tsx src/features/axial-viewer/pages/AxialViewerPage.test.tsx src/features/patients/pages/PatientManagementPage.dicom.test.tsx`

Expected: PASS，病人管理 → 轴位 → MPR → 轴位 → 病人管理的编排无回归。

### Task 6: 样式、响应式和可访问性

**Files:**
- Create: `frontend/src/styles/mpr-viewer.css`
- Modify: `frontend/src/app/App.tsx`
- Modify: MPR 组件对应测试文件

- [ ] **Step 1: 写可访问性断言**

测试返回、重试、工具、十字线、重置均可通过 role/name 获取；活动工具使用 `aria-pressed`，活动 viewport
具有文字状态；加载和错误状态仍由 `AppShell` 显示完整非临床提示。

- [ ] **Step 2: 实现二乘二布局**

桌面 `.mpr-grid` 使用两列两行，三个 `.mpr-viewport-card` 与 `.mpr-metadata-panel` 各占一格；viewport
画布最小高度 `22rem`，背景纯黑，overlay 不拦截鼠标。活动卡片同时使用边框和文本标签。

- [ ] **Step 3: 实现窄屏布局和 focus**

在 `max-width: 900px` 时改成单列，画布最小高度 `18rem`；工具栏允许换行；所有按钮和可聚焦 viewport
使用与现有应用一致的 `:focus-visible` 样式。不得使用覆盖 SafetyBanner 的 fixed/fullscreen 布局。

- [ ] **Step 4: 导入样式并运行页面测试/build**

Run: `cd frontend; npm test -- --run src/features/mpr-viewer src/features/axial-viewer/pages/AxialViewerPage.test.tsx`

Run: `cd frontend; npm run build`

Expected: MPR 定向测试 PASS，TypeScript 和 production build PASS。

### Task 7: 全量验证和真实浏览器验收

**Files:**
- Modify: `specs/004-three-view-mpr/quickstart.md`
- Modify: `specs/004-three-view-mpr/tasks.md`
- Modify: `specs/004-three-view-mpr/spec.md`

- [ ] **Step 1: 运行后端全量测试**

Run: `cd backend; uv run pytest -q`

Expected: 全部 PASS；本功能无后端代码变更。

- [ ] **Step 2: 运行前端全量测试**

Run: `cd frontend; npm test -- --run`

Expected: 全部 PASS，记录 test files 和 tests 数量。

- [ ] **Step 3: 运行 production build**

Run: `cd frontend; npm run build`

Expected: TypeScript 检查和 Vite build PASS；记录已有 Cornerstone externalization/chunk warning，不执行破坏性依赖升级。

- [ ] **Step 4: 启动隔离验收环境**

使用新的 `%TEMP%/TestProj-004-*` 目录作为 `MEDICAL_CT_APP_DATA_DIR`，后端绑定 `127.0.0.1:8000`，前端
绑定 `127.0.0.1:5173`。创建虚构病人并导入已脱敏真实多切片 CT。

- [ ] **Step 5: 执行完整浏览器路径**

按设计文档第 7 节执行三个非黑正交 viewport、三向定位联动、VOI 同步、平移、缩放、显隐、重置、
返回/重开默认、MPR eligibility、文件缺失、服务失败、加载中退出、键盘、Console、loopback Network 和
服务重启恢复。记录 Chrome 版本、首个三视图可见耗时、截图和证据目录。

- [ ] **Step 6: 同步 SpecKit 完成状态**

仅当自动化、build 和真实浏览器验收全部通过后，勾选 `tasks.md` 全部任务，把 `spec.md` 状态改为
`Complete`，更新 checklist 和 quickstart。停止临时服务并确认 8000/5173 无监听。不执行 commit、push、
merge 或上传。

## 计划自检

- 设计中的入口、轴位降级、eligibility、三个正交 viewport、十字定位、VOI 同步、工具、元数据、响应式、
  错误、cleanup 和真实浏览器验收均有对应任务。
- 类型统一为 `MprViewportId`、`MprTool`、`MprRuntimeElements`、`MprRuntimeCallbacks` 和 `MprRuntime`。
- 没有后端 schema/API/数据库改动，没有测量、标注、3D、PACS、DICOMweb、认证、云或状态持久化。
- 所有实现任务遵循测试先行，且没有 commit、push、merge 或上传步骤。
