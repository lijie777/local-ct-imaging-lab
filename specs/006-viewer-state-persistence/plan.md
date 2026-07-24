# Implementation Plan: 查看器状态持久化

**Branch**: `main` | **Date**: 2026-07-23 | **Spec**: [spec.md](spec.md)

## Summary

为每个 Series 增加一份 SQLite 版本化查看器状态，通过本机 FastAPI GET/PUT/DELETE API
读写。前端安全捕获和恢复轴位、MPR、Crosshairs 与四类 annotation，连续交互合并写入，
读取或保存失败时保持查看器可用；重置同时清除持久状态。

## Technical Context

**Language/Version**: Python 3.12、TypeScript 5.9、React 19

**Primary Dependencies**: FastAPI、Pydantic、SQLAlchemy 2、Alembic、Cornerstone3D 5.6.8

**Storage**: SQLite `viewer_states` 一对一 Series 表，版本列 + 受校验 JSON payload

**Testing**: pytest 9、Vitest 4、React Testing Library、真实生产浏览器验收

**Target Platform**: Windows 本机，FastAPI 单进程托管 production 前端

**Project Type**: React 前端 + FastAPI 后端的本地 Web 应用

**Performance Goals**: 连续交互停止 1 秒内完成保存；20 次快速变化最多 2 次 PUT；恢复不
额外复制像素/volume 数据

**Constraints**: 本地离线、单用户、非临床；payload ≤ 2 MiB、annotation ≤ 500；仅有限
数值与工具 allowlist；恢复失败不得阻止影像

**Scale/Scope**: 每个 Series 一份轴位/MPR/annotation 快照；last-write-wins

## Constitution Check

*GATE: 研究前与设计后均通过。*

- **Safety boundary**: 轴位与 MPR 保留持续可见非临床提示，并在持久化错误提示中不弱化边界。
- **Local data boundary**: 新 API、数据库和浏览器请求全部限 loopback；无外部服务或遥测。
- **Scope and stack**: 使用既有 React/FastAPI/SQLAlchemy/SQLite/Cornerstone；不新增依赖，
  不引入后台导入、3D、认证、PACS、DICOMweb 或报告。
- **Modularity and minimal change**: 后端 model/schema/service/router 分层；前端状态 codec、API、
  writer、annotation adapter 与 runtime 集成分离，不重构无关功能。
- **Verification**: 后端业务与合同使用 pytest；前端 codec/writer/runtime/UI 使用 Vitest/RTL；
  完成跨重启 E2E。
- **DICOM consistency**: 本功能只读 DICOM；查看状态随 Series 外键级联删除，不写受管文件。

## Project Structure

```text
backend/
├── alembic/versions/003_create_viewer_states.py
├── app/models/viewer_state.py
├── app/schemas/viewer_state.py
├── app/services/viewer_state_service.py
├── app/api/viewer_states.py
└── tests/{contract,integration,migration}/

frontend/src/features/viewer-state/
├── model/viewerState.ts
├── api/viewerStateApi.ts
├── core/annotationPersistence.ts
├── core/viewerStateWriter.ts
└── components/ViewerStateStatus.tsx

frontend/src/features/{axial-viewer,mpr-viewer}/
├── core/*Cornerstone.ts
├── components/*Viewport*.tsx
└── pages/*ViewerPage.tsx
```

**Structure Decision**: 新增独立 `viewer-state` Feature 保存协议、校验、API 和写入调度；两个
查看器 runtime 只负责 Cornerstone capture/apply，页面只负责 Series ID 和状态提示。

## Complexity Tracking

无宪章违规或需要豁免的复杂度。SQLite JSON 是 Cornerstone 状态的最小稳定边界；不新增依赖。

## Detailed Implementation Steps

逐步 TDD 命令和文件级改动见
[`docs/superpowers/plans/2026-07-23-viewer-state-persistence.md`](../../docs/superpowers/plans/2026-07-23-viewer-state-persistence.md)。
