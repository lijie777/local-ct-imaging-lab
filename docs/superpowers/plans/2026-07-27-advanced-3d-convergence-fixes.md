# Advanced 3D Convergence Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended; unavailable under current collaboration constraint) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 闭合高级 3D 的运行时失败清理、无有效 HU range 和无图形能力三个规格缺口。

**Architecture:** 保留现有单 volume、单 viewport 和 React 编排。runtime 继续拥有底层资源并在页面级失败时立即幂等清理；surface range 使用 `null` 表达不可用；Cornerstone CPU fallback 在创建 volume viewport 前映射为专用不可重试错误。

**Tech Stack:** React 19、TypeScript、Vitest、React Testing Library、Cornerstone3D 5.6.8

---

### Task 1: 页面级 runtime failure 立即释放资源

**Files:**
- Modify: `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.ts`
- Test: `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.test.ts`

- [x] **Step 1: 写失败测试**

在 owned `IMAGE_LOAD_FAILED` 或 `VOLUME_LOADED_FAILED` 到达后，断言 `onError` 被调用且 `abortPendingDicomLoads`、volume `cancelLoading`、RenderingEngine `destroy` 均立即执行。

- [x] **Step 2: 运行测试并确认失败**

Run: `npm test -- --run src/features/advanced-3d-viewer/core/advanced3dCornerstone.test.ts`

Expected: 新测试因异步错误只上报、不清理而失败。

- [x] **Step 3: 最小实现**

让 `reportRuntimeFailure()` 在记录稳定错误后调用已有的幂等 `destroyRuntime()`，再通知 React；surface reconstruction error 保持原有隔离路径。

- [x] **Step 4: 运行目标测试并确认通过**

Run: `npm test -- --run src/features/advanced-3d-viewer/core/advanced3dCornerstone.test.ts`

Expected: PASS。

### Task 2: 无有效 HU range 时禁用 surface

**Files:**
- Modify: `frontend/src/features/advanced-3d-viewer/core/advanced3dRuntimeTypes.ts`
- Modify: `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.ts`
- Modify: `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.tsx`
- Modify: `frontend/src/features/advanced-3d-viewer/components/Advanced3dToolbar.tsx`
- Test: `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.test.ts`
- Test: `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.test.tsx`
- Test: `frontend/src/features/advanced-3d-viewer/components/Advanced3dToolbar.test.tsx`

- [x] **Step 1: 写失败测试**

测试 invalid/non-finite range 返回 `null`，并验证 surface 按钮 disabled、显示“当前 CT 无法提供有效 HU 范围，表面重建不可用”，而 volume/MIP 仍可用。

- [x] **Step 2: 运行测试并确认失败**

Run: `npm test -- --run src/features/advanced-3d-viewer`

Expected: runtime 仍返回 `[0, 0]`，surface 按钮仍可用。

- [x] **Step 3: 最小实现**

将 runtime 合同改为 `getSurfaceRange(): readonly [number, number] | null`；无有效 finite range 时返回 `null`，Toolbar 仅禁用 surface 模式并显示安全说明，volume/MIP 保持可用。

- [x] **Step 4: 运行目标测试并确认通过**

Run: `npm test -- --run src/features/advanced-3d-viewer`

Expected: PASS。

### Task 3: 无图形能力时提供不可重试错误

**Files:**
- Modify: `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.ts`
- Modify: `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.tsx`
- Test: `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.test.ts`
- Test: `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.test.tsx`

- [x] **Step 1: 写失败测试**

让 mock Cornerstone 返回 CPU fallback，断言创建 runtime 拒绝专用 unsupported graphics 消息且不创建 RenderingEngine；组件不显示重试按钮。

- [x] **Step 2: 运行测试并确认失败**

Run: `npm test -- --run src/features/advanced-3d-viewer`

Expected: 当前实现继续映射为通用可重试错误。

- [x] **Step 3: 最小实现**

初始化完成后、创建 RenderingEngine 前检查 `core.getShouldUseCPURendering()`；为真时报告“当前浏览器无法使用高级 3D，请使用支持三维图形的现代浏览器”。Viewport 对该稳定消息不渲染重试按钮，其余 runtime 错误维持原有重试行为。

- [x] **Step 4: 运行回归验证**

Run: `npm test -- --run src/features/advanced-3d-viewer src/features/axial-viewer/pages/AxialViewerPage.test.tsx`

Expected: 所有目标测试 PASS。

Run: `npm run build`

Expected: TypeScript noEmit 与 production build PASS。

Run: `git diff --check`

Expected: 无输出。
