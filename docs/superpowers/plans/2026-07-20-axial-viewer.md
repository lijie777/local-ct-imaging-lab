# 本地 CT 轴位查看器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从现有 Patient → Study → eligible Series 打开一个本机单视口轴位 CT 查看器，并支持切片浏览、窗宽窗位、平移、缩放、重置及稳定错误反馈。

**Architecture:** 后端新增只读 Instance 文件资源接口，资源 ID 经数据库解析为受管目录内文件，不暴露路径；前端用显式页面状态进入独立查看页，以既有 Series 详情顺序生成 Cornerstone3D stack。Cornerstone 生命周期和工具绑定集中在小型 adapter/component 中，病人管理页只编排打开和返回。

**Tech Stack:** FastAPI、SQLAlchemy、SQLite、pytest、React 19、TypeScript、Vite、Vitest、React Testing Library、Cornerstone3D 5.6.8。

---

## 文件结构

- Create `backend/app/api/instances.py`: Instance DICOM 文件 HTTP 资源。
- Create `backend/app/services/instance_service.py`: Instance 查询、Series 可查看校验与受管文件解析。
- Create `backend/tests/unit/test_managed_storage_read.py`: 受管只读路径安全规则。
- Create `backend/tests/integration/test_instance_file_api.py`: 文件资源成功和失败合同。
- Modify `backend/app/services/managed_storage.py`: 增加安全的相对路径解析，不改变导入/删除行为。
- Modify `backend/app/core/errors.py`: 增加 Instance、不可查看和文件缺失的稳定错误。
- Modify `backend/app/api/__init__.py`, `backend/app/main.py`: 注册路由并同步 OpenAPI。
- Create `frontend/src/features/axial-viewer/api/axialViewerApi.ts`: Series 加载和 Instance image ID 构造。
- Create `frontend/src/features/axial-viewer/core/cornerstone.ts`: Cornerstone 单次初始化与 adapter。
- Create `frontend/src/features/axial-viewer/hooks/useAxialSeries.ts`: Series 加载状态与 image IDs。
- Create `frontend/src/features/axial-viewer/components/ViewerToolbar.tsx`: 工具和切片控制。
- Create `frontend/src/features/axial-viewer/components/AxialViewport.tsx`: viewport 生命周期。
- Create `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx`: 查看页状态和摘要。
- Create `frontend/src/features/axial-viewer/model/axialViewer.ts`: 查看上下文与工具类型。
- Create `frontend/src/styles/axial-viewer.css`: 单视口查看布局。
- Modify `frontend/src/features/dicom-import/components/StudyList.tsx`: eligible Series 打开入口。
- Modify `frontend/src/features/patients/pages/PatientManagementPage.tsx`: 页面状态切换。
- Modify `frontend/src/app/App.tsx`: 引入查看器样式。

### Task 1: 安全解析受管 DICOM 文件

**Files:**
- Modify: `backend/app/services/managed_storage.py`
- Create: `backend/tests/unit/test_managed_storage_read.py`

- [ ] **Step 1: 写失败测试，覆盖合法路径、绝对路径和目录逃逸**

```python
from pathlib import Path

import pytest

from app.core.config import load_settings
from app.services.managed_storage import ManagedStorage, UnsafeManagedPathError


def test_resolves_relative_dicom_path_inside_managed_root(tmp_path: Path) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    expected = tmp_path / "dicom" / "patient" / "study" / "image.dcm"

    resolved = storage.resolve_dicom_file("dicom/patient/study/image.dcm")

    assert resolved == expected.resolve()


@pytest.mark.parametrize("value", ["../outside.dcm", "dicom/../../outside.dcm"])
def test_rejects_relative_path_escape(tmp_path: Path, value: str) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    with pytest.raises(UnsafeManagedPathError):
        storage.resolve_dicom_file(value)


def test_rejects_absolute_path(tmp_path: Path) -> None:
    storage = ManagedStorage(load_settings(data_dir_override=tmp_path))
    with pytest.raises(UnsafeManagedPathError):
        storage.resolve_dicom_file(str((tmp_path / "outside.dcm").resolve()))
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd backend; uv run pytest tests/unit/test_managed_storage_read.py -q`

Expected: FAIL，提示 `ManagedStorage` 没有 `resolve_dicom_file`。

- [ ] **Step 3: 实现最小只读路径解析**

```python
def resolve_dicom_file(self, managed_path: str) -> Path:
    relative = Path(managed_path)
    if relative.is_absolute():
        raise UnsafeManagedPathError("Managed DICOM path must be relative")
    target = self._ensure_within(self.data_dir / relative, self.dicom_dir)
    return target
```

- [ ] **Step 4: 运行单元测试并确认通过**

Run: `cd backend; uv run pytest tests/unit/test_managed_storage_read.py tests/unit/test_managed_storage.py -q`

Expected: PASS，且既有受管存储测试无回归。

### Task 2: 提供 Instance 文件资源服务

**Files:**
- Create: `backend/app/services/instance_service.py`
- Modify: `backend/app/core/errors.py`
- Create: `backend/tests/integration/test_instance_file_api.py`

- [ ] **Step 1: 写服务失败测试**

```python
def test_unknown_instance_returns_stable_not_found(client: TestClient) -> None:
    response = client.get(f"/api/instances/{uuid4()}/file")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "instance_not_found"


def test_unsupported_series_cannot_serve_pixel_file(
    client: TestClient, tmp_path: Path
) -> None:
    patient = create_patient(client)
    fixture = write_dicom_file(tmp_path / "unsupported.dcm", include_geometry=False)
    import_fixture(client, patient["id"], fixture)
    instance_id = series_detail(client, patient["id"])["instances"][0]["id"]

    response = client.get(f"/api/instances/{instance_id}/file")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "series_not_viewable"
```

- [ ] **Step 2: 运行测试并确认路由缺失**

Run: `cd backend; uv run pytest tests/integration/test_instance_file_api.py -q`

Expected: FAIL，当前请求返回 404 且不是稳定 `instance_not_found` 错误体。

- [ ] **Step 3: 增加稳定错误类型**

```python
class InstanceNotFoundError(ApiError):
    def __init__(self) -> None:
        super().__init__(status_code=404, code="instance_not_found", message="未找到该影像实例")


class SeriesNotViewableError(ApiError):
    def __init__(self) -> None:
        super().__init__(status_code=409, code="series_not_viewable", message="该序列暂不可查看")


class ManagedDicomFileMissingError(ApiError):
    def __init__(self) -> None:
        super().__init__(status_code=410, code="dicom_file_missing", message="本机 DICOM 文件缺失")
```

- [ ] **Step 4: 实现查询和路径解析服务**

```python
from pathlib import Path
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import (
    InstanceNotFoundError,
    ManagedDicomFileMissingError,
    PersistenceError,
    SeriesNotViewableError,
)
from app.models.instance import Instance
from app.services.managed_storage import ManagedStorage, ManagedStorageError


def get_viewable_instance_file(
    session: Session,
    storage: ManagedStorage,
    instance_id: UUID,
) -> Path:
    try:
        instance = session.get(Instance, instance_id)
        if instance is None:
            raise InstanceNotFoundError()
        if instance.series.viewability_status != "eligible":
            raise SeriesNotViewableError()
        path = storage.resolve_dicom_file(instance.managed_path)
        if not path.is_file():
            raise ManagedDicomFileMissingError()
        return path
    except (InstanceNotFoundError, SeriesNotViewableError, ManagedDicomFileMissingError):
        raise
    except (SQLAlchemyError, ManagedStorageError) as error:
        session.rollback()
        raise PersistenceError() from error
```

- [ ] **Step 5: 运行服务相关测试**

Run: `cd backend; uv run pytest tests/integration/test_instance_file_api.py -q`

Expected: 仍因 API 路由尚未注册而 FAIL；服务单元逻辑已可被下一任务使用。

### Task 3: 注册文件 API 与 OpenAPI 合同

**Files:**
- Create: `backend/app/api/instances.py`
- Modify: `backend/app/api/__init__.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/contract/test_openapi_contract.py`
- Modify: `backend/tests/integration/test_instance_file_api.py`

- [ ] **Step 1: 补充成功、文件缺失和路径不泄露测试**

```python
def test_serves_managed_dicom_by_instance_resource_id(
    client: TestClient, tmp_path: Path
) -> None:
    patient = create_patient(client)
    fixture = write_dicom_file(tmp_path / "viewable.dcm")
    instance_id = import_and_get_instance_id(client, patient["id"], fixture)

    response = client.get(f"/api/instances/{instance_id}/file")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/dicom")
    assert response.content == fixture.path.read_bytes()
    assert str(tmp_path) not in response.text


def test_missing_managed_file_returns_gone_without_path(
    client: TestClient, db_session: Session, managed_storage: ManagedStorage
) -> None:
    instance = create_imported_instance(client, db_session)
    managed_storage.resolve_dicom_file(instance.managed_path).unlink()

    response = client.get(f"/api/instances/{instance.id}/file")

    assert response.status_code == 410
    assert response.json()["error"]["code"] == "dicom_file_missing"
    assert instance.managed_path not in response.text
```

- [ ] **Step 2: 实现只读文件路由**

```python
from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from app.api.dicom_import import request_storage
from app.api.patients import request_session
from app.services.instance_service import get_viewable_instance_file

router = APIRouter(tags=["Instances"])


@router.get("/instances/{instance_id}/file", operation_id="getInstanceDicomFile")
def get_instance_file(
    instance_id: UUID,
    session: Session = Depends(request_session),
    storage: ManagedStorage = Depends(request_storage),
) -> FileResponse:
    path = get_viewable_instance_file(session, storage, instance_id)
    return FileResponse(path, media_type="application/dicom", filename="image.dcm")
```

- [ ] **Step 3: 注册路由并扩展 OpenAPI 枚举/参数/响应**

```python
api_router.include_router(instances_router)
```

在 `backend/app/main.py` 增加 `Instances` tag、`InstanceId` 参数，以及
`instance_not_found`、`series_not_viewable`、`dicom_file_missing` 错误码，并把
`/api/instances/{instance_id}/file` 的 `200/404/409/410/422/500` 响应固定到合同。

- [ ] **Step 4: 运行 API 与合同测试**

Run: `cd backend; uv run pytest tests/integration/test_instance_file_api.py tests/contract/test_openapi_contract.py -q`

Expected: PASS；响应中不包含 `managed_path` 或绝对路径。

### Task 4: 增加 Cornerstone3D 最小依赖和初始化 adapter

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/src/features/axial-viewer/core/cornerstone.ts`
- Create: `frontend/src/features/axial-viewer/core/cornerstone.test.ts`

- [ ] **Step 1: 安装锁定版本依赖**

Run: `cd frontend; npm install @cornerstonejs/core@5.6.8 @cornerstonejs/tools@5.6.8 @cornerstonejs/dicom-image-loader@5.6.8`

Expected: `package.json` 和 lockfile 只增加三个 Cornerstone3D 直接依赖及其必要传递依赖。

- [ ] **Step 2: 写 image ID 和单次初始化失败测试**

```typescript
it('builds a loopback instance wadouri image id', () => {
  expect(instanceImageId('instance-1')).toBe(
    'wadouri:http://localhost:3000/api/instances/instance-1/file',
  )
})

it('initializes cornerstone only once', async () => {
  await initializeCornerstone()
  await initializeCornerstone()
  expect(coreInit).toHaveBeenCalledTimes(1)
  expect(loaderInit).toHaveBeenCalledTimes(1)
  expect(toolsInit).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: 实现 adapter**

```typescript
import { init as initCore } from '@cornerstonejs/core'
import { init as initLoader } from '@cornerstonejs/dicom-image-loader'
import { init as initTools } from '@cornerstonejs/tools'

let initialization: Promise<void> | null = null

export function instanceImageId(instanceId: string): string {
  const url = new URL(
    `/api/instances/${encodeURIComponent(instanceId)}/file`,
    window.location.origin,
  )
  return `wadouri:${url.toString()}`
}

export function initializeCornerstone(): Promise<void> {
  initialization ??= Promise.resolve().then(() => {
    initCore()
    initLoader({ maxWebWorkers: Math.max(1, Math.min(2, navigator.hardwareConcurrency ?? 1)) })
    initTools()
  })
  return initialization
}
```

- [ ] **Step 4: 运行 adapter 测试和 TypeScript 检查**

Run: `cd frontend; npm test -- --run src/features/axial-viewer/core/cornerstone.test.ts`

Expected: PASS。

### Task 5: Series 加载 hook 与打开入口

**Files:**
- Create: `frontend/src/features/axial-viewer/model/axialViewer.ts`
- Create: `frontend/src/features/axial-viewer/api/axialViewerApi.ts`
- Create: `frontend/src/features/axial-viewer/hooks/useAxialSeries.ts`
- Create: `frontend/src/features/axial-viewer/hooks/useAxialSeries.test.tsx`
- Modify: `frontend/src/features/dicom-import/components/StudyList.tsx`
- Modify: `frontend/src/features/dicom-import/components/StudyList.test.tsx`

- [ ] **Step 1: 写 eligible/unsupported 打开入口测试**

```typescript
it('opens only eligible series', async () => {
  const onOpenSeries = vi.fn()
  render(<StudyList {...props} onOpenSeries={onOpenSeries} />)

  await userEvent.click(screen.getByRole('button', { name: '打开轴位查看器' }))

  expect(onOpenSeries).toHaveBeenCalledWith(study, eligibleSeries)
  expect(screen.getByText(/暂不可查看：missing_geometry/)).toBeVisible()
  expect(screen.getByRole('button', { name: /暂不可查看/ })).toBeDisabled()
})
```

- [ ] **Step 2: 写 hook 的顺序、空和 unsupported 测试**

```typescript
it('preserves backend instance ordering in image ids', async () => {
  vi.mocked(getSeriesDetails).mockResolvedValue({ ...seriesDetail, instances: [second, first] })
  const { result } = renderHook(() => useAxialSeries(seriesDetail.id))
  await waitFor(() => expect(result.current.status).toBe('success'))
  expect(result.current.imageIds).toEqual([
    instanceImageId(second.id),
    instanceImageId(first.id),
  ])
})
```

- [ ] **Step 3: 实现查看上下文和 hook**

```typescript
export interface AxialViewerContext {
  patient: Pick<Patient, 'medical_record_no' | 'name'>
  study: Study
  series: Series
}

export function useAxialSeries(seriesId: string) {
  // 与 usePatientStudies 相同：AbortController、loading/success/error、reload。
  // 成功时拒绝 unsupported 和空实例，并按响应原顺序 map(instanceImageId)。
}
```

- [ ] **Step 4: 修改 StudyList，保持 unsupported 不可打开**

```tsx
{series.viewability_status === 'eligible' ? (
  <button type="button" onClick={() => onOpenSeries(study, series)}>
    打开轴位查看器
  </button>
) : (
  <button type="button" disabled aria-label={`暂不可查看：${series.viewability_reason ?? '条件不足'}`}>
    暂不可查看
  </button>
)}
```

- [ ] **Step 5: 运行相关前端测试**

Run: `cd frontend; npm test -- --run src/features/dicom-import/components/StudyList.test.tsx src/features/axial-viewer/hooks/useAxialSeries.test.tsx`

Expected: PASS。

### Task 6: 创建可测试的 StackViewport 与工具栏

**Files:**
- Create: `frontend/src/features/axial-viewer/components/ViewerToolbar.tsx`
- Create: `frontend/src/features/axial-viewer/components/ViewerToolbar.test.tsx`
- Create: `frontend/src/features/axial-viewer/components/AxialViewport.tsx`
- Create: `frontend/src/features/axial-viewer/components/AxialViewport.test.tsx`
- Modify: `frontend/src/features/axial-viewer/core/cornerstone.ts`

- [ ] **Step 1: 写工具栏行为测试**

```typescript
it('changes tools, slices and resets without crossing stack bounds', async () => {
  const onPrevious = vi.fn()
  const onNext = vi.fn()
  const onToolChange = vi.fn()
  const onReset = vi.fn()
  render(<ViewerToolbar currentIndex={1} total={3} tool="windowLevel" {...callbacks} />)

  expect(screen.getByText('2 / 3')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '平移' }))
  expect(onToolChange).toHaveBeenCalledWith('pan')
  await userEvent.click(screen.getByRole('button', { name: '重置' }))
  expect(onReset).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: 为 Cornerstone runtime 定义小接口**

```typescript
export interface AxialViewportRuntime {
  activateTool(tool: ViewerTool): void
  destroy(): void
  next(): Promise<void>
  previous(): Promise<void>
  reset(): Promise<void>
}

export async function createAxialViewportRuntime(
  element: HTMLDivElement,
  imageIds: readonly string[],
  initialIndex: number,
  onIndexChange: (index: number) => void,
  onError: (message: string) => void,
): Promise<AxialViewportRuntime> {
  // 创建唯一 renderingEngineId/viewportId/toolGroupId。
  // 注册 WindowLevelTool、PanTool、ZoomTool、StackScrollTool。
  // StackScrollTool 绑定 MouseBindings.Wheel；当前工具绑定 Primary。
  // setStack([...imageIds], initialIndex)，监听 STACK_NEW_IMAGE，resize 后 render。
  // destroy 时移除监听、destroyToolGroup、renderingEngine.destroy()。
}
```

- [ ] **Step 3: 写 viewport 生命周期测试**

```typescript
it('starts at the middle slice and destroys its runtime on unmount', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createAxialViewportRuntime).mockResolvedValue(runtime)
  const { unmount } = render(<AxialViewport imageIds={['a', 'b', 'c']} />)

  await waitFor(() => expect(createAxialViewportRuntime).toHaveBeenCalledWith(
    expect.any(HTMLDivElement), ['a', 'b', 'c'], 1, expect.any(Function), expect.any(Function),
  ))
  unmount()
  expect(runtime.destroy).toHaveBeenCalledOnce()
})
```

- [ ] **Step 4: 实现 AxialViewport 与 ViewerToolbar**

`AxialViewport` 用 `useRef` 保存 DOM 和 runtime，用 state 保存 `currentIndex`、`tool`、`runtimeError`；
image IDs 变化时创建 runtime，cleanup 中销毁。上一张/下一张只调用 runtime，禁用状态由
`currentIndex === 0` 和 `currentIndex === imageIds.length - 1` 决定。

- [ ] **Step 5: 运行组件测试**

Run: `cd frontend; npm test -- --run src/features/axial-viewer/components/ViewerToolbar.test.tsx src/features/axial-viewer/components/AxialViewport.test.tsx`

Expected: PASS；测试不依赖真实 WebGL。

### Task 7: 查看页与病人管理页切换

**Files:**
- Create: `frontend/src/features/axial-viewer/pages/AxialViewerPage.tsx`
- Create: `frontend/src/features/axial-viewer/pages/AxialViewerPage.test.tsx`
- Create: `frontend/src/styles/axial-viewer.css`
- Modify: `frontend/src/features/patients/pages/PatientManagementPage.tsx`
- Modify: `frontend/src/features/patients/pages/PatientManagementPage.dicom.test.tsx`
- Modify: `frontend/src/app/App.tsx`

- [ ] **Step 1: 写页面状态与摘要测试**

```typescript
it('shows safety notice, context and returns to patient management', async () => {
  const onClose = vi.fn()
  render(<AxialViewerPage context={context} onClose={onClose} />)
  expect(screen.getByText('教学演示软件，不用于临床诊断')).toBeVisible()
  expect(screen.getByText(context.patient.name)).toBeVisible()
  expect(screen.getByText(context.patient.medical_record_no)).toBeVisible()
  expect(screen.queryByText(context.series.id)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '返回病人管理' }))
  expect(onClose).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: 实现查看页状态**

```tsx
export function AxialViewerPage({ context, onClose }: Props) {
  const series = useAxialSeries(context.series.id)
  return (
    <AppShell>
      <section className="axial-viewer-page">
        <header>{/* 返回、Patient/Study/Series 摘要；不渲染 UUID */}</header>
        {series.status === 'loading' ? <p>正在加载轴位影像…</p> : null}
        {series.status === 'error' ? <ViewerError message={series.error} onRetry={series.reload} /> : null}
        {series.status === 'success' ? <AxialViewport imageIds={series.imageIds} /> : null}
      </section>
    </AppShell>
  )
}
```

- [ ] **Step 3: 在 PatientManagementPage 编排打开/退出**

```tsx
const [viewerContext, setViewerContext] = useState<AxialViewerContext | null>(null)

if (viewerContext !== null) {
  return <AxialViewerPage context={viewerContext} onClose={() => setViewerContext(null)} />
}
```

`StudyList.onOpenSeries` 使用当前 `detail.patient`、对应 `study` 和 `series` 生成 context。

- [ ] **Step 4: 增加深色画布和响应式样式**

CSS 使用现有按钮和 banner 风格；查看器画布区域至少 `min-height: 32rem`，桌面工具栏横向排列，
窄屏改为换行。加载、错误和画布区域保持安全提示不被覆盖。

- [ ] **Step 5: 运行页面和病人流程测试**

Run: `cd frontend; npm test -- --run src/features/axial-viewer/pages/AxialViewerPage.test.tsx src/features/patients/pages/PatientManagementPage.dicom.test.tsx`

Expected: PASS。

### Task 8: 全量验证与真实浏览器验收

**Files:**
- Modify: `specs/003-axial-viewer/quickstart.md`
- Modify: `specs/003-axial-viewer/tasks.md`
- Modify: `specs/003-axial-viewer/spec.md`

- [ ] **Step 1: 运行后端全量测试**

Run: `cd backend; uv run pytest -q`

Expected: 全部 PASS，无 warning 导致的隐藏失败。

- [ ] **Step 2: 运行前端全量测试**

Run: `cd frontend; npm test -- --run`

Expected: 全部 PASS。

- [ ] **Step 3: 运行 production build**

Run: `cd frontend; npm run build`

Expected: TypeScript 检查和 Vite production build PASS。

- [ ] **Step 4: 使用独立临时数据目录启动本机服务**

PowerShell 环境变量设置为新的 `%TEMP%/TestProj-003-*` 目录；后端绑定 `127.0.0.1:8000`，前端绑定
`127.0.0.1:5173`。验收过程中确认没有外网请求。

- [ ] **Step 5: 执行九步真实 Chrome 路径**

按设计文档第 8 节逐项执行：导入多切片 Series、打开中间切片、滚动/按钮、窗宽窗位、平移、缩放、
重置、退出重开、unsupported 阻止、文件缺失错误、安全提示和 loopback 网络检查。截图、控制台、
网络和临时数据目录证据写入 `quickstart.md`。

- [ ] **Step 6: 同步完成状态**

仅当自动化、build 和真实 Chrome 验收全部通过时，将 `tasks.md` 全部勾选，把 `spec.md` 状态更新为
`Complete`，并记录最终测试数量与证据目录。不得执行 commit、push、merge 或上传。

## 计划自检

- 设计中的安全文件访问、eligible/unsupported、单 stack、四类交互、错误状态、资源清理和真实浏览器
  验收均有对应任务。
- 计划不包含 MPR、测量、标注、3D、PACS、DICOMweb、认证、云或状态持久化。
- 类型名统一为 `AxialViewerContext`、`ViewerTool`、`AxialViewportRuntime`；接口路径统一为
  `/api/instances/{instance_id}/file`。
- 未包含 commit、push、merge 或上传步骤。
