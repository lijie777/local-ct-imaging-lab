# Tasks: 后台导入与断点续传

## Phase 1: Setup

- [X] T001 在 `backend/tests/migration/test_alembic_upgrade.py`、`backend/tests/unit/test_import_job_model.py` 添加 004 表、外键、active slot、状态/offset/计数约束和唯一索引的失败断言
- [X] T002 [P] 在 `backend/tests/contract/test_openapi_contract.py`、`backend/tests/integration/test_import_job_api.py` 添加创建/latest/detail/chunk/queue/delete 和 201/202/204/404/409/413/422/500 的失败合同
- [X] T003 [P] 在 `backend/tests/unit/test_import_job_storage.py` 添加安全目录、symlink/越界、chunk、offset 对账、fingerprint、终态与 orphan 清理失败测试
- [X] T004 [P] 在 `frontend/src/features/dicom-import/core/importManifest.test.ts`、`frontend/src/features/dicom-import/api/importJobApi.test.ts` 添加路径、首尾 fingerprint、limits、binary chunk、offset header、abort 和错误映射失败测试

## Phase 2: Foundational

- [X] T005 实现 `backend/app/models/import_job.py`、`backend/alembic/versions/004_create_import_jobs.py`，并更新 `backend/app/models/patient.py`、`backend/app/db/base.py` 通过 T001
- [X] T006 实现严格 job/file DTO、稳定错误码和活动任务/状态转换服务，写入 `backend/app/schemas/import_job.py`、`backend/app/services/import_job_service.py`、`backend/app/core/errors.py`
- [X] T007 实现独立 `.import-jobs` 配置与安全存储边界，写入 `backend/app/core/config.py`、`backend/app/services/import_job_storage.py`、`.gitignore` 并通过 T003
- [X] T008 实现六个 import-job endpoint、app upload lock 和 OpenAPI 合同，写入 `backend/app/api/import_jobs.py`、`backend/app/api/__init__.py`、`backend/app/main.py` 并通过 T002

## Phase 3: User Story 1 - 中断后继续上传 (P1)

**Independent Test**: 上传到 30%–70% 时刷新并重新选择同一目录，只发送剩余字节；错误文件身份和 offset 被安全拒绝。

- [X] T009 [P] [US1] 在 `backend/tests/unit/test_import_job_service.py`、`backend/tests/integration/test_import_job_api.py` 补清单 limits、单活动任务、顺序 offset、4 MiB、磁盘长短对账和 fingerprint 完成核对失败测试
- [X] T010 [US1] 在 `backend/app/services/import_job_service.py`、`backend/app/services/import_job_storage.py`、`backend/app/api/import_jobs.py` 实现创建、确认 offset、chunk 写入/回退/截断和入队前完整性，通过 T009
- [X] T011 [US1] 实现 `frontend/src/features/dicom-import/model/importJob.ts`、`frontend/src/features/dicom-import/core/importManifest.ts`、`frontend/src/features/dicom-import/api/importJobApi.ts` 并通过 T004
- [X] T012 [P] [US1] 在 `frontend/src/features/dicom-import/core/resumableUploader.test.ts` 编写清单一一匹配、缺失/额外/不匹配、按 confirmed offset 续传、4 MiB 顺序 chunk、进度、abort 和网络重试失败测试
- [X] T013 [US1] 实现 `frontend/src/features/dicom-import/core/resumableUploader.ts` 并通过 T012
- [X] T014 [P] [US1] 在 `frontend/src/features/dicom-import/hooks/useImportJob.test.tsx`、`frontend/src/features/dicom-import/components/DicomImportDialog.test.tsx` 编写 latest 恢复、重新选择续传、刷新找回、暂停说明、身份错误和可访问进度失败测试
- [X] T015 [US1] 实现 `frontend/src/features/dicom-import/hooks/useImportJob.ts` 并最小修改 `frontend/src/features/dicom-import/components/DicomImportDialog.tsx`、`frontend/src/styles/patients.css` 完成 P1，通过 T014

## Phase 4: User Story 2 - 上传完成后后台处理 (P2)

**Independent Test**: 完成上传并入队后关闭对话框，任务在单 worker 中继续；重新打开可见 queued/running/completed 和五类报告，Study/Series 刷新。

- [X] T016 [P] [US2] 在 `backend/tests/integration/test_import_job_worker.py` 编写单 worker 串行 claim、独立 Session、现有 `import_dicom_files` 调用、完整报告、基础设施 failed 和终态清理失败测试
- [X] T017 [US2] 实现 `backend/app/services/import_job_worker.py`，在 `backend/app/main.py` lifespan 启停唯一 worker，并由 queue endpoint 唤醒，通过 T016
- [X] T018 [US2] 在 `backend/tests/integration/test_import_job_worker.py`、`backend/tests/integration/test_dicom_import_service.py` 验证成功/重复/跳过/不支持/失败五类报告持久化、成功数据可查询和既有事务/文件一致性
- [X] T019 [P] [US2] 在 `frontend/src/features/dicom-import/hooks/useImportJob.test.tsx`、`frontend/src/features/dicom-import/components/DicomImportDialog.test.tsx` 编写 queued/running 1 秒轮询、关闭不取消、completed 单次通知、五类报告和 Study 刷新失败测试
- [X] T020 [US2] 扩展 `frontend/src/features/dicom-import/hooks/useImportJob.ts`、`frontend/src/features/dicom-import/components/DicomImportDialog.tsx` 接入 queue/poll/completed 并复用 `frontend/src/features/dicom-import/components/ImportReport.tsx`，通过 T019

## Phase 5: User Story 3 - 服务重启与安全清理 (P3)

**Independent Test**: uploading 和 running 状态分别重启服务；前者保留 offset，后者 requeue 并结束。活动任务阻止 Patient 删除，放弃/终态后无 job 或 staging 残留。

- [X] T021 [P] [US3] 在 `backend/tests/integration/test_import_job_worker.py`、`backend/tests/unit/test_import_job_storage.py` 编写 running→queued、queued 自动继续、uploading 保留、orphan 识别和活动目录不清理失败测试
- [X] T022 [US3] 在 `backend/app/services/import_job_worker.py`、`backend/app/services/import_job_storage.py`、`backend/app/main.py` 实现启动 requeue、孤立目录清理和关闭时停止领取，通过 T021
- [X] T023 [P] [US3] 在 `backend/tests/integration/test_patient_delete.py`、`backend/tests/integration/test_import_job_api.py` 编写活动任务 Patient DELETE 409、终态 cascade、uploading/completed/failed 删除清理和 queued/running 删除冲突失败测试
- [X] T024 [US3] 在 `backend/app/services/patient_service.py`、`backend/app/api/patients.py`、`backend/app/services/import_job_service.py` 实现 `import_in_progress` 门禁和安全 discard，通过 T023
- [X] T025 [P] [US3] 在 `frontend/src/features/dicom-import/hooks/useImportJob.test.tsx`、`frontend/src/features/dicom-import/components/DicomImportDialog.test.tsx` 编写 failed、放弃任务、重新开始、queued/running 禁止删除、焦点和错误安全失败测试
- [X] T026 [US3] 扩展 `frontend/src/features/dicom-import/hooks/useImportJob.ts`、`frontend/src/features/dicom-import/components/DicomImportDialog.tsx` 完成 discard/failed/retry UI，通过 T025
- [X] T027 [US3] 在 `backend/tests/integration/test_import_job_worker.py` 添加两次 application lifespan 的上传 offset、running requeue、已提交 SOP duplicate 与最终无孤立文件端到端自动化路径

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T028 [P] 更新 `README.md`、`README.en.md`、`docs/README.md`，将 Feature 007 移入已实现，记录 `.import-jobs`、单 worker、重新选择同一文件边界并保持 Feature 008 未完成
- [X] T029 运行既有同步 multipart 导入、Patient 删除、DICOM 查询和 FastAPI 静态托管回归，确认 `backend/app/api/dicom_import.py` 兼容且单进程 production 前端仍可运行
- [X] T030 运行完整前端 `npm test -- --run`、`npm run build`、后端 `uv run python -m pytest -q -p no:cacheprovider` 和空库 `uv run alembic upgrade head`，记录准确结果到 `specs/007-background-import-resume/quickstart.md`
- [X] T031 执行 production 单进程真实浏览器 E2E：30%–70% 刷新续传、partial/running 服务重启、关闭 dialog 后后台完成、身份不匹配、放弃清理、Patient 删除门禁、五类报告、1280×900/820×900、console/network，并写入 `specs/007-background-import-resume/quickstart.md`
- [X] T032 执行最终独立代码审查，修复全部 Critical/Important，重跑 `git diff --check`、规格覆盖、任务格式和无占位检查后关闭 Feature 007

## Dependencies

- T001–T004 先建立失败证据；T005–T008 顺序闭合共享后端基础。
- US1 依赖 T005–T008；T011→T013，T014→T015，后端 T009→T010。
- US2 依赖所有文件已可完整上传/queue；T016→T017→T018，T019→T020。
- US3 依赖 worker 状态机；T021→T022，T023→T024，T025→T026，最后 T027。
- T028 可与 US3 后端工作并行；T029→T030→T031→T032 必须最后顺序执行。

## Parallel Examples

- T001、T002、T003、T004 触及不同测试边界，可并行编写失败测试。
- US1 中 T009、T012、T014 可在共享 DTO 确定后并行；实现按各自测试链顺序完成。
- US2 中 worker 后端 T016 与前端 polling T019 可并行。
- US3 中 restart/storage T021、Patient 删除 T023、前端 discard T025 可并行。

## Implementation Strategy

先交付可独立验收的持久化清单和顺序断点续传 (US1)，随后用同一 job 状态机接入单 worker 与
五类报告 (US2)，最后闭合重启、orphan、Patient 删除和放弃任务 (US3)。保持旧同步接口兼容，
不在本 Feature 中实现跨设备、并行 worker 或 Feature 008。
