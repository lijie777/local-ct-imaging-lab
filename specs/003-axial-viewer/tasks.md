---

description: "Implementation tasks for the local axial CT viewer"
---

# Tasks: 轴位 CT 查看器

**Input**: Design documents from `/specs/003-axial-viewer/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: pytest、Vitest/React Testing Library 和真实 Chrome 验收均为强制门禁。每个 Story 先写失败测试，
再实现最小代码并验证。

**Organization**: Tasks are grouped by user story so each story remains independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可与相邻任务并行，文件不重叠且不依赖未完成结果
- **[Story]**: 对应 spec.md 的 User Story
- 所有任务包含精确文件路径

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 锁定依赖、确认基线并建立 feature 目录

- [x] T001 在 `frontend/package.json` 和 `frontend/package-lock.json` 安装并锁定 `@cornerstonejs/core@5.6.8`、`@cornerstonejs/tools@5.6.8`、`@cornerstonejs/dicom-image-loader@5.6.8`
- [x] T002 [P] 在 `frontend/src/features/axial-viewer/` 下建立 `api/`、`components/`、`core/`、`hooks/`、`model/`、`pages/` 文件边界
- [x] T003 [P] 运行并记录变更前后端基线测试到 `specs/003-axial-viewer/quickstart.md`
- [x] T004 [P] 校验 `specs/003-axial-viewer/contracts/instance-file.openapi.yaml` 可解析且仅声明 loopback server

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 建立所有 Story 共用的安全路径、前端类型和 Cornerstone 初始化边界

**⚠️ CRITICAL**: 本阶段完成前不得进入 User Story 实现

- [x] T005 [P] 在 `backend/tests/unit/test_managed_storage_read.py` 添加合法相对 DICOM 路径、Windows 绝对路径和 `..` 逃逸的失败测试
- [x] T006 在 `backend/app/services/managed_storage.py` 实现只读 `resolve_dicom_file()` 并通过 T005 与既有存储测试
- [x] T007 [P] 在 `frontend/src/features/axial-viewer/model/axialViewer.ts` 定义 `AxialViewerContext`、`ViewerTool` 和前端状态类型
- [x] T008 [P] 在 `frontend/src/features/axial-viewer/api/axialViewerApi.test.ts` 添加同源 Instance `wadouri:` image ID、URL 编码和无远程地址输入测试
- [x] T009 在 `frontend/src/features/axial-viewer/api/axialViewerApi.ts` 实现 Series 详情复用和 Instance image ID 构造并通过 T008
- [x] T010 [P] 在 `frontend/src/features/axial-viewer/core/cornerstone.test.ts` 添加三库只初始化一次和 worker 上限测试
- [x] T011 在 `frontend/src/features/axial-viewer/core/cornerstone.ts` 实现 Cornerstone3D 单次初始化并通过 T010
- [x] T012 运行 `backend/tests/unit/test_managed_storage_read.py` 与 `frontend/src/features/axial-viewer/api/axialViewerApi.test.ts`、`core/cornerstone.test.ts`，确认 Foundational 全部通过

**Checkpoint**: 安全本机资源 URL 和 Cornerstone 初始化边界已就绪

---

## Phase 3: User Story 1 - 打开并连续浏览轴位 CT 序列 (Priority: P1) 🎯 MVP

**Goal**: 从 eligible Series 打开独立查看页，显示中间切片，并通过滚轮和按钮完整浏览有序 stack

**Independent Test**: 导入至少三张 eligible CT，打开后显示中间切片和正确计数，滚轮/按钮可到达首尾且不越界，退出返回原病人上下文

### Tests for User Story 1 (MANDATORY)

- [x] T013 [P] [US1] 在 `backend/tests/integration/test_instance_file_api.py` 添加 eligible Instance 返回 `application/dicom` 且 bytes 与受管文件一致的失败测试
- [x] T014 [P] [US1] 在 `backend/tests/contract/test_openapi_contract.py` 添加 Instance 文件路径、operationId、binary 响应和资源参数的失败合同测试
- [x] T015 [P] [US1] 在 `frontend/src/features/dicom-import/components/StudyList.test.tsx` 添加 eligible Series 打开回调及 Patient/Study/Series 参数测试
- [x] T016 [P] [US1] 在 `frontend/src/features/axial-viewer/hooks/useAxialSeries.test.tsx` 添加 loading、按响应顺序生成 image IDs、空实例和取消旧请求测试
- [x] T017 [P] [US1] 在 `frontend/src/features/axial-viewer/components/AxialViewport.test.tsx` 添加奇数/偶数/单张中间索引、切片计数和卸载 cleanup 测试
- [x] T018 [P] [US1] 在 `frontend/src/features/axial-viewer/components/ViewerToolbar.test.tsx` 添加上一张/下一张首尾禁用和 `current / total` 文本测试
- [x] T019 [P] [US1] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx` 添加上下文摘要、无 UUID 泄露、加载状态、返回行为和 SafetyBanner 测试
- [x] T020 [P] [US1] 在 `frontend/src/features/patients/pages/PatientManagementPage.dicom.test.tsx` 添加从选中病人 Series 打开查看页并返回原详情的失败流程测试

### Implementation for User Story 1

- [x] T021 [US1] 在 `backend/app/core/errors.py` 增加 `InstanceNotFoundError` 并把 `instance_id` 加入公共验证字段
- [x] T022 [US1] 在 `backend/app/services/instance_service.py` 实现 eligible Instance 查询与只读受管文件解析
- [x] T023 [US1] 在 `backend/app/api/instances.py` 实现 `GET /instances/{instance_id}/file` 的 `FileResponse(application/dicom)`
- [x] T024 [US1] 在 `backend/app/api/__init__.py` 注册 Instances router
- [x] T025 [US1] 在 `backend/app/main.py` 增加 Instances tag、InstanceId 参数、错误枚举和 Instance 文件 OpenAPI 响应合同
- [x] T026 [US1] 在 `backend/tests/integration/test_instance_file_api.py` 与 `backend/tests/contract/test_openapi_contract.py` 运行 T013-T014 并修正最小合同差异
- [x] T027 [US1] 在 `frontend/src/features/dicom-import/components/StudyList.tsx` 增加 `onOpenSeries(study, series)` 并只为 eligible Series显示可用入口
- [x] T028 [US1] 在 `frontend/src/features/axial-viewer/hooks/useAxialSeries.ts` 实现 Series 详情加载、AbortController、ordered image IDs 和 reload
- [x] T029 [US1] 在 `frontend/src/features/axial-viewer/core/cornerstone.ts` 定义 `AxialViewportRuntime` 并实现单 StackViewport 创建、`setStack` 中间索引、wheel StackScroll、索引事件和 destroy
- [x] T030 [US1] 在 `frontend/src/features/axial-viewer/components/ViewerToolbar.tsx` 实现上一张、下一张和文字切片计数
- [x] T031 [US1] 在 `frontend/src/features/axial-viewer/components/AxialViewport.tsx` 集成 runtime、currentIndex、边界控制、resize 和卸载 cleanup
- [x] T032 [US1] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx` 实现查看页上下文、加载/空状态、viewport 和返回入口
- [x] T033 [US1] 在 `frontend/src/features/patients/pages/PatientManagementPage.tsx` 增加临时 `AxialViewerContext` 页面切换且不持久化状态
- [x] T034 [US1] 在 `frontend/src/styles/axial-viewer.css` 实现独立深色单视口、摘要区、切片控制和不遮挡 sticky SafetyBanner 的响应式布局
- [x] T035 [US1] 在 `frontend/src/app/App.tsx` 引入 `frontend/src/styles/axial-viewer.css`
- [x] T036 [US1] 运行 US1 后端/前端定向测试，确认所有新增测试 PASS 且既有 StudyList/病人 DICOM 流程无回归
- [x] T037 [US1] 按 `specs/003-axial-viewer/quickstart.md` A-B 段执行真实 Chrome MVP 验收并记录 5 秒内首图、中间切片、切片顺序、计数、返回和 loopback 证据

**Checkpoint**: User Story 1 可独立演示为单轴位切片浏览 MVP

---

## Phase 4: User Story 2 - 调整影像显示并恢复默认视图 (Priority: P2)

**Goal**: 提供互斥的窗宽窗位、平移、缩放工具和完整重置

**Independent Test**: 在任意 eligible Series 上依次产生灰度、位置和比例变化，重置后恢复初始中间切片和默认视图，退出重开不恢复旧状态

### Tests for User Story 2 (MANDATORY)

- [x] T038 [P] [US2] 在 `frontend/src/features/axial-viewer/core/cornerstone.test.ts` 添加四个工具只注册一次、wheel stack scroll 和 primary 工具互斥绑定测试
- [x] T039 [P] [US2] 在 `frontend/src/features/axial-viewer/components/ViewerToolbar.test.tsx` 添加三种工具 active 文本/ARIA 状态和重置回调测试
- [x] T040 [P] [US2] 在 `frontend/src/features/axial-viewer/components/AxialViewport.test.tsx` 添加 activateTool、previous/next、reset 回到 initialIndex 和 runtime error 测试
- [x] T041 [P] [US2] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx` 添加退出重开不恢复工具/切片状态的页面编排测试

### Implementation for User Story 2

- [x] T042 [US2] 在 `frontend/src/features/axial-viewer/core/cornerstone.ts` 注册 WindowLevel、Pan、Zoom、StackScroll 工具并实现 tool group 的 wheel/primary 绑定
- [x] T043 [US2] 在 `frontend/src/features/axial-viewer/core/cornerstone.ts` 实现 runtime `activateTool()`、`previous()`、`next()` 和 reset 的 properties/camera/index 恢复
- [x] T044 [US2] 在 `frontend/src/features/axial-viewer/components/ViewerToolbar.tsx` 增加窗宽窗位、平移、缩放、重置按钮和当前工具标识
- [x] T045 [US2] 在 `frontend/src/features/axial-viewer/components/AxialViewport.tsx` 集成 activeTool、runtime 工具切换、重置和安全错误状态
- [x] T046 [US2] 在 `frontend/src/styles/axial-viewer.css` 增加工具 active、focus-visible、禁用和窄屏换行样式
- [x] T047 [US2] 运行 US2 定向 Vitest/RTL，确认工具互斥、滚轮、重置和重新打开默认状态全部 PASS
- [x] T048 [US2] 按 `specs/003-axial-viewer/quickstart.md` C 段执行真实 Chrome 工具验收并记录窗宽窗位、平移、缩放和重置的可见证据

**Checkpoint**: User Stories 1-2 均可独立验证，且未加入测量、标注或多视口

---

## Phase 5: User Story 3 - 安全、可理解的不可查看与失败反馈 (Priority: P3)

**Goal**: 阻止 unsupported Series，并稳定处理未知实例、路径异常、文件缺失、解码失败和服务失败

**Independent Test**: 使用 unsupported Series、未知 Instance、移除受管文件和停止服务，所有场景均显示可理解错误、重试/返回能力且不泄露路径或修改数据

### Tests for User Story 3 (MANDATORY)

- [x] T049 [P] [US3] 在 `backend/tests/integration/test_instance_file_api.py` 添加未知 Instance 404、unsupported 409、文件缺失 410 和非法 UUID 422 测试
- [x] T050 [P] [US3] 在 `backend/tests/integration/test_instance_file_api.py` 添加数据库 managed_path 绝对路径、目录逃逸和目录外目标均返回 sanitized 500 的测试
- [x] T051 [P] [US3] 在 `backend/tests/integration/test_instance_file_api.py` 断言所有错误响应不包含 `managed_path`、临时目录、SQLite 文本或内部异常
- [x] T052 [P] [US3] 在 `frontend/src/features/dicom-import/components/StudyList.test.tsx` 添加 unsupported 按钮禁用、稳定原因和回调不触发测试
- [x] T053 [P] [US3] 在 `frontend/src/features/axial-viewer/hooks/useAxialSeries.test.tsx` 添加 series_not_found、unsupported、空实例、网络失败和 retry 测试
- [x] T054 [P] [US3] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx` 添加文件缺失、解码失败、本机服务失败、安全文案、返回/重试、已加载切片仍可导航和无路径/UUID/堆栈测试
- [x] T055 [P] [US3] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx` 添加返回、重试、切片、工具、重置的键盘可达名称和非颜色状态测试

### Implementation for User Story 3

- [x] T056 [US3] 在 `backend/app/core/errors.py` 增加 `SeriesNotViewableError` 和 `ManagedDicomFileMissingError`
- [x] T057 [US3] 在 `backend/app/services/instance_service.py` 区分 unknown、unsupported、missing 和 unsafe/persistence，并保持全流程只读
- [x] T058 [US3] 在 `backend/app/main.py` 与 `backend/tests/contract/test_openapi_contract.py` 固定 404/409/410/422/500 组件引用及公开错误码
- [x] T059 [US3] 在 `frontend/src/features/axial-viewer/hooks/useAxialSeries.ts` 将 Series API 失败、unsupported 和 empty 映射为稳定中文状态
- [x] T060 [US3] 在 `frontend/src/features/axial-viewer/core/cornerstone.ts` 将 loader/runtime 原始错误转换为无 codec 堆栈的“无法解码该影像”回调，且单张失败不销毁仍可用 stack
- [x] T061 [US3] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx` 实现可重试错误、不可重试状态、已加载切片仍可导航和始终可用的返回入口
- [x] T062 [US3] 在 `frontend/src/features/dicom-import/components/StudyList.tsx` 完成 unsupported disabled/accessibility 状态且持续显示 `viewability_reason`
- [x] T063 [US3] 在 `frontend/src/features/axial-viewer/components/ViewerToolbar.tsx` 和 `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx` 补齐键盘名称、focus 和非颜色状态文本
- [x] T064 [US3] 运行 US3 后端/前端定向测试，确认失败类别、隐私、重试、返回和 accessibility 全部 PASS
- [x] T065 [US3] 按 `specs/003-axial-viewer/quickstart.md` D 段执行真实 Chrome unsupported、文件缺失、服务失败、恢复和非临床提示验收

**Checkpoint**: 全部三个 User Story 可独立验证，错误不会改变既有索引或文件

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 全量回归、合同同步、真实验收和完成状态闭环

- [x] T066 [P] 更新 `specs/003-axial-viewer/contracts/instance-file.openapi.yaml` 使其与最终运行时 endpoint、错误码和 `application/dicom` 响应一致
- [x] T067 [P] 复核 `specs/003-axial-viewer/checklists/requirements.md` 与 `specs/003-axial-viewer/checklists/viewer-quality.md`，仅在规格仍满足时保持全部勾选
- [x] T068 运行 `backend/` 全量 pytest 并把测试数量和结果写入 `specs/003-axial-viewer/quickstart.md`
- [x] T069 运行 `frontend/` 全量 Vitest/RTL 并把测试数量和结果写入 `specs/003-axial-viewer/quickstart.md`
- [x] T070 运行 `frontend/npm run build` 并把 TypeScript/Vite production build 结果写入 `specs/003-axial-viewer/quickstart.md`
- [x] T071 使用独立临时 SQLite、受管 DICOM 目录和真实 DICOM fixture 完整执行 `specs/003-axial-viewer/quickstart.md` A-D 真实 Chrome 路径
- [x] T072 记录 Chrome 版本、Console、Network loopback、截图、临时证据目录和 unsupported/missing-file 恢复结果到 `specs/003-axial-viewer/quickstart.md`
- [x] T073 停止临时服务并确认 `127.0.0.1:8000` 与 `127.0.0.1:5173` 无监听，将结果写入 `specs/003-axial-viewer/quickstart.md`
- [x] T074 只有 T068-T073 全部通过后，勾选 `specs/003-axial-viewer/tasks.md` 全部任务并把 `specs/003-axial-viewer/spec.md` 状态更新为 `Complete`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖
- **Foundational (Phase 2)**: 依赖 Setup，阻断所有 User Story
- **US1 (Phase 3)**: 依赖 Foundational；提供 MVP 文件资源和 StackViewport
- **US2 (Phase 4)**: 依赖 US1 runtime/toolbar，可在 US1 完成后独立验证工具
- **US3 (Phase 5)**: 依赖 US1 文件/页面基础；错误测试可与 US2 测试文件不重叠部分并行设计，但实现按顺序执行
- **Polish (Phase 6)**: 依赖 US1-US3 完成

### User Story Dependencies

- **US1 (P1)**: 基础完成后可独立交付，建议 MVP
- **US2 (P2)**: 复用 US1 viewport runtime，不改变 US1 切片浏览合同
- **US3 (P3)**: 扩展 US1 的安全错误边界，不依赖 US2 的显示工具正确性

### Within Each User Story

- 测试必须先写并确认失败
- 后端路径/服务先于 endpoint 注册
- 前端 adapter/hook 先于 viewport/page
- 定向自动化 PASS 后才执行该 Story 的真实 Chrome checkpoint
- 不执行 commit、push、merge 或上传

### Parallel Opportunities

- T005、T007、T008、T010 使用不同文件，可并行设计
- US1 的 T013-T020 测试文件大部分不重叠，可并行编写
- US2 的 T038-T041 可并行编写
- US3 的后端 T049-T051 与前端 T052-T055 可并行编写
- T066-T067 可并行复核；全量测试和真实 Chrome 验收按顺序执行

## Parallel Example: User Story 1

```text
Task: T013 backend Instance file integration test
Task: T015 StudyList eligible entry test
Task: T016 useAxialSeries ordering/cancellation test
Task: T017 AxialViewport middle-index/cleanup test
Task: T019 AxialViewerPage context/safety test
```

## Parallel Example: User Story 3

```text
Task: T049-T051 backend error/privacy tests
Task: T052 StudyList unsupported test
Task: T053 hook retry/error tests
Task: T054-T055 page failure/accessibility tests
```

## Implementation Strategy

### MVP First (User Story 1)

1. 完成 Setup 和 Foundational。
2. 完成 US1 测试、文件 endpoint、StackViewport、切片控制和页面切换。
3. 运行 US1 定向自动化和 quickstart A-B。
4. US1 通过后再增加工具和错误分支。

### Incremental Delivery

1. US1：可靠打开和浏览切片。
2. US2：窗宽窗位、平移、缩放和重置。
3. US3：unsupported、缺失、解码、服务、安全与 accessibility。
4. 全量回归、production build、真实 Chrome 和证据闭环。

## Notes

- 总任务数：74。
- Story 任务数：US1 25（T013-T037），US2 11（T038-T048），US3 17（T049-T065）。
- Setup/Foundation/Polish：21。
- 所有任务符合 `- [ ] T### [P?] [US?] 描述 + 精确文件路径` 格式。
- Feature 完成前不执行 commit、push、merge 或上传。

---

## Phase 7: Convergence

**Purpose**: 关闭独立 review 发现的错误语义、卸载生命周期和不可查看原因可理解性缺口

- [x] T075 [US3] 在 `frontend/src/features/axial-viewer/core/cornerstone.test.ts`、`frontend/src/features/axial-viewer/core/cornerstone.ts` 和 `frontend/src/features/axial-viewer/components/AxialViewport.tsx` 增加 404/409/410/422/500、本机网络失败与真实解码失败的稳定安全分类，并验证 410 不再显示为解码失败 per FR-017/SC-005 (partial)
- [x] T076 [US1] 在 `frontend/src/features/axial-viewer/components/AxialViewport.test.tsx`、`frontend/src/features/axial-viewer/core/cornerstone.test.ts`、`frontend/src/features/axial-viewer/components/AxialViewport.tsx` 和 `frontend/src/features/axial-viewer/core/cornerstone.ts` 为初始加载加入 `AbortSignal`、XHR 取消和幂等 runtime 清理，并验证 pending `setStack()` 期间卸载立即释放资源 per FR-020 (partial)
- [x] T077 [US3] 在 `frontend/src/features/dicom-import/components/StudyList.test.tsx`、`frontend/src/features/dicom-import/components/StudyList.tsx`、`frontend/src/features/axial-viewer/hooks/useAxialSeries.test.tsx` 和 `frontend/src/features/axial-viewer/hooks/useAxialSeries.ts` 将稳定 `viewability_reason` 码映射为可理解中文文案并保留未知码安全兜底 per FR-002/FR-017 (partial)
