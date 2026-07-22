---

description: "Implementation tasks for linked local CT three-view MPR"
---

# Tasks: 联动 CT 三视图 MPR

**Input**: Design documents from `/specs/004-three-view-mpr/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/mpr-ui.md, quickstart.md

**Tests**: Vitest/React Testing Library、既有 pytest 全量回归和真实 Chrome/DICOM 验收均为强制门禁。
每个 User Story 先写失败测试，再实现最小代码并验证。

**Organization**: Tasks are grouped by user story so the linked views, display tools, and safe recovery remain independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可与相邻任务并行，文件不重叠且不依赖未完成结果
- **[Story]**: 对应 spec.md 的 User Story
- 所有任务包含精确文件路径

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 建立 feature 文件边界、确认 003 基线和锁定无新增依赖/后端改动的范围

- [x] T001 在 `frontend/src/features/mpr-viewer/` 下建立 `components/`、`core/`、`hooks/`、`model/`、`pages/` 文件边界
- [x] T002 [P] 运行变更前 `backend/uv run pytest -q`、`frontend/npm test -- --run` 和 `frontend/npm run build`，把基线数量与结果写入 `specs/004-three-view-mpr/quickstart.md`
- [x] T003 [P] 复核 `frontend/package.json` 和 `frontend/package-lock.json` 保持现有 Cornerstone3D `5.6.8` 三个直接依赖且本功能不新增包
- [x] T004 [P] 校验 `specs/004-three-view-mpr/contracts/mpr-ui.md`、两份 checklist 和 `.specify/memory/constitution.md` 无未决占位符且范围不含后端 schema/API/迁移

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 建立所有 Story 共用的 MPR eligibility、重新加载 hook 和可复用 Cornerstone 取消边界

**⚠️ CRITICAL**: 本阶段完成前不得创建 volume 或三视图组件

### Foundational Tests (MANDATORY)

- [x] T005 [P] 在 `frontend/src/features/mpr-viewer/model/mprViewer.test.ts` 添加有效多切片、单切片、重复位置、缺失/非有限 geometry、退化法向、尺寸/方向不一致和 slice spacing 推导的失败测试
- [x] T006 [P] 在 `frontend/src/features/mpr-viewer/hooks/useMprSeries.test.tsx` 添加重新请求详情、eligible/unsupported/删除、旧请求取消、retry、顺序保持和错误类别的失败测试
- [x] T007 [P] 在 `frontend/src/features/axial-viewer/core/cornerstone.test.ts` 添加导出初始化模块类型、按指定 image IDs 中止活动 XHR且不影响其他请求的失败测试

### Foundational Implementation

- [x] T008 在 `frontend/src/features/mpr-viewer/model/mprViewer.ts` 定义 `MprViewportId`、`MprTool`、`MprEligibility`、`MprErrorKind`、位置/方向/runtime 状态类型并实现 `deriveMprEligibility()`
- [x] T009 在 `frontend/src/features/mpr-viewer/hooks/useMprSeries.ts` 实现独立 Series 详情重新加载、AbortController、二次 eligibility、ordered image IDs、稳定错误类别和 reload
- [x] T010 在 `frontend/src/features/axial-viewer/core/cornerstone.ts` 导出 `CornerstoneModules`、`abortPendingDicomLoads(imageIds)` 和可复用安全 HTTP/decode 错误映射，保持既有轴位 runtime 行为不变
- [x] T011 运行 `frontend/src/features/mpr-viewer/model/mprViewer.test.ts`、`hooks/useMprSeries.test.tsx` 和 `axial-viewer/core/cornerstone.test.ts`，修正最小类型/行为差异
- [x] T012 检查 `deriveMprEligibility()` 与 `backend/app/services/study_service.py` 的法向投影排序规则一致，并在 `specs/004-three-view-mpr/research.md` 记录任何实际 API 差异

**Checkpoint**: MPR 入口可可靠预判，进入后会重新校验，加载取消不会影响轴位或其他 image IDs

---

## Phase 3: User Story 1 - 打开并联动浏览三个正交视图 (Priority: P1) 🎯 MVP

**Goal**: 从轴位页进入一个共享 volume 的轴位、冠状位、矢状位三视图，并通过 Crosshairs/滚轮保持世界坐标联动

**Independent Test**: 使用至少三张真实 eligible CT，进入后显示三个正交非黑视图；分别从三向改变定位，另外两向同步；返回轴位后仍可浏览

### Tests for User Story 1 (MANDATORY)

- [x] T013 [P] [US1] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts` 添加唯一 streaming volume、imageIds 副本、三个 ORTHOGRAPHIC viewport 和 AXIAL/CORONAL/SAGITTAL 方向的失败测试
- [x] T014 [P] [US1] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts` 添加同一 volume 绑定三个 viewport、先绑定后单次 `volume.load(callback)` 和首次 render 的失败测试
- [x] T015 [P] [US1] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts` 添加 loaded/processed/total 完整成功、部分帧失败和 volume creation reject 的失败测试
- [x] T016 [P] [US1] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts` 添加 Crosshairs/StackScroll 注册、三 viewport ToolGroup、Primary 互斥和 Wheel 滚层的失败测试
- [x] T017 [P] [US1] 在 `frontend/src/features/mpr-viewer/components/MprViewportGrid.test.tsx` 添加三个 viewport DOM、默认 axial active、中心位置、加载进度、ready 和卸载 cleanup 的失败测试
- [x] T018 [P] [US1] 在 `frontend/src/features/mpr-viewer/pages/MprViewerPage.test.tsx` 添加重新校验 loading/success、三个视图、返回轴位和 SafetyBanner 的失败测试
- [x] T019 [P] [US1] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx` 添加 eligible 多位置入口、MPR 不可用原因、进入/返回和轴位重新默认创建的失败测试
- [x] T020 [P] [US1] 在 `frontend/src/features/patients/pages/PatientManagementPage.dicom.test.tsx` 添加 Patient → Axial → MPR → Axial → Patient 的完整页面编排失败测试

### Implementation for User Story 1

- [x] T021 [US1] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 定义 `MprRuntimeElements`、`MprRuntimeCallbacks`、`MprRuntime` 和唯一 runtime/volume/viewport/tool IDs
- [x] T022 [US1] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 创建三个有非零尺寸的 ORTHOGRAPHIC viewport 并使用 `createAndCacheVolume(..., { imageIds: [...imageIds] })`
- [x] T023 [US1] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 用 `setVolumesForViewports()` 绑定同一 volume，单次启动 streaming load，并用帧计数报告 progress/ready/partial failure
- [x] T024 [US1] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 注册 Crosshairs、WindowLevel、Pan、Zoom、StackScroll，只为 Crosshairs 绑定默认 Primary并为 StackScroll 绑定 Wheel
- [x] T025 [US1] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 监听 pointer/focus/camera/volume image 事件，向 React 回调活动 viewport、focal point 和方向标记
- [x] T026 [US1] 在 `frontend/src/features/mpr-viewer/components/ViewportOverlay.tsx` 实现轴位/冠状位/矢状位名称、方向、位置和活动/非活动文字覆盖层
- [x] T027 [US1] 在 `frontend/src/features/mpr-viewer/components/MprViewportGrid.tsx` 实现三个 DOM ref、runtime effect、AbortController、progress/ready、active viewport、positions 和 ResizeObserver
- [x] T028 [US1] 在 `frontend/src/features/mpr-viewer/pages/MprViewerPage.tsx` 集成 `useMprSeries`、安全上下文、loading/eligibility/volume 状态、MprViewportGrid 和返回轴位入口
- [x] T029 [US1] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx` 增加临时 `mprOpen`、`deriveMprEligibility(series.detail)`、可用入口/禁用原因和 MprViewerPage 返回编排
- [x] T030 [US1] 在 `frontend/src/styles/mpr-viewer.css` 实现三 viewport + 元数据占位的基础二乘二深色布局、非零画布尺寸和不遮挡 SafetyBanner 的页面结构
- [x] T031 [US1] 在 `frontend/src/app/App.tsx` 引入 `frontend/src/styles/mpr-viewer.css`
- [x] T032 [US1] 运行 T013-T020 定向 Vitest/RTL 并确认既有轴位、StudyList 和 Patient DICOM 流程无回归
- [x] T033 [US1] 按 `specs/004-three-view-mpr/quickstart.md` A-B 执行真实 Chrome MVP 验收，记录三个非黑平面、8 秒目标、三向 Crosshairs/滚轮联动和返回轴位证据
- [x] T034 [US1] 将 US1 真实 API/事件差异同步到 `specs/004-three-view-mpr/research.md` 和 `quickstart.md`，不扩大功能范围

**Checkpoint**: User Story 1 可独立演示真实三正交 MPR 和世界坐标联动，轴位降级路径保留

---

## Phase 4: User Story 2 - 识别视图并使用二维显示工具 (Priority: P2)

**Goal**: 提供可理解的视图覆盖层、互斥工具、共享 VOI、独立 pan/zoom、十字线显隐、元数据和完整重置

**Independent Test**: 在已加载三视图中激活各 viewport，依次操作四种工具、显隐和重置，核对共享/独立规则、覆盖层和元数据

### Tests for User Story 2 (MANDATORY)

- [x] T035 [P] [US2] 在 `frontend/src/features/mpr-viewer/components/MprToolbar.test.tsx` 添加四工具 `aria-pressed` 互斥、活动视图文字、十字线显隐和重置回调的失败测试
- [x] T036 [P] [US2] 在 `frontend/src/features/mpr-viewer/components/ViewportOverlay.test.tsx` 添加中文名称、方向、位置一位小数和非颜色活动状态的失败测试
- [x] T037 [P] [US2] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts` 添加工具切换清除旧 Primary bindings、Crosshairs Enabled/Disabled/Active 模式的失败测试
- [x] T038 [P] [US2] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts` 添加 runtime 自有 `VOI_MODIFIED` 三向同步、递归保护、pan/zoom 不同步和 listener cleanup 的失败测试
- [x] T039 [P] [US2] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts` 添加 Crosshairs reset、三 camera/properties reset、中心定位和默认工具恢复的失败测试
- [x] T040 [P] [US2] 在 `frontend/src/features/mpr-viewer/components/MprViewportGrid.test.tsx` 添加 active viewport、工具、显隐保留位置、reset React 状态和 resize 的失败测试
- [x] T041 [P] [US2] 在 `frontend/src/features/mpr-viewer/pages/MprViewerPage.test.tsx` 添加 Patient/Study/Series、Modality、Rows×Columns、实例数、spacing/不可推导和无 UUID/UID/路径泄露的失败测试

### Implementation for User Story 2

- [x] T042 [US2] 在 `frontend/src/features/mpr-viewer/components/MprToolbar.tsx` 实现十字定位、窗宽窗位、平移、缩放、显隐、重置和活动 viewport 文字合同
- [x] T043 [US2] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 实现显式 `activateTool()`，清除全部旧 Primary bindings并保持非活动 Crosshairs 可见
- [x] T044 [US2] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 实现 Crosshairs 显隐；Disabled 前清理交互，显示时依据当前 cameras 重新初始化且不自动抢占非 Crosshairs 主工具
- [x] T045 [US2] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 实现可完整移除的三 element VOI 同步监听和递归保护，不使用 5.6.8 全局 Synchronizer
- [x] T046 [US2] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 实现 reset：默认 VOI、三 camera、Crosshairs center/visible/active 和 axial active 回调
- [x] T047 [US2] 在 `frontend/src/features/mpr-viewer/components/MprViewportGrid.tsx` 集成 MprToolbar、activeTool、crosshairsVisible、runtime tool/visibility/reset 和非颜色状态
- [x] T048 [US2] 在 `frontend/src/features/mpr-viewer/pages/MprViewerPage.tsx` 实现二乘二第四格元数据面板及 spacing 安全格式化
- [x] T049 [US2] 在 `frontend/src/styles/mpr-viewer.css` 完成 overlay、active/focus、toolbar、metadata、desktop 二乘二和 `max-width:900px` 纵向布局
- [x] T050 [US2] 运行 T035-T041 定向测试和 `frontend/npm run build`，确认工具共享规则、TypeScript 和 production build PASS
- [x] T051 [US2] 按 `specs/004-three-view-mpr/quickstart.md` C 段执行真实 Chrome WindowLevel/Pan/Zoom/显隐/reset/窄屏/键盘验收并记录证据
- [x] T052 [US2] 复核 `specs/004-three-view-mpr/contracts/mpr-ui.md` 与实际按钮名称、默认状态和元数据字段一致

**Checkpoint**: User Stories 1-2 均可独立验证，且未加入测量、标注、分割或 3D

---

## Phase 5: User Story 3 - 安全、可恢复的 MPR 不可用与失败反馈 (Priority: P3)

**Goal**: 稳定处理 eligibility、Series 状态、文件缺失、网络、decode/volume/render 和加载中退出，并保留轴位降级

**Independent Test**: 使用单切片、删除/unsupported Series、移除受管文件、停止服务和 pending load，所有场景提供安全反馈、重试/返回且不修改数据

### Tests for User Story 3 (MANDATORY)

- [x] T053 [P] [US3] 在 `frontend/src/features/mpr-viewer/hooks/useMprSeries.test.tsx` 添加 series_not_found、unsupported、invalid geometry、网络失败、validation/persistence 和 retry 后恢复的失败测试
- [x] T054 [P] [US3] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts` 添加 404/409/410/422/500、status 0、未知 decode/volume/WebGL 错误的安全分类失败测试
- [x] T055 [P] [US3] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts` 添加 `IMAGE_LOAD_FAILED`、错位数字 `IMAGE_LOAD_ERROR.imageId`、partial frame failure 和不回显原始错误的失败测试
- [x] T056 [P] [US3] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts` 添加 pending XHR abort、cancelLoading、callbacks clear、listener removal、Crosshairs disable、engine/tool/volume cleanup 和 destroy 幂等测试
- [x] T057 [P] [US3] 在 `frontend/src/features/mpr-viewer/components/MprViewportGrid.test.tsx` 添加 runtime creation reject、partial failure、retry 新 attempt/new runtime 和卸载不 setState 的失败测试
- [x] T058 [P] [US3] 在 `frontend/src/features/mpr-viewer/pages/MprViewerPage.test.tsx` 添加安全 error、重试/返回、轴位降级、无 UUID/URL/path/codec/stack 和持续 SafetyBanner 的失败测试
- [x] T059 [P] [US3] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx` 添加单切片/重复位置禁用 MPR、未知 eligibility reason 兜底且 AxialViewport 仍渲染的失败测试

### Implementation for User Story 3

- [x] T060 [US3] 在 `frontend/src/features/mpr-viewer/hooks/useMprSeries.ts` 完成 notFound/notViewable/geometry/service/validation/persistence/unknown 分类和安全中文消息
- [x] T061 [US3] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 实现 HTTP/网络/文件缺失与 decode/volume/render 安全分类，结合 frame counts 判断 partial failure
- [x] T062 [US3] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 完成创建失败回滚、active XHR abort、volume queue/callback、DOM/core listener、Crosshairs、engine、tool group、cache 的幂等 cleanup
- [x] T063 [US3] 在 `frontend/src/features/mpr-viewer/components/MprViewportGrid.tsx` 实现 safe runtime error、重试全新 runtime、返回前 cleanup 和取消后不更新 React 状态
- [x] T064 [US3] 在 `frontend/src/features/mpr-viewer/pages/MprViewerPage.tsx` 实现 Series/geometry/runtime 错误的重试/不可重试动作及始终可用的返回轴位入口
- [x] T065 [US3] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx` 完成 MPR 不可用稳定原因和轴位继续可用的降级状态
- [x] T066 [US3] 在 `frontend/src/styles/mpr-viewer.css` 增加 loading/progress/error、disabled、focus-visible 和窄屏安全错误布局
- [x] T067 [US3] 运行 T053-T059 定向测试，确认错误类别、隐私、重试、返回、partial failure 和 cleanup 全部 PASS
- [x] T068 [US3] 按 `specs/004-three-view-mpr/quickstart.md` D-E 执行真实 Chrome 单切片阻止、missing-file、服务失败、恢复、pending abort、loopback 和 restart 验收

**Checkpoint**: 全部三个 User Story 可独立验证，MPR 失败不会破坏轴位或持久化 DICOM

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 全量回归、文档同步、真实验收和完成状态闭环

- [x] T069 [P] 复核 `specs/004-three-view-mpr/checklists/requirements.md` 与 `specs/004-three-view-mpr/checklists/mpr-quality.md`，仅在最终规格仍满足时保持全部勾选
- [x] T070 [P] 复核 `docs/superpowers/specs/2026-07-20-three-view-mpr-design.md`、`docs/superpowers/plans/2026-07-20-three-view-mpr.md` 与最终 SpecKit artifacts 无 synchronizer/useAxialSeries 等术语漂移
- [x] T071 运行 `backend/uv run pytest -q` 并把最终测试数量、warning 和结果写入 `specs/004-three-view-mpr/quickstart.md`
- [x] T072 运行 `frontend/npm test -- --run` 并把最终 test files/tests 数量写入 `specs/004-three-view-mpr/quickstart.md`
- [x] T073 运行 `frontend/npm run build` 并把 TypeScript/Vite 结果、modules transformed 和非阻断 warning 写入 `specs/004-three-view-mpr/quickstart.md`
- [x] T074 使用独立临时 SQLite/受管 DICOM 目录和真实 DICOM fixture 完整执行 `specs/004-three-view-mpr/quickstart.md` A-E
- [x] T075 记录 Chrome 版本、三个非黑视图首屏耗时、三向联动、Console、Network loopback、截图、missing/service/pending-load 恢复和 evidence directory 到 `specs/004-three-view-mpr/quickstart.md`
- [x] T076 停止临时服务并确认 `127.0.0.1:8000` 与 `127.0.0.1:5173` 无监听，将结果写入 `specs/004-three-view-mpr/quickstart.md`
- [x] T077 执行只读完成前审查，确认 spec/plan/tasks、UI contract、实现、测试和真实验收一致，关闭 Critical/Important 问题
- [x] T078 只有 T071-T077 全部通过后，勾选 `specs/004-three-view-mpr/tasks.md` 全部任务并把 `specs/004-three-view-mpr/spec.md` 状态更新为 `Complete`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖
- **Foundational (Phase 2)**: 依赖 Setup，阻断所有 User Story
- **US1 (Phase 3)**: 依赖 Foundational；提供共享 volume、三 viewport、Crosshairs 联动 MVP
- **US2 (Phase 4)**: 依赖 US1 runtime/grid；扩展工具、VOI、overlay、metadata 和 reset
- **US3 (Phase 5)**: 依赖 US1 runtime/page；错误测试可与 US2 不重叠文件并行设计，但实现按优先级顺序集成
- **Polish (Phase 6)**: 依赖 US1-US3 全部完成

### User Story Dependencies

- **US1 (P1)**: 基础完成后可独立交付三正交 linked MPR MVP
- **US2 (P2)**: 复用 US1 runtime 和 viewport grid，不改变 US1 volume/空间联动合同
- **US3 (P3)**: 扩展 US1 的安全失败和 cleanup 边界，不依赖 US2 工具正确性

### Within Each User Story

- 测试必须先写并确认失败
- 纯模型/hook 先于 volume runtime
- volume/runtime 先于 grid/page
- 定向自动化 PASS 后才执行该 Story 的真实 Chrome checkpoint
- 不执行 commit、push、merge 或上传

### Parallel Opportunities

- T002-T004 使用测试/文档/依赖不同边界，可并行只读执行
- T005-T007 使用不同测试文件，可并行编写
- US1 的 T013-T020 按 runtime/component/page 文件分组可并行编写测试
- US2 的 toolbar/overlay/page 测试可与 runtime VOI/reset 测试并行
- US3 的 hook/page 与 runtime cleanup 测试可并行设计
- T069-T070 可并行复核；全量测试、build 和真实 Chrome 验收按顺序执行

## Parallel Example: User Story 1

```text
Task: T013-T016 MPR runtime volume/viewport/load/Crosshairs tests
Task: T017 MprViewportGrid lifecycle test
Task: T018 MprViewerPage loading/return test
Task: T019-T020 Axial/Patient navigation tests
```

## Parallel Example: User Story 2

```text
Task: T035 MprToolbar contract test
Task: T036 ViewportOverlay contract test
Task: T037-T039 runtime tools/VOI/reset tests
Task: T041 page metadata/privacy test
```

## Parallel Example: User Story 3

```text
Task: T053 useMprSeries error/retry tests
Task: T054-T056 runtime classification/partial/cleanup tests
Task: T057 grid retry/unmount tests
Task: T058-T059 page/axial fallback tests
```

## Implementation Strategy

### MVP First (User Story 1)

1. 完成 Setup 和 Foundational。
2. 完成 US1 的共享 volume、三个正交 viewport、Crosshairs/滚轮联动和返回轴位。
3. 运行 US1 定向自动化和 quickstart A-B。
4. 真实三向联动通过后再增加工具和错误分支。

### Incremental Delivery

1. US1：一个共享 volume 的三正交 linked MPR。
2. US2：视图识别、工具、VOI、显隐、metadata 和 reset。
3. US3：eligibility/文件/网络/volume/cleanup 的安全恢复。
4. 全量回归、production build、真实 Chrome A-E 和证据闭环。

## Notes

- 总任务数：78。
- Story 任务数：US1 22（T013-T034），US2 18（T035-T052），US3 16（T053-T068）。
- Setup/Foundation/Polish：22。
- 所有任务符合 `- [ ] T### [P?] [US?] 描述 + 精确文件路径` 格式。
- Feature 完成前不执行 commit、push、merge 或上传。
