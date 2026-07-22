# Data and State Model: 联动 CT 三视图 MPR

## 1. 持久化模型结论

本功能不新增数据库实体、字段或迁移。它只读既有数据链：

```text
Patient 1 ── * Study 1 ── * Series 1 ── * Instance
```

MPR eligibility、volume、三个 viewport、linked position、工具和显示状态全部只存在于当前浏览器页面
会话，退出或刷新后销毁。

## 2. 既有实体的本功能约束

### Patient

- 使用 `name`、`medical_record_no` 作为可见上下文。
- 内部 `id` 只用于既有资源关联，不在 MPR 页显示。
- Patient 删除或上下文失效后，MPR 重新请求必须返回稳定 not-found，不保留旧 volume。

### Study

- 使用 `description`、`study_date` 作为可见摘要。
- `id`、StudyInstanceUID 不在 MPR 页显示。

### Series

- 使用 `modality`、`description`、`rows`、`columns`、`instance_count`、`viewability_status` 和
  `viewability_reason`。
- 轴位 eligible 只是 MPR eligibility 的必要条件，不是充分条件。
- MPR 不写回新的状态或原因；同一 Series 的轴位状态保持不变。

### Instance

- 使用既有响应中的 `id` 构造同源文件资源 image ID。
- 使用 `image_position_patient`、`image_orientation_patient`、`rows` 和 `columns` 做 eligibility 和 spacing
  推导。
- `managed_path`、SOPInstanceUID、文件名和绝对路径不进入 MPR UI。
- 文件读取和像素解码失败不改变记录、排序或受管文件。

## 3. 临时前端实体

### MprEligibility

```text
eligible: boolean
reason: string | null
sliceSpacing: number | null
```

规则：

1. Series 必须为 CT 且 `viewability_status = eligible`。
2. 至少两个 Instance。
3. 每个 Instance 的 position 必须为三个有限数，orientation 必须为六个有限数。
4. Rows/Columns 必须为正整数并在全部 Instance 中一致。
5. 首张 orientation 的 row/column 向量叉积必须形成非退化法向。
6. 其他 orientation 在 `1e-6` 分量容差内与首张一致。
7. position 在法向上的投影按 `1e-3 mm` 容差去重，至少两个不同位置。
8. 排序后相邻间距均为正；只有间距偏差在规划确定的容差内时才提供 `sliceSpacing`，否则为 null。

生命周期：轴位页入口预判一次，MPR page 重新请求后再计算一次；不持久化。

### MprSeriesState

| Field | Shape | Rule |
|-------|-------|------|
| status | `idle/loading/success/error` | 一个时刻一个状态 |
| detail | SeriesDetail or null | success 时存在 |
| eligibility | MprEligibility or null | detail 校验后存在 |
| imageIds | ordered string array | 与响应 instances 一一对应，使用副本且顺序不回写 |
| errorKind | stable enum or null | `notFound/notViewable/geometry/service/unknown` |
| error | safe Chinese string or null | 不含 ID、路径、URL、codec 或堆栈 |

### MprVolumeSession

| Field | Shape | Rule |
|-------|-------|------|
| volumeId | unique runtime string | 仅内部使用，不显示 |
| imageIds | ordered string array | 当前 session 专用副本 |
| framesLoaded | integer | `0..totalFrames` |
| framesProcessed | integer | `0..totalFrames`，包含失败帧 |
| totalFrames | integer | 与 imageIds 数量一致 |
| status | `creating/loading/ready/error/cancelled/destroyed` | 单向状态转换 |

完整 ready 条件：

```text
framesProcessed == totalFrames
AND framesLoaded == totalFrames
```

`VOLUME_LOADED`、`loadStatus.loaded` 或最后一帧 callback 的 `success` 不能单独设置 ready。

### MprViewportState

```text
id: axial | coronal | sagittal
label: 轴位 | 冠状位 | 矢状位
active: boolean
position: [x, y, z]
orientation: { top, right, bottom, left }
```

- 三个 viewport 共享同一个 MprVolumeSession 和 FrameOfReference。
- `position` 来自当前 camera focal point/linked center，并仅用于可见覆盖层。
- 平移和缩放属于各 viewport 相机，不复制给其他 viewport。

### LinkedPosition

```text
world: [x, y, z]
sourceViewport: axial | coronal | sagittal
```

- 初始值为 volume center。
- Crosshairs 拖动或 volume slice scroll 更新 world。
- 更新后全部 viewport 必须仍在各自空间边界内显示该位置。
- 十字线隐藏只改变可见/工具模式，不删除当前 camera/linked position。

### MprDisplayState

| Field | Shape | Default |
|-------|-------|---------|
| activeViewport | `axial/coronal/sagittal` | axial |
| activeTool | `crosshairs/windowLevel/pan/zoom` | crosshairs |
| crosshairsVisible | boolean | true |
| voiRange | `{lower, upper}` or null | volume default |
| runtimeError | safe string or null | null |

- VOI range 同步到三个 viewport。
- pan/zoom 保存在各 viewport camera 内，不进入 React 持久化状态。
- reset 恢复全部默认值、volume center 和三相机默认状态。

### MprRuntimeResources

```text
RenderingEngine 1
Volume 1
OrthographicViewport 3
ToolGroup 1
DOM/Core event handlers N
ResizeObserver 1
AbortController 1
```

runtime 对这些资源拥有唯一所有权。destroy 必须幂等且不影响轴位 runtime 或其他会话的缓存。

## 4. State Transitions

### MPR Series loading

```text
idle -> loading -> validating -> success
               -> error -> loading (retry)
loading/validating -> cancelled (return/unmount)
```

- 每次 load 使用新的 AbortController。
- 旧请求取消后不得覆盖新请求或已离开页面的状态。
- success 前必须再次确认 Series eligible、geometry sufficient、image IDs 非空。

### Volume runtime

```text
creating -> loading -> ready -> destroyed
    |          |          |
    +--------> error ----> destroyed
    +--------> cancelled -> destroyed
```

- 创建前安装失败监听。
- loading 中允许增量 render，但工具栏仅在 runtime 可安全交互时启用。
- 任意部分帧失败使最终状态为 error，不将部分 volume 标为完整成功。
- retry 销毁旧 runtime 并创建新的 IDs、volume 和 listeners。

### Tool state

```text
crosshairs <-> windowLevel <-> pan <-> zoom
```

- 切换前清除全部主工具 Primary bindings。
- Crosshairs visible 且非当前主工具时为 Enabled。
- Crosshairs hidden 时为 Disabled；若当时是 activeTool，自动转为 windowLevel。
- reset 将 Crosshairs 设为 visible + Active。

### Page navigation

```text
Patient management -> Axial viewer -> MPR viewer
                                      |
                                      +-> Axial viewer -> Patient management
```

- MPR 返回不销毁 Patient/Study/Series context。
- 返回后 AxialViewport 使用自身默认状态重新创建。
- 页面刷新按现有应用规则回到病人管理页。

## 5. Cleanup Order

```text
mark cancelled
-> abort detail request
-> abort active DICOM XHRs for session imageIds
-> cancel volume queue + clear load callbacks
-> remove app-owned DOM/core listeners and ResizeObserver
-> cancel active tool manipulations
-> disable Crosshairs to release its listeners/annotations
-> destroy RenderingEngine enabled elements
-> destroy ToolGroup
-> remove dedicated volume load object if present
-> mark destroyed and block state callbacks
```

任何一步抛错都不得阻止后续拥有资源的清理步骤；调用 destroy 两次不得重复产生异常。
