# Implementation Plan: 联动 CT 三视图 MPR

**Branch**: `004-three-view-mpr` | **Date**: 2026-07-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-three-view-mpr/spec.md`

## Summary

在已完成的单轴位 CT 查看器中增加“进入三视图”，使用同一套有序本机 DICOM image IDs 创建一个
streaming CT volume，并由三个正交二维 viewport 共享。CrosshairsTool 负责世界坐标联动，runtime 内部
监听负责三视图 VOI 同步；平移和缩放保持 viewport 独立。MPR 进入时重新获取并校验 Series，失败可重试
或返回仍可使用的轴位页，退出时取消请求并释放 volume、viewport、tool 和监听资源。

## Technical Context

**Language/Version**: TypeScript 5.9；React 19；现有 Python 3.12 后端不改代码

**Primary Dependencies**: 复用 `@cornerstonejs/core@5.6.8`、`@cornerstonejs/tools@5.6.8`、
`@cornerstonejs/dicom-image-loader@5.6.8`、React、Vite；不新增直接依赖

**Storage**: 只读现有 SQLite Patient/Study/Series/Instance 索引和 `data/dicom/` 受管文件；不新增表、
字段、迁移、缓存目录或持久化查看状态

**Testing**: Vitest、React Testing Library、既有 pytest 全量回归、真实 Chrome + 真实已脱敏 DICOM CT

**Target Platform**: Windows 本机桌面 Chrome；FastAPI 与 Vite 只绑定 `127.0.0.1`

**Project Type**: 本机前后端 Web 应用；本功能为纯前端 volume viewer 扩展

**Performance Goals**: 验收 Series 从进入 MPR 到三个非黑正交视图可见不超过 8 秒；交互提供连续可见
反馈；一次 session 只创建一个 volume 和三个 viewport

**Constraints**: 离线、单用户、非临床；不暴露绝对路径、内部资源 ID或异常堆栈；不持久化 MPR 状态；
只读既有 DICOM；不加入测量、标注、分割、3D、PACS、DICOMweb、认证、云或新 E2E 框架

**Scale/Scope**: 同时一个 MPR 页面、一个 CT volume、三个二维正交 viewport 和一个元数据面板；典型
Series 为数百张切片，按 streaming loader 加载，失败不修改数据库或文件

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Safety boundary — PASS**: MPR 页继续使用 `AppShell`/`SafetyBanner`；入口、加载、错误和窄屏状态均在
  banner 下方，不使用遮挡提示的全屏层。
- **Local data boundary — PASS**: 继续使用同源 Series 和 Instance file 资源；volume、像素、元数据和
  网络请求保留在本机，不引入远程 URL、遥测或外部服务。
- **Scope and stack — PASS**: 使用宪章锁定的 React/TypeScript/Vite/Cornerstone3D；不新增依赖，不改变
  后端，不加入认证、云、PACS、DICOMweb、报告、测量、分割或 3D。
- **Modularity and minimal change — PASS**: eligibility、hook、runtime、grid、toolbar、page 和 style 分责；
  只对轴位初始化模块导出中性复用能力，对轴位页增加入口，不重构无关 Patient/DICOM 代码。
- **Verification — PASS**: 计划包含纯函数、hook、adapter、组件、页面、全量回归、production build 和
  真实 Chrome/DICOM 三向联动验收。
- **DICOM consistency — PASS**: MPR 全流程只读，失败不得跳过、删除、覆盖或修复 Instance 和受管文件，
  不改变 `002` 五类导入报告和一致性规则。

**Pre-research gate result**: 全部 PASS，无阻断项。

## Project Structure

### Documentation (this feature)

```text
specs/004-three-view-mpr/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── mpr-ui.md
├── checklists/
│   ├── requirements.md
│   └── mpr-quality.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
└── tests/                              # 只运行现有全量回归；无产品代码改动

frontend/src/
├── app/App.tsx                         # 导入 MPR 样式
├── features/
│   ├── axial-viewer/
│   │   ├── core/cornerstone.ts         # 导出初始化模块和按 imageId 取消请求能力
│   │   └── pages/AxialViewerPage.tsx   # MPR 入口、不可用原因和返回编排
│   └── mpr-viewer/
│       ├── components/
│       │   ├── MprToolbar.tsx
│       │   ├── MprViewportGrid.tsx
│       │   └── ViewportOverlay.tsx
│       ├── core/mprCornerstone.ts
│       ├── hooks/useMprSeries.ts
│       ├── model/mprViewer.ts
│       └── pages/MprViewerPage.tsx
└── styles/mpr-viewer.css
```

前端测试与被测文件放在同一 feature 目录，沿用现有约定。MPR 不进入 `PatientManagementPage` 的数据或
工具职责；该页继续只管理一个 `AxialViewerContext`。

**Structure Decision**: 保持 `backend/` + `frontend/` 双项目结构，在现有轴位 feature 旁新增独立
`mpr-viewer`。MPR 复用 Series/API/imageId 和初始化边界，但不把 volume lifecycle 追加进已较大的轴位
adapter；不创建通用 viewer 框架或提前抽象不存在的第五个 feature。

## Phase 0: Research Outcomes

研究结论见 [research.md](research.md)。已解决 streaming volume 创建/完成判定、三正交 viewport、
Crosshairs 工具模式、VOI 同步、两阶段 eligibility、错误分类、XHR 取消、缓存清理和 5.6.8 已知事件陷阱。
无 `NEEDS CLARIFICATION`。

## Phase 1: Design Outcomes

- 数据和会话状态：[data-model.md](data-model.md)
- 用户界面与状态合同：[contracts/mpr-ui.md](contracts/mpr-ui.md)
- 自动化与真实浏览器验证：[quickstart.md](quickstart.md)

## Post-Design Constitution Check

- **Safety boundary — PASS**: UI 合同要求所有 MPR 状态复用完整非临床提示，grid/overlay 不可遮挡。
- **Local data boundary — PASS**: 合同不新增网络接口，quickstart 要求 Network 100% loopback。
- **Scope and stack — PASS**: 设计只使用已锁定 Cornerstone 包的 volume viewport/Crosshairs 公共 API，
  明确排除 3D、测量、标注、分割和远程功能。
- **Modularity and minimal change — PASS**: 数据模型只含临时会话实体；无迁移、无后端改动、无新依赖；
  已知 synchronizer 清理缺陷通过小型可清理 VOI listener 避免。
- **Verification — PASS**: quickstart 覆盖自动化、build、真实三个非黑视图、三向联动、工具、失败、
  cleanup、restart 和 loopback。
- **DICOM consistency — PASS**: 所有失败和退出均只释放前端会话资源，不写入或修改持久化数据。

**Post-design gate result**: 全部 PASS，可进入任务生成。

## Complexity Tracking

无宪章违规，不需要复杂度豁免。
