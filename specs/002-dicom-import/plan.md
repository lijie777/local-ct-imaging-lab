# Implementation Plan: DICOM 导入与持久化

**Branch**: `002-dicom-import` | **Date**: 2026-07-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-dicom-import/spec.md`

## Summary

在现有本地病人管理应用中增加真实 CT DICOM 文件/文件夹导入、Study/Series/Instance 索引、
五类逐文件报告、检查/序列列表、重启持久化和病人删除时的受管文件清理。后端把上传文件流式写入
本机临时目录，使用 pydicom 延迟读取大值且不解码像素，按 Study 分组执行独立事务；SQLite 保存
结构化元数据和相对受管路径，原始 `.dcm` 文件保存在 `data/dicom/`。前端复用现有病人详情和原生
dialog，增加文件/文件夹选择、导入状态、报告及检查列表，不初始化 Cornerstone3D。

## Technical Context

**Language/Version**: Python 3.12；TypeScript 5.x；React 19；现代浏览器 JavaScript

**Primary Dependencies**: 现有 FastAPI、Uvicorn、SQLAlchemy 2、Pydantic、Alembic、React、Vite；
新增 `pydicom` 用于 DICOM 元数据读取，新增 `python-multipart` 用于浏览器本机文件上传；不新增
任务队列、缓存、状态库、表单库、UI 组件库或影像查看依赖

**Storage**: SQLite 保存 Patient、Study、Series、Instance 元数据和相对受管路径；原始 DICOM 文件
保存在 `data/dicom/{patient_uuid}/{study_uid}/{series_uid}/{sop_uid}.dcm`；请求临时文件保存在
`data/.imports/{session_uuid}` 并在请求结束后清理

**Testing**: 后端 pytest、FastAPI TestClient、真实临时 SQLite 和 pydicom 动态生成的已脱敏小型 CT
fixtures；前端 Vitest、jsdom、React Testing Library 和 user-event；最终使用真实浏览器与独立临时
数据目录执行完整导入/重启/删除路径，不新增 E2E 框架

**Target Platform**: Windows 10/11 本机；前端 `127.0.0.1:5173`，后端 `127.0.0.1:8000`，全部数据
和日志留在本机

**Project Type**: 本地前后端分离 Web 应用

**Performance Goals**: 在常规开发机器上以流式方式处理至少 50 个 CT 实例，不把整套像素数据载入
内存；用户能在一次同步操作中得到完整五类报告；当前规格不定义并发吞吐或后台队列 SLA

**Constraints**: 本机离线、单用户、非临床；每个输入文件必须唯一分类；按 Study 部分成功；
数据库与受管文件在导入和删除失败后保持一致；不泄露绝对路径；不显示像素或实现查看器

**Scale/Scope**: 一个已有 Patient 实体加 Study、Series、Instance 三个持久化实体；一个 multipart
导入入口、三个检查查询入口、一个导入 dialog、一个导入报告和一个检查/序列列表；不做分页、
后台任务、断点续传或跨设备导入

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| 宪章门禁 | 研究前 | 设计后依据 |
| --- | --- | --- |
| 教学演示与非临床边界 | PASS | AppShell 继续显示固定完整提示；导入 dialog 内重复提示；检查列表、报告、加载和错误状态不绕开 AppShell |
| 本地离线、单用户与数据驻留 | PASS | 仅使用 loopback multipart/REST；SQLite、临时文件、受管 DICOM 和日志均在配置的数据目录或本机测试目录 |
| 第一版范围与技术栈 | PASS | 引入宪章批准的 pydicom；python-multipart 是 FastAPI 接收浏览器文件的最小必要解析依赖；本 Feature 不初始化 Cornerstone3D，也不加入排除能力 |
| 小模块、明确职责与最小改动 | PASS | 解析、受管存储、事务编排、查询、API、前端 API/状态/视图分别独立；只扩展 Patient 汇总和删除生命周期所必需的文件 |
| 分层测试与端到端验收 | PASS | 纯解析/存储单测、真实 SQLite 集成/迁移/合同测试、前端行为测试和真实浏览器验收全部进入任务范围 |
| DICOM 导入可追踪与存储一致性 | PASS | 五类互斥计数、逐文件原因、按 Study 事务、失败补偿、重复保护、重启和删除一致性均在数据模型、合同和 Quickstart 中定义 |

无门禁失败，不需要 Complexity Tracking 例外。

## Project Structure

### Documentation (this feature)

```text
specs/002-dicom-import/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── openapi.yaml
├── checklists/
│   ├── requirements.md
│   └── dicom-lifecycle.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── pyproject.toml
├── alembic/versions/
│   └── 002_create_dicom_index.py
├── app/
│   ├── api/
│   │   ├── dicom_import.py
│   │   └── studies.py
│   ├── core/config.py
│   ├── db/
│   │   ├── base.py
│   │   └── session.py
│   ├── models/
│   │   ├── patient.py
│   │   ├── study.py
│   │   ├── series.py
│   │   └── instance.py
│   ├── schemas/
│   │   ├── patient.py
│   │   └── dicom_import.py
│   └── services/
│       ├── dicom_parser.py
│       ├── managed_storage.py
│       ├── dicom_import.py
│       ├── study_service.py
│       └── patient_service.py
└── tests/
    ├── dicom_factory.py
    ├── unit/
    │   ├── test_dicom_parser.py
    │   └── test_managed_storage.py
    ├── integration/
    │   ├── test_dicom_import_api.py
    │   ├── test_dicom_import_service.py
    │   ├── test_study_api.py
    │   └── test_patient_dicom_delete.py
    ├── migration/test_alembic_upgrade.py
    └── contract/test_openapi_contract.py

frontend/src/features/dicom-import/
├── api/
│   ├── dicomImportApi.ts
│   └── dicomImportApi.test.ts
├── components/
│   ├── DicomImportDialog.tsx
│   ├── DicomImportDialog.test.tsx
│   ├── ImportReport.tsx
│   ├── ImportReport.test.tsx
│   ├── StudyList.tsx
│   └── StudyList.test.tsx
├── hooks/
│   ├── usePatientStudies.ts
│   └── usePatientStudies.test.tsx
└── model/dicomImport.ts
```

**Structure Decision**: 继续使用 `backend/` 与 `frontend/` 两个顶层目录。后端不增加通用 Repository、
Unit of Work 或后台任务框架；现有显式 Session 服务继续作为事务边界。DICOM 解析不依赖 ORM，
受管存储不理解 HTTP，导入服务编排两者。前端把新功能限制在 `features/dicom-import/`，病人页面只
增加入口和状态编排。

## Architecture and Responsibility Boundaries

### Backend

- `dicom_parser.py`：延迟读取大值，只访问标签，不访问或解码 PixelData 值；返回纯数据解析结果。
- `managed_storage.py`：临时会话、路径包含性、原子移动、当前操作清理、删除暂存/恢复/清除。
- `dicom_import.py`：五类映射、Study 分组、PatientID 规则、重复判断、事务和补偿。
- `study_service.py`：确定排序的 Study/Series/Instance 只读查询，不暴露绝对路径。
- `patient_service.py`：Patient CRUD、动态检查摘要和删除全生命周期；不解析 DICOM。
- API 层只负责 HTTP 形状、依赖注入和稳定错误映射。

multipart 路由只异步分块读取 UploadFile；完成临时落盘后，通过框架线程池执行同步 pydicom 解析、
受管文件变更和 SQLAlchemy Session 事务，避免阻塞事件循环。

### Frontend

- `DicomImportDialog` 只管理浏览器文件对象、提交状态、错误和焦点；失败保留选择，成功/明确关闭清理。
- `ImportReport` 只展示五类计数和逐文件结果。
- `StudyList` 只展示检查、序列摘要及加载/空/错误状态。
- `dicomImportApi.ts` 负责 multipart 和查询请求；不设置 multipart Content-Type，不解析 DICOM。
- `usePatientStudies` 负责取消旧请求、病人切换清理和成功导入后的刷新。
- `PatientManagementPage` 继续编排 Patient 选择、详情和 dialog，不复制导入规则。

## Data and Request Flow

```text
浏览器选择文件/目录
→ multipart 上传到 loopback FastAPI
→ 分块写入 data/.imports/{session}
→ pydicom 延迟读取元数据（不解码像素）
→ 文件级预分类
→ 按 Study UID 分组并核对 PatientID
→ 检查重复 SOP UID 与已有 Study/Series 所属病人
→ 写入 data/dicom/... 暂存目标并原子移动
→ flush/commit Study、Series、Instance
→ 失败时 rollback 并清理当前 Study 本次新增文件
→ 返回五类报告
→ 前端刷新 Patient 摘要和 Study/Series 列表
```

删除路径先把病人受管目录原子移动到删除暂存区，再提交数据库级联删除，最后清除暂存目录；失败时
按设计执行目录恢复或数据库快照补偿，不报告伪成功。

## Testing Strategy

### Backend pytest

- pydicom 动态生成最小已脱敏 CT 文件，避免测试依赖仓库中的真实患者数据。
- 纯单元测试解析类别、UID/日期/数值转换、PixelData 不解码和路径包含性。
- 真实临时 SQLite 验证模型、唯一索引、外键级联、Study 分组、重复、部分成功和重启。
- 故障注入覆盖临时写入、文件移动、flush/commit、删除暂存、清除和补偿失败。
- Alembic 从全新空库升级到最新 head，并验证数据库结构不包含像素 BLOB。
- 设计 OpenAPI 与运行时 OpenAPI 的新增路径、schema、状态码和错误枚举保持一致。

### Frontend Vitest/RTL

- 文件/目录输入、空选择、导入中禁用、焦点进入/恢复和完整免责声明。
- multipart FormData、错误映射、失败后选择和报告保留、成功后清理并刷新。
- 五类计数和非成功原因、Study/Series 加载/空/失败/不可查看状态。
- Patient 检查数量和最近日期更新；现有创建、搜索、编辑和删除行为回归。

### Browser Acceptance

不新增 Playwright/Cypress。使用已脱敏 CT fixture 和独立临时数据目录，在真实 Chrome 中完成
Quickstart 的完整路径；记录数据库路径、受管目录、五类计数、重启、删除、网络和截图/日志证据。

## Complexity Tracking

无宪章违规。按 Study 事务和删除补偿比整批单事务复杂，但它们直接满足宪章规定的部分成功、既有
数据保护及数据库/文件一致性，不属于未来扩展。
