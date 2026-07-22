# Tasks: DICOM 导入与持久化

**Input**: Design documents from `/specs/002-dicom-import/`

**Prerequisites**: `plan.md`、`spec.md`、`research.md`、`data-model.md`、`contracts/openapi.yaml`、`quickstart.md`

**Tests**: 测试为强制项。每个 Story 必须先编写并运行失败的 pytest、Vitest/React Testing Library
测试，再实现最小代码；每个 Story 有独立浏览器 checkpoint，最终执行完整端到端路径。

**Scope**: 只实现本机 CT DICOM 导入、Study/Series/Instance 元数据、受管文件、五类报告、检查/序列
列表、重启持久化和病人删除清理。不得初始化 Cornerstone3D，不得加入查看器、MPR、PACS、
DICOMweb、认证、云、测量、报告或 3D。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 不同文件且不依赖未完成任务，可并行执行
- **[Story]**: `[US1]`、`[US2]`、`[US3]`
- 所有任务包含精确文件路径

## Phase 1: Setup（共享依赖与测试数据）

**Purpose**: 加入最小依赖、忽略运行数据，并建立不含真实患者信息的 DICOM 测试夹具。

- [X] T001 更新 `.gitignore`，新增 `data/dicom/`、`data/.imports/`、`data/.delete-staging/` 及 SQLite sidecar 排除项，不忽略任何规格或测试 fixture 源码
- [X] T002 在 `backend/pyproject.toml` 加入生产依赖 `pydicom>=3,<4` 与 `python-multipart>=0.0.20,<1`，运行 `uv lock` 更新 `backend/uv.lock`，不得加入影像解码器、任务队列或其他依赖
- [X] T003 [P] 先在 `backend/tests/unit/test_dicom_factory.py` 编写并运行失败测试，再实现动态已脱敏最小 CT 文件工厂 `backend/tests/dicom_factory.py`，覆盖 PatientID、CT 模态、Study/Series/SOP UID、尺寸、空间标签、PixelData 和可选异常变体
- [X] T004 [P] 创建 `frontend/src/features/dicom-import/test/fileFixtures.ts`，提供标准 File、目录相对路径和空文件构造器供后续 multipart/dialog 测试复用，不创建通用查看器目录

---

## Phase 2: Foundational（阻塞所有 Story）

**Purpose**: 建立数据库结构、SQLite 外键、纯 DICOM 解析和安全受管存储。

**⚠️ CRITICAL**: 本阶段完成前不得开始任何 User Story 实现。

- [X] T005 [P] 先扩展 `backend/tests/migration/test_alembic_upgrade.py` 并确认失败，覆盖空库升级后 `studies`、`series`、`instances` 表、三个全局 UID 唯一索引、稳定排序索引、级联外键、viewability 约束及不存在像素 BLOB 列
- [X] T006 [P] 先在 `backend/tests/unit/test_dicom_parser.py` 编写并确认失败的解析测试，覆盖有效 CT、非 DICOM、损坏、非 CT、缺失 PatientID、缺失必需 UID、不支持传输语法、尺寸/空间信息不足、数值与日期转换以及不访问/解码 PixelData 值
- [X] T007 [P] 先在 `backend/tests/unit/test_managed_storage.py` 编写并确认失败的存储测试，覆盖配置目录、临时会话清理、UID 路径校验、路径包含性、未知目标冲突、原子移动、只清理当前操作文件及病人目录暂存/恢复/清除
- [X] T008 实现 Study、Series、Instance SQLAlchemy 模型及 Patient 关系，写入 `backend/app/models/study.py`、`backend/app/models/series.py`、`backend/app/models/instance.py`、`backend/app/models/patient.py`，包括全局 UID 唯一性、viewability 约束、稳定索引和数据库级联
- [X] T009 创建 Alembic revision `backend/alembic/versions/002_create_dicom_index.py`，按父到子顺序创建表/索引/约束并按反序 downgrade；更新 `backend/app/db/base.py` 加载全部模型；依赖 T005、T008
- [X] T010 在 `backend/app/db/session.py` 为 SQLite 连接显式启用 `PRAGMA foreign_keys=ON`，保持测试数据库 URL 覆盖和现有 Session 工厂行为；运行迁移测试确认 T005 通过
- [X] T011 实现纯解析器 `backend/app/services/dicom_parser.py`：使用 `dcmread(..., defer_size=1024, force=False)`、严格 UID 校验、稳定分类/原因、可选标签安全转换和未压缩小端 baseline，不访问 PixelData 值；运行 T006 测试
- [X] T012 扩展 `backend/app/core/config.py` 派生 `imports_dir`、`dicom_dir`、`delete_staging_dir`，实现 `backend/app/services/managed_storage.py` 的临时目录、确定受管路径、包含性、原子存储、当前操作清理和删除暂存/恢复/清除；运行 T007 测试
- [X] T013 [P] 创建 `backend/app/schemas/dicom_import.py` 的五类枚举、ImportItem/ImportReport 计数恒等校验、StudyRead、SeriesRead、SeriesDetailRead、InstanceRead 和 viewability schema，不暴露 managed_path 或绝对路径
- [X] T014 运行 `backend/tests/migration/test_alembic_upgrade.py`、`backend/tests/unit/test_dicom_parser.py`、`backend/tests/unit/test_managed_storage.py` 和现有 `backend/tests/` 回归，修正仅限 Phase 2 文件并确认全部通过

**Checkpoint**: 数据模型、纯解析和安全文件操作已就绪，所有 Story 可在此基础上开发。

---

## Phase 3: User Story 1 — 导入并持久保存真实 CT 数据 (Priority: P1) 🎯 MVP

**Goal**: 在选定病人下导入匹配的 CT Study/Series/Instance，显示检查摘要，并在服务重启后保留。

**Independent Test**: 预置一位病人，导入一套动态生成或已脱敏 CT 序列，核对 Study/Series/Instance
数量、Patient 检查摘要和受管文件；重建 app/engine 后再次读取，数据保持不变。

### Tests for User Story 1（必须先失败）

- [X] T015 [P] [US1] 在 `backend/tests/integration/test_dicom_import_service.py` 编写并确认失败的有效导入测试，覆盖单 Study 多 Series、PatientID 规范化匹配、受管相对路径、文件存在、按 Study commit 和关闭/重建 engine 后持久化
- [X] T016 [P] [US1] 在 `backend/tests/integration/test_dicom_import_api.py` 编写并确认失败的 multipart API 测试，覆盖多文件 200 报告、空 files/非法 UUID 422、未知 Patient 404、全局初始化 500 及响应不泄露绝对路径
- [X] T017 [P] [US1] 在 `backend/tests/integration/test_study_api.py` 编写并确认失败的查询测试，覆盖 Patient 空/非空 Study 列表、Study/Series/Instance 稳定排序、实例数量、查看条件、404/422/500 和 Patient `study_count/latest_study_date`
- [X] T018 [P] [US1] 扩展 `backend/tests/contract/test_openapi_contract.py` 并确认失败，以 `specs/002-dicom-import/contracts/openapi.yaml` 为基准覆盖 import、Patient Studies、Study Series、Series Detail 路径、schema、状态码、loopback server 与统一错误引用
- [X] T019 [P] [US1] 在 `frontend/src/features/dicom-import/api/dicomImportApi.test.ts` 和 `frontend/src/features/dicom-import/hooks/usePatientStudies.test.tsx` 编写并确认失败的测试，覆盖 multipart FormData、不手写 Content-Type、Study/Series 查询、取消旧请求、病人切换和成功导入刷新
- [X] T020 [P] [US1] 在 `frontend/src/features/dicom-import/components/DicomImportDialog.test.tsx`、`StudyList.test.tsx` 及 `frontend/src/features/patients/pages/PatientManagementPage.dicom.test.tsx` 编写并确认失败的组件/页面测试，覆盖文件与目录入口、空选择、导入中禁用、焦点、完整免责声明、检查空/加载/失败/列表及 Patient 摘要刷新

### Implementation for User Story 1

- [X] T021 [US1] 实现 `backend/app/services/dicom_import.py` 的有效候选按 Study 分组、PatientID 精确规范化匹配、既有 Study/Series 归属校验、受管文件跟踪、ORM flush/commit 和重启持久化；依赖 T011-T013、T015
- [X] T022 [US1] 实现异步 multipart 路由 `backend/app/api/dicom_import.py`，异步分块写入请求临时目录、关闭 UploadFile、通过 `run_in_threadpool` 执行同步解析/存储/事务、finally 清理并返回 ImportReport；在 `backend/app/api/__init__.py` 挂载路由并扩展 `backend/app/core/errors.py` 的公开字段枚举；依赖 T016、T021
- [X] T023 [US1] 实现 `backend/app/services/study_service.py` 与 `backend/app/api/studies.py` 的 Patient Studies、Study Series、Series Detail 查询及稳定排序；实例在方向一致时按 `dot(position, cross(row, column))` 升序，否则按 InstanceNumber null-last，最终以 SOP UID 打破平局；在 `backend/app/api/__init__.py` 挂载路由；依赖 T013、T017
- [X] T024 [US1] 将 `backend/app/schemas/patient.py` 的 `study_count` 改为非负整数、`latest_study_date` 改为可空日期，并在 `backend/app/services/patient_service.py` 通过 Study 聚合派生摘要，保持无检查时 0/null；依赖 T017
- [X] T025 [US1] 更新 `backend/app/main.py` 的运行时 OpenAPI 版本、tags、参数、错误枚举、公共 responses 和新增路径规范化，使 T018 的设计/运行时合同测试通过且保留 001 合同语义
- [X] T026 [P] [US1] 创建 `frontend/src/features/dicom-import/model/dicomImport.ts` 的 ImportReport、Study、Series、Instance 类型，并更新 `frontend/src/features/patients/model/patient.ts` 的动态检查摘要类型
- [X] T027 [US1] 实现 `frontend/src/features/dicom-import/api/dicomImportApi.ts` 的 multipart 导入与 Study/Series 查询，以及 `frontend/src/features/dicom-import/hooks/usePatientStudies.ts` 的取消、切换和刷新状态流；依赖 T019、T026
- [X] T028 [US1] 实现 `frontend/src/features/dicom-import/components/DicomImportDialog.tsx` 与 `StudyList.tsx`，复用原生 ModalDialog/SafetyBanner，支持 multiple file 与目录选择、失败保留、成功/明确关闭清理、焦点恢复和检查/序列状态；依赖 T020、T027
- [X] T029 [US1] 在 `frontend/src/features/patients/components/PatientDetails.tsx` 增加“导入 DICOM”入口，在 `frontend/src/features/patients/pages/PatientManagementPage.tsx` 编排导入、Patient 摘要和 Study 列表刷新，并仅在 `frontend/src/styles/patients.css` 增加本 Story 所需样式；依赖 T028
- [X] T030 [US1] 运行 `backend/tests/integration/test_dicom_import_service.py`、`test_dicom_import_api.py`、`test_study_api.py`、`backend/tests/contract/test_openapi_contract.py` 和 `frontend/src/features/dicom-import/`、`frontend/src/features/patients/pages/` 测试，修正仅限 US1 文件并确认有效导入、查询、合同、重启、免责声明及 001 回归通过
- [X] T031 [US1] 使用独立临时数据目录执行有效 CT 浏览器 checkpoint，在 `specs/002-dicom-import/quickstart.md` 记录病人选择、导入 dialog、首次导入、Study/Series/Instance 数量、Patient 摘要、服务重启和证据路径

**Checkpoint**: 有效 CT 可以导入、列出并跨重启持久化；US1 可独立演示。

---

## Phase 4: User Story 2 — 可追踪的部分失败与重复报告 (Priority: P2)

**Goal**: 对每个输入文件给出五类互斥结果，支持重复、异常混合和按 Study 部分成功且无残留。

**Independent Test**: 混合有效、重复、非 DICOM、损坏、非 CT、病人不匹配、不支持和注入提交失败
文件，确认五类合计、逐项原因、无关成功保留和失败 Study 零新增残留。

### Tests for User Story 2（必须先失败）

- [X] T032 [P] [US2] 扩展 `backend/tests/integration/test_dicom_import_service.py` 并确认失败，覆盖数据库与同批重复 SOP UID、非 DICOM、损坏、非 CT、缺失 PatientID/UID、PatientID 组不一致、跨病人 Study/Series 冲突、不支持条件和原始输入顺序报告
- [X] T033 [P] [US2] 在 `backend/tests/integration/test_dicom_import_failures.py` 编写并确认失败的故障注入测试，覆盖目标未知文件冲突、文件存储失败、flush/commit 失败、Study rollback、只清理当前操作文件、其他 Study 与既有数据保持
- [X] T034 [P] [US2] 扩展 `backend/tests/integration/test_dicom_import_api.py` 并确认失败，覆盖混合输入五类计数恒等、稳定代码/中文原因、200 部分成功和技术异常/绝对路径不泄露
- [X] T035 [P] [US2] 在 `frontend/src/features/dicom-import/components/ImportReport.test.tsx` 和 `DicomImportDialog.test.tsx` 编写并确认失败的报告测试，覆盖五类计数、逐项原因、折叠/展开可访问性、失败后 files/report 保留和新导入/关闭清理

### Implementation for User Story 2

- [X] T036 [US2] 扩展 `backend/app/services/dicom_import.py` 实现五类最终映射、同批/数据库重复、不支持持久化、Study 组病人阻止、逐项输入顺序、计数恒等和按 Study 失败补偿；依赖 T032-T034
- [X] T037 [US2] 扩展 `backend/app/services/dicom_parser.py` 与 `backend/app/services/managed_storage.py` 的稳定错误代码、Series 不支持原因优先级、未知目标冲突和故障清理，使 T032-T033 全部通过
- [X] T038 [US2] 实现 `frontend/src/features/dicom-import/components/ImportReport.tsx`，分别显示五类计数、总数一致性、非成功文件名/类别/原因和可访问列表，不显示绝对路径或技术异常；依赖 T035
- [X] T039 [US2] 将 ImportReport 接入 `frontend/src/features/dicom-import/components/DicomImportDialog.tsx` 和 `frontend/src/features/patients/pages/PatientManagementPage.tsx`，失败保留选择与报告，仅成功后的新导入或用户明确关闭清理；导入后刷新 Patient/Study 而不乐观伪造计数
- [X] T040 [US2] 运行 `backend/tests/integration/test_dicom_import_service.py`、`test_dicom_import_failures.py`、`test_dicom_import_api.py` 和 `frontend/src/features/dicom-import/` 测试，修正仅限 DICOM import feature 文件并确认分类、重复、部分失败、清理、报告及 US1/001 回归通过
- [X] T041 [US2] 在独立浏览器环境执行重复及混合异常 checkpoint，记录首次与重复数据库/文件计数、五类 totals、损坏/非 CT/不匹配原因、无关成功保留和证据路径到 `specs/002-dicom-import/quickstart.md`

**Checkpoint**: US1 与 US2 均可独立验证，异常目录不会静默丢失结果或破坏成功数据。

---

## Phase 5: User Story 3 — 浏览检查并安全删除全部本地数据 (Priority: P3)

**Goal**: 完整浏览检查/序列摘要，并在确认删除病人时同步清理数据库索引和受管目录，失败可补偿。

**Independent Test**: 为病人导入数据，核对确定排序的检查/序列；先取消删除验证零变更，再确认删除
验证全部索引和受管目录消失；注入删除失败验证数据库/文件恢复；重启后成功删除不恢复。

### Tests for User Story 3（必须先失败）

- [X] T042 [P] [US3] 在 `backend/tests/integration/test_patient_dicom_delete.py` 编写并确认失败的删除一致性测试，覆盖无目录、有目录成功级联、暂存移动失败、数据库 commit 失败目录恢复、最终清除失败数据库/目录补偿、其他病人隔离和重启不恢复
- [X] T043 [P] [US3] 扩展 `backend/tests/integration/test_study_api.py` 并确认失败，覆盖空/多 Study、Series/Instance 稳定排序、不支持原因、删除后 404/空列表和所有响应不含 managed_path
- [X] T044 [P] [US3] 扩展 `frontend/src/features/patients/pages/PatientManagementPage.delete.test.tsx` 与 `PatientManagementPage.dicom.test.tsx` 并确认失败，覆盖删除取消零请求/零刷新、删除中不提前移除、失败后 Patient/Study 保留、成功后全部清理和完整免责声明

### Implementation for User Story 3

- [X] T045 [US3] 在 `backend/app/services/patient_service.py` 实现影像索引 plain-value 快照、病人目录暂存、数据库级联删除、提交失败恢复和清除失败索引/目录补偿；通过应用依赖获得 ManagedStorage，不使用全局临时路径；依赖 T042
- [X] T046 [US3] 扩展 `backend/app/main.py` 的 `create_app` 支持可注入 ManagedStorage，并在 `backend/app/api/patients.py` 的 DELETE 路由传入存储依赖，保持 204/404/422/500 合同和现有无影像删除行为
- [X] T047 [US3] 完成 `backend/app/services/study_service.py` 的确定排序与删除后错误映射，确保公共 schema 不暴露 managed_path，使 T043 通过
- [X] T048 [US3] 更新 `frontend/src/features/patients/pages/PatientManagementPage.tsx` 的删除成功/失败状态流：取消零变更，失败保留 Patient/Study，成功后清空选择并刷新列表；保持 `DeletePatientDialog.tsx` 的焦点与免责声明行为，使 T044 通过
- [X] T049 [US3] 运行 `backend/tests/integration/test_patient_dicom_delete.py`、`test_study_api.py`、`test_patient_delete.py` 和 `frontend/src/features/patients/pages/PatientManagementPage.delete.test.tsx`、`PatientManagementPage.dicom.test.tsx`，修正仅限 US3 文件并确认删除补偿、查询、UI 保护及 001/US1/US2 回归通过
- [X] T050 [US3] 在真实浏览器执行删除取消、确认、受管目录清理和重启不恢复 checkpoint，将数据库/目录核对和证据路径写入 `specs/002-dicom-import/quickstart.md`

**Checkpoint**: 三个 Story 均完成，Patient 与全部本地 DICOM 数据具有一致的完整生命周期。

---

## Phase 6: 完整验证与收尾

**Purpose**: 跨 Story 自动化回归、真实浏览器完整路径、Checklist 和范围一致性。

- [X] T051 [P] 运行 `backend/pyproject.toml` 定义的完整 pytest 套件，确认解析、迁移、合同、导入、五类报告、重复、部分失败、重启、查询、删除补偿和现有 Patient 行为全部通过并保留终端结果
- [X] T052 [P] 运行 `frontend/package.json` 定义的完整 Vitest/React Testing Library 套件及 Vite production build，确认 import dialog/report、Study/Series 状态、免责声明、删除保护和 001 回归全部通过并保留终端结果
- [X] T053 执行 `specs/002-dicom-import/quickstart.md` 的完整八步真实浏览器路径，使用独立临时 SQLite 与受管目录，逐行填写环境、实际结果、Pass/Fail、五类计数、数据库/文件数量、重启和截图/日志路径，不以组件测试代填浏览器结果
- [X] T054 复核真实浏览器 Network/DOM/Console、运行数据目录和实现源码，确认仅 loopback、完整免责声明、无绝对路径/UUID 泄露、失败 Study 零残留、删除数据库/文件一致，且未引入 Cornerstone3D 初始化、查看器、MPR、PACS、DICOMweb、认证、云、测量、报告或 3D；结果写入 `specs/002-dicom-import/quickstart.md`
- [X] T055 对照 `specs/002-dicom-import/checklists/requirements.md`、`specs/002-dicom-import/checklists/dicom-lifecycle.md`、`specs/002-dicom-import/spec.md`、`plan.md` 和 `tasks.md` 复核全部需求、清单和任务状态，将 Feature 状态更新为 Complete，确保没有未验证项、范围扩张或未清理的临时运行服务

---

## Dependencies & Execution Order

### Phase dependencies

- Phase 1 无依赖。
- Phase 2 依赖 Phase 1，并阻塞全部 Story。
- US1 依赖 Phase 2；是 DICOM import MVP。
- US2 依赖 US1 的基础导入和报告 schema，但通过混合 fixture 可独立验证分类/部分失败。
- US3 依赖 US1 的持久化层；不依赖 US2 的异常 UI，可独立验证查询和删除生命周期。
- Phase 6 依赖三个 Story 全部完成；T051 与 T052 可并行，T053-T055 顺序执行。

### User story dependency graph

```text
Setup
  ↓
Foundation
  ↓
US1 有效导入与持久化
  ├──→ US2 五类报告与部分失败
  └──→ US3 浏览与删除一致性
              ↓
        完整验收与收尾
```

### Within each Story

- 所有失败测试任务先于实现任务，并实际运行确认失败。
- 模型/解析/存储先于导入 service；service 先于 API；API/类型先于 UI。
- 不在后端成功前用前端 mock 声称真实持久化通过。
- 每个 Story 的 checkpoint 通过后才进入下一优先级。

### Parallel opportunities

- T003 与 T004 可并行。
- T005、T006、T007 可并行编写失败测试。
- US1 的 T015-T020 可按后端 service、合同、查询、前端 API、前端组件文件集并行编写。
- US2 的 T032-T035 可并行编写。
- US3 的 T042-T044 可并行编写。
- T051 与 T052 可并行运行。

## Parallel examples

### US1

```text
T015: backend import service tests
T016: backend multipart API tests
T017: backend Study query tests
T018: OpenAPI contract tests
T019: frontend API/hook tests
T020: frontend dialog/page tests
```

### US2

```text
T032: classification/duplicate tests
T033: failure-compensation tests
T034: mixed API report tests
T035: frontend ImportReport tests
```

### US3

```text
T042: backend delete consistency tests
T043: Study query/deletion tests
T044: frontend deletion protection tests
```

## Implementation strategy

### MVP first

1. 完成 Phase 1 和 Phase 2。
2. 完成 US1 的失败测试、最小实现和真实浏览器 checkpoint。
3. 停在可导入、列出并跨重启持久化真实 CT 的 MVP，确认边界后再叠加异常报告和删除清理。

### Incremental delivery

1. MVP：有效 CT 导入、Study/Series 列表和重启持久化。
2. 增量 1：五类报告、重复、混合异常、部分失败和失败补偿。
3. 增量 2：完整查询、Patient 删除的索引/文件一致性和失败恢复。
4. 收尾：完整自动化测试、八步真实浏览器路径和范围复核。

## Notes

- `[P]` 只表示文件集与依赖允许并行；当前执行遵循用户要求，不调度子代理。
- 不执行 Git commit、push 或 upload。
- 任务完成后必须将对应 `[ ]` 改为 `[X]`，不能只在聊天中声称完成。
