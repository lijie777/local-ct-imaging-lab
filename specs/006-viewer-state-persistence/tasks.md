# Tasks: 查看器状态持久化

## Phase 1: Setup

- [X] T001 在 `backend/tests/migration/test_alembic_upgrade.py` 添加 `viewer_states` 表、主键、版本/时间约束和 Series cascade FK 的失败断言
- [X] T002 [P] 在 `backend/tests/integration/test_viewer_state_api.py` 添加 GET/PUT/DELETE、重启、幂等、边界、错误安全和级联删除失败测试
- [X] T003 [P] 在 `backend/tests/contract/test_openapi_contract.py` 添加 viewer-state 三个 operation 与 200/204/404/422/500 合同失败断言

## Phase 2: Foundational

- [X] T004 实现 `backend/app/models/viewer_state.py`、`backend/alembic/versions/003_create_viewer_states.py` 及 `backend/app/db/base.py`、`backend/app/models/series.py` 一对一关系并通过 T001
- [X] T005 实现严格 viewer-state DTO、2 MiB/500 条/有限数值/allowlist 校验和事务服务，写入 `backend/app/schemas/viewer_state.py`、`backend/app/services/viewer_state_service.py`
- [X] T006 实现 `/api/series/{series_id}/viewer-state` GET/PUT/DELETE 与安全错误合同，写入 `backend/app/api/viewer_states.py`、`backend/app/api/__init__.py`、`backend/app/main.py` 并通过 T002–T003
- [X] T007 [P] 在 `frontend/src/features/viewer-state/model/viewerState.test.ts`、`frontend/src/features/viewer-state/api/viewerStateApi.test.ts` 编写 v1 codec、未知键/版本/工具、非有限数值、point/text/count/size 边界和 API 映射失败测试
- [X] T008 实现受限 DTO、defensive parser 和本机 GET/PUT/DELETE client，写入 `frontend/src/features/viewer-state/model/viewerState.ts`、`frontend/src/features/viewer-state/api/viewerStateApi.ts` 并通过 T007
- [X] T009 [P] 在 `frontend/src/features/viewer-state/core/viewerStateWriter.test.ts` 编写 500 ms debounce、latest-wins、in-flight queue、flush、keepalive、retry、clear/destroy 失败测试
- [X] T010 实现 `frontend/src/features/viewer-state/core/viewerStateWriter.ts` 写入状态机并通过 T009
- [X] T011 [P] 在 `frontend/src/features/viewer-state/core/annotationPersistence.test.ts` 和 `frontend/src/features/viewer-annotations/core/annotationTools.test.ts` 编写四类 allowlist capture/hydrate、Crosshairs 排除、point/label/textBox、统计重算、render 与恢复抑制失败测试
- [X] T012 实现 `frontend/src/features/viewer-state/core/annotationPersistence.ts` 并扩展 `frontend/src/features/viewer-annotations/core/annotationTools.ts` 的安全 capture/restore 接口，通过 T011

## Phase 3: User Story 1 - 恢复轴位查看状态 (P1)

**Independent Test**: 修改同一 Series 的轴位切片、工具、灰度、相机和四类 annotation，退出、刷新和服务重启后全部恢复；另一 Series 保持默认。

- [X] T013 [US1] 在 `frontend/src/features/axial-viewer/core/cornerstone.test.ts` 编写 capture/apply 顺序、索引夹取、校准工具回退、事件触发和恢复抑制失败测试
- [X] T014 [P] [US1] 在 `frontend/src/features/axial-viewer/components/AxialViewport.test.tsx` 编写 Series load、writer schedule/flush、恢复状态、保存失败降级和 Series 隔离失败测试
- [X] T015 [US1] 在 `frontend/src/features/axial-viewer/core/cornerstone.ts` 实现公开 presentation/VOI/切片/工具/annotation 的 capture/apply 与精确监听清理，通过 T013
- [X] T016 [US1] 在 `frontend/src/features/axial-viewer/components/AxialViewport.tsx`、`frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx` 接入 seriesId、load/writer/flush 和非阻塞状态，通过 T014

## Phase 4: User Story 2 - 恢复 MPR 联动状态 (P2)

**Independent Test**: 改变三个 viewport、Crosshairs、工具、灰度、相机和 annotation，退出/刷新/重启后恢复，Crosshairs 不作为普通 annotation 重复。

- [X] T017 [US2] 在 `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts` 编写三视图 capture/apply、setToolCenter、可见性、工具、annotation、恢复顺序/抑制和缺失 image 跳过失败测试
- [X] T018 [P] [US2] 在 `frontend/src/features/mpr-viewer/components/MprViewportGrid.test.tsx` 编写共享 Series writer、轴位状态保留、MPR 恢复/保存/flush 和错误降级失败测试
- [X] T019 [US2] 在 `frontend/src/features/mpr-viewer/core/mprRuntimeTypes.ts`、`frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 实现三视图 capture/apply 和安全 Crosshairs 恢复，通过 T017
- [X] T020 [US2] 在 `frontend/src/features/mpr-viewer/components/MprViewportGrid.tsx`、`frontend/src/features/mpr-viewer/pages/MprViewerPage.tsx` 接入 seriesId、共享 payload、writer/flush 和恢复状态，通过 T018

## Phase 5: User Story 3 - 清除与安全降级 (P3)

**Independent Test**: 有保存状态时重置并重新进入/重启仍为默认；旧版本、损坏和超限状态不阻止影像；删除 Patient 后状态记录为零。

- [X] T021 [P] [US3] 在 `frontend/src/features/viewer-state/components/ViewerStateStatus.test.tsx` 编写 loading/restored/saving/saved/error/partial/cleared、重试/清除焦点与非临床边界失败测试
- [X] T022 [US3] 在轴位和 MPR 组件测试中补充重置清除 annotation + DELETE + 默认重入、GET 损坏/旧版本降级和 DELETE 失败可重试测试，写入 `frontend/src/features/axial-viewer/components/AxialViewport.test.tsx`、`frontend/src/features/mpr-viewer/components/MprViewportGrid.test.tsx`
- [X] T023 [US3] 实现 `frontend/src/features/viewer-state/components/ViewerStateStatus.tsx`、`frontend/src/styles/viewer-state.css` 并在 `frontend/src/app/App.tsx`、轴位/MPR 重置路径接入删除和安全提示，通过 T021–T022
- [X] T024 [US3] 运行 `backend/tests/integration/test_viewer_state_api.py` 的 Patient cascade、损坏/超限/安全 404/422/500 和重启路径，确认全部通过

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T025 [P] 更新 `README.md`、`README.en.md`、`docs/README.md`，将 Feature 006 移入已实现并保持 007/008 为未完成
- [X] T026 运行完整前端 `npm test -- --run`、`npm run build`、后端 `uv run python -m pytest -q -p no:cacheprovider` 和空库 `uv run alembic upgrade head`，记录准确结果到 `specs/006-viewer-state-persistence/quickstart.md`
- [X] T027 执行 production 单进程真实浏览器 E2E：轴位/MPR 跨退出/刷新/服务重启恢复、双 Series 隔离、四类 annotation、Crosshairs、重置删除、损坏状态、Patient 级联、1280×900/820×900、console/network，并写入 `specs/006-viewer-state-persistence/quickstart.md`
- [X] T028 修复最终审查发现的 annotation 归属/上限、annotations-only 恢复、退出 flush/DELETE 和 image identity 缺口；重跑 `git diff --check`、规格覆盖与任务格式检查后关闭本 Feature

## Dependencies

- T001–T003 先写失败证据；T004–T006 顺序闭合后端基础。
- T007→T008，T009→T010，T011→T012；三条前端基础链可独立推进，但同文件修改顺序执行。
- US1 依赖 T004–T012；US2 依赖 US1 的共享 payload 语义和 T012；US3 依赖 US1/US2 reset 接口。
- T025 可与 US3 代码并行；T026→T027→T028 必须最后顺序执行。

## Parallel Examples

- T002、T003、T007、T009、T011 触及不同测试文件，可在不写共享源文件时并行设计。
- T014 与 T017 可在 T012 接口固定后并行；T018 与后端补充测试可并行。

## Implementation Strategy

先完成后端持久化和共享前端 codec/writer/annotation adapter，再交付可独立验收的轴位恢复
(US1)，随后复用同一状态边界完成 MPR (US2)，最后闭合重置、损坏状态和级联删除 (US3)。
