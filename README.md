**中文** | [English](README.en.md)

# 本地 CT 影像教学平台

> 教学演示软件，不用于临床诊断。

这是一个完全运行在本机的单用户医疗 CT 教学项目，用于演示从病人资料管理、DICOM 导入和本地持久化，到后台断点续传、轴位查看、三视图 MPR 联动、测量与标注、查看状态恢复及高级 3D 可视化的完整数据流。它不提供临床诊断、治疗决策或公网服务。

## 背景与目的

医疗影像教学需要同时处理结构化病人信息、DICOM 文件生命周期、二维查看工具、空间联动、安全的非临床测量、可恢复的查看上下文和本机三维可视化。本项目采用分阶段 Spec Kit 工作流，把病人管理、DICOM 导入、轴位查看、三视图 MPR、测量与标注、查看器状态持久化、后台导入断点续传和高级 3D 可视化拆分为可独立规格化、实现和验收的 Feature。

项目的主要目的包括：

- 演示本机 DICOM 数据从导入、索引、受管存储到浏览器显示的完整链路。
- 验证 SQLite 元数据与受管 DICOM 文件之间的数据一致性和安全失败行为。
- 提供轴位浏览、轴位/冠状位/矢状位联动 MPR，以及体绘制、MIP 和真实表面重建的教学示例。
- 在单机、单用户边界内，通过自动化测试和分阶段验收降低病人数据与影像文件误处理风险。

## 已完成功能

- **病人管理**：创建、查看、搜索、编辑和二次确认删除；病历号规范化唯一性校验；服务重启后数据仍可访问。
- **DICOM 导入与持久化**：导入本机文件或目录中的 CT DICOM，按 Study、Series、Instance 组织数据，逐文件报告成功、重复、跳过、不支持和失败，并把原始 DICOM 复制到本机受管目录。
- **轴位查看**：对 `eligible` Series 显示轴位切片，支持切片浏览、窗宽窗位、平移、缩放和重置。
- **三视图 MPR**：显示轴位、冠状位、矢状位三个 viewport，支持 Crosshairs 联动、共享窗宽窗位、独立平移/缩放、十字线显隐和完整重置。
- **测量与标注**：轴位和三个 MPR viewport 支持长度、角度、矩形 ROI、箭头文字标注、单项删除和确认清空；缺少可靠 Pixel Spacing 时禁用几何测量，Crosshairs 不会被清理。
- **查看器状态持久化**：按 Series 在 SQLite 中保存轴位/MPR 的切片、工具、灰度、相机、Crosshairs 和四类允许 annotation；annotation 绑定当前 Series 的 image identity，冠状位/矢状位标注按方向恢复，缺失影像时仅跳过对应标注；支持 500 ms 合并写入、退出/刷新/服务重启恢复、超限整份拒绝、保存失败重试，以及重置后删除已保存状态。
- **后台导入与断点续传**：先持久化清单，再按 4 MiB 顺序 chunk 从服务端确认 offset 续传；任务状态、五类导入报告和暂存内容跨刷新/服务重启保留，单 FastAPI 进程内 worker 在关闭对话框后继续处理，活动任务会阻止删除 Patient。仅支持在同一台机器上重新选择同一批文件，不支持跨设备续传或并行 worker。
- **高级 3D 可视化**：从满足空间条件的 CT 轴位页进入，复用同一次本机 volume 加载，支持骨/软组织/肺体绘制预设、六个标准方向与物理厚度的 MIP，以及按实际 HU 阈值运行的真实表面重建。表面计算完全在浏览器本机执行，超过 4,000,000 个采样点时自动降低采样密度并保持物理范围和方向；所有模式持续显示非临床提示，不保存 3D 会话状态。
- **安全失败恢复**：对数据库写入失败、病人删除清理失败、本机 DICOM 缺失、后端暂时不可用和查看器构建失败提供受控回滚、隔离、重试或安全提示；启动时会重试清理病人删除隔离残留和异常中断的导入临时目录。

## 系统架构与数据流

```text
开发模式：Browser -> Vite :5173 -> /api proxy -> FastAPI :8000
生产交付：Browser -> FastAPI :8000 -> frontend/dist + /api
                                      -> SQLite + Managed DICOM
```

前端开发服务器和后端 API 都只监听 loopback 地址。病人元数据、DICOM 文件和像素数据保留在本机；当前实现不向外部服务上传、同步或发送遥测。

## 技术栈

- 后端：Python 3.12、FastAPI、SQLAlchemy、Alembic、pydicom、SQLite、pytest。
- 前端：React 19、TypeScript、Vite、Vitest、Testing Library、Cornerstone3D 5.6.8、vtk.js 36.4.1。
- 规格与过程：GitHub Spec Kit 项目结构和项目内 Superpowers 设计/实施文档。

## 目录结构

| 目录 | 用途 |
| --- | --- |
| `backend/` | FastAPI API、SQLAlchemy 模型、Alembic 迁移、DICOM 解析/导入、受管存储和后端测试。 |
| `frontend/` | React 页面、病人/DICOM/轴位/MPR/查看器状态/高级 3D 功能、Cornerstone3D 与 vtk.js runtime，以及前端测试。 |
| `specs/` | 八个已实施 Feature 的 `spec.md`、`plan.md`、`tasks.md`、`quickstart.md` 及配套设计制品。 |
| `docs/` | 总体设计、功能设计、代码审查修复和实施计划。 |
| `.specify/` | Spec Kit 宪章、模板、脚本、工作流和当前 Feature 元数据。 |
| `data/` | 默认本机运行数据目录；包含 SQLite、受管 DICOM 和内部临时/隔离目录，不应提交到版本库。 |

## 环境要求

- Windows 10/11 与 PowerShell。
- Python 3.12。
- `uv`。
- Node.js 24.15.x 与 npm 11.12.x；仓库根目录 `.node-version` 和 `frontend/package.json` 是版本约束。
- 支持 WebGL 的现代 Chrome 或 Edge；高级 3D 计算会使用本机浏览器 CPU/GPU 和内存。

## 开发模式快速启动

在仓库根目录打开 PowerShell。后端和前端需要分别占用一个终端。

### 1. 启动后端

```powershell
cd backend
uv sync --locked --group dev
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

后端启动时会先自动把当前 SQLite 数据库升级到 Alembic head，再执行残留清理并启动后台导入 worker；
不需要单独运行迁移命令。需要检查迁移状态时仍可在 `backend/` 执行 `uv run alembic current`。

### 2. 启动前端

另开一个位于仓库根目录的 PowerShell：

```powershell
cd frontend
npm ci
npm run dev
```

浏览器访问 `http://127.0.0.1:5173`。

## Production 单进程运行

先构建前端，再启动后端；FastAPI 会从 `/` 同源提供 `frontend/dist`，因此运行时只需一个后端进程：

```powershell
cd frontend
npm ci
npm run build

cd ../backend
uv sync --locked --group dev
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

浏览器访问 `http://127.0.0.1:8000`。如果尚未生成 `frontend/dist/index.html`，FastAPI 仍会以 API-only 模式启动，`/api`、`/docs` 和 `/openapi.json` 不受影响。

## 本机数据目录

默认数据根目录是仓库根目录下的 `data/`：

```text
data/
├── patient-management.sqlite3  # 病人、Study、Series、Instance 与查看器状态
├── dicom/                      # 按病人和 DICOM UID 组织的受管原始文件
├── .imports/                   # 旧同步导入的内部临时目录
├── .import-jobs/               # 后台导入任务的可恢复暂存目录
└── .delete-staging/            # 病人删除过程的内部隔离目录
```

如需使用独立的本机数据目录，请在启动后端之前，在同一个后端终端设置：

```powershell
$env:MEDICAL_CT_APP_DATA_DIR = Join-Path $env:TEMP 'local-ct-imaging-lab-data'
```

`.imports/` 只用于既有同步导入操作的临时落盘；`.import-jobs/` 用于后台任务的持久化 chunk 暂存，单文件上限 512 MiB、单批最多 2,000 个文件且总量不超过 8 GiB。后台任务完成、失败或放弃后清理暂存；异常残留会在下次应用启动时安全重试。删除带有影像的病人时，系统先把该病人的受管 DICOM 目录移动到 `.delete-staging/`，再提交数据库删除，避免可访问数据库记录指向已删除文件；提交后的清理如果失败，剩余文件保持隔离，并在下次应用启动时逐项重试。

`.delete-staging/` 是 `ManagedStorage` 独占的内部目录：只有病人删除流程可以向其中创建暂存项。启动清理只检查其直接子目录，并拒绝符号链接、junction、普通文件或越出配置数据根目录的路径。不要手工向该目录放置文件、替换目录或把它用于其他数据；单项清理失败只记录安全 warning，不阻止其他项清理或本机服务启动。

请只导入已脱敏的教学 CT 数据，不要录入真实患者信息。备份、移动或删除 `data/` 前，应先停止后端服务。

## 基本使用流程

1. 创建一位虚构病人，并使病历号与待导入脱敏 CT 的 DICOM `PatientID` 匹配。
2. 在当前病人下选择已脱敏 CT DICOM 文件或目录并开始后台导入；刷新或关闭对话框后重新选择同一批文件即可从确认 offset 继续。
3. 等待后台任务完成，查看逐文件报告，确认成功、重复、跳过、不支持和失败项目。
4. 从检查与序列列表中打开一个 `eligible` Series 的轴位查看器。
5. 浏览切片，并使用窗宽窗位、平移、缩放、测量、箭头标注和重置工具。
6. 对符合条件的多切片 Series 进入三视图 MPR，使用联动定位、查看、测量和标注工具。
7. 退出、刷新页面或重启本机服务后重新打开同一 Series，核对轴位/MPR、Crosshairs 与四类 annotation 已恢复。
8. 使用“重置”恢复默认查看状态并删除该 Series 的保存；只清除 annotation 时使用“全部清空”并确认。

## 测试与 production build

后端：

```powershell
cd backend
uv run pytest -q -p no:cacheprovider
```

前端：

```powershell
cd frontend
npm test -- --run
npm run build
```

`npm run build` 同时执行 TypeScript `tsc --noEmit` 检查和 Vite production build。
`frontend/package.json` 还通过 `overrides` 固定已修复的 `adm-zip` 与 `uuid` 传递依赖版本；CI 会运行 `npm audit --audit-level=moderate`，避免后续锁文件重新引入已知中高风险版本。

## 文档导航

| Feature | 规格 | 任务 | 启动与验收 |
| --- | --- | --- | --- |
| 001 病人管理 | [spec](specs/001-patient-management/spec.md) | [tasks](specs/001-patient-management/tasks.md) | [quickstart](specs/001-patient-management/quickstart.md) |
| 002 DICOM 导入 | [spec](specs/002-dicom-import/spec.md) | [tasks](specs/002-dicom-import/tasks.md) | [quickstart](specs/002-dicom-import/quickstart.md) |
| 003 轴位查看器 | [spec](specs/003-axial-viewer/spec.md) | [tasks](specs/003-axial-viewer/tasks.md) | [quickstart](specs/003-axial-viewer/quickstart.md) |
| 004 三视图 MPR | [spec](specs/004-three-view-mpr/spec.md) | [tasks](specs/004-three-view-mpr/tasks.md) | [quickstart](specs/004-three-view-mpr/quickstart.md) |
| 005 测量与标注 | [spec](specs/005-measurement-annotation/spec.md) | [tasks](specs/005-measurement-annotation/tasks.md) | [quickstart](specs/005-measurement-annotation/quickstart.md) |
| 006 查看器状态持久化 | [spec](specs/006-viewer-state-persistence/spec.md) | [tasks](specs/006-viewer-state-persistence/tasks.md) | [quickstart](specs/006-viewer-state-persistence/quickstart.md) |
| 007 后台导入与断点续传 | [spec](specs/007-background-import-resume/spec.md) | [tasks](specs/007-background-import-resume/tasks.md) | [quickstart](specs/007-background-import-resume/quickstart.md) |
| 008 高级 3D 可视化 | [spec](specs/008-advanced-3d-visualization/spec.md) | [tasks](specs/008-advanced-3d-visualization/tasks.md) | [quickstart](specs/008-advanced-3d-visualization/quickstart.md) |

- [项目宪章](.specify/memory/constitution.md)
- [文档状态与导航](docs/README.md)
- [总体设计](docs/superpowers/specs/2026-07-16-medical-ct-viewer-design.md)
- [代码审查问题修复设计](docs/superpowers/specs/2026-07-21-code-review-fixes-design.md)
- [测量与标注设计](docs/superpowers/specs/2026-07-23-measurement-annotation-design.md)
- [查看器状态持久化设计](docs/superpowers/specs/2026-07-23-viewer-state-persistence-design.md)
- [高级 3D 可视化设计](docs/superpowers/specs/2026-07-23-advanced-3d-visualization-design.md)

## 当前限制与明确排除

当前版本明确不提供：

- PACS、Orthanc、DICOMweb、HIS、RIS 或其他外部医疗系统集成。
- 登录、账户、认证、角色、权限或多用户并发。
- 云服务、远程访问、外部备份、跨设备同步或遥测。
- 分割、自动病灶检测、诊断报告或诊断建议。
- 手术规划、3D 测量、网格导出、表面编辑或跨 Series 配准。
- 临床诊断、治疗决策、医疗设备注册、合规认证或其他临床使用。
- 书签、最近查看列表、深链接、截图、报告或跨设备查看状态同步。
- 跨设备导入、远程目录扫描、并行 worker 或跨设备断点续传。

## 已知非阻断 warning

- 后端测试存在 FastAPI/Starlette `TestClient` 与 `httpx` 兼容性的 `StarletteDeprecationWarning`。
- Cornerstone codec 在 production build 中存在 Node module externalization warning，Vite 还会报告较大的输出 chunk。
- 重复创建多个浏览器/渲染上下文的压力场景可能出现 WebGL context-limit warning；已验收的正常单实例流程和清理流程仍可用。

这些 warning 已记录，但不属于本次项目发布与存储清理工作的处理范围。
