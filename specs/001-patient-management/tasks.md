# Tasks: Patient Management

**Input**: `specs/001-patient-management/spec.md`, `plan.md`, `research.md`,
`data-model.md`, `contracts/openapi.yaml`, `quickstart.md` and
`.specify/memory/constitution.md`

**Scope**: 仅实现本地、单用户、非临床的病人管理。不得引入 DICOM、Cornerstone3D、
PACS、登录、云服务、影像查看或新的端到端测试框架。

**Testing rule**: 每个 User Story 都先编写并确认对应 pytest 或 Vitest/React Testing
Library 测试失败，再进行最小实现；后端始终是字段校验和唯一性规则的最终权威。

## Task notation

- `[P]`：可与同阶段内其他标记为 `[P]` 且不写同一文件的任务并行。
- `[US1]`、`[US2]`、`[US3]`：任务所属 User Story。
- 每项任务都给出需要创建、修改或记录结果的准确文件路径。

---

## Phase 1: 项目与测试环境初始化

**Goal**: 建立可复现的 Python 3.12/uv 与 React 19/Vite 测试环境，并排除本地运行产物。

- [X] T001 [P] 创建或更新 `.gitignore`，至少排除 `.superpowers/`、`data/*.sqlite3`、`data/*.sqlite3-wal`、`data/*.sqlite3-shm`、`data/*.sqlite3-journal`、`backend/.venv/`、`__pycache__/`、`*.py[cod]`、`.pytest_cache/`、`frontend/node_modules/` 和 `frontend/dist/`
- [X] T002 [P] 使用 Python 3.12 和 uv 初始化后端依赖与 pytest 配置，加入 FastAPI、普通 `uvicorn`（不使用 `uvicorn[standard]`）、SQLAlchemy 2、Alembic、HTTPX 和 pytest，并生成 `backend/pyproject.toml`、`backend/.python-version`、`backend/uv.lock`
- [X] T003 [P] 初始化 React 19、TypeScript、Vite、Vitest、jsdom、React Testing Library 和 `@testing-library/user-event`，使用原生 CSS 且不加入 UI 组件库，生成 `frontend/package.json`、`frontend/package-lock.json`、`frontend/index.html`、`frontend/tsconfig.json`、`frontend/vite.config.ts`

**Checkpoint**: 后端和前端依赖均可安装，测试命令可启动且不会收集本地数据库或构建产物。

---

## Phase 2: 前后端基础设施

**Goal**: 建立所有 User Story 共用的数据库会话、应用入口、错误格式、迁移框架、测试夹具和前端应用壳。

- [X] T004 [P] 实现仅绑定本机运行数据目录 `data/patient-management.sqlite3` 的配置、SQLite engine 和显式 Session 工厂，并支持测试覆盖数据库 URL，写入 `backend/app/core/config.py`、`backend/app/db/session.py`
- [X] T005 [P] 创建 FastAPI 应用工厂、`/api` 路由挂载点及病人路由骨架，写入 `backend/app/__init__.py`、`backend/app/main.py`、`backend/app/api/__init__.py`、`backend/app/api/patients.py`
- [X] T006 [P] 实现统一 `ErrorResponse` 及 FastAPI 请求校验错误处理器，稳定映射 `404 patient_not_found`、`409 medical_record_no_conflict`、`500 persistence_error`，并确保响应不泄露 SQL、文件路径、堆栈或内部异常，写入 `backend/app/core/errors.py`
- [X] T007 [P] 配置 Alembic 使用应用 metadata 和可覆盖的数据库 URL，创建 `backend/alembic.ini`、`backend/alembic/env.py`、`backend/alembic/script.py.mako`
- [X] T008 基于临时 SQLite 数据库提供隔离的 engine、Session、FastAPI TestClient 和数据清理夹具，写入 `backend/tests/conftest.py`；依赖 T004、T005
- [X] T009 [P] 创建 React 入口、应用壳骨架和全局原生 CSS，写入 `frontend/src/main.tsx`、`frontend/src/app/App.tsx`、`frontend/src/styles/global.css`
- [X] T010 [P] 配置 Vitest/jsdom、React Testing Library 清理与 loopback `/api` Vite proxy，写入 `frontend/vite.config.ts`、`frontend/src/test/setup.ts`

**Checkpoint**: FastAPI 测试客户端和前端组件测试环境均可运行；浏览器端只通过 loopback `/api` 访问后端。

---

## Phase 3: User Story 1 — 创建、详情和重启持久化 (Priority: P1) 🎯 MVP

**Goal**: 用户能在空列表创建病人、查看完整详情，并在后端重启后看到数据仍存在。

**Independent Test**: 从空临时/本地数据库启动，仅执行本阶段测试；创建一个虚构病人，验证列表和详情字段、免责声明、UUID 隐藏及后端重启后的持久化，不需要搜索、编辑或删除功能。

### Tests for User Story 1 — 必须先编写并确认失败

- [X] T011 [P] [US1] 编写后端失败单元测试，覆盖病历号与姓名必填/长度并拒绝换行符及控制字符；病历号只去除首尾空白且保留内部空格和符号，姓名保留内部空格和标点；验证 `casefold` 等价值唯一性、任意不晚于今天的有效历史日期可接受、未来日期被拒绝、性别枚举与 `unknown` 默认值，并要求编辑复用创建时的完整字段校验矩阵，写入 `backend/tests/unit/test_patient_validation.py`
- [X] T012 [P] [US1] 编写后端失败 API 测试，覆盖 POST 创建成功并实际返回 `Location` header、GET 完整列表、GET 详情、统一 422 字段错误和等价病历号 409；分别对 GET 列表、POST、GET 详情注入持久化故障，验证实际运行时返回统一 `500 persistence_error` 且不泄露内部信息，并验证响应不泄露规范化字段，写入 `backend/tests/integration/test_patient_api.py`
- [X] T013 [P] [US1] 编写 Alembic 从全新空 SQLite 数据库升级到 head 的失败测试，检查 patients 表、`medical_record_no_normalized` 唯一索引、`ix_patients_stable_sort`、`ck_patients_sex` 和 `ck_patients_timestamp_order`，写入 `backend/tests/migration/test_alembic_upgrade.py`
- [X] T014 [P] [US1] 编写创建事务提交、关闭并重新建立 engine/Session 后仍能读取同一病人的失败持久化测试，写入 `backend/tests/integration/test_patient_persistence.py`
- [X] T015 [P] [US1] 编写设计合同与 FastAPI 运行时 OpenAPI 一致性的失败测试，以 `specs/001-patient-management/contracts/openapi.yaml` 为基准覆盖公共 Patient schema、统一 `ErrorResponse`、GET `/api/patients` 的 200/500、POST `/api/patients` 的 201/409/422/500 及 `Location` header、GET `/api/patients/{id}` 的 200/404/422/500，并核对全部请求、响应和错误结构，写入 `backend/tests/contract/test_openapi_contract.py`
- [X] T016 [P] [US1] 编写前端失败单元测试，覆盖与后端一致的即时字段校验、性别中文显示、日期时间显示及空检查字段显示，写入 `frontend/src/features/patients/model/patientValidation.test.ts`、`frontend/src/features/patients/model/patientFormatters.test.ts`
- [X] T017 [P] [US1] 编写前端失败 API 测试，覆盖列表、创建、详情请求，422/409/404/网络错误映射及错误响应不清空调用方数据，写入 `frontend/src/features/patients/api/patientApi.test.ts`
- [X] T018 [P] [US1] 编写前端失败组件测试，覆盖病人列表、空列表、加载、操作失败、病人详情和创建 dialog；所有页面状态持续显示完整免责声明，创建 dialog 具有明确可访问名称、内部重复完整免责声明、打开后焦点进入 dialog、关闭后焦点恢复到创建触发按钮；详情显示八项指定信息且不显示 UUID，创建失败后 dialog 与全部输入保持，写入 `frontend/src/features/patients/pages/PatientManagementPage.create-detail.test.tsx`

### Minimal implementation for User Story 1

- [X] T019 [P] [US1] 实现 Patient SQLAlchemy 2 模型、内部 UUID、UTC `created_at`/`updated_at`、`medical_record_no_normalized` 唯一索引、`ix_patients_stable_sort`、`ck_patients_sex` 和 `ck_patients_timestamp_order`；模型不得包含 `study_count` 或 `latest_study_date` 数据库列，写入 `backend/app/db/base.py`、`backend/app/models/patient.py`
- [X] T020 [P] [US1] 实现病历号/姓名/性别/出生日期的后端规范化与最终权威校验函数，写入 `backend/app/services/patient_validation.py`
- [X] T021 [US1] 实现创建、列表、详情和错误响应所需 Pydantic schema，确保 API 可使用内部 UUID 定位但不返回 `medical_record_no_normalized`；在响应层将 `study_count` 固定派生为 0、`latest_study_date` 固定派生为 `null`，两者不进入数据库迁移，写入 `backend/app/schemas/patient.py`；依赖 T020
- [X] T022 [US1] 创建初始 patients 表迁移，包含 UUID 主键、原始与规范化病历号、姓名、性别、出生日期、UTC 时间戳、`medical_record_no_normalized` 唯一索引、`ix_patients_stable_sort`、`ck_patients_sex` 和 `ck_patients_timestamp_order`，且不得创建 `study_count` 或 `latest_study_date` 列，写入 `backend/alembic/versions/001_create_patients.py`；依赖 T019
- [X] T023 [US1] 实现创建、完整列表和按 UUID 获取详情的显式 Session 服务，创建时执行校验、唯一冲突映射、flush/commit/refresh 和异常 rollback；构造响应时将 `study_count` 固定派生为 0、`latest_study_date` 固定派生为 `null`，不持久化两者，写入 `backend/app/services/patient_service.py`；依赖 T019–T021
- [X] T024 [US1] 实现 POST/GET `/api/patients` 与 GET `/api/patients/{id}`，覆盖合同规定的 201/200/404/409/422/500、统一 `ErrorResponse` 和 `500 persistence_error`，POST 成功时实际返回 `Location` header，并将路由接入应用，写入 `backend/app/api/patients.py`、`backend/app/main.py`；依赖 T006、T023
- [X] T025 [P] [US1] 实现 Patient、创建输入、API 错误类型，以及与后端一致的前端即时校验和中文格式化，写入 `frontend/src/features/patients/model/patient.ts`、`frontend/src/features/patients/model/patientValidation.ts`、`frontend/src/features/patients/model/patientFormatters.ts`
- [X] T026 [P] [US1] 实现应用级固定完整免责声明横幅、原生 `<dialog>` 覆盖层及应用壳；ModalDialog 必须支持明确可访问名称、打开后把焦点移入 dialog、关闭后恢复到触发按钮，并在创建 dialog 内重复完整免责声明，写入 `frontend/src/components/SafetyBanner.tsx`、`frontend/src/components/ModalDialog.tsx`、`frontend/src/app/AppShell.tsx`
- [X] T027 [US1] 使用原生 Fetch 实现列表、创建和详情客户端及统一错误映射，写入 `frontend/src/features/patients/api/patientApi.ts`；依赖 T025
- [X] T028 [US1] 实现列表/详情加载、成功和错误状态管理，忽略已取消请求且不丢失现有表单数据，写入 `frontend/src/features/patients/hooks/usePatientList.ts`、`frontend/src/features/patients/hooks/usePatientDetail.ts`；依赖 T027
- [X] T029 [US1] 实现病人列表、空/加载/错误状态、详情八项用户可见信息和创建 dialog，写入 `frontend/src/features/patients/pages/PatientManagementPage.tsx`、`frontend/src/features/patients/components/PatientList.tsx`、`frontend/src/features/patients/components/PatientDetails.tsx`、`frontend/src/features/patients/components/PatientPageState.tsx`、`frontend/src/features/patients/components/PatientFormDialog.tsx`；依赖 T025、T026、T028
- [X] T030 [US1] 将病人管理页接入应用并补齐仅服务本 Story 的响应式原生 CSS，写入 `frontend/src/app/App.tsx`、`frontend/src/styles/patients.css`；依赖 T029
- [X] T031 [US1] 运行并修正本阶段全部自动化测试，确认先前失败的创建、详情、迁移、运行时合同、免责声明和重启持久化测试全部通过；必要修正仅限 `backend/tests/`、`backend/app/`、`frontend/src/features/patients/`、`frontend/src/components/` 中本 Story 涉及文件
- [X] T032 [US1] 按独立测试路径执行 MVP 浏览器 checkpoint，并在 `specs/001-patient-management/quickstart.md` 的验收记录中填写空列表、创建、详情和一次重启持久化的实际结果与证据路径

**Checkpoint**: US1 可独立演示和测试；这是首个可交付 MVP。

---

## Phase 4: User Story 2 — 搜索和编辑 (Priority: P2)

**Goal**: 用户能按病历号或姓名子串搜索病人，并编辑已有病人且可靠处理冲突和失败。

**Independent Test**: 通过后端夹具或预置 API 数据准备一个 Patient，仅执行本阶段测试；验证搜索、稳定排序和编辑成功/失败，无需依赖 US1 的创建 UI 或 US3 删除 UI。

### Tests for User Story 2 — 必须先编写并确认失败

- [X] T033 [P] [US2] 编写后端失败测试，覆盖搜索文本去除首尾空白、病历号与姓名中的英文字母不区分大小写、字面量 `%`/`_` 转义、空搜索恢复完整列表、PATCH 部分更新和 casefold 唯一冲突，并要求编辑复用创建时全部字段校验；使用固定时钟构造相同 `updated_at` 数据集，比较初次查询与重新建立 engine/Session 后完整 Patient ID 顺序完全一致；同时覆盖编辑异常事务 rollback 及重启后保留修改，写入 `backend/tests/integration/test_patient_search_and_edit.py`
- [X] T034 [P] [US2] 扩展失败合同与运行时测试，以 `specs/001-patient-management/contracts/openapi.yaml` 为基准验证 GET `/api/patients?q=...` 参数及 PATCH `/api/patients/{id}` 的请求、响应、统一 `ErrorResponse` 和 200/404/409/422/500；通过故障注入验证实际 PATCH 持久化失败返回统一 `500 persistence_error`，写入 `backend/tests/contract/test_openapi_contract.py`
- [X] T035 [P] [US2] 编写前端失败 API 测试，覆盖搜索文本首尾空白处理与查询参数编码、`AbortController` 取消旧请求且旧响应不得覆盖新搜索结果、PATCH 部分更新及 404/409/422/500/网络错误映射，写入 `frontend/src/features/patients/api/patientApi.search-edit.test.ts`
- [X] T036 [P] [US2] 编写前端失败页面测试，覆盖病历号与姓名中英文字母大小写不敏感的搜索结果、搜索无结果、搜索加载和搜索失败状态的完整免责声明、清空搜索恢复完整列表，以及较晚返回的旧请求不得覆盖最新搜索，写入 `frontend/src/features/patients/pages/PatientManagementPage.search.test.tsx`
- [X] T037 [P] [US2] 编写前端失败编辑测试，覆盖 dialog 的明确可访问名称、焦点进入、关闭后焦点恢复和重复完整免责声明；覆盖初值装载、即时校验、服务端失败后合理保留焦点与全部草稿，以及成功或取消后清除暂存状态，写入 `frontend/src/features/patients/components/PatientFormDialog.edit.test.tsx`

### Minimal implementation for User Story 2

- [X] T038 [US2] 实现 LIKE 特殊字符转义、病历号/姓名子串搜索、双键稳定排序、PATCH 校验/唯一冲突/显式 commit 与异常 rollback，写入 `backend/app/services/patient_service.py`；依赖 T033
- [X] T039 [US2] 在 GET `/api/patients` 接入 `q` 查询并实现 PATCH `/api/patients/{id}` 的 200/404/409/422/500、统一 `ErrorResponse` 和 `500 persistence_error`，确保故障注入路径执行 rollback，写入 `backend/app/api/patients.py`、`backend/app/schemas/patient.py`；依赖 T034、T038
- [X] T040 [P] [US2] 先在 `frontend/src/features/patients/components/PatientSearchForm.test.tsx` 编写并确认失败的组件测试，覆盖提交时搜索文本首尾空白处理、清空搜索恢复完整列表和旧请求结果不回写；再实现受控搜索表单、清除操作和可访问状态提示，写入 `frontend/src/features/patients/components/PatientSearchForm.tsx`
- [X] T041 [P] [US2] 实现搜索参数、旧请求取消、PATCH 客户端和搜索/编辑状态流，写入 `frontend/src/features/patients/api/patientApi.ts`、`frontend/src/features/patients/hooks/usePatientList.ts`、`frontend/src/features/patients/hooks/usePatientDetail.ts`；依赖 T035
- [X] T042 [US2] 将搜索结果/无结果/失败状态和编辑 dialog 接入页面，失败时保留输入并仅在成功或取消后清理，写入 `frontend/src/features/patients/pages/PatientManagementPage.tsx`、`frontend/src/features/patients/components/PatientFormDialog.tsx`、`frontend/src/styles/patients.css`；依赖 T036、T037、T040、T041
- [X] T043 [US2] 运行并修正本阶段全部后端和前端测试，确认搜索转义、稳定排序、合同一致性、事务回滚、重启持久化和失败输入保留全部通过；必要修正仅限 `backend/tests/integration/test_patient_search_and_edit.py`、`backend/app/services/patient_service.py`、`backend/app/api/patients.py`、`frontend/src/features/patients/`
- [X] T044 [US2] 使用预置 Patient 执行独立浏览器 checkpoint，并在 `specs/001-patient-management/quickstart.md` 的验收记录中填写搜索、编辑、失败输入保留和重启后保留修改的实际结果与证据路径

**Checkpoint**: US2 可在预置 Patient 上独立演示和测试，US1 行为保持通过。

---

## Phase 5: User Story 3 — 删除确认和删除失败 (Priority: P3)

**Goal**: 用户能在明确确认后真实删除病人；取消或删除失败时病人不应提前消失。

**Independent Test**: 通过后端夹具或预置 API 数据准备一个 Patient，仅执行本阶段测试；分别验证取消、失败、成功删除和重启不恢复，无需依赖 US1 创建 UI 或 US2 搜索/编辑 UI。

### Tests for User Story 3 — 必须先编写并确认失败

- [X] T045 [P] [US3] 编写后端失败运行时测试，覆盖 DELETE 成功返回 204 且无响应体、未知 Patient 返回 404、非法 UUID 返回统一 422；通过故障注入验证持久化失败返回统一 `500 persistence_error`、事务 rollback 且记录保持，并验证成功删除后关闭并重建 engine/Session 仍不恢复，写入 `backend/tests/integration/test_patient_delete.py`
- [X] T046 [P] [US3] 扩展失败合同测试，以 `specs/001-patient-management/contracts/openapi.yaml` 为基准验证设计 OpenAPI 与 FastAPI 运行时合同中 DELETE `/api/patients/{id}` 的 path 参数、统一 `ErrorResponse`、204/404/422/500，确认 204 无响应体、非法 UUID 使用统一 422、持久化故障使用统一 `500 persistence_error`，写入 `backend/tests/contract/test_openapi_contract.py`
- [X] T047 [P] [US3] 编写删除确认 dialog 失败组件测试，覆盖重复完整免责声明、明确可访问名称、病人姓名、病历号和不可恢复后果；打开后初始焦点位于“取消”按钮，关闭后焦点恢复到删除触发按钮，Escape 或取消均不得触发 DELETE/确认回调，写入 `frontend/src/features/patients/components/DeletePatientDialog.test.tsx`
- [X] T048 [P] [US3] 编写页面删除失败测试，覆盖取消不发送 DELETE、请求期间不提前移除病人、失败后仍保留列表/详情与错误提示、仅成功响应后移除病人，写入 `frontend/src/features/patients/pages/PatientManagementPage.delete.test.tsx`

### Minimal implementation for User Story 3

- [X] T049 [US3] 实现按内部 UUID 查找和真实删除、成功 commit、异常 rollback 及不存在映射，写入 `backend/app/services/patient_service.py`；依赖 T045
- [X] T050 [US3] 实现 DELETE `/api/patients/{id}` 的 204/404/422/500 和统一 `ErrorResponse`：非法 UUID 返回统一 422，持久化失败 rollback 后返回统一 `500 persistence_error`，成功 204 不包含响应体，写入 `backend/app/api/patients.py`；依赖 T046、T049
- [X] T051 [P] [US3] 使用原生 `<dialog>` 实现删除确认界面，显示完整免责声明、明确可访问名称、姓名、病历号和不可恢复后果；初始焦点位于“取消”按钮，关闭后恢复到删除触发按钮，Escape 或取消不得触发 DELETE，写入 `frontend/src/features/patients/components/DeletePatientDialog.tsx`；依赖 T047
- [X] T052 [US3] 实现 DELETE 客户端与页面删除状态流，取消不请求、请求失败不提前移除、成功后才同步列表/详情，写入 `frontend/src/features/patients/api/patientApi.ts`、`frontend/src/features/patients/pages/PatientManagementPage.tsx`、`frontend/src/styles/patients.css`；依赖 T048、T050、T051
- [X] T053 [US3] 运行并修正本阶段全部后端和前端测试，确认真实删除、失败 rollback、合同一致性、取消零请求、失败不提前移除和重启不恢复全部通过；必要修正仅限 `backend/tests/integration/test_patient_delete.py`、`backend/app/services/patient_service.py`、`backend/app/api/patients.py`、`frontend/src/features/patients/`
- [X] T054 [US3] 使用预置 Patient 执行独立浏览器 checkpoint，并在 `specs/001-patient-management/quickstart.md` 的验收记录中填写删除取消、删除成功、删除失败保护和重启不恢复的实际结果与证据路径

**Checkpoint**: US3 可在预置 Patient 上独立演示和测试，US1、US2 行为保持通过。

---

## Phase 6: 完整浏览器验收与收尾验证

**Goal**: 用完整自动化测试和真实浏览器证据证明实现符合 spec、OpenAPI 合同、Constitution 和范围边界。

- [X] T055 [P] 运行 `backend/pyproject.toml` 定义的完整 pytest 套件，确认字段校验、casefold 唯一性、迁移空库升级、OpenAPI 运行时一致性、搜索转义、事务回滚和重启持久化全部通过；对相同 `updated_at` 的固定数据集记录初次查询的完整 Patient ID 顺序，并在重新建立 engine/Session 后比较顺序完全一致，保留终端结果供 T057 记录
- [X] T056 [P] 运行 `frontend/package.json` 定义的完整 Vitest/React Testing Library 套件和 Vite production build，确认所有页面状态、三个 dialog、失败输入保留及删除保护测试通过，并保留终端结果供 T057 记录
- [X] T057 将 T055、T056 的自动化结果写入 `specs/001-patient-management/quickstart.md`，再严格按其中的 Eight-step acceptance path 在真实浏览器执行全部八步；为 SC-009 使用相同 `updated_at` 的固定数据集，记录初次加载的 Patient ID 顺序，页面刷新后比较一次，后端重启后再次比较，确认三次顺序完全一致，并逐行填写环境、实际结果、Pass/Fail 和证据/截图路径，不使用组件测试结果代填浏览器结果
- [X] T058 在真实浏览器补查病人列表、空列表、搜索结果、搜索无结果、加载/操作失败、病人详情及创建/编辑/删除三个 dialog 的完整免责声明，同时核对 loopback REST、本地 `data/patient-management.sqlite3` 和禁止范围，将结果写入 `specs/001-patient-management/quickstart.md`
- [X] T059 对照 `specs/001-patient-management/checklists/requirements.md`、`specs/001-patient-management/checklists/completeness.md` 和 `specs/001-patient-management/tasks.md` 复核全部需求、清单与任务状态，确保没有未验证项、范围扩张或后续影像功能

**Checkpoint**: 自动化测试、真实浏览器八步路径、失败/边界抽查和 Constitution 检查均有可追溯结果。

---

## Dependencies and execution order

### Phase dependency graph

```text
Phase 1 → Phase 2 → US1 → US2 → US3 → Phase 6
                     │      │
                     │      └─ US3 也可用预置 Patient 独立验证
                     └─ US2 可用预置 Patient 独立验证
```

- Phase 1 无前置依赖。
- Phase 2 依赖 Phase 1；T008 依赖 T004、T005，其余 `[P]` 基础设施任务可按文件集并行。
- 各 Story 的测试依赖 Phase 2，且必须在对应实现任务前创建并确认失败。
- US1 实现依赖：T021 ← T020；T022 ← T019；T023 ← T019–T021；T024 ← T006、T023；T027 ← T025；T028 ← T027；T029 ← T025、T026、T028；T030 ← T029；T031–T032 最后顺序执行。
- US2 实现依赖：T038 ← T033；T039 ← T034、T038；T040 与 T041 可并行；T042 ← T036、T037、T040、T041；T043–T044 最后顺序执行。
- US3 实现依赖：T049 ← T045；T050 ← T046、T049；T051 可与后端实现并行；T052 ← T048、T050、T051；T053–T054 最后顺序执行。
- Phase 6 依赖三个 Story 全部完成；T055 与 T056 可并行，T057–T059 顺序执行。

### User Story independence

- **US1 (MVP)**：使用空数据库，仅需创建、列表、详情与持久化能力。
- **US2 和 US3 的依赖边界**：US2 和 US3 依赖共享的 Patient 基础模型以及已完成的前序实现，但可以通过测试夹具或预置 Patient 独立验证。“独立”指独立验收和回归，不表示能够从空仓库独立实现；Patient 模型、schema 和业务 API 保留在现有 User Story 阶段，不移入 Foundation。
- **US2**：使用测试夹具或预置 Patient 独立验收搜索和编辑，不依赖创建 UI。
- **US3**：使用测试夹具或预置 Patient 独立验收取消、失败和真实删除，不依赖创建或编辑 UI。

### Parallel examples

```text
US1 tests: T011 || T012 || T013 || T014 || T015 || T016 || T017 || T018
US1 implementation after failing tests: T019 || T020 || T025 || T026

US2 tests: T033 || T034 || T035 || T036 || T037
US2 implementation after failing tests: T040 || T041

US3 tests: T045 || T046 || T047 || T048
US3 implementation after failing tests: (T049 → T050) || T051

Final automation: T055 || T056
```

---

## Delivery strategy

### MVP first

1. 完成 Phase 1 和 Phase 2。
2. 完成 US1 的失败测试、最小实现和独立 checkpoint。
3. 停在可创建、查看详情并经重启保持数据的 MVP，确认边界后再继续。

### Incremental delivery

1. MVP：US1 创建、详情和重启持久化。
2. 增量 1：US2 搜索和编辑，独立回归后叠加到 MVP。
3. 增量 2：US3 删除确认和删除失败保护，独立回归后叠加。
4. 收尾：完整自动化测试、八步真实浏览器路径和范围复核。
