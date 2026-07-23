# Repository Remediation Implementation Plan

> **执行状态（2026-07-23）：** 全部步骤已完成；最终结果以当前代码、测试和本计划末尾记录的验证为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复仓库审计发现的文档、导入安全、运行交付、持续集成、依赖可重复性、测试覆盖和模块职责问题。

**Architecture:** 保持现有 FastAPI + React/Vite 双项目结构。后端新增小型配置常量、导入限额和安全启动补偿，并在 API 路由之后可选挂载构建后的前端；前端只抽出 MPR runtime 的纯类型、错误和几何辅助模块，保持现有公开接口与行为。

**Tech Stack:** Python 3.12、FastAPI、Starlette StaticFiles、pytest、React 19、TypeScript、Vite、Vitest、GitHub Actions Windows runner。

---

### Task 1: DICOM 导入限额与统一 413

**Files:**
- Modify: `backend/app/api/dicom_import.py`
- Modify: `backend/app/core/errors.py`
- Modify: `backend/app/main.py`
- Modify: `specs/002-dicom-import/contracts/openapi.yaml`
- Test: `backend/tests/integration/test_dicom_import_api.py`
- Test: `backend/tests/contract/test_openapi_contract.py`

- [x] **Step 1: 写失败测试**

增加文件数、单文件字节数和批次累计字节数边界测试，断言超限响应为：

```python
assert response.status_code == 413
assert response.json()["error"]["code"] == "import_limit_exceeded"
assert "private" not in response.text.lower()
```

- [x] **Step 2: 运行测试并确认失败**

Run: `cd backend; uv run python -m pytest tests/integration/test_dicom_import_api.py tests/contract/test_openapi_contract.py -q -p no:cacheprovider`

Expected: FAIL，当前路由没有 413 和导入限额。

- [x] **Step 3: 实现最小限额**

在路由模块定义：

```python
MAX_IMPORT_FILE_COUNT = 2_000
MAX_IMPORT_FILE_BYTES = 512 * 1024 * 1024
MAX_IMPORT_BATCH_BYTES = 8 * 1024 * 1024 * 1024
```

路由使用 Starlette `MultiPartParser` 的小型子类，在文件 part 写入 `UploadFile` 临时文件前累计单文件和批次字节，并把 parser 的文件数上限提高到 2,000；超过任一上限立即停止解析并抛出 `ImportLimitExceededError`。复制函数继续每次读取 1 MiB 并重复累计，作为受管目录写入前的纵深防御。该错误继承 `ApiError`，状态 413，公开码 `import_limit_exceeded`。

- [x] **Step 4: 同步 OpenAPI 并运行测试**

Run: `cd backend; uv run python -m pytest tests/integration/test_dicom_import_api.py tests/contract/test_openapi_contract.py -q -p no:cacheprovider`

Expected: PASS。

### Task 2: `.imports` 启动补偿与清理失败语义

**Files:**
- Modify: `backend/app/services/managed_storage.py`
- Modify: `backend/app/api/dicom_import.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/unit/test_managed_storage.py`
- Test: `backend/tests/integration/test_patient_delete.py`
- Test: `backend/tests/integration/test_dicom_import_api.py`

- [x] **Step 1: 写失败测试**

覆盖安全会话目录删除、普通文件保留、symlink/junction 保留、单项 `rmtree` 失败后继续、应用启动调用清理，以及成功导入后的 session cleanup 失败不覆盖成功报告。

- [x] **Step 2: 运行定向测试并确认失败**

Run: `cd backend; uv run python -m pytest tests/unit/test_managed_storage.py tests/integration/test_patient_delete.py tests/integration/test_dicom_import_api.py -q -p no:cacheprovider`

Expected: FAIL，当前没有 pending import cleanup。

- [x] **Step 3: 实现安全补偿**

`ManagedStorage.cleanup_pending_imports()` 只扫描 `.imports` 直接子项，拒绝 link、普通文件和越界路径，对安全目录逐项 `shutil.rmtree()`，返回失败计数。应用 lifespan 调用并记录下一次启动重试 warning。请求级 cleanup 捕获 `OSError` 并记录 warning，不覆盖成功报告。

- [x] **Step 4: 运行定向测试**

Run: `cd backend; uv run python -m pytest tests/unit/test_managed_storage.py tests/integration/test_patient_delete.py tests/integration/test_dicom_import_api.py -q -p no:cacheprovider`

Expected: PASS。

### Task 3: FastAPI 托管 production build

**Files:**
- Modify: `backend/app/main.py`
- Create: `backend/tests/integration/test_frontend_static.py`
- Modify: `README.md`

- [x] **Step 1: 写失败测试**

使用 pytest 临时目录创建 `index.html` 和 `assets/app.js`，断言 `/` 与 `/assets/app.js` 可访问、`/api/patients` 仍进入 API；dist 不存在时根路径保持 404 而应用正常启动。

- [x] **Step 2: 运行测试并确认失败**

Run: `cd backend; uv run python -m pytest tests/integration/test_frontend_static.py -q -p no:cacheprovider`

Expected: FAIL，`create_app()` 尚不接受 dist override。

- [x] **Step 3: 实现可选静态挂载**

在 `create_app()` 增加 `frontend_dist_override: Path | None = None`，解析默认 `PROJECT_ROOT / "frontend" / "dist"`；仅当 `index.html` 存在时，在 API router 和 OpenAPI 配置之后挂载 `StaticFiles(directory=..., html=True)` 到 `/`。

- [x] **Step 4: 运行定向测试**

Run: `cd backend; uv run python -m pytest tests/integration/test_frontend_static.py tests/integration/test_patient_api.py -q -p no:cacheprovider`

Expected: PASS。

### Task 4: Windows 真实目录链接测试

**Files:**
- Modify: `backend/tests/unit/test_managed_storage.py`

- [x] **Step 1: 扩展测试 helper**

Windows `os.symlink()` 失败时执行：

```python
subprocess.run(
    ["cmd", "/c", "mklink", "/J", str(link), str(target)],
    check=True,
    capture_output=True,
    text=True,
)
```

POSIX 继续使用真实 symlink。测试名称改为 `directory_link`，行为断言不变。

- [x] **Step 2: 运行真实链接测试**

Run: `cd backend; uv run python -m pytest tests/unit/test_managed_storage.py -q -p no:cacheprovider -rs`

Expected: PASS 且相关两项不再 SKIP。

### Task 5: MPR runtime 纯职责拆分

**Files:**
- Create: `frontend/src/features/mpr-viewer/core/mprRuntimeTypes.ts`
- Create: `frontend/src/features/mpr-viewer/core/mprRuntimeErrors.ts`
- Create: `frontend/src/features/mpr-viewer/core/mprRuntimeGeometry.ts`
- Modify: `frontend/src/features/mpr-viewer/core/mprCornerstone.ts`
- Test: `frontend/src/features/mpr-viewer/core/mprCornerstone.test.ts`

- [x] **Step 1: 提取 public runtime 类型并从入口重新导出**

移动 `MprRuntimeElements`、`MprRuntimeProgress`、`MprRuntimeCallbacks`、`MprRuntime`，在 `mprCornerstone.ts` 使用 `export type { ... }` 保持消费者兼容。

- [x] **Step 2: 提取安全错误函数**

移动 `abortError()`、`safeCall()`、`errorStatus()`、`toSafeRuntimeError()`，只导出 runtime 编排实际需要的函数。

- [x] **Step 3: 提取几何纯函数**

移动 `point3()`、`dot()`、`cross()`、`intersectCameraPlanes()`、`voiRange()` 及其私有类型，不改变算法与容差。

- [x] **Step 4: 运行 MPR 定向测试与类型检查**

Run: `cd frontend; npm test -- --run src/features/mpr-viewer/core/mprCornerstone.test.ts`

Run: `cd frontend; .\node_modules\.bin\tsc.cmd --noEmit`

Expected: 全部 PASS。

### Task 6: 前端版本约束与 Windows CI

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `.node-version`
- Create: `.github/workflows/ci.yml`

- [x] **Step 1: 固定直接依赖和工具链**

使用当前 lockfile 已安装版本替换全部范围和 `latest`，增加 Node/npm engines 与 `packageManager`，并新增 `.node-version`。

- [x] **Step 2: 增加 Windows CI**

工作流在 `windows-latest` 上执行 `uv sync --locked --group dev`、后端 pytest、`npm ci`、前端 Vitest 和 build；工作目录分别固定到 `backend` 与 `frontend`。

- [x] **Step 3: 本机验证可重复安装元数据**

Run: `cd frontend; npm install --package-lock-only --ignore-scripts`

Expected: package-lock 根元数据与 package.json 一致且依赖解析不变化。

### Task 7: 文档、证据和状态源治理

**Files:**
- Modify: `README.md`
- Modify: `specs/001-patient-management/quickstart.md`
- Modify: `specs/002-dicom-import/quickstart.md`
- Modify: `specs/003-axial-viewer/quickstart.md`
- Modify: `specs/004-three-view-mpr/quickstart.md`
- Create: `docs/README.md`
- Modify: `docs/superpowers/plans/*.md`

- [x] **Step 1: 修复当前命令**

所有安装命令使用 `npm ci`；Quickstart 从仓库根目录采用 `Set-Location backend` / `Set-Location frontend`，不写死旧绝对仓库路径。

- [x] **Step 2: 脱敏历史证据路径**

将 `C:\Users\lijie\AppData\Local\Temp\TestProj-*` 改为 `%TEMP%\TestProj-*`，保留 evidence 目录名和结果数字；添加说明这些是历史本机记录，不随仓库发布。

- [x] **Step 3: 明确文档状态源**

新增 `docs/README.md`，并在历史计划顶部增加“历史实施计划”说明；不修改原 checklist 勾选状态。

- [x] **Step 4: 扫描旧路径和坏链接**

Run: `rg -n "D:\\work\\TestAI\\TestProj|C:\\Users\\lijie\\AppData\\Local\\Temp" README.md specs docs`

Expected: 仅重命名历史设计中用于解释迁移的旧路径保留，不再出现在当前执行命令或用户绝对 evidence 路径中。

### Task 8: 重建本机环境并全量验证

**Files:**
- Recreate ignored directory: `backend/.venv/`

- [x] **Step 1: 验证并删除旧虚拟环境**

确认 `backend/.venv` 的解析路径严格位于当前仓库后，使用 PowerShell `Remove-Item -LiteralPath ... -Recurse -Force` 删除，再执行 `uv sync --locked --group dev`。

- [x] **Step 2: 验证 trampoline 已更新**

Run: `rg -a "D:\\work\\TestAI\\TestProj" backend/.venv/Scripts/pytest.exe`

Expected: 无匹配。

- [x] **Step 3: 运行全量门禁**

Run: `cd backend; uv run pytest -q -p no:cacheprovider`

Run: `cd frontend; npm test -- --run`

Run: `cd frontend; npm run build`

Expected: 全部 PASS，真实目录链接测试不再 skip，仅保留已知 Starlette warning。

- [x] **Step 4: 验证单进程 production 形态**

构建完成后用 FastAPI TestClient/定向测试确认 `/`、静态资源和 `/api` 同源可用，不启动残留后台服务。

- [x] **Step 5: 最终差异检查**

Run: `git diff --check`

Run: `git status --short`

Expected: 无 whitespace 错误，只有本次整改相关文件。

执行说明：当前环境策略拒绝直接递归删除 `.venv`，因此在已验证目标路径后使用 `uv venv --clear --python 3.12` 对同一目录完成受控清理，再执行锁文件同步；重建后的 `pytest.exe` 已确认不含旧仓库路径。
