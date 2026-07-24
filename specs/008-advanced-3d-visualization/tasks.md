# Tasks: 高级 3D 可视化

## Phase 1: Setup

- [X] T001 在 `frontend/package.json`、`frontend/package-lock.json` 将 `@kitware/vtk.js@36.4.1` 固定为直接依赖，并确认 `npm ls @kitware/vtk.js` 只有该版本
- [X] T002 在 `frontend/src/types/vtk-image-marching-cubes.d.ts` 添加当前 Feature 所需的最小 `ImageMarchingCubes` TypeScript module declaration

## Phase 2: Foundational

- [X] T003 [P] 在 `frontend/src/features/advanced-3d-viewer/model/advanced3dViewer.test.ts` 编写默认状态、preset、方向、阈值 clamp、中点、volume 对角线和 4,000,000 点采样 stride 失败测试
- [X] T004 在 `frontend/src/features/advanced-3d-viewer/model/advanced3dViewer.ts` 实现模式、preset、方向、阈值、物理厚度和采样纯函数并通过 T003
- [X] T005 [P] 在 `frontend/src/features/advanced-3d-viewer/hooks/useAdvanced3dSeries.test.tsx` 编写重新 GET Series、eligibility、imageIds、abort、404/409/410/5xx 和安全未知错误失败测试
- [X] T006 在 `frontend/src/features/advanced-3d-viewer/hooks/useAdvanced3dSeries.ts` 实现独立高级 3D Series hook 并通过 T005
- [X] T007 在 `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.test.ts` 编写单 engine/volume/`ORTHOGRAPHIC` volume viewport、完整帧判定、进度、工具绑定、runtime error、abort 和幂等 cleanup 失败测试
- [X] T008 在 `frontend/src/features/advanced-3d-viewer/core/advanced3dRuntimeTypes.ts`、`frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.ts` 实现共享 runtime 基础并通过 T007

## Phase 3: User Story 1 - 查看可交互体绘制 (P1)

**Independent Test**: eligible CT 从轴位页进入后显示默认骨 preset 的非黑体绘制；骨/软组织/肺、旋转/平移/缩放、reset、返回和重新进入默认状态全部可独立完成。

- [X] T009 [P] [US1] 在 `frontend/src/features/advanced-3d-viewer/components/Advanced3dToolbar.test.tsx` 编写三个模式基础、volume 三 preset、pressed、busy 和 reset 的失败测试
- [X] T010 [US1] 在 `frontend/src/features/advanced-3d-viewer/components/Advanced3dToolbar.tsx` 实现 volume 控制和公共 toolbar 合同并通过 T009
- [X] T011 [P] [US1] 在 `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.test.tsx` 编写 runtime loading/progress/ready、preset、reset、runtime error/retry、unmount 和 imageIds 切换 cleanup 失败测试
- [X] T012 [US1] 在 `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.tsx` 实现 volume runtime 生命周期和安全状态并通过 T011
- [X] T013 [P] [US1] 在 `frontend/src/features/advanced-3d-viewer/pages/Advanced3dViewerPage.test.tsx` 编写 SafetyBanner、元数据、Series loading/error/retry、eligible viewport、blocked 和返回失败测试
- [X] T014 [US1] 在 `frontend/src/features/advanced-3d-viewer/pages/Advanced3dViewerPage.tsx` 实现高级 3D 页面并通过 T013
- [X] T015 [US1] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx` 编写 eligible 双入口、3D 打开/返回、blocked 3D 按钮和轴位降级失败测试
- [X] T016 [US1] 在 `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx` 增加独立高级 3D open state、入口和返回编排并通过 T015
- [X] T017 [US1] 在 `frontend/src/styles/advanced-3d-viewer.css` 实现桌面 viewport+侧栏、820px 窄屏纵向、焦点和状态样式，并在 `frontend/src/app/App.tsx` 导入
- [X] T018 [US1] 运行 `frontend/src/features/advanced-3d-viewer` volume 目标测试、`frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx` 和 `npm run build`，修复 P1 回归
- [X] T019 [US1] 按 `specs/008-advanced-3d-visualization/quickstart.md` 执行 production 单进程 P1 Chrome 验收，记录入口、默认非黑 volume、三 preset、相机、reset、返回、首屏时间、Console 和 Network

## Phase 4: User Story 2 - 使用最大强度投影 (P2)

**Independent Test**: 在同一已加载 CT 中进入 MIP，验证 maximum projection、六方向、自由旋转、至少两个 thickness 和返回上次 volume preset，不依赖 surface。

- [X] T020 [P] [US2] 扩展 `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.test.ts`，添加 maximum blend、`CT-MIP`、slab clamp、六相机方向、自由旋转状态和恢复 volume preset 失败测试
- [X] T021 [US2] 扩展 `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.ts` 实现 MIP mode、方向和物理 thickness 并通过 T020
- [X] T022 [P] [US2] 扩展 `frontend/src/features/advanced-3d-viewer/components/Advanced3dToolbar.test.tsx`，添加六方向、自由视角、range/number thickness、完整体数据和 mode-specific 控件失败测试
- [X] T023 [US2] 扩展 `frontend/src/features/advanced-3d-viewer/components/Advanced3dToolbar.tsx` 实现 MIP 控制并通过 T022
- [X] T024 [P] [US2] 扩展 `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.test.tsx`，添加 MIP mode/direction/thickness/reset、快速切换和旧 callback 保护失败测试
- [X] T025 [US2] 扩展 `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.tsx` 完成 MIP React 编排并通过 T024
- [X] T026 [US2] 运行高级 3D model/runtime/toolbar/viewport/page 目标测试和 `npm run build`，确认 MIP 不创建第二个 volume 或新 DICOM 请求
- [X] T027 [US2] 按 `specs/008-advanced-3d-visualization/quickstart.md` 执行 production P2 Chrome 验收，记录六方向、自由旋转、两个 thickness、≤2 秒模式切换、preset 恢复、Console 和 Network

## Phase 5: User Story 3 - 按阈值重建真实表面 (P3)

**Independent Test**: 同一 CT 以默认 300 HU 和第二阈值生成两个真实 mesh，再用空结果阈值和失败注入验证恢复；MIP 不作为前置操作。

- [X] T028 [P] [US3] 在 `frontend/src/features/advanced-3d-viewer/core/surfaceReconstruction.test.ts` 编写 scalar range、统一 stride、sampled dimensions/spacing、方向 user matrix、normals/merge、actor 材质、empty 和幂等 destroy 失败测试
- [X] T029 [US3] 在 `frontend/src/features/advanced-3d-viewer/core/surfaceReconstruction.ts` 实现采样、`ImageMarchingCubes`、mapper/actor、物理方向和资源所有权并通过 T028
- [X] T030 [P] [US3] 扩展 `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.test.ts`，添加默认阈值不自动计算、surface actor add/replace/hide/show、reset 销毁 surface、empty/error 隔离、volume 保留和 destroy 失败测试
- [X] T031 [US3] 扩展 `frontend/src/features/advanced-3d-viewer/core/advanced3dCornerstone.ts` 接入 surface pipeline、阈值结果和 mode 切换并通过 T030
- [X] T032 [P] [US3] 扩展 `frontend/src/features/advanced-3d-viewer/components/Advanced3dToolbar.test.tsx`，添加阈值 range/number、实际 HU 边界、应用、busy 禁用和 stride 提示失败测试
- [X] T033 [US3] 扩展 `frontend/src/features/advanced-3d-viewer/components/Advanced3dToolbar.tsx` 实现 surface 控制并通过 T032
- [X] T034 [P] [US3] 扩展 `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.test.tsx`，添加首次 surface 只准备阈值、显式应用、requestAnimationFrame yield、递增 token、ready/empty/error、surface reset、重试和切回 volume/MIP 失败测试
- [X] T035 [US3] 扩展 `frontend/src/features/advanced-3d-viewer/components/Advanced3dViewport.tsx` 完成 surface busy/result/error 编排并通过 T034
- [X] T036 [US3] 运行高级 3D 全部目标测试和 `npm run build`，确认直接 vtk 依赖、module declaration、TypeScript 和三模式回归通过
- [X] T037 [US3] 按 `specs/008-advanced-3d-visualization/quickstart.md` 执行 production P3 Chrome 验收，记录两个有效阈值、空 mesh、采样提示、世界方向、≤15 秒结果、失败隔离、Console 和 Network

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T038 [P] 更新 `README.md`、`README.en.md`、`docs/README.md`，把 Feature 008 移入已实现，记录入口、三个模式、浏览器本机计算、表面自动降采样和非临床边界
- [X] T039 运行前端 `npm test -- --run`、`npm run build`、后端 `uv run python -m pytest -q -p no:cacheprovider`、空库 `uv run alembic upgrade head` 和 `git diff --check HEAD`，把准确结果写入 `specs/008-advanced-3d-visualization/quickstart.md`
- [X] T040 执行最终 production 单进程真实浏览器 A–E 验收：410、服务停止、1280×900/820×900、键盘、快速操作、三次进入退出、FastAPI 重启、默认状态和 loopback-only，并写入 `specs/008-advanced-3d-visualization/quickstart.md`
- [X] T041 执行最终代码复核，修复全部 Critical/Important，检查规格覆盖、`tasks.md` 格式、checklist、无未决占位符和资源清理后，把 `specs/008-advanced-3d-visualization/spec.md` 改为 Complete 并勾选全部任务

## Dependencies

- T001–T002 建立 vtk 直接依赖和类型入口；T003/T005 可并行，分别由 T004/T006 闭合。
- T007 依赖 T004 和 T006 的合同，T008 是所有用户故事的共享 runtime 基础。
- US1 依赖 T008；T009/T011/T013 可在接口确定后并行写失败测试，随后 T010/T012/T014，最后 T015→T016→T017→T018→T019。
- US2 依赖 US1 的可用页面和 runtime；T020/T022/T024 可并行写失败测试，随后 T021/T023/T025，最后 T026→T027。
- US3 依赖共享 volume，但不依赖用户执行 MIP；T028 可与 T030/T032/T034 的失败测试准备并行，实施顺序为 T029→T031→T033→T035→T036→T037。
- T038 可在 P3 稳定后并行整理；T039→T040→T041 必须最后顺序执行。

## Parallel Examples

- Foundational：T003 模型测试与 T005 hook 测试使用不同文件，可并行编写。
- US1：T009 toolbar、T011 viewport、T013 page 的失败测试边界独立，可并行准备。
- US2：T020 runtime、T022 toolbar、T024 viewport 的 MIP 失败测试可并行准备。
- US3：T028 surface core 与 T032 toolbar 测试独立；T030/T034 在 runtime surface 合同确定后可并行准备。

## Implementation Strategy

先完成依赖、纯模型、Series hook 和单 volume runtime。P1 交付可独立验收的体绘制页面；P2 仅扩展同一
runtime 的 blend/slab/camera；P3 最后加入独立 surface pipeline，并保证失败不破坏 volume。每个故事都先写
失败测试，再做最小实现和 production 浏览器 checkpoint；最后统一完成双语文档、全量回归和单进程验收。
