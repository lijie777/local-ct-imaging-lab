# 项目发布与删除残留自动清理 Implementation Plan

> **状态说明（2026-07-23）：** 本文件是历史实施计划，保留未勾选项用于过程追溯；当前需求与完成状态以对应 `specs/*/spec.md` 和 `specs/*/tasks.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为病人删除隔离残留增加安全的启动时自动重试清理，补齐项目 README 和最新验收记录，并在最终确认后首次发布到私有 GitHub 仓库。

**Architecture:** `ManagedStorage` 负责安全枚举和逐项清理 `.delete-staging`，FastAPI lifespan 只负责在真实应用启动时触发清理并按失败数量记录 warning。README 和 quickstart 只记录当前已验证行为；Git/GitHub 写入在代码与文档验证完成后经过独立确认门执行。

**Tech Stack:** Python 3.12、FastAPI lifespan、SQLAlchemy、pytest、React 19、TypeScript、Vite、Vitest、Cornerstone3D、Git、GitHub CLI。

---

## 文件结构

- Modify `backend/app/services/managed_storage.py`: 安全枚举并清理启动前遗留的删除暂存目录。
- Modify `backend/app/main.py`: 在 FastAPI lifespan 中触发残留清理并记录聚合 warning。
- Modify `backend/tests/unit/test_managed_storage.py`: 覆盖无目录、成功、单项失败继续和非目录拒绝。
- Modify `backend/tests/integration/test_patient_delete.py`: 覆盖 TestClient 启动触发和失败不阻止服务。
- Create `README.md`: 项目背景、目的、功能、架构、启动、使用、测试、数据边界和文档导航。
- Modify `specs/004-three-view-mpr/quickstart.md`: 追加本次发布前回归记录，保留历史验收数据。
- Modify `docs/superpowers/plans/2026-07-22-repository-publication-and-storage-cleanup.md`: 实施完成后勾选任务。

### Task 1: 为删除暂存残留补充失败测试

**Files:**
- Modify: `backend/tests/unit/test_managed_storage.py`

- [x] **Step 1: 增加不存在目录和成功清理测试**

```python
def test_pending_delete_cleanup_is_noop_without_staging_directory(
    tmp_path: Path,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))

    failed = storage.cleanup_pending_patient_deletes()

    assert failed == 0
    assert not storage.delete_staging_dir.exists()


def test_pending_delete_cleanup_removes_all_staged_directories(
    tmp_path: Path,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    first = storage.delete_staging_dir / "first"
    second = storage.delete_staging_dir / "second"
    first.mkdir(parents=True)
    second.mkdir()
    (first / "one.dcm").write_bytes(b"one")
    (second / "two.dcm").write_bytes(b"two")

    failed = storage.cleanup_pending_patient_deletes()

    assert failed == 0
    assert not first.exists()
    assert not second.exists()
```

- [x] **Step 2: 增加单项失败继续和未知文件拒绝测试**

```python
import shutil


def test_pending_delete_cleanup_keeps_failure_and_continues(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    failed_dir = storage.delete_staging_dir / "a-failed"
    removed_dir = storage.delete_staging_dir / "b-removed"
    failed_dir.mkdir(parents=True)
    removed_dir.mkdir()
    original_rmtree = shutil.rmtree

    def fail_one(path: Path) -> None:
        if Path(path) == failed_dir.resolve():
            raise OSError("locked")
        original_rmtree(path)

    monkeypatch.setattr(shutil, "rmtree", fail_one)

    failed = storage.cleanup_pending_patient_deletes()

    assert failed == 1
    assert failed_dir.exists()
    assert not removed_dir.exists()


def test_pending_delete_cleanup_does_not_delete_unknown_file(tmp_path: Path) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    unknown = storage.delete_staging_dir / "unexpected.txt"
    unknown.parent.mkdir(parents=True)
    unknown.write_text("keep", encoding="utf-8")

    failed = storage.cleanup_pending_patient_deletes()

    assert failed == 1
    assert unknown.read_text(encoding="utf-8") == "keep"
```

- [x] **Step 3: 运行测试并确认旧实现失败**

Run:

```powershell
cd backend
.\.venv\Scripts\pytest.exe -q -p no:cacheprovider tests\unit\test_managed_storage.py -k pending_delete_cleanup
```

Expected: 四个测试因 `ManagedStorage` 尚无 `cleanup_pending_patient_deletes()` 而失败。

### Task 2: 实现安全的逐项残留清理

**Files:**
- Modify: `backend/app/services/managed_storage.py`
- Test: `backend/tests/unit/test_managed_storage.py`

- [x] **Step 1: 实现最小清理方法**

在 `ManagedStorage` 中增加：

```python
def cleanup_pending_patient_deletes(self) -> int:
    if not self.delete_staging_dir.exists():
        return 0

    failed = 0
    for entry in sorted(self.delete_staging_dir.iterdir(), key=lambda path: path.name):
        try:
            if entry.is_symlink() or entry.is_junction() or not entry.is_dir():
                raise UnsafeManagedPathError("Unsafe staged patient delete entry")
            target = self._ensure_within(entry, self.delete_staging_dir)
            shutil.rmtree(target)
        except (ManagedStorageError, OSError):
            failed += 1
    return failed
```

该方法不得创建缺失的 staging 根目录，不得恢复数据库或正式 DICOM 目录，也不得删除非目录、符号链接或 junction。

- [x] **Step 2: 运行清理单元测试**

Run:

```powershell
cd backend
.\.venv\Scripts\pytest.exe -q -p no:cacheprovider tests\unit\test_managed_storage.py
```

Expected: 全部 `ManagedStorage` 单元测试 PASS；失败目录保留、后续目录继续删除。

### Task 3: 在 FastAPI lifespan 触发启动清理

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/tests/integration/test_patient_delete.py`

- [x] **Step 1: 增加 lifespan 启动清理测试**

```python
def test_application_startup_retries_pending_patient_delete_cleanup(
    session_factory,
    managed_storage,
) -> None:
    pending = managed_storage.delete_staging_dir / "pending"
    pending.mkdir(parents=True)
    (pending / "image.dcm").write_bytes(b"dicom")
    application = create_app(
        session_factory=session_factory,
        managed_storage=managed_storage,
    )

    assert pending.exists()
    with TestClient(application) as test_client:
        assert test_client.get("/api/patients").status_code == 200
        assert not pending.exists()
```

- [x] **Step 2: 增加失败只记录 warning 且服务继续测试**

```python
def test_application_startup_reports_cleanup_failure_without_stopping_service(
    session_factory,
    managed_storage,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(
        managed_storage,
        "cleanup_pending_patient_deletes",
        lambda: 1,
    )
    application = create_app(
        session_factory=session_factory,
        managed_storage=managed_storage,
    )

    with caplog.at_level(logging.WARNING), TestClient(application) as test_client:
        assert test_client.get("/api/patients").status_code == 200

    assert "1 staged patient delete item" in caplog.text
    assert str(managed_storage.delete_staging_dir) not in caplog.text
```

- [x] **Step 3: 运行测试并确认 lifespan 行为尚未实现**

Run:

```powershell
cd backend
.\.venv\Scripts\pytest.exe -q -p no:cacheprovider tests\integration\test_patient_delete.py -k application_startup
```

Expected: 启动清理测试失败，因为 `create_app()` 尚未注册 lifespan；warning 测试也未得到预期日志。

- [x] **Step 4: 实现 lifespan**

在 `backend/app/main.py` 增加：

```python
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import logging


LOGGER = logging.getLogger(__name__)


def _application_lifespan(storage: ManagedStorage):
    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        failed = storage.cleanup_pending_patient_deletes()
        if failed:
            LOGGER.warning(
                "Unable to purge %d staged patient delete item(s); "
                "cleanup will retry on next startup",
                failed,
            )
        yield

    return lifespan
```

并在 `create_app()` 中先解析 `configured_storage`，再传给 FastAPI：

```python
configured_storage = managed_storage or ManagedStorage(load_settings())
application = FastAPI(
    title="Patient Management API",
    version="0.3.0",
    description=(
        "Local-only API for an educational medical CT application. "
        "Not for clinical diagnosis."
    ),
    lifespan=_application_lifespan(configured_storage),
)
application.state.managed_storage = configured_storage
```

- [x] **Step 5: 运行启动与删除回归测试**

Run:

```powershell
cd backend
.\.venv\Scripts\pytest.exe -q -p no:cacheprovider tests\integration\test_patient_delete.py tests\integration\test_patient_dicom_delete.py tests\unit\test_managed_storage.py
```

Expected: 全部 PASS；启动清理不会改变提交前失败恢复和提交后残留隔离规则。

### Task 4: 创建详细项目 README

**Files:**
- Create: `README.md`

- [x] **Step 1: 写入项目定位、功能和安全边界**

README 开头使用以下结构和事实：

```markdown
# 本地医疗 CT 教学与三视图预览系统

> 教学演示软件，不用于临床诊断。

这是一个完全运行在本机的单用户医疗 CT 教学项目。项目用于演示从病人资料管理、DICOM 导入和本地持久化，到轴位查看与三视图 MPR 联动的完整数据流，不提供临床诊断、治疗决策或公网服务。

## 项目背景

医疗影像教学通常需要同时处理结构化病人信息、DICOM 文件生命周期、二维查看工具和空间联动。该项目采用分阶段 Spec Kit 工作流，将这些能力拆分为可独立验收的 Feature，并用自动化测试和真实浏览器路径固定数据安全与用户行为。

## 建设目的

- 演示本机 DICOM 数据从导入到显示的完整链路。
- 验证数据库索引与受管 DICOM 文件的一致性。
- 提供轴位浏览和轴位、冠状位、矢状位联动 MPR。
- 为学习 FastAPI、React、Cornerstone3D 和 Spec Kit 提供可运行示例。
```

随后列出四个已完成 Feature、错误恢复、免责声明和 loopback-only 边界，不加入尚未实现的能力。

- [x] **Step 2: 写入架构、目录和数据流**

````markdown
## 系统架构

```text
Browser / React 19 / Cornerstone3D
            |
      http://127.0.0.1:5173
            |
       Vite /api proxy
            |
      http://127.0.0.1:8000
            |
      FastAPI + SQLAlchemy
         /          \
      SQLite      Managed DICOM
```

所有病人元数据、DICOM 文件和像素数据都保留在本机；浏览器只请求 loopback 地址。
````

目录说明必须覆盖 `backend/`、`frontend/`、`specs/`、`docs/superpowers/`、`.specify/` 和运行时 `data/`。

- [x] **Step 3: 写入可执行的 Windows 启动命令**

````markdown
## 环境要求

- Windows 10/11 与 PowerShell
- Python 3.12
- uv 0.11 或兼容版本
- Node.js 24 与 npm 11，或满足当前 lockfile 的兼容版本
- 支持 WebGL 的 Chrome/Edge

## 快速启动

### 1. 启动后端

```powershell
cd backend
uv sync --group dev
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### 2. 启动前端

另开一个 PowerShell：

```powershell
cd frontend
npm install
npm run dev
```

访问 `http://127.0.0.1:5173`。
````

说明默认数据目录为项目根目录 `data/`，可通过 `MEDICAL_CT_APP_DATA_DIR` 指定其他本机目录。

- [x] **Step 4: 写入使用、验证、文档导航与限制**

README 必须提供：

````markdown
## 基本使用流程

1. 创建病人。
2. 选择当前病人并导入已脱敏 CT DICOM 文件或目录。
3. 查看逐文件成功、重复、跳过、不支持和失败报告。
4. 从 eligible Series 打开轴位查看器。
5. 使用切片、窗宽窗位、平移、缩放和重置。
6. 对符合条件的多切片 Series 进入三视图 MPR。

## 测试与构建

```powershell
cd backend
.\.venv\Scripts\pytest.exe -q -p no:cacheprovider

cd ..\frontend
npm test -- --run
npm run build
```
````

文档导航链接到四个 `spec.md`、`tasks.md`、`quickstart.md`、项目宪章、总体设计和代码审查修复设计。限制章节明确列出 PACS/DICOMweb、认证/多用户、云/远程、测量/标注/分割/报告、3D/MIP/手术规划和临床使用均未实现。

- [x] **Step 5: 校验 README 命令和链接**

Run:

```powershell
rg -n "教学演示软件，不用于临床诊断|uv sync|alembic upgrade head|npm run dev|npm run build|MEDICAL_CT_APP_DATA_DIR|PACS|DICOMweb" README.md
rg -n "\]\([^)]*\.md\)" README.md
```

Expected: 所有必要章节、命令和边界均存在；相对 Markdown 链接均指向仓库内真实文件。

### Task 5: 全量验证并同步 quickstart

**Files:**
- Modify: `specs/004-three-view-mpr/quickstart.md`

- [x] **Step 1: 运行后端全量测试**

Run:

```powershell
cd backend
.\.venv\Scripts\pytest.exe -q -p no:cacheprovider
```

Expected: 全部 PASS；只允许既有 Starlette TestClient/httpx 弃用 warning。记录实际测试数量和耗时。

- [x] **Step 2: 并行运行前端全量测试和 production build**

Run:

```powershell
cd frontend
npm test -- --run
npm run build
```

Expected: 30 个测试文件及全部测试 PASS；TypeScript `noEmit` 和 Vite build PASS。只记录并保留既有 Cornerstone 非阻断 warning，不尝试修复。

- [x] **Step 3: 追加发布前回归记录**

在 `specs/004-three-view-mpr/quickstart.md` 末尾追加：

````markdown
### Pre-publication regression verification (2026-07-22)

```text
Backend: 记录 Step 1 产生的完整 pytest 数量、warning 和耗时
Frontend: 记录 Step 2 产生的完整 test files/tests 数量
Production build: PASS，TypeScript noEmit PASS，记录 Vite modules transformed
Storage cleanup: PASS，应用启动会重试 `.delete-staging` 残留；单项失败不阻止其他项和服务启动
Documentation: PASS，根 README 的启动命令、数据边界和仓库内链接已核对
Scope: existing Starlette, Cornerstone build and WebGL context-limit warnings intentionally unchanged
```
````

执行时必须把“记录 Step”说明替换为本轮真实输出；不得修改 2026-07-21 的历史验收记录。

- [x] **Step 4: 检查文档一致性**

Run:

```powershell
rg -n "Pre-publication regression|Backend:|Frontend:|Production build:|Storage cleanup:|Documentation:" specs\004-three-view-mpr\quickstart.md README.md
rg -n "待定|待补|<[^>]+>" README.md specs\004-three-view-mpr\quickstart.md docs\superpowers\specs\2026-07-22-repository-publication-and-storage-cleanup-design.md
```

Expected: 新回归记录与真实输出一致，无未替换占位符；历史验收仍保留。

### Task 6: 发布前 Git 范围与敏感信息审查

**Files:**
- Review: repository root

- [x] **Step 1: 只读检查将被提交的文件**

Run:

```powershell
git status --short
git add --dry-run .
git check-ignore -v backend/.venv frontend/node_modules data 2>$null
```

Expected: 源码、测试、规格、设计、README 和 `.gitignore` 在范围内；虚拟环境、依赖、数据库、DICOM、临时目录、日志和 IDE 文件被排除。

- [x] **Step 2: 检查敏感信息和异常大文件**

Run:

```powershell
rg -n --hidden -g '!backend/.venv/**' -g '!frontend/node_modules/**' -g '!data/**' "gho_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|password\s*=|secret\s*=" .
Get-ChildItem -Recurse -File | Where-Object { $_.Length -gt 10MB -and $_.FullName -notmatch '\\(backend\\.venv|frontend\\node_modules|data)\\' } | Select-Object FullName,Length
```

Expected: 没有真实 token、私钥、密码或意外大文件。示例文字若被命中，必须人工确认不是凭据。

- [x] **Step 3: 形成最终提交确认合同**

向用户报告：

```text
Current branch: 003-axial-viewer
Planned branch: main
Commit scope: all non-ignored project files
Change type: feat
Scope: CT教学系统
Reason: 首次发布完整本地 DICOM 管理、轴位/MPR 查看、自动残留清理和项目文档
Planned commit message: feat(CT教学系统): 发布本地DICOM管理与三视图应用
Remote: new private repository https://github.com/lijie777/TestProj
Planned steps: git branch -M main -> git add . -> inspect staged diff -> git commit -> gh repo create -> git push
```

在用户明确回复“确认提交并推送”前停止，不执行任何 Git 写操作。

### Task 7: 经确认后创建提交并推送 GitHub

**Files:**
- Publish: all confirmed non-ignored project files

- [ ] **Step 1: 重新核对状态未变化**

Run:

```powershell
git branch --show-current
git status --short
gh auth status
gh repo view lijie777/TestProj --json nameWithOwner,visibility,url 2>$null
```

Expected: 状态与确认合同一致；GitHub 登录账号为 `lijie777`；目标仓库仍不存在。若状态或目标变化，停止并重新确认。

- [ ] **Step 2: 执行已确认的本地提交**

仅在最终确认后运行：

```powershell
git branch -M main
git add .
git diff --cached --stat
git diff --cached --check
git commit -m "feat(CT教学系统): 发布本地DICOM管理与三视图应用"
```

Expected: 创建一个初始提交，`git diff --cached --check` 无空白错误。

- [ ] **Step 3: 创建私有远端并推送**

仅在同一最终确认范围内运行：

```powershell
gh repo create lijie777/TestProj --private --source . --remote origin
git push -u origin main
```

Expected: 创建 `https://github.com/lijie777/TestProj`，`origin/main` 与本地 `main` 指向相同提交。

- [ ] **Step 4: 验证发布结果**

Run:

```powershell
git status --short
git log -1 --oneline --decorate
git remote -v
gh repo view lijie777/TestProj --json nameWithOwner,visibility,url,defaultBranchRef
```

Expected: 工作区干净；仓库为 PRIVATE；默认分支为 `main`；本地与远端提交一致。

## 计划自检

- 自动清理的触发时机、范围、逐项失败、路径安全和日志均有对应测试。
- README 的背景、目的、启动、使用、测试、数据边界、文档索引和排除范围均有明确内容。
- quickstart 只追加真实新记录，不篡改历史验收。
- 第 4 条技术债没有对应实现任务，只在 README/quickstart 中如实记录。
- Git 写入、仓库创建和 push 均位于独立最终确认门之后。
- 没有默认创建公开仓库、Release、Tag、Issue、PR、GitHub Actions 或许可证。
