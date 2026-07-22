# 本地 CT 影像教学平台项目重命名设计

## 背景

当前仓库名为 `TestProj`，前端包名为 `patient-management-frontend`，后端 API 标题为 `Patient Management API`，这些名称只覆盖了项目早期的病人管理阶段，无法准确表达当前已经包含的 DICOM 导入、轴位查看和三视图 MPR 教学能力。

## 目标

统一项目对外名称，使名称能够准确表达“本地 CT 影像教学平台”的用途，同时保持现有功能、接口、数据存储和历史验收记录不变。

## 采用的命名

| 层级 | 新名称 |
| --- | --- |
| 中文产品名 | `本地 CT 影像教学平台` |
| 英文产品名 | `Local CT Imaging Lab` |
| GitHub 仓库 | `lijie777/local-ct-imaging-lab` |
| 前端 npm 包 | `local-ct-imaging-lab-frontend` |
| 浏览器标题 | `本地 CT 影像教学平台` |
| 后端 API 标题 | `Local CT Imaging Lab API` |
| README 临时数据示例 | `local-ct-imaging-lab-data` |

## 实施范围

### 需要修改

- `README.md`：更新主标题及临时数据目录示例。
- `.specify/memory/constitution.md`：同步项目标题，并按 Governance 做 `1.0.1` PATCH 修订；原则正文、技术约束、流程和 Governance 语义保持不变。
- `frontend/index.html`：更新浏览器页面标题。
- `frontend/package.json`：更新前端包名。
- `frontend/package-lock.json`：同步根包名字段。
- `backend/app/main.py`：更新 FastAPI 标题和对应描述中的产品名称。
- GitHub 远程仓库：将 `lijie777/TestProj` 重命名为 `lijie777/local-ct-imaging-lab`，并同步本地 `origin` 地址。

### 明确保留

- 所有业务功能、API 路径、请求/响应字段和 OpenAPI 业务契约。
- SQLite 文件名 `patient-management.sqlite3`、环境变量 `MEDICAL_CT_APP_DATA_DIR` 及受管 DICOM 存储布局。
- 本地工作目录名 `TestProj`，避免破坏当前开发环境和脚本路径。
- `specs/001-*` 至 `specs/004-*` 的 Feature 编号、目录名、设计文档和历史验收证据路径。
- 历史 quickstart、plan 和 evidence 中出现的 `TestProj-*` 路径；它们是已完成验收的事实记录，不作为当前产品名继续使用。

## 行为与兼容性

本次只改变名称和文档元数据，不改变运行时业务行为。现有 API 客户端、数据库、DICOM 文件和本地启动方式应继续可用。GitHub 仓库重命名后，GitHub 通常会保留旧地址的重定向，但本地远程地址仍需显式同步为新地址。

## 验证标准

1. `README.md`、浏览器标题、前端包名和后端 API 元数据显示新名称。
2. 活动代码和配置中不再出现旧的产品级名称；历史 Spec、quickstart 和 evidence 中的旧路径可以保留。
3. 后端测试通过，前端测试通过，TypeScript 检查和生产构建通过。
4. GitHub 仓库名称、可见性、默认分支和本地 `origin` 地址均指向新仓库名。
5. 工作区只包含本次重命名相关改动。
6. `.specify/memory/constitution.md` 的标题、Sync Impact Report 和底部版本行一致，版本为 `1.0.1`，Ratified 保持 `2026-07-16`，Last Amended 为 `2026-07-22`。

## 操作边界

源码和文档修改完成并验证后，提交、推送以及 GitHub 仓库重命名仍作为单独的远程写入步骤执行；执行前需要再次确认准确的提交范围和目标仓库。
