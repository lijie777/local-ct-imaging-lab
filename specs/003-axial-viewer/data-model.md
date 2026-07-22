# Data and State Model: 轴位 CT 查看器

## 1. 持久化模型结论

本功能不新增数据库实体、字段或迁移。它只读 `002-dicom-import` 已存在的四个实体：

```text
Patient 1 ── * Study 1 ── * Series 1 ── * Instance
```

## 2. 既有实体的本功能约束

### Patient

- 使用字段：`id`、`medical_record_no`、`name`。
- `id` 只用于资源关联，不在查看页显示。
- 删除 Patient 后其查看上下文立即失效，沿用既有级联和受管文件删除规则。

### Study

- 使用字段：`id`、`study_date`、`description`。
- `id` 只用于入口上下文关联，不在查看页显示。
- Study 在打开前被删除时，Series 详情或文件资源返回稳定 not-found。

### Series

- 使用字段：`id`、`description`、`series_number`、`instance_count`、
  `viewability_status`、`viewability_reason`。
- 只有 `viewability_status = eligible` 且实际 Instance 数量大于 0 时可创建 Viewer Session。
- `unsupported` 必须有 `viewability_reason`；查看页不得尝试读取像素。

### Instance

- 使用字段：`id`、`series_id`、`managed_path` 以及 Series 详情中已公开的顺序元数据。
- `id` 是 DICOM 文件资源的唯一客户端身份。
- `managed_path` 仍为相对 data directory 的内部字段，不进入 Series 响应或 UI。
- 文件资源只读；读取失败不改变记录、顺序或文件。

## 3. 临时前端实体

### ViewerContext

| Field | Shape | Validation / Visibility |
|-------|-------|-------------------------|
| patient | `{name, medical_record_no}` | 必须存在；显示给用户 |
| study | Study summary | 只显示描述和日期；不显示 `id` |
| series | Series summary | 必须来自当前 Study；只显示描述和实例数；不显示 `id` |

生命周期：在用户点击 eligible Series 时创建；退出查看页或页面刷新时销毁；不写入 storage、URL 或后端。

### AxialSeriesState

| Field | Shape | Rule |
|-------|-------|------|
| status | `idle/loading/success/error` | 一个时刻一个状态 |
| detail | Series detail or null | 仅 success 时存在 |
| imageIds | ordered string array | 与响应 instances 一一对应且顺序不变 |
| error | safe string or null | 仅 error 时存在；无内部 ID/路径/堆栈 |

### ViewerSession

| Field | Shape | Rule |
|-------|-------|------|
| currentIndex | integer | `0 <= value < total` |
| initialIndex | integer | `floor(total / 2)` |
| activeTool | `windowLevel/pan/zoom` | 始终仅一个 primary 工具 |
| runtimeStatus | `initializing/ready/error/destroyed` | destroyed 后不得更新 React 状态 |
| runtimeError | safe string or null | 解码/渲染失败时使用 |

## 4. State Transitions

### Series loading

```text
idle -> loading -> success
               -> error -> loading (retry)
loading -> destroyed (exit/cancel)
```

- success 前必须再次检查 Series 为 eligible 且实例列表非空。
- 旧请求被取消后不得覆盖新请求或已退出页面的状态。

### Viewport runtime

```text
initializing -> ready -> destroyed
             -> error -> destroyed
```

- `ready` 时才允许工具和切片控制。
- reset 将 `currentIndex` 设回 `initialIndex`，恢复默认 properties 和 camera，不创建新 session。
- exit、Series 变化或 component unmount 必须进入 destroyed 并释放 rendering engine、tool group 和 listeners。

## 5. File Resource Resolution

```text
instance_id
  -> Instance row
  -> Series.viewability_status == eligible
  -> managed_path is relative
  -> resolve(data_dir / managed_path)
  -> resolved path is within dicom_dir
  -> existing regular file
  -> application/dicom response
```

任何一步失败都只返回稳定错误，不回写数据库、不移动文件、不改变 viewer 之外的数据。
