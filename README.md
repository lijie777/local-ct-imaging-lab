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

| 功能 | 详细说明 |
| --- | --- |
| **病人管理** | 支持病人资料创建、详情查看、条件搜索、编辑和二次确认删除；病历号在规范化后保持唯一，输入错误和重复数据会返回明确提示；资料保存在本机 SQLite 中，服务重启后仍可访问。 |
| **DICOM 导入与持久化** | 支持选择本机文件或目录导入 CT DICOM，按 Study、Series、Instance 建立索引，并逐文件报告成功、重复、跳过、不支持和失败；原始文件复制到本机受管目录，删除病人时同步处理关联索引与受管影像。 |
| **轴位查看** | 对满足条件的 `eligible` Series 按正确实例顺序显示轴位切片，支持滚轮浏览、窗宽窗位、平移、缩放和一键重置；遇到文件缺失、格式不支持或服务暂时不可用时显示安全错误，不泄露本机绝对路径。 |
| **三视图 MPR** | 基于同一 CT 体数据同时显示轴位、冠状位和矢状位三个 viewport；支持 Crosshairs 空间联动、共享窗宽窗位、各视图独立平移/缩放、十字线显隐和完整重置。 |
| **测量与标注** | 轴位及三个 MPR 视图支持长度、角度、矩形 ROI、箭头文字标注、单项删除和确认清空；缺少可靠 Pixel Spacing 时自动禁用几何测量，清理标注时不会误删 Crosshairs。 |
| **查看器状态持久化** | 按 Series 在 SQLite 中保存切片位置、当前工具、窗宽窗位、相机、Crosshairs 和四类允许的 annotation；支持 500 ms 合并写入，刷新页面、退出查看器或重启后端后可以恢复；损坏、超限、版本不兼容或影像已不存在的状态会安全降级，保存失败可以重试，执行重置后会删除已保存状态。 |
| **后台导入与断点续传** | 先持久化导入任务和有序文件清单，再按 4 MiB 顺序分块上传，并根据服务端确认的 offset 继续传输；关闭导入窗口后单进程 worker 仍会处理任务，刷新页面或重启服务后可恢复任务、暂存内容和五类导入报告；活动任务会阻止删除对应 Patient。当前仅支持在同一台机器重新选择同一批文件，不支持跨设备续传或并行 worker。 |
| **3D 体绘制** | 从满足空间条件的 CT 轴位页进入并复用同一次本机 volume 加载；支持骨、软组织、肺三个体绘制预设，以及旋转、缩放和平移观察；计算和显示均在本机浏览器完成，并持续显示非临床用途提示。 |
| **MIP** | 支持最大密度投影，可在前、后、左、右、上、下六个标准观察方向之间切换，并按毫米调节投影厚度；从 MIP 返回体绘制时恢复之前选择的体绘制预设。 |
| **表面重建** | 根据实际 CT 体数据和 HU 阈值生成真实表面网格；超过 4,000,000 个采样点时自动降低采样密度，同时保持物理尺寸、空间范围和方向；表面计算失败时仍可返回体绘制或 MIP，无需重新下载 Series。 |
| **后端启动可靠性** | FastAPI 启动时先自动把当前 SQLite 数据库升级到 Alembic head，再执行残留清理并启动后台导入 worker，避免旧数据库缺少新表导致启动警告、任务反复重试或后台导入不可用。 |
| **单进程交付** | 前端生产构建输出到 `frontend/dist`，由 FastAPI 同时托管静态页面和 `/api`；交付环境只需运行一个后端进程，即可通过同一个本机地址访问完整应用。 |
| **安全失败恢复** | 对数据库写入失败、病人删除清理失败、本机 DICOM 缺失、导入中断、后端暂时不可用和查看器构建失败提供受控回滚、隔离、重试或安全提示；应用启动时会重试清理病人删除隔离残留和异常中断的导入临时目录。 |

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

## 未开发功能与后续计划

以下功能当前尚未开发，后续会根据优先级拆分为独立 Feature，依次完成规格、实现、测试和验收；只有对应 Feature 完成后，才会移入“已完成功能”：

- PACS、Orthanc、DICOMweb、HIS、RIS 及其他外部医疗系统集成。
- 登录、账户、认证、角色、权限和多用户并发。
- 外部备份、受控远程访问、跨设备同步和可选遥测管理。
- 影像分割、教学研究用途的自动检测辅助和非诊断性报告导出。
- 手术规划、3D 测量、网格导出、表面编辑和跨 Series 配准。
- 书签、最近查看列表、深链接、截图和跨设备查看状态同步。
- 跨设备导入、远程目录扫描、并行 worker 和跨设备断点续传。

上述内容是后续开发方向，不代表当前版本已经具备，也不构成具体版本或交付日期承诺；开发顺序和验收标准会在相应 Feature 的 `spec.md` 与 `tasks.md` 中单独确认。

## 长期产品边界

本项目保持本机、非临床教学演示定位，不提供临床诊断、诊断建议、治疗决策、医疗设备注册、合规认证或其他临床用途。后续新增的分割、检测、报告和规划能力也必须保持非诊断、非治疗用途边界。

## 已知非阻断 warning

- 后端测试存在 FastAPI/Starlette `TestClient` 与 `httpx` 兼容性的 `StarletteDeprecationWarning`。
- Cornerstone codec 在 production build 中存在 Node module externalization warning，Vite 还会报告较大的输出 chunk。
- 重复创建多个浏览器/渲染上下文的压力场景可能出现 WebGL context-limit warning；已验收的正常单实例流程和清理流程仍可用。

这些 warning 已记录，但不属于本次项目发布与存储清理工作的处理范围。
