# Implementation Plan: 轴位 CT 查看器

**Branch**: `003-axial-viewer` | **Date**: 2026-07-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-axial-viewer/spec.md`

## Summary

在现有 Patient → Study → Series → ordered Instance 数据链上增加单轴位 CT 查看能力。后端新增一个
只接受 Instance 资源 ID 的只读 DICOM 文件接口，将数据库中的相对受管路径安全解析到本机 DICOM
目录；前端以 Cornerstone3D StackViewport 加载既有实例顺序，并提供切片滚动、窗宽窗位、平移、
缩放和重置。查看状态仅存在于当前页面会话，所有失败均使用稳定、无路径泄露的反馈。

## Technical Context

**Language/Version**: Python 3.12；TypeScript 5.9；React 19

**Primary Dependencies**: FastAPI 0.139+、SQLAlchemy 2、pydicom 3、React、Vite、
`@cornerstonejs/core@5.6.8`、`@cornerstonejs/tools@5.6.8`、
`@cornerstonejs/dicom-image-loader@5.6.8`

**Storage**: 复用 SQLite 中的 Patient/Study/Series/Instance 索引和 `data/dicom/` 受管文件；不新增表、
列、缓存或迁移

**Testing**: pytest 9；Vitest；React Testing Library；真实 Chrome + 真实 DICOM fixture

**Target Platform**: Windows 本机桌面浏览器；FastAPI 与 Vite 仅绑定 `127.0.0.1`

**Project Type**: 本机前后端 Web 应用

**Performance Goals**: 单视口交互在正常桌面浏览器中保持连续反馈；切片切换不重新查询 Series，文件按需
加载；验收用本机多切片 Series 首张影像应在 5 秒内出现

**Constraints**: 离线、单用户、非临床；不暴露绝对路径或内部异常；不持久化浏览状态；只读既有
DICOM 数据；不实现 MPR、测量、标注、3D、PACS、DICOMweb、认证或云

**Scale/Scope**: 同时一个查看页、一个 StackViewport、一个 CT Series；典型序列可包含数百张 Instance，
浏览器按需解码，不预先构建体数据

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Safety boundary — PASS**: Patient/Series 入口、查看页、加载、空和错误状态均由现有 sticky
  `SafetyBanner` 持续显示完整非临床提示，查看器不使用遮挡 banner 的全屏覆盖层。
- **Local data boundary — PASS**: image IDs 仅指向同源 `/api/instances/{id}/file`；后端只读取本机
  受管文件，不引入远程 URL、遥测或外部服务。
- **Scope and stack — PASS**: 使用宪章锁定的 React/TypeScript/Vite/Cornerstone3D/FastAPI/
  SQLAlchemy/SQLite/pydicom 技术栈；排除认证、云、PACS、DICOMweb、报告、测量、MPR 和 3D。
- **Modularity and minimal change — PASS**: 文件接口、存储解析、Cornerstone adapter、viewport、hook、
  toolbar 和 page 分责；不修改现有导入分类、排序或数据库结构。
- **Verification — PASS**: 计划包含后端路径/API 测试、前端 adapter/hook/component/page 测试、全量
  自动化、production build 和真实 Chrome/DICOM 验收。
- **DICOM consistency — PASS**: 本功能只读既有索引和文件；失败不得跳过、删除、覆盖或修复数据，
  因此不会改变 `002` 的五类报告和数据库/文件一致性规则。

**Pre-research gate result**: 全部 PASS，无阻断项。

## Project Structure

### Documentation (this feature)

```text
specs/003-axial-viewer/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── instance-file.openapi.yaml
├── checklists/
│   ├── requirements.md
│   └── viewer-quality.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── api/
│   │   ├── __init__.py
│   │   └── instances.py
│   ├── core/errors.py
│   ├── main.py
│   └── services/
│       ├── instance_service.py
│       └── managed_storage.py
└── tests/
    ├── contract/test_openapi_contract.py
    ├── integration/test_instance_file_api.py
    └── unit/test_managed_storage_read.py

frontend/
├── package.json
├── package-lock.json
└── src/
    ├── app/App.tsx
    ├── features/
    │   ├── axial-viewer/
    │   │   ├── api/axialViewerApi.ts
    │   │   ├── components/
    │   │   │   ├── AxialViewport.tsx
    │   │   │   └── ViewerToolbar.tsx
    │   │   ├── core/cornerstone.ts
    │   │   ├── hooks/useAxialSeries.ts
    │   │   ├── model/axialViewer.ts
    │   │   └── pages/AxialViewerPage.tsx
    │   ├── dicom-import/components/StudyList.tsx
    │   └── patients/pages/PatientManagementPage.tsx
    └── styles/axial-viewer.css
```

测试与被测前端文件放在同一 feature 目录，沿用现有项目约定。

**Structure Decision**: 保持现有 `backend/` + `frontend/` 双项目结构。后端 API、服务和存储安全分层；
前端以 `axial-viewer` feature 聚合 API、状态、Cornerstone adapter、组件和页面，避免把影像库细节混入
病人管理页。

## Phase 0: Research Outcomes

研究结论见 [research.md](research.md)。所有依赖版本、StackViewport 初始化、工具绑定、文件资源接口、
错误映射和测试隔离问题均已解决，无 `NEEDS CLARIFICATION`。

## Phase 1: Design Outcomes

- 数据和状态设计：[data-model.md](data-model.md)
- 新增 HTTP 合同：[contracts/instance-file.openapi.yaml](contracts/instance-file.openapi.yaml)
- 真实验证指南：[quickstart.md](quickstart.md)

## Post-Design Constitution Check

- **Safety boundary — PASS**: 设计持续复用 `AppShell`/`SafetyBanner`，没有全屏遮挡。
- **Local data boundary — PASS**: 合同只有 loopback server 和本机 Instance 资源；image ID 不接受远程地址。
- **Scope and stack — PASS**: 仅新增三个同版本 Cornerstone3D 必需包；未预装 MPR、分割、测量或 3D 功能。
- **Modularity and minimal change — PASS**: 无数据库迁移；新增文件均有单一职责，现有文件只增加入口和注册。
- **Verification — PASS**: quickstart 包含自动化、build、真实 DICOM/Chrome、错误和 loopback 验收。
- **DICOM consistency — PASS**: 文件接口严格只读；任何错误都不变更数据库和文件。

**Post-design gate result**: 全部 PASS，可进入任务生成。

## Complexity Tracking

无宪章违规，不需要复杂度豁免。
