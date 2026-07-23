# 仓库完整整改设计

## 背景

仓库已具备完整的 Spec Kit 制品、前后端实现、分层自动化测试和真实浏览器验收记录，但整体审计发现以下问题：项目重命名后部分可执行文档仍使用旧路径；历史验收证据指向不可移植的本机绝对路径；DICOM 导入缺少批次限额和异常退出后的临时目录补偿；真实目录链接安全测试可能因 Windows 权限被跳过；仓库没有持续集成；前端直接依赖和 Node/npm 版本约束不足；production build 没有单进程运行形态；部分历史计划的未勾选状态容易与当前完成状态混淆；MPR runtime 文件承担了过多纯辅助职责；本机 Python 虚拟环境仍内嵌重命名前路径。

## 目标

1. 修正文档中的当前可执行命令，同时保留历史验收事实。
2. 让前端 production build 由 FastAPI 同源托管，构建后只需一个后端进程即可运行。
3. 为 DICOM 导入增加明确、可测试的资源上限，并补齐 `.imports` 异常残留的启动补偿。
4. 让真实目录链接安全测试在普通 Windows 环境优先使用 junction 继续执行。
5. 建立可重复的前后端依赖安装和 Windows CI 质量门禁。
6. 在不改变 MPR runtime 对外接口和行为的前提下拆出纯辅助职责。
7. 重建本机后端虚拟环境，消除旧仓库路径。

## 明确边界

- 不改变既有 Patient、Study、Series、Instance 数据模型和数据库迁移。
- 不改变现有 `/api` 业务路径、成功响应或 DICOM 五类报告语义。
- 不加入认证、PACS、DICOMweb、云服务、遥测、诊断、测量或三维体绘制。
- 不引入新的 Python 或 npm 依赖。
- 不自动提交、推送、创建 Release 或修改远程仓库状态。

## 运行架构

### 开发模式

开发模式保持两个进程：Vite 监听 `127.0.0.1:5173` 并代理 `/api` 到 FastAPI `127.0.0.1:8000`。该模式继续支持热更新，不依赖已生成的 `frontend/dist`。

### Production build 本机运行

先在 `frontend/` 执行 `npm ci` 和 `npm run build`。FastAPI 创建应用时检查仓库内 `frontend/dist/index.html`：存在时，在全部 `/api` 路由之后挂载静态目录到 `/`；不存在时保持 API-only 启动，不阻断后端测试、迁移或开发模式。

静态挂载必须满足：

- `/api/*` 始终由既有 API 路由处理，不能被 SPA fallback 覆盖。
- `/` 返回构建后的 `index.html`，`/assets/*` 返回构建资源。
- 静态路径解析沿用 Starlette `StaticFiles` 的包含性保护。
- 不新增独立反向代理或部署框架。

## DICOM 导入资源限制

采用固定教学场景上限：

- 单文件最大 `512 MiB`。
- 单批最多 `2,000` 个文件。
- 单批总量最大 `8 GiB`。

文件数、单文件字节数和批次总量在 Starlette multipart parser 接收每个文件 part 时累计检查，超限后立即停止解析并关闭已创建的临时文件；受管目录复制阶段保留同样的字节检查作为纵深防御。这样不会先把超限请求完整 spool 到系统临时目录。超限统一返回 HTTP 413、错误码 `import_limit_exceeded` 和不包含内部路径的中文消息。超限或复制失败后关闭已接收的 `UploadFile`，并清理当前导入会话。

## 临时导入目录补偿

`ManagedStorage` 增加启动清理入口，只检查 `.imports` 的直接子项：

- 只删除真实目录；拒绝 symlink、junction、普通文件和越出 `.imports` 根目录的目标。
- 每个安全目录独立清理；单项失败只计数并记录 warning，不阻断其他项或应用启动。
- 应用 lifespan 在处理 `.delete-staging` 后执行该清理，失败项留待下次启动重试。
- 正常请求结束仍执行当前会话清理；若业务已成功但临时目录清理失败，记录 warning 并返回原成功报告，避免用户重试造成重复导入。

## 测试与 CI

后端新增：

- 文件数、单文件和批次总量边界测试。
- 413 运行时合同与错误响应测试。
- `.imports` 安全启动清理、失败继续和非法子项保留测试。
- FastAPI 静态托管、API 优先和 dist 缺失测试。

真实目录链接测试在 Windows 上先尝试 `os.symlink()`；若缺少权限，则在 pytest 临时目录内使用 `cmd /c mklink /J` 创建 junction。只有平台确实无法创建任何目录链接时才允许 skip。

新增 Windows GitHub Actions 工作流，依次执行：

1. 安装 Python 3.12 和 `uv`。
2. `uv sync --locked --group dev`。
3. `uv run python -m pytest -q -p no:cacheprovider`。
4. 安装 Node 24.15.0。
5. `npm ci`。
6. `npm test -- --run`。
7. `npm run build`。

## 前端依赖与工具链

`package.json` 的直接依赖使用当前 lockfile 已解析版本，不保留 `latest`。新增：

- `engines.node`: `>=24.15.0 <25`
- `engines.npm`: `>=11.12.1 <12`
- `packageManager`: `npm@11.12.1`
- 仓库级 `.node-version`: `24.15.0`

README 和各 Quickstart 的全新安装命令统一使用 `npm ci`。

## 文档与证据

- 当前操作命令使用仓库根目录相对路径，不写死 `D:\work\TestAI\TestProj`。
- 历史 evidence 目录名 `TestProj-*` 保留，但用户目录前缀改为 `%TEMP%`，并标注证据是历史本机记录、不随仓库分发。
- 新增 `docs/README.md`，明确 `specs/*/spec.md` 与 `specs/*/tasks.md` 是需求和完成状态的权威来源；`docs/superpowers/plans` 是历史实施计划，未勾选框不代表当前功能未完成。
- 历史计划文件只增加统一状态说明，不批量改写原步骤或伪造完成勾选。

## MPR runtime 拆分

保持 `frontend/src/features/mpr-viewer/core/mprCornerstone.ts` 导出的 `createMprRuntime()` 和现有类型名兼容，抽出：

- `mprRuntimeTypes.ts`：runtime elements、callbacks、progress 和 public runtime 接口。
- `mprRuntimeErrors.ts`：AbortError 创建、best-effort safe call、HTTP 状态提取和安全错误文案。
- `mprRuntimeGeometry.ts`：三维点校验、向量运算、相机平面交点和 VOI 范围解析。

原文件只保留 Cornerstone 初始化、viewport/volume/tool 绑定、事件协调、共享 VOI、重置和资源生命周期编排。不引入 Controller、事件总线、继承层次或新的 runtime abstraction。

## 本机环境修复

确认 `backend/.venv` 的绝对路径位于当前仓库后，删除该忽略目录并执行 `uv sync --locked --group dev` 重建。验证 `pytest.exe` 不再包含 `D:\work\TestAI\TestProj`，随后使用 README 中的 `uv run pytest` 原命令执行全量后端测试。

## 完成标准

1. 所有当前文档命令不再依赖旧仓库目录。
2. FastAPI 能在构建后从 `/` 提供 UI，且全部 `/api` 回归测试通过。
3. 三类导入限额和 `.imports` 启动补偿均有自动化测试。
4. Windows 真实目录链接测试在本机不再 skip；若外部平台无法创建链接，日志必须说明两种创建方式均失败。
5. 后端 pytest、前端 Vitest、TypeScript 检查和 production build 全部通过。
6. `npm ci` 与 `uv sync --locked` 可从锁文件恢复环境。
7. `git diff --check` 通过，工作区只包含本次整改相关改动。
