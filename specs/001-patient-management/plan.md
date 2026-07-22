# Implementation Plan: 病人管理

**Branch**: `001-patient-management` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-patient-management/spec.md`

**Reference Design**: [本地医疗 CT 病人管理与三视图预览系统设计](../../docs/superpowers/specs/2026-07-16-medical-ct-viewer-design.md)，本计划只采用其中与病人管理直接相关的边界

## Summary

在本机实现一个单用户病人管理 Web 功能：React 19、TypeScript、Vite 和原生 CSS 负责病人列表、
搜索、详情、创建、编辑与删除确认；Python 3.12、FastAPI、SQLAlchemy 2 和 SQLite 负责权威校验、
规范化唯一性、稳定排序、真实删除与重启持久化。前后端通过 loopback REST API 通信，Python 环境
由 `uv` 管理。当前功能不安装或引用 DICOM、Cornerstone3D、PACS、认证、云服务及其他影像能力。

## Technical Context

**Language/Version**: Python 3.12；TypeScript 5.x；React 19；现代浏览器 JavaScript

**Primary Dependencies**: FastAPI、Uvicorn、SQLAlchemy 2、Pydantic、Alembic；React、React DOM、
Vite；生产前端使用原生 Fetch、原生 `<dialog>` 和原生 CSS，不引入 UI 组件库、表单库、状态库、
路由库、Axios 或 CSS 框架

**Storage**: SQLite 文件位于项目根目录的本机运行数据目录 `data/patient-management.sqlite3`；
`MEDICAL_CT_APP_DATA_DIR` 仅作为运行和测试覆盖入口；数据库、WAL/SHM 文件全部排除出 Git

**Testing**: 后端使用 pytest、HTTPX/FastAPI TestClient 和 `tmp_path` 临时 SQLite 文件；前端使用
Vitest、jsdom、React Testing Library、`@testing-library/user-event`；完整浏览器验收按
`quickstart.md` 人工执行和记录，不增加 Playwright、Cypress 或其他端到端框架

**Target Platform**: Windows 10/11 本机；前端浏览器和后端均只使用 loopback，后端绑定
`127.0.0.1:8000`，Vite 绑定 `127.0.0.1:5173` 并将相对 `/api` 代理到后端

**Project Type**: 本地前后端分离 Web 应用

**Performance Goals**: 单用户本机 CRUD、详情和搜索操作在常规开发机器上无明显等待；当前规格未
定义并发、分页或吞吐 SLA，因此不引入缓存、后台队列、分页或异步数据库栈

**Constraints**: 本机离线、单用户、无登录、无外部服务；后端是校验和唯一性的最终权威；所有完整
页面持续显示非临床声明，三个覆盖式界面内重复显示完整声明；失败时不得伪造成功或丢失表单输入；
内部 UUID 不渲染到界面

**Scale/Scope**: 一个 Patient 实体、五个 REST 接口、一个病人管理页面、列表/详情/加载/空/错误状态、
创建/编辑/删除三个覆盖式界面；第一阶段返回完整数组，不做分页、并发编辑、软删除或影像数据

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

### Gate 1 — 研究前检查

| 宪章门禁 | 结果 | 计划依据 |
| --- | --- | --- |
| 教学演示与非临床边界 | PASS | `SafetyBanner` 在应用外壳中持续显示；创建、编辑、删除对话框内重复完整声明 |
| 本地离线、单用户与数据驻留 | PASS | loopback REST、项目本机 `data/` SQLite、无遥测、无外部服务 |
| 第一版范围与技术栈 | PASS | 使用批准的 React/TypeScript/Vite/FastAPI/SQLAlchemy/SQLite；本功能明确不安装影像依赖 |
| 小模块、明确职责与最小改动 | PASS | API、业务服务、数据库、模型、schema、前端 API、状态 hook、组件和纯校验函数分离 |
| 分层测试与端到端验收 | PASS | pytest、Vitest/RTL 和八步浏览器验收均进入计划 |
| DICOM 可追踪与存储一致性 | N/A | 当前功能不接收、索引或删除 DICOM；真实删除只作用于 Patient 记录 |

研究前无门禁失败项，不需要 Complexity Tracking 例外。

### Gate 2 — 设计后复核

| 宪章门禁 | 结果 | 设计复核 |
| --- | --- | --- |
| 非临床声明完整覆盖 | PASS | 列表、空状态、搜索、无结果、加载、错误和详情均处于 `AppShell`；所有模态内部重复横幅 |
| 数据不离开本机 | PASS | OpenAPI 只声明 `127.0.0.1:8000`，`security: []`，无云端或远程 URL |
| 范围和依赖最小 | PASS | 未设计 DICOM、查看器、PACS、认证、云、报告、测量或 3D；前端无第三方 UI/状态/表单依赖 |
| 模块职责和事务边界 | PASS | router 只处理 HTTP，service 负责业务规则与事务，SQLAlchemy 模型负责持久化形状 |
| 测试和验收可执行 | PASS | 数据模型、OpenAPI、Quickstart 和固定验收记录表均已生成，无未解决占位符 |
| DICOM 生命周期 | N/A | `study_count=0`、`latest_study_date=null` 为响应层固定派生值，不创建影像表或文件流程 |

设计后仍无宪章违规，可以进入 `/speckit-tasks` 阶段。

## Project Structure

### Documentation (this feature)

```text
specs/001-patient-management/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── openapi.yaml
├── checklists/
│   ├── requirements.md
│   └── completeness.md
└── tasks.md                 # 由 /speckit-tasks 后续生成，本阶段不创建
```

### Source Code (repository root)

```text
backend/
├── pyproject.toml
├── uv.lock
├── alembic.ini
├── alembic/
│   ├── env.py
│   └── versions/
│       └── <initial_patient_schema>.py
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── api/
│   │   └── patients.py
│   ├── core/
│   │   ├── config.py
│   │   └── errors.py
│   ├── db/
│   │   ├── base.py
│   │   └── session.py
│   ├── models/
│   │   └── patient.py
│   ├── schemas/
│   │   └── patient.py
│   └── services/
│       ├── patient_service.py
│       └── patient_validation.py
└── tests/
    ├── conftest.py
    ├── unit/
    │   └── test_patient_validation.py
    ├── integration/
    │   ├── test_patient_api.py
    │   └── test_patient_persistence.py
    └── migration/
        └── test_alembic_upgrade.py

frontend/
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx
    ├── app/
    │   ├── App.tsx
    │   └── AppShell.tsx
    ├── components/
    │   ├── SafetyBanner.tsx
    │   └── ModalDialog.tsx
    ├── features/
    │   └── patients/
    │       ├── api/
    │       │   └── patientApi.ts
    │       ├── model/
    │       │   ├── patient.ts
    │       │   ├── patientValidation.ts
    │       │   └── patientFormatters.ts
    │       ├── hooks/
    │       │   ├── usePatientList.ts
    │       │   └── usePatientDetail.ts
    │       ├── pages/
    │       │   └── PatientManagementPage.tsx
    │       └── components/
    │           ├── PatientSearchForm.tsx
    │           ├── PatientList.tsx
    │           ├── PatientDetails.tsx
    │           ├── PatientFormDialog.tsx
    │           ├── DeletePatientDialog.tsx
    │           └── PatientPageState.tsx
    ├── styles/
    │   ├── global.css
    │   └── patients.css
    └── test/
        └── setup.ts

data/
└── patient-management.sqlite3   # 运行时生成并被 Git 忽略
```

**Structure Decision**: 采用 `frontend/` 与 `backend/` 两个顶层目录。后端不增加通用 Repository、
Unit of Work 或领域事件框架；单个 `patient_service.py` 在显式 SQLAlchemy Session 中完成查询、校验、
`flush`、提交和回滚。前端不预建 DICOM 目录或通用插件机制，只保留当前 Patient 功能所需模块。

## Architecture and Responsibility Boundaries

### Backend

- `api/patients.py`：解析 HTTP、注入 Session、调用 service、选择响应 schema；不写业务校验或 SQL。
- `schemas/patient.py`：定义 JSON 形状、类型和序列化；后端 service 仍是业务规则最终权威。
- `services/patient_validation.py`：实现 trim、可见字符、控制字符、casefold、出生日期和枚举规则。
- `services/patient_service.py`：实现搜索、稳定排序、唯一性预检查、事务、真实删除与异常转换。
- `models/patient.py`：只声明表、唯一索引、排序索引和数据库约束。
- `db/session.py`：创建 Engine/Session、SQLite 连接参数和数据目录，不包含 Patient 规则。
- `core/errors.py`：统一 `422/404/409/500` 错误体，不向用户泄露 SQL、路径或堆栈。

### Frontend

- `AppShell` 始终渲染应用级 `SafetyBanner`；加载、空、搜索、错误、列表和详情都不能绕开外壳。
- `PatientManagementPage` 只编排选择、状态和覆盖界面，不包含 HTTP、校验算法或大段字段格式化。
- `PatientFormDialog` 使用受控草稿；失败保留全部输入，仅成功或明确取消时清除。
- 创建、编辑和删除使用原生 `<dialog>`，内部始终复用完整 `SafetyBanner`，不依赖 z-index 保证可见性。
- `patientApi.ts` 使用原生 Fetch 和 AbortController，统一解析字段错误并丢弃过期搜索响应。
- 后端返回已排序列表，前端保持服务器顺序，不做第二套排序规则。

## Data and Request Flow

```text
用户输入
→ 前端即时格式校验
→ POST/PATCH localhost REST
→ Pydantic 请求形状校验
→ service 执行业务校验与规范化
→ SQLAlchemy flush 暴露唯一约束
→ SQLite 事务提交
→ PatientRead 返回规范值与 UTC 时间
→ 前端使用服务器结果更新详情并刷新列表
```

失败路径不做乐观更新。`422` 和 `409` 映射到具体字段；`404` 显示资源已不存在；持久化失败返回
稳定的 `500 persistence_error`，表单或删除确认保持打开，列表和详情保持原有可见状态。

## Testing Strategy

### Backend pytest

- 纯函数测试字段 trim、长度、控制字符、casefold、性别和出生日期。
- 使用 `tmp_path` 下的真实 SQLite 文件验证 CRUD、规范化唯一性、搜索、LIKE 字符转义和稳定排序。
- 关闭第一套 app/engine 后用同一临时文件重建，验证创建/编辑保留及删除不恢复。
- 注入固定 UTC 时钟制造相同 `updated_at`，验证第二排序键。
- 模拟 flush/commit 失败，验证回滚、错误码和数据库状态不变。
- 单独验证 Alembic 能从空数据库升级到 head；普通测试可用 metadata 快速建表。
- 验证 FastAPI `/openapi.json` 与 `contracts/openapi.yaml` 的路径、方法、关键 schema 和状态码一致。

### Frontend Vitest/RTL

- 测试列表、空状态、搜索结果、无结果、加载、错误和详情都显示完整声明。
- 测试三个 `<dialog>` 内重复声明、可访问名称、焦点进入/恢复和删除初始焦点。
- 测试即时字段校验、性别中文映射、UTC 时间显示、八项详情信息和 UUID 不可见。
- 测试 `422/409/500` 后表单保持打开并保留原始草稿；成功或明确取消才清除。
- 测试搜索清除、旧请求取消、服务器排序保持、删除取消不请求、删除失败不移除病人。

### Browser Acceptance

不新增 E2E 框架。实现完成后按 `quickstart.md` 的八步路径在真实浏览器执行，记录环境、Git SHA、
SQLite 路径、每步实际结果、Pass/Fail 和截图路径。组件测试不能替代对真实 CSS 遮挡、浏览器
`<dialog>` top layer 和服务重启持久性的验收。
