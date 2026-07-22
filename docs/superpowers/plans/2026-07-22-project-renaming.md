# Project Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将项目统一命名为“本地 CT 影像教学平台 / Local CT Imaging Lab”，同时保持业务行为、数据文件、Spec 标识和历史验收记录不变。

**Architecture:** 这是一次元数据和文档层面的重命名。产品显示名、前端 npm 元数据和 FastAPI 应用元数据分别在现有文件中更新；不改变 API 路径、React 功能组件、数据库配置或 DICOM 存储流程。GitHub 仓库重命名和本地远程地址同步作为实现后的单独远程写入步骤。

**Tech Stack:** Markdown、JSON、React/Vite、FastAPI、Python、npm、uv、Git、GitHub CLI。

---

## 文件变更地图

| 文件/系统 | 责任 | 计划动作 |
| --- | --- | --- |
| `README.md` | 项目对外说明和启动示例 | 更新主标题与临时数据目录示例 |
| `.specify/memory/constitution.md` | 活动项目治理文件 | 同步项目标题、Sync Impact Report 和 `1.0.1` PATCH 版本元数据 |
| `frontend/index.html` | 浏览器页面标题 | 更新 `<title>` |
| `frontend/package.json` | 前端 npm 包元数据 | 更新根 `name` |
| `frontend/package-lock.json` | npm 锁文件根包元数据 | 同步两个根 `name` 字段 |
| `backend/app/main.py` | FastAPI 应用元数据 | 更新 `title` 和产品描述 |
| `specs/`、历史 quickstart/evidence | 规格和验收事实记录 | 不修改 |
| GitHub remote | 远程仓库身份 | 在最终远程写入确认后重命名并同步 `origin` |

### Task 1: 更新 README 和浏览器产品名称

**Files:**
- Modify: `README.md:1`
- Modify: `README.md:109`
- Modify: `.specify/memory/constitution.md:1-21,98`
- Modify: `frontend/index.html:7`

- [ ] **Step 1: 更新 README 主标题**

将文件第一行替换为：

```markdown
# 本地 CT 影像教学平台
```

保留后续背景、目的、功能和免责声明内容不变。

- [ ] **Step 2: 更新 README 临时数据目录示例**

将 PowerShell 示例中的：

```powershell
$env:MEDICAL_CT_APP_DATA_DIR = Join-Path $env:TEMP 'TestProj-data'
```

替换为：

```powershell
$env:MEDICAL_CT_APP_DATA_DIR = Join-Path $env:TEMP 'local-ct-imaging-lab-data'
```

不要修改 `MEDICAL_CT_APP_DATA_DIR` 变量名或真实数据目录结构说明。

- [ ] **Step 3: 同步活动项目宪章标题与修订报告**

将 `.specify/memory/constitution.md` 的标题替换为：

```markdown
# 本地 CT 影像教学平台项目宪章
```

将顶部 Sync Impact Report 更新为本次修订报告，精确记录：

- Version change: `1.0.0 -> 1.0.1`
- Project title: `本地医疗 CT 病人管理与三视图预览系统 -> 本地 CT 影像教学平台`
- Modified principles、Added sections、Removed sections 均为 `None`
- `.specify/templates/{plan,spec,tasks,constitution}-template.md` 均已 reviewed，no update required
- `.agents/skills/speckit-*/SKILL.md` 均已 reviewed，no update required
- `README.md` 和本次重命名 design/plan 均已 updated
- Follow-up TODOs: `None`

原则正文、技术与范围约束、开发流程与质量门禁以及 Governance 语义保持不变。

- [ ] **Step 4: 更新宪章 PATCH 版本元数据**

将底部版本行替换为：

```markdown
**Version**: 1.0.1 | **Ratified**: 2026-07-16 | **Last Amended**: 2026-07-22
```

- [ ] **Step 5: 更新浏览器标题**

将 `frontend/index.html` 中的：

```html
<title>病人管理教学演示</title>
```

替换为：

```html
<title>本地 CT 影像教学平台</title>
```

- [ ] **Step 6: 检查文档差异**

运行：

```powershell
git diff -- README.md .specify/memory/constitution.md frontend/index.html
```

预期：只包含产品标题、宪章修订报告与版本元数据、临时数据示例的改动，不出现原则正文、功能说明、启动命令或免责声明的无关变化。

### Task 2: 更新前端包名和后端 API 元数据

**Files:**
- Modify: `frontend/package.json:2`
- Modify: `frontend/package-lock.json:2,8`
- Modify: `backend/app/main.py:332-338`

- [ ] **Step 1: 更新前端 package name**

将 `frontend/package.json` 根字段更新为：

```json
{
  "name": "local-ct-imaging-lab-frontend"
}
```

保留版本号、依赖和 scripts 不变。

- [ ] **Step 2: 同步 package-lock 根元数据**

将 `frontend/package-lock.json` 顶层和 `packages[""]` 两处根包名都更新为：

```json
"name": "local-ct-imaging-lab-frontend"
```

不要重新生成或升级依赖，避免引入与重命名无关的锁文件差异。

- [ ] **Step 3: 更新 FastAPI 应用元数据**

将 `backend/app/main.py` 的应用构造参数更新为：

```python
application = FastAPI(
    title="Local CT Imaging Lab API",
    version="0.3.0",
    description=(
        "Local-only API for Local CT Imaging Lab, an educational medical CT application. "
        "Not for clinical diagnosis."
    ),
    lifespan=_application_lifespan(configured_storage),
)
```

保留版本号、生命周期、路由注册和 OpenAPI 业务 schema 不变。

- [ ] **Step 4: 检查元数据差异**

运行：

```powershell
git diff -- frontend/package.json frontend/package-lock.json backend/app/main.py
```

预期：只包含包名、API 标题和 API 产品描述的改动。

### Task 3: 做活动代码和兼容性审计

**Files:**
- Inspect: `.specify/memory/constitution.md`, `README.md`, `frontend/`, `backend/`
- Preserve: `backend/app/core/config.py`, `specs/`, 历史 quickstart 和 evidence 路径

- [ ] **Step 1: 检查活动代码中的旧产品级名称**

运行：

```powershell
rg -n -i --glob '!frontend/node_modules/**' --glob '!backend/.venv/**' --glob '!specs/**' --glob '!docs/**' --glob '!*.lock' "TestProj|Patient Management API|patient-management-frontend|病人管理教学演示|本地医疗 CT 教学与三视图预览系统|本地医疗 CT 病人管理与三视图预览系统" .specify README.md frontend backend
```

预期：不再出现旧的活动产品级名称；宪章 Sync Impact Report 中用于说明本次变更的旧标题不是活动名称。`patient-management.sqlite3`、`MEDICAL_CT_APP_DATA_DIR` 等数据兼容标识不在本次搜索的删除范围内；历史 `specs/`、quickstart 和 evidence 不纳入清理。

- [ ] **Step 2: 确认保留项未被改动**

运行：

```powershell
git diff -- backend/app/core/config.py .specify specs
```

预期：tracked diff 中 `.specify/memory/constitution.md` 只包含计划内标题和 PATCH 修订元数据，`backend/app/core/config.py` 与 `specs/` 没有重命名产生的改动；Spec Feature 编号、历史路径和数据库文件名保持原样。两份未跟踪文档在下一步单独检查，不以 `git diff` 的结果代替。

- [ ] **Step 3: 检查格式和工作区范围**

运行：

```powershell
git diff --check
$renameDocs = @(
    'docs/superpowers/specs/2026-07-22-project-renaming-design.md'
    'docs/superpowers/plans/2026-07-22-project-renaming.md'
)
$whitespaceHits = @(rg -n '[ \t]+$' $renameDocs)
$clarificationMarker = 'NEEDS' + ' CLARIFICATION'
$placeholderPattern = '\{\{[^}]+\}\}|' + [regex]::Escape($clarificationMarker) + '|\[(TODO|TBD|PLACEHOLDER)(:[^]]*)?\]|<[A-Z][A-Z0-9_-]+>'
$placeholderHits = @(rg -n $placeholderPattern $renameDocs)
if ($whitespaceHits.Count -ne 0 -or $placeholderHits.Count -ne 0) {
    $whitespaceHits
    $placeholderHits
    throw 'Untracked rename docs contain whitespace errors or unresolved placeholders.'
}
git status --short -- docs/superpowers/specs/2026-07-22-project-renaming-design.md docs/superpowers/plans/2026-07-22-project-renaming.md
git status --short
```

预期：`git diff --check` 对 tracked diff 无输出；两组 `rg` 均无命中；文档范围状态只显示上述两份 `??` 文件；根目录 `git status --short` 显示工作区只包含 `.specify/memory/constitution.md`、`README.md`、`frontend/index.html`、前端包元数据、`backend/app/main.py` 以及这两份设计和计划文档。

### Task 4: 运行现有验证

**Files:**
- Test: existing backend and frontend test suites

- [ ] **Step 1: 运行后端测试**

运行：

```powershell
Set-Location backend
uv run pytest
Set-Location ..
```

预期：后端测试全部通过；允许出现项目既有的非阻塞弃用 warning，但不能新增失败。

- [ ] **Step 2: 运行前端测试**

运行：

```powershell
Set-Location frontend
npm test -- --run
Set-Location ..
```

预期：前端测试全部通过。

- [ ] **Step 3: 运行 TypeScript 检查和生产构建**

运行：

```powershell
Set-Location frontend
npm run build
Set-Location ..
```

预期：TypeScript 检查和 Vite production build 均成功。

- [ ] **Step 4: 汇总验证结果**

运行：

```powershell
git diff --stat
git status --short
```

预期：变更范围仍限于命名相关文件，测试和构建不会生成应提交的临时产物。

## 最终远程写入步骤（单独确认后执行）

以下操作不在本计划的本地实现步骤中自动执行。完成 Task 1–4 后，先再次确认准确提交范围和目标，再执行：

```powershell
gh repo view lijie777/TestProj --json nameWithOwner,visibility,defaultBranchRef
gh repo rename local-ct-imaging-lab --yes
git remote set-url origin https://github.com/lijie777/local-ct-imaging-lab.git
git remote -v
gh repo view lijie777/local-ct-imaging-lab --json nameWithOwner,visibility,defaultBranchRef
```

随后才在独立确认下进行 commit 和 push；提交内容只应包含 Task 1–4 的命名改动及已确认的设计/计划文档。
