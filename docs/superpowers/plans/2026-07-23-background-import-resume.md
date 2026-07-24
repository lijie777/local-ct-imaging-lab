# 后台导入与断点续传 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加 SQLite 持久化导入任务、顺序分块续传和 FastAPI 单进程后台 worker，并复用现有五类 DICOM 导入报告。

**Architecture:** 浏览器先提交文件清单，再按服务端确认 offset 顺序上传 4 MiB chunk；SQLite 保存任务、文件进度和报告，独立 `.import-jobs` 目录保存可跨重启续传的暂存文件。FastAPI lifespan 启动唯一 worker，串行领取 queued 任务并调用现有 `import_dicom_files`。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy 2、Alembic、SQLite、React 19、TypeScript 5.9、Vitest、React Testing Library、Web Crypto。

---

## 文件职责

- `backend/app/models/import_job.py`：ImportJob/ImportJobFile ORM、状态与约束。
- `backend/alembic/versions/004_create_import_jobs.py`：任务表、文件表、索引与级联迁移。
- `backend/app/schemas/import_job.py`：清单、任务详情、offset、状态和报告 DTO。
- `backend/app/services/import_job_storage.py`：`.import-jobs` 安全路径、chunk 写入、截断、fingerprint 与清理。
- `backend/app/services/import_job_service.py`：任务状态机、清单限制、offset 事务和 Patient 删除门禁。
- `backend/app/services/import_job_worker.py`：单 worker claim、执行、重启 requeue 与终态记录。
- `backend/app/api/import_jobs.py`：创建、查询、上传、入队和删除 API。
- `frontend/src/features/dicom-import/model/importJob.ts`：严格任务/文件 DTO 与 UI 状态类型。
- `frontend/src/features/dicom-import/core/importManifest.ts`：相对路径规范化和轻量 fingerprint。
- `frontend/src/features/dicom-import/api/importJobApi.ts`：JSON API、binary chunk 和错误映射。
- `frontend/src/features/dicom-import/core/resumableUploader.ts`：顺序匹配、offset 续传、进度与 abort。
- `frontend/src/features/dicom-import/hooks/useImportJob.ts`：latest 恢复、轮询、上传/入队和完成通知。
- `frontend/src/features/dicom-import/components/DicomImportDialog.tsx`：复用现有对话框呈现任务状态。

### Task 1: 写迁移与 ORM 的失败测试

**Files:**
- Modify: `backend/tests/migration/test_alembic_upgrade.py`
- Create: `backend/tests/unit/test_import_job_model.py`
- Create: `backend/app/models/import_job.py`
- Create: `backend/alembic/versions/004_create_import_jobs.py`
- Modify: `backend/app/models/patient.py`
- Modify: `backend/app/db/base.py`

- [ ] **Step 1: 写失败断言**

断言 `004_create_import_jobs` 后存在 `import_jobs`、`import_job_files`；Patient 和 Job 均为
`ON DELETE CASCADE`；`patient_id + active_slot` 唯一；状态/active_slot、offset、size、ordinal、
时间和计数有 CHECK；文件 `(job_id, ordinal)` 与 `(job_id, relative_path)` 唯一。

- [ ] **Step 2: 运行迁移测试确认失败**

Run: `cd backend && uv run python -m pytest tests/migration/test_alembic_upgrade.py tests/unit/test_import_job_model.py -q`

Expected: FAIL，原因是 004、ORM 或表不存在。

- [ ] **Step 3: 实现最小 ORM 与迁移**

状态与 active slot 使用同一合同：

```python
ACTIVE_IMPORT_STATUSES = ("uploading", "queued", "running")
TERMINAL_IMPORT_STATUSES = ("completed", "failed")

CheckConstraint(
    "(status IN ('uploading','queued','running') AND active_slot = 1) OR "
    "(status IN ('completed','failed') AND active_slot IS NULL)",
    name="ck_import_jobs_status_active_slot",
)
UniqueConstraint("patient_id", "active_slot", name="uq_import_jobs_patient_active")
```

`ImportJobFile.confirmed_offset` 必须满足 `0 <= confirmed_offset <= size_bytes`。

- [ ] **Step 4: 运行迁移与 ORM 测试**

Run: `cd backend && uv run python -m pytest tests/migration/test_alembic_upgrade.py tests/unit/test_import_job_model.py -q`

Expected: PASS。

### Task 2: 定义严格 DTO 与状态机服务

**Files:**
- Create: `backend/app/schemas/import_job.py`
- Create: `backend/app/services/import_job_service.py`
- Create: `backend/tests/unit/test_import_job_service.py`
- Modify: `backend/app/core/errors.py`

- [ ] **Step 1: 写清单和状态机失败测试**

覆盖：空清单、2,001 文件、单文件 >512 MiB、总量 >8 GiB、重复/危险路径、fingerprint 非
64 位小写 hex、每病人第二个活动任务、错误状态入队、未完成文件入队、终态 active_slot 清空、
queued/running 禁止删除、Patient 不存在和安全错误码。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `cd backend && uv run python -m pytest tests/unit/test_import_job_service.py -q`

Expected: FAIL，原因是 schema/service/error 不存在。

- [ ] **Step 3: 实现清单 DTO**

```python
class ImportManifestFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    relative_path: str = Field(min_length=1, max_length=1024)
    size_bytes: int = Field(ge=1, le=512 * 1024 * 1024)
    last_modified_ms: int = Field(ge=0)
    resume_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")

class ImportJobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    files: list[ImportManifestFile] = Field(min_length=1, max_length=2000)
```

路径规范化后拒绝绝对路径、空段、`.`、`..`、NUL 和控制字符；服务层计算 total 并在一个事务
内创建 job/file 行。

- [ ] **Step 4: 实现状态转换函数**

`create_job`、`get_latest_job`、`get_job`、`record_confirmed_offset`、`queue_job`、
`complete_job`、`fail_job`、`delete_job` 只接受明确的源状态；所有异常转换返回
`import_job_state_conflict`，不隐式修复。

- [ ] **Step 5: 运行定向测试**

Run: `cd backend && uv run python -m pytest tests/unit/test_import_job_service.py -q`

Expected: PASS。

### Task 3: 实现可恢复暂存存储

**Files:**
- Modify: `backend/app/core/config.py`
- Create: `backend/app/services/import_job_storage.py`
- Create: `backend/tests/unit/test_import_job_storage.py`
- Modify: `.gitignore`

- [ ] **Step 1: 写存储失败测试**

覆盖安全创建 `data/.import-jobs/{uuid}`、拒绝 symlink/越界、offset 不匹配不写入、chunk
>4 MiB 拒绝、写后确认、数据库 offset 落后时截断尾部、实际文件较短时回退、首尾 64 KiB
fingerprint、终态清理和仅删除无活动 DB 记录的孤立目录。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && uv run python -m pytest tests/unit/test_import_job_storage.py -q`

Expected: FAIL。

- [ ] **Step 3: 增加设置和存储实现**

`Settings` 增加 `import_jobs_dir=data_dir / ".import-jobs"`。每个文件路径只能由已校验 UUID 和
ordinal 派生，不拼接用户路径。chunk 写入以 SQLite confirmed offset 为真值：多出的磁盘尾部
先截断，短缺则返回实际长度供 service 回退。

- [ ] **Step 4: 运行存储测试**

Run: `cd backend && uv run python -m pytest tests/unit/test_import_job_storage.py -q`

Expected: PASS。

### Task 4: 增加任务 API 与合同测试

**Files:**
- Create: `backend/app/api/import_jobs.py`
- Modify: `backend/app/api/__init__.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/integration/test_import_job_api.py`
- Modify: `backend/tests/contract/test_openapi_contract.py`

- [ ] **Step 1: 写 API/合同失败测试**

覆盖六个 endpoint 的 201/200/202/204、404、409、413、422、500；OpenAPI binary body、
`Upload-Offset` header、严格 response schema、loopback server、稳定错误码与无路径泄漏。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && uv run python -m pytest tests/integration/test_import_job_api.py tests/contract/test_openapi_contract.py -q`

Expected: FAIL，路径不存在。

- [ ] **Step 3: 实现路由**

```text
POST   /api/patients/{patient_id}/import-jobs
GET    /api/patients/{patient_id}/import-jobs/latest
GET    /api/import-jobs/{job_id}
PUT    /api/import-jobs/{job_id}/files/{file_id}/content
POST   /api/import-jobs/{job_id}/queue
DELETE /api/import-jobs/{job_id}
```

上传 endpoint 先读取最多 `CHUNK_BYTES + 1`，超限立即 413；在 app 级单一 async lock 内完成
offset 检查、存储写入和 SQLite 确认，避免两个并发 chunk 交错。

- [ ] **Step 4: 更新自定义 OpenAPI**

把新增错误码加入 `ErrorDetail.code` enum，把 job/file path 参数放进 components，并显式替换
各 operation responses，保持现有合同测试风格。

- [ ] **Step 5: 运行 API/合同测试**

Run: `cd backend && uv run python -m pytest tests/integration/test_import_job_api.py tests/contract/test_openapi_contract.py -q`

Expected: PASS。

### Task 5: 实现单 worker 与重启恢复

**Files:**
- Create: `backend/app/services/import_job_worker.py`
- Create: `backend/tests/integration/test_import_job_worker.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/patient_service.py`
- Modify: `backend/app/api/patients.py`
- Modify: `backend/tests/integration/test_patient_delete.py`

- [ ] **Step 1: 写 worker 失败测试**

覆盖只领取一个最早 queued job、独立 Session、调用 `import_dicom_files`、正常五类报告进入
completed、基础设施异常进入 failed、running 启动时回到 queued、worker 不并行、终态清理、
Patient 有活动 job 时 DELETE 返回 409、终态 job 随 Patient 级联。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `cd backend && uv run python -m pytest tests/integration/test_import_job_worker.py tests/integration/test_patient_delete.py -q`

Expected: FAIL。

- [ ] **Step 3: 实现 worker**

worker 线程使用 `threading.Event` 唤醒和 `daemon=True`；每次 claim/执行/终态更新使用新的
Session。lifespan 顺序固定为：现有删除清理 → 现有 `.imports` 清理 → import-job 孤立目录
清理 → running requeue → worker.start；退出时先 stop，不再领取新任务。

- [ ] **Step 4: 增加 Patient 删除门禁**

删除事务开始前查询 `active_slot=1`；存在时抛 `ImportInProgressError`，API 返回 409。不要尝试
中断正在运行的 pydicom/文件事务。

- [ ] **Step 5: 运行 worker 和删除测试**

Run: `cd backend && uv run python -m pytest tests/integration/test_import_job_worker.py tests/integration/test_patient_delete.py -q`

Expected: PASS。

### Task 6: 前端 manifest 与 API client

**Files:**
- Create: `frontend/src/features/dicom-import/model/importJob.ts`
- Create: `frontend/src/features/dicom-import/core/importManifest.ts`
- Create: `frontend/src/features/dicom-import/core/importManifest.test.ts`
- Create: `frontend/src/features/dicom-import/api/importJobApi.ts`
- Create: `frontend/src/features/dicom-import/api/importJobApi.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖 `webkitRelativePath || name`、路径规范化、首尾最多 64 KiB fingerprint、稳定 ordinal、
manifest limits、API URL 编码、binary body、`Upload-Offset`、abort、409/413/422/500 映射。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm test -- --run src/features/dicom-import/core/importManifest.test.ts src/features/dicom-import/api/importJobApi.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 fingerprint**

小文件读取全部；大文件读取前后各 32 KiB，把 UTF-8 metadata 与字节拼接后调用
`crypto.subtle.digest('SHA-256', data)`，输出 64 位小写 hex。函数支持 AbortSignal，并按原文件
顺序串行计算，避免同时读取 2,000 个文件。

- [ ] **Step 4: 实现 API client**

API client 复用现有 `DicomApiError` 语义，但不构造 multipart。`uploadImportChunk` 发送
`file.slice(offset, end)`，body 为 Blob，header 为十进制 offset。

- [ ] **Step 5: 运行定向测试**

Run: `cd frontend && npm test -- --run src/features/dicom-import/core/importManifest.test.ts src/features/dicom-import/api/importJobApi.test.ts`

Expected: PASS。

### Task 7: 顺序续传器

**Files:**
- Create: `frontend/src/features/dicom-import/core/resumableUploader.ts`
- Create: `frontend/src/features/dicom-import/core/resumableUploader.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖按 relative_path/size/last_modified/fingerprint 一一匹配、缺失/额外/不匹配拒绝、从每个
confirmed offset 继续、4 MiB 顺序 chunk、服务端新 offset 单调校验、聚合进度、AbortError
暂停且不清除任务、网络失败保留可重试状态。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm test -- --run src/features/dicom-import/core/resumableUploader.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现最小 uploader**

```typescript
export async function resumeImportUpload(options: {
  job: ImportJob
  files: readonly File[]
  signal: AbortSignal
  onProgress(progress: UploadProgress): void
}): Promise<ImportJob>
```

只允许一个进行中的 request；每次响应后更新内存中的 confirmed offset，全部完成后调用 queue。

- [ ] **Step 4: 运行续传器测试**

Run: `cd frontend && npm test -- --run src/features/dicom-import/core/resumableUploader.test.ts`

Expected: PASS。

### Task 8: hook 与对话框状态机

**Files:**
- Create: `frontend/src/features/dicom-import/hooks/useImportJob.ts`
- Create: `frontend/src/features/dicom-import/hooks/useImportJob.test.tsx`
- Modify: `frontend/src/features/dicom-import/components/DicomImportDialog.tsx`
- Modify: `frontend/src/features/dicom-import/components/DicomImportDialog.test.tsx`
- Modify: `frontend/src/styles/patients.css`

- [ ] **Step 1: 写 hook/UI 失败测试**

覆盖打开时 latest 查询、无任务新建、uploading 提示重新选择、queued/running 每秒轮询、关闭
uploading 时 abort 暂停、关闭 running 时后台不取消、completed 只通知 `onImported` 一次、
failed 删除后重新开始、焦点恢复和非临床提示不消失。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm test -- --run src/features/dicom-import/hooks/useImportJob.test.tsx src/features/dicom-import/components/DicomImportDialog.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 实现 hook**

hook 暴露 `phase`、`job`、`progress`、`error`、`prepareAndUpload(files)`、`discard()`、`refresh()`；
轮询只在对话框打开且状态为 queued/running 时存在，cleanup 必须清 timer 和 AbortController。

- [ ] **Step 4: 最小修改对话框**

保留现有两个 file input 和 `ImportReport`。仅增加状态文案、字节进度、续传匹配错误、暂停说明
和“放弃任务/开始新导入”。不要新建任务中心或改 Patient 页面布局。

- [ ] **Step 5: 运行 hook/UI 测试**

Run: `cd frontend && npm test -- --run src/features/dicom-import/hooks/useImportJob.test.tsx src/features/dicom-import/components/DicomImportDialog.test.tsx`

Expected: PASS。

### Task 9: 回归、文档与 production 验收

**Files:**
- Create: `specs/007-background-import-resume/quickstart.md`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/README.md`
- Modify: `backend/tests/integration/test_frontend_static.py`

- [ ] **Step 1: 运行后端全量与空库迁移**

Run: `cd backend && uv run python -m pytest -q -p no:cacheprovider`

Run: 使用独立临时 `MEDICAL_CT_APP_DATA_DIR` 执行 `uv run alembic upgrade head`。

Expected: 全量通过，`alembic_version=004_create_import_jobs`。

- [ ] **Step 2: 运行前端全量和 production build**

Run: `cd frontend && npm test -- --run`

Run: `cd frontend && npm run build`

Expected: 全量通过；FastAPI 可托管新 `frontend/dist`。

- [ ] **Step 3: production 单进程 E2E**

使用脱敏 CT fixture 验证：上传一部分后刷新并从确认 offset 续传；全部上传后关闭对话框，后台
完成并保存五类报告；在 uploading 和 running 两个状态分别重启 FastAPI；确认 queued 自动继续、
Patient 删除门禁、完成后 Study/Series 可见、无外部请求、console/network 无未处理错误。

- [ ] **Step 4: 更新双语文档与 quickstart**

记录准确测试数量、迁移链、浏览器证据和已知非阻塞警告。README 明确单进程 worker、重新选择
同一批本机文件的续传边界，以及不支持跨设备/并行 worker。

- [ ] **Step 5: 最终静态检查**

Run: `git diff --check`

Run: `rg -n "TBD|TODO|NEEDS CLARIFICATION" specs/007-background-import-resume docs/superpowers/specs/2026-07-23-background-import-resume-design.md docs/superpowers/plans/2026-07-23-background-import-resume.md`

Expected: diff check 通过，Feature 文档无占位或未决项。

## 自检结果

- Spec coverage：任务覆盖持久化 job/file、顺序 chunk、offset、fingerprint、worker、重启、五类
  报告、Patient 删除、前端恢复、全量测试和 production E2E。
- Placeholder scan：无 `TBD`、`TODO`、`NEEDS CLARIFICATION`。
- Type consistency：后端统一使用 `uploading/queued/running/completed/failed`；前后端统一使用
  `relative_path`、`size_bytes`、`last_modified_ms`、`resume_fingerprint`、`confirmed_offset`。
