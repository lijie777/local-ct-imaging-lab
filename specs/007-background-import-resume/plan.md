# Implementation Plan: 后台导入与断点续传

**Branch**: `main` | **Date**: 2026-07-23 | **Spec**: [spec.md](spec.md)

## Summary

为每位 Patient 增加最多一个活动的持久化导入任务。浏览器提交文件清单后按 4 MiB 数据块顺序
上传，服务端用 SQLite 确认 offset，并把可续传字节保存在独立 `.import-jobs` 目录。全部上传
完成后，FastAPI 单进程内唯一 worker 串行调用现有 `import_dicom_files`，保存五类报告；刷新、
网络中断和服务重启后继续，不引入 Redis、Celery 或第二个进程。

## Technical Context

**Language/Version**: Python 3.12、TypeScript 5.9、React 19

**Primary Dependencies**: FastAPI、Pydantic、SQLAlchemy 2、Alembic、pydicom、React；浏览器原生
File/Blob、Web Crypto 和 AbortController；不新增第三方依赖

**Storage**: SQLite `import_jobs`/`import_job_files` + 本机 `data/.import-jobs/{job_id}` 暂存目录

**Testing**: pytest 9、Vitest 4、React Testing Library、真实 production 浏览器验收

**Target Platform**: Windows 本机，FastAPI 单进程托管 production 前端

**Project Type**: React 前端 + FastAPI 后端的本地 Web 应用

**Performance Goals**: 任务/字节状态在 1 秒内可见；4 MiB 顺序 chunk；单 worker 无并行写入；
刷新或重启后不重复发送已确认字节

**Constraints**: 本地离线、单用户、非临床；1–2,000 文件、单文件 ≤512 MiB、总量 ≤8 GiB；
每 Patient 最多一个活动任务；不支持跨设备或运行中取消

**Scale/Scope**: 单机少量 Patient；每个 Patient 最多一个活动任务，全局单 worker 同时最多一个
`running` 任务，全量文件清单最多 2,000 项

## Constitution Check

*GATE: 研究前与设计后均通过。*

- **Safety boundary**: Patient/导入页面保留持续可见非临床提示，新增进度和错误使用可访问状态。
- **Local data boundary**: 清单、fingerprint、chunk、任务、报告和 DICOM 全部限 loopback 与本机目录。
- **Scope and stack**: 使用既有 React/FastAPI/SQLAlchemy/SQLite/pydicom 和浏览器原生 API；
  不新增依赖、云、认证、PACS、DICOMweb、报告或 Feature 008 的高级 3D。
- **Modularity and minimal change**: job model/schema/service/storage/worker/router 分离；前端 manifest、
  API、uploader、hook 和现有 dialog 分离；保留旧同步接口，不重构无关导入逻辑。
- **Verification**: 后端状态机/文件一致性使用 pytest；前端续传/UI 使用 Vitest/RTL；完成跨刷新、
  跨服务重启和后台关闭对话框的 production E2E。
- **DICOM consistency**: worker 复用现有五类报告与按 Study 事务；活动任务阻止 Patient 删除；
  终态/放弃清理暂存，已提交 SOP 由既有去重保护。

## Project Structure

```text
backend/
├── alembic/versions/004_create_import_jobs.py
├── app/models/import_job.py
├── app/schemas/import_job.py
├── app/services/import_job_{service,storage,worker}.py
├── app/api/import_jobs.py
└── tests/{contract,integration,migration,unit}/

frontend/src/features/dicom-import/
├── model/importJob.ts
├── core/{importManifest,resumableUploader}.ts
├── api/importJobApi.ts
├── hooks/useImportJob.ts
└── components/DicomImportDialog.tsx
```

**Structure Decision**: 在现有 `dicom-import` 前端 Feature 内增加续传边界，复用报告和 Patient 页面；
后端新增独立 job 模块，只通过 `ImportSource` 调用既有同步导入服务，不把 worker 状态塞进
`dicom_import.py` 或 `managed_storage.py`。

## Complexity Tracking

无宪章违规。新增持久化 job/file 两表和独立暂存目录是跨刷新/重启续传的最小边界；消息队列、
多 worker、增量哈希库和运行中取消均被排除。

## Detailed Implementation Steps

逐步 TDD 命令、文件职责和验收步骤见
[`docs/superpowers/plans/2026-07-23-background-import-resume.md`](../../docs/superpowers/plans/2026-07-23-background-import-resume.md)。
