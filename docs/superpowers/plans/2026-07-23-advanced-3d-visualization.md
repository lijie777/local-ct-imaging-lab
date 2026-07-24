# 高级 3D 可视化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为满足空间条件的本机 CT Series 增加体绘制、MIP 和真实阈值表面重建，并保持单 volume、单 viewport、本机离线和安全清理边界。

**Architecture:** 新增独立 `advanced-3d-viewer` feature，页面重新校验 Series 后创建一个 Cornerstone `ORTHOGRAPHIC` volume runtime。体绘制和 MIP 复用 volume actor；表面模式把采样后的 vtkImageData 交给 `vtkImageMarchingCubes`，将 mesh actor 加入同一 viewport，并通过 user matrix 恢复 DICOM 方向。

**Tech Stack:** React 19、TypeScript 5.9、Vite 8、Vitest/RTL、Cornerstone3D 5.6.8、vtk.js 36.4.1、FastAPI 同源静态交付。

---

## 文件结构

```text
frontend/src/features/advanced-3d-viewer/
├── components/
│   ├── Advanced3dToolbar.tsx
│   ├── Advanced3dToolbar.test.tsx
│   ├── Advanced3dViewport.tsx
│   └── Advanced3dViewport.test.tsx
├── core/
│   ├── advanced3dCornerstone.ts
│   ├── advanced3dCornerstone.test.ts
│   ├── advanced3dRuntimeTypes.ts
│   ├── surfaceReconstruction.ts
│   └── surfaceReconstruction.test.ts
├── hooks/
│   ├── useAdvanced3dSeries.ts
│   └── useAdvanced3dSeries.test.tsx
├── model/
│   ├── advanced3dViewer.ts
│   └── advanced3dViewer.test.ts
└── pages/
    ├── Advanced3dViewerPage.tsx
    └── Advanced3dViewerPage.test.tsx
frontend/src/types/vtk-image-marching-cubes.d.ts
frontend/src/styles/advanced-3d-viewer.css
```

现有文件只修改 `AxialViewerPage.tsx`、对应测试、`App.tsx`、`package.json`、lockfile、双语 README 和
Feature 008 文档。后端产品代码不变。

### Task 1: 3D 模式与范围纯模型

**Files:**
- Create: `frontend/src/features/advanced-3d-viewer/model/advanced3dViewer.ts`
- Test: `frontend/src/features/advanced-3d-viewer/model/advanced3dViewer.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖默认模式、preset 映射、阈值 clamp、默认阈值、物理对角线和统一采样 stride：

```ts
expect(DEFAULT_ADVANCED_3D_STATE).toEqual({
  mode: 'volume', preset: 'CT-Bone', direction: 'anterior',
})
expect(defaultSurfaceThreshold([-1024, 3071])).toBe(300)
expect(defaultSurfaceThreshold([500, 900])).toBe(700)
expect(clampSurfaceThreshold(4000, [-1024, 3071])).toBe(3071)
expect(surfaceSampleStride([512, 512, 300], 4_000_000)).toBe(3)
expect(volumeDiagonalMm([100, 120, 80], [0.7, 0.7, 1.5]))
  .toBeCloseTo(Math.hypot(69.3, 83.3, 118.5))
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/model/advanced3dViewer.test.ts; Pop-Location`

Expected: FAIL，提示目标模块不存在。

- [ ] **Step 3: 实现最小纯模型**

定义：

```ts
export type Advanced3dMode = 'volume' | 'mip' | 'surface'
export type VolumePreset = 'CT-Bone' | 'CT-Soft-Tissue' | 'CT-Lung'
export type StandardViewDirection =
  | 'anterior' | 'posterior' | 'left' | 'right' | 'superior' | 'inferior'

export const MAX_SURFACE_SAMPLE_POINTS = 4_000_000
export const DEFAULT_ADVANCED_3D_STATE = {
  mode: 'volume' as const,
  preset: 'CT-Bone' as const,
  direction: 'anterior' as const,
}

export function defaultSurfaceThreshold([minimum, maximum]: readonly [number, number]) {
  return minimum <= 300 && maximum >= 300 ? 300 : (minimum + maximum) / 2
}

export function clampSurfaceThreshold(value: number, range: readonly [number, number]) {
  return Math.min(range[1], Math.max(range[0], value))
}

export function surfaceSampleStride(dimensions: readonly number[], limit = MAX_SURFACE_SAMPLE_POINTS) {
  let stride = 1
  const outputCount = () => dimensions.reduce(
    (count, size) => count * (Math.floor((size - 1) / stride) + 1), 1,
  )
  while (outputCount() > limit) stride += 1
  return stride
}
```

`volumeDiagonalMm` 使用每轴 `(dimension - 1) * spacing` 后调用 `Math.hypot`。

- [ ] **Step 4: 运行模型测试并确认通过**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/model/advanced3dViewer.test.ts; Pop-Location`

Expected: PASS。

### Task 2: vtk.js 直接依赖与表面重建管线

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/src/types/vtk-image-marching-cubes.d.ts`
- Create: `frontend/src/features/advanced-3d-viewer/core/surfaceReconstruction.ts`
- Test: `frontend/src/features/advanced-3d-viewer/core/surfaceReconstruction.test.ts`

- [ ] **Step 1: 把 vtk.js 固定为直接依赖**

Run: `Push-Location frontend; npm install @kitware/vtk.js@36.4.1 --save-exact; Pop-Location`

Expected: `package.json` 的 `dependencies` 出现 `"@kitware/vtk.js": "36.4.1"`，lockfile 保持单一 36.4.1。

- [ ] **Step 2: 写失败测试**

用 3×3×3 synthetic scalar volume 验证 stride=1、输出 spacing、实际 scalar range、方向矩阵和 actor：

```ts
const prepared = prepareSurfaceInput({
  dimensions: [3, 3, 3], spacing: [1, 2, 3], origin: [10, 20, 30],
  direction: [0, 1, 0, 1, 0, 0, 0, 0, -1],
  scalarData: new Int16Array(27).map((_, index) => index),
})
expect(prepared.stride).toBe(1)
expect(prepared.scalarRange).toEqual([0, 26])
expect(prepared.userMatrix).toEqual([
  0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 10, 20, 30, 1,
])
```

再 mock `vtkImageMarchingCubes`，验证 `setComputeNormals(true)`、`setMergePoints(true)`、阈值、
`mapper.setInputConnection(filter.getOutputPort())`、actor 浅骨色和 `delete()` 清理。

- [ ] **Step 3: 运行表面测试并确认失败**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/core/surfaceReconstruction.test.ts; Pop-Location`

Expected: FAIL，提示模块或声明不存在。

- [ ] **Step 4: 添加最小 Marching Cubes 声明**

声明默认导出：

```ts
declare module '@kitware/vtk.js/Filters/General/ImageMarchingCubes' {
  import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData'
  import type vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData'
  interface vtkImageMarchingCubes {
    delete(): void
    getOutputData(): vtkPolyData
    getOutputPort(): unknown
    setComputeNormals(value: boolean): boolean
    setContourValue(value: number): boolean
    setInputData(value: vtkImageData): void
    setMergePoints(value: boolean): boolean
    update(): void
  }
  const api: { newInstance(): vtkImageMarchingCubes }
  export default api
}
```

- [ ] **Step 5: 实现采样、矩阵和 actor 创建**

`prepareSurfaceInput` 创建零 origin、单位 direction 的新 `vtkImageData`，按统一 stride 抽样到
`Float32Array`，spacing 乘 stride；user matrix 使用 vtk.js column-major 布局：

```ts
export function directionUserMatrix(direction: readonly number[], origin: readonly number[]) {
  return new Float64Array([
    direction[0], direction[1], direction[2], 0,
    direction[3], direction[4], direction[5], 0,
    direction[6], direction[7], direction[8], 0,
    origin[0], origin[1], origin[2], 1,
  ])
}
```

`createSurfaceActor` 创建 filter、mapper、actor；无三角形时释放并返回 `{ kind: 'empty' }`，成功时返回
`{ kind: 'ready', actor, destroy }`。`destroy` 必须幂等释放 actor、mapper、filter 和采样 imageData。

- [ ] **Step 6: 运行表面测试并确认通过**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/core/surfaceReconstruction.test.ts; Pop-Location`

Expected: PASS。

### Task 3: 高级 3D Series 加载 hook

**Files:**
- Create: `frontend/src/features/advanced-3d-viewer/hooks/useAdvanced3dSeries.ts`
- Test: `frontend/src/features/advanced-3d-viewer/hooks/useAdvanced3dSeries.test.tsx`

- [ ] **Step 1: 写失败测试**

测试首次请求、Series 切换 abort、MPR eligibility 复用、instance 顺序到 imageId、404/409/410/5xx 和未知错误。
安全消息使用“高级 3D”，不得出现“三视图”、内部 ID、路径或异常堆栈。

- [ ] **Step 2: 运行 hook 测试并确认失败**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/hooks/useAdvanced3dSeries.test.tsx; Pop-Location`

Expected: FAIL，提示 hook 不存在。

- [ ] **Step 3: 实现 hook**

复用 `getSeriesDetails`、`instanceImageId` 和 `deriveMprEligibility`，但独立映射 3D 用户消息：

```ts
if (error.code === 'series_not_found' || error.status === 404) {
  return { kind: 'notFound', message: '未找到该本机 CT 序列，请返回轴位查看器' }
}
if (error.code === 'series_not_viewable' || error.status === 409) {
  return { kind: 'notViewable', message: '该序列暂不可用于高级 3D，请返回轴位查看器' }
}
if (error.code === 'instance_file_missing' || error.status === 410) {
  return { kind: 'persistence', message: '本机 DICOM 文件缺失，请恢复文件后重试' }
}
```

每次 load 创建新 `AbortController`，只有仍为 active controller 时才能写状态。

- [ ] **Step 4: 运行 hook 测试并确认通过**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/hooks/useAdvanced3dSeries.test.tsx; Pop-Location`

Expected: PASS。

### Task 4: 单 volume、单 viewport Cornerstone runtime

**Files:**
- Create: `frontend/src/features/advanced-3d-viewer/core/advanced3dRuntimeTypes.ts`
- Create: `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.ts`
- Test: `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.test.ts`

- [ ] **Step 1: 定义 runtime 合同并写失败测试**

合同包含：

```ts
export interface Advanced3dRuntime {
  destroy(): void
  getSurfaceRange(): readonly [number, number]
  reset(): void
  setDirection(direction: StandardViewDirection): void
  setMipThickness(thicknessMm: number): void
  setMode(mode: Advanced3dMode): Promise<SurfaceResult | void>
  setPreset(preset: VolumePreset): void
  setSurfaceThreshold(threshold: number): Promise<SurfaceResult>
}
```

测试 mock Cornerstone 和 vtk surface factory，断言只创建一个 engine、一个 `ORTHOGRAPHIC` volume viewport、一个 volume；
完整 load 前不 ready；部分 load 失败；体绘制、MIP、surface 切换不创建第二个 volume。

- [ ] **Step 2: 运行 runtime 测试并确认失败**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/core/advanced3dCornerstone.test.ts; Pop-Location`

Expected: FAIL，提示 runtime 不存在。

- [ ] **Step 3: 实现 volume 创建和工具绑定**

沿用 MPR 的唯一 ID、abort、safeCall、load 完成判定和 cache cleanup 模式。viewport 类型使用
`core.Enums.ViewportType.ORTHOGRAPHIC`；Cornerstone 5.6.8 的 `VolumeViewport3D.setBlendMode()` 与
`setSlabThickness()` 发布实现为 no-op，不能满足可调 MIP slab。注册 `TrackballRotateTool`、`PanTool`、`ZoomTool`：左键旋转、
中键平移、右键和滚轮缩放。完成 load 后设置：

```ts
viewport.setBlendMode(core.Enums.BlendModes.COMPOSITE)
viewport.setProperties({ preset: 'CT-Bone' })
viewport.setSlabThickness(maxThickness)
viewport.resetCamera()
```

- [ ] **Step 4: 实现模式、相机和表面隔离**

`setMode('mip')` 显示 volume actor，隐藏 surface actor，应用 `MAXIMUM_INTENSITY_BLEND` 与 `CT-MIP`；
`setMode('volume')` 恢复 `COMPOSITE` 和最后 preset；`setMode('surface')` 隐藏 volume actor，已有 surface
时显示它，没有 surface 时等待显式应用阈值。六方向通过固定 `viewPlaneNormal`/`viewUp` 设置相机并 reset。

表面失败时只移除新 surface 管线，恢复旧 surface 或保持空状态，volume 仍可切回。

- [ ] **Step 5: 实现幂等 destroy 与过期保护**

destroy 顺序：移除 signal/listeners → abort DICOM → cancel/clear volume callbacks → destroy surface →
destroy tool group → destroy engine → remove volume load object。所有异步回调在 `destroyed` 或 signal aborted
时直接返回。

- [ ] **Step 6: 运行 runtime 测试并确认通过**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/core/advanced3dCornerstone.test.ts; Pop-Location`

Expected: PASS。

### Task 5: 3D 工具栏

**Files:**
- Create: `frontend/src/features/advanced-3d-viewer/components/Advanced3dToolbar.tsx`
- Test: `frontend/src/features/advanced-3d-viewer/components/Advanced3dToolbar.test.tsx`

- [ ] **Step 1: 写失败测试**

测试三个模式的 `aria-pressed`、三个体绘制 preset、六方向、MIP thickness、阈值 range/number 同步、
“应用阈值”、busy 禁用和“重置高级 3D”。

- [ ] **Step 2: 运行工具栏测试并确认失败**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/components/Advanced3dToolbar.test.tsx; Pop-Location`

Expected: FAIL，提示组件不存在。

- [ ] **Step 3: 实现按模式显示的最小控制组**

模式按钮始终显示；volume 只显示 preset；MIP 只显示方向和 thickness；surface 只显示阈值与应用按钮。
阈值 number 输入先 clamp 再回调，所有按钮使用明确中文 `aria-label`，busy 时禁用会改变 runtime 的控件。

- [ ] **Step 4: 运行工具栏测试并确认通过**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/components/Advanced3dToolbar.test.tsx; Pop-Location`

Expected: PASS。

### Task 6: Viewport 生命周期与用户状态

**Files:**
- Create: `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.tsx`
- Test: `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.test.tsx`

- [ ] **Step 1: 写失败测试**

mock `createAdvanced3dRuntime`，覆盖 loading、ready、progress、mode/preset/direction/thickness、第一次进入 surface
只准备阈值、显式应用、empty mesh、surface error、surface reset、runtime error、retry、unmount destroy 和
imageIds 切换清理。

- [ ] **Step 2: 运行 viewport 测试并确认失败**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/components/Advanced3dViewport.test.tsx; Pop-Location`

Expected: FAIL，提示组件不存在。

- [ ] **Step 3: 实现 runtime 编排**

组件维护 `attempt/status/mode/preset/direction/thickness/threshold/surfaceMessage`。每次 effect 创建
`AbortController` 和 runtime；cleanup 先 abort 再 destroy。表面操作使用递增 token，只有最后一次结果可写 UI。
在调用同步 Marching Cubes 前：

```ts
setSurfaceStatus('building')
await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const result = await runtime.setSurfaceThreshold(threshold)
```

错误显示 allowlist 后的安全消息；重试递增 `attempt`，从默认模式创建全新 runtime。

- [ ] **Step 4: 运行 viewport 测试并确认通过**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/components/Advanced3dViewport.test.tsx; Pop-Location`

Expected: PASS。

### Task 7: 高级 3D 页面

**Files:**
- Create: `frontend/src/features/advanced-3d-viewer/pages/Advanced3dViewerPage.tsx`
- Test: `frontend/src/features/advanced-3d-viewer/pages/Advanced3dViewerPage.test.tsx`

- [ ] **Step 1: 写失败测试**

覆盖 SafetyBanner、标题、元数据、Series loading/error/retry、eligible viewport、不可查看阻止 runtime、返回轴位，
并断言内部 UUID/UID 不可见。

- [ ] **Step 2: 运行页面测试并确认失败**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/pages/Advanced3dViewerPage.test.tsx; Pop-Location`

Expected: FAIL，提示页面不存在。

- [ ] **Step 3: 实现页面**

页面结构沿用 `MprViewerPage`，标题为“CT 高级 3D”，eyebrow 为“本机 CT 三维可视化”，按钮为
“返回轴位查看器”。只有 hook success 且 eligibility eligible 时渲染 `Advanced3dViewport`。

- [ ] **Step 4: 运行页面测试并确认通过**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer/pages/Advanced3dViewerPage.test.tsx; Pop-Location`

Expected: PASS。

### Task 8: 轴位入口与样式

**Files:**
- Modify: `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx`
- Modify: `frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx`
- Create: `frontend/src/styles/advanced-3d-viewer.css`
- Modify: `frontend/src/app/App.tsx`

- [ ] **Step 1: 扩展轴位页面测试并确认失败**

eligible Series 应同时显示“进入三视图”和“进入高级 3D”；点击 3D 后显示新页面并可返回；不 eligible 时
显示禁用“高级 3D 暂不可用”，轴位仍可操作。mock 新页面以隔离 runtime。

- [ ] **Step 2: 运行轴位页面测试并确认失败**

Run: `Push-Location frontend; npm test -- --run src/features/axial-viewer/pages/AxialViewerPage.test.tsx; Pop-Location`

Expected: FAIL，找不到 3D 入口。

- [ ] **Step 3: 添加独立 3D open state 与入口**

`AxialViewerPage` 增加 `advanced3dOpen`，其优先分支渲染 `Advanced3dViewerPage`；MPR 与 3D 不同时存在。
eligible 区域增加按钮，不改变既有 MPR 文案和返回行为。

- [ ] **Step 4: 添加响应式样式并导入**

CSS 使用现有变量和按钮风格，桌面为 `minmax(0, 1fr) 18rem`，viewport 最小高度 36rem；
`@media (max-width: 900px)` 改为单列并把 viewport 最小高度降到 28rem。canvas 容器 `position: relative`、
`overflow: hidden`，toolbar 和 SafetyBanner 保持正常文档流。

- [ ] **Step 5: 运行轴位和新页面相关测试**

Run: `Push-Location frontend; npm test -- --run src/features/axial-viewer/pages/AxialViewerPage.test.tsx src/features/advanced-3d-viewer; Pop-Location`

Expected: PASS。

### Task 9: Spec Kit、双语 README 与验收文档

**Files:**
- Modify: `.specify/feature.json`
- Create: `specs/008-advanced-3d-visualization/**`
- Modify: `README.md`
- Modify: `README.en.md`

- [ ] **Step 1: 生成并闭合 Feature 008 工件**

创建 `spec.md`、requirements checklist、`plan.md`、`research.md`、`data-model.md`、
`contracts/advanced-3d-ui.md`、`quickstart.md` 和 `tasks.md`。用户故事顺序为 P1 体绘制、P2 MIP、
P3 表面重建；所有 requirements、tasks 和验收项必须可独立验证且无待澄清标记。

- [ ] **Step 2: 更新双语 README**

把体绘制、MIP、表面重建从“计划功能”移动到“已实现功能”，说明进入路径、三模式、本机浏览器计算、
大体积表面自动降采样、非临床边界和支持的现代 WebGL 浏览器。中文与英文结构和事实保持一致。

- [ ] **Step 3: 文档检查**

Run: `$patterns = @(("T"+"ODO"),("T"+"BD"),("NEEDS"+" CLARIFICATION"),("[FEATURE"+" NAME]"),("[D"+"ATE]")); Get-ChildItem specs/008-advanced-3d-visualization -Recurse -File | Select-String -SimpleMatch -Pattern $patterns`

Expected: 无输出。

### Task 10: 分层验证与真实浏览器验收

**Files:**
- Modify: `specs/008-advanced-3d-visualization/quickstart.md`
- Modify: `specs/008-advanced-3d-visualization/tasks.md`

- [ ] **Step 1: 运行目标前端测试**

Run: `Push-Location frontend; npm test -- --run src/features/advanced-3d-viewer src/features/axial-viewer/pages/AxialViewerPage.test.tsx; Pop-Location`

Expected: 全部 PASS。

- [ ] **Step 2: 运行前端全量测试和 production build**

Run: `Push-Location frontend; npm test -- --run; npm run build; Pop-Location`

Expected: 全部测试 PASS；TypeScript noEmit 和 Vite production build PASS。

- [ ] **Step 3: 运行后端全量回归**

Run: `Push-Location backend; uv run python -m pytest -q -p no:cacheprovider; Pop-Location`

Expected: Feature 005–007 的全部既有测试继续 PASS；本 Feature 不增加后端产品代码。

- [ ] **Step 4: 运行静态质量检查**

Run: `git diff --check HEAD`

Expected: 无输出。再用同一组规则扫描新增产品代码，预期无未决实现标记。

- [ ] **Step 5: 启动单进程 production 交付验收**

使用新的 `%TEMP%\local-ct-imaging-lab-e2e-008-*` 数据目录，执行 Alembic、前端 build，然后只启动
FastAPI 托管 `frontend/dist`。只停止明确的测试端口 owner，不批量结束 Python/Node。

- [ ] **Step 6: 完成真实 Chrome 验收**

验证：eligible/blocked 入口；默认非黑体绘制；三 preset；自由旋转/平移/缩放；六方向 MIP；厚度变化；
300 HU 和另一个阈值的真实表面；空 mesh；大体积采样提示；表面失败后切回 volume；410/服务停止恢复；
1280×900 和 820×900；三次进入退出；重启后默认状态；Console 无未处理错误；Network 100% loopback。

- [ ] **Step 7: 记录结果并关闭 tasks**

把命令结果、Chrome 版本、首次 3D 时间、两次表面时间、截图、Console、Network、cleanup 和已知非阻断
warning 写入 quickstart。只有全部通过后才勾选 `tasks.md` 并把 Feature 状态改为 Complete。

## Plan Self-Review

- 设计中的入口、单 volume、三个模式、方向、厚度、真实表面、降采样、错误隔离、可访问性、双语文档和
  浏览器证据均有对应 Task。
- 类型名统一为 `Advanced3d*`、`Advanced3dMode`、`VolumePreset`、`StandardViewDirection`。
- 没有提交、推送、PR 或无关重构步骤。
- 没有未决占位符或“以后实现”的步骤。
