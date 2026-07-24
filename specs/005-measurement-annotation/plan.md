# Implementation Plan: 测量与标注

**Branch**: `main` | **Date**: 2026-07-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-measurement-annotation/spec.md`

## Summary

在轴位与三视图 MPR 查看器中接入 Cornerstone3D 原生长度、角度、矩形 ROI 和箭头文字
标注，并提供只处理本功能 annotation 的单项删除和确认清空。Feature 005 只保存当前
runtime 会话状态，不新增后端 API、数据库迁移或依赖。

## Technical Context

**Language/Version**: TypeScript 5.9、React 19

**Primary Dependencies**: Cornerstone3D 5.6.8、Vite（不新增 npm 依赖）

**Storage**: N/A；annotation 仅存在于当前 Cornerstone runtime

**Testing**: Vitest、React Testing Library；后端 pytest 只做回归验证

**Target Platform**: Windows 本机浏览器，由本机 FastAPI 单进程托管构建后的前端

**Project Type**: React 前端 + FastAPI 后端的本地 Web 应用

**Performance Goals**: 工具切换和标注编辑保持交互响应，不额外复制体数据或重算测量结果

**Constraints**: 本地离线、单用户、非临床；缺少可靠 Pixel Spacing 时禁用几何测量；
不得删除 Crosshairs；不得使用 `prompt()` 或全局 `removeAllAnnotations()`

**Scale/Scope**: 单个轴位 runtime 或共享一个 volume 的三个 MPR viewport；五个交互工具

## Constitution Check

*GATE: 设计前与设计后均通过。*

- **Safety boundary**: 复用并在文字对话框重复“教学演示软件，不用于临床诊断”提示。
- **Local data boundary**: 无网络、云或远程数据流；annotation 仅保留在本机内存。
- **Scope and stack**: 作为独立 Feature 增加测量与标注，不引入认证、PACS、DICOMweb、
  诊断报告、持久化、后台导入或高级三维功能，也不新增依赖。
- **Modularity and minimal change**: 共享 annotation 边界独立于轴位和 MPR runtime；不重构
  无关病人、导入或后端代码。
- **Verification**: 纯函数、控制器、组件和两个 runtime 均有 Vitest/Testing Library
  测试，并执行真实浏览器端到端验收和后端回归。
- **DICOM consistency when applicable**: 本 Feature 不写入 DICOM、数据库或受管文件。

## Project Structure

### Documentation (this feature)

```text
specs/005-measurement-annotation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── tasks.md
```

### Source Code (repository root)

```text
frontend/src/features/
├── viewer-annotations/
│   ├── model/
│   ├── core/
│   └── components/
├── axial-viewer/
└── mpr-viewer/

frontend/src/styles/viewer-annotations.css
```

**Structure Decision**: 共享模型、Cornerstone controller 和 React UI 放入独立
`viewer-annotations` Feature；轴位与 MPR 仅在各自 runtime 和组件中接入。

## Complexity Tracking

无宪章违规或需要豁免的复杂度。

## Detailed Implementation Steps

具体 TDD 步骤、文件清单和命令见
[`docs/superpowers/plans/2026-07-23-measurement-annotation.md`](../../docs/superpowers/plans/2026-07-23-measurement-annotation.md)。
