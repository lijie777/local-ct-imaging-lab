# Data and State Model: 高级 3D 可视化

## 1. 持久化模型结论

本功能不新增数据库实体、字段、迁移或受管文件。只读现有数据链：

```text
Patient 1 ── * Study 1 ── * Series 1 ── * Instance
```

高级 3D 会话、volume、MIP 设置、表面输入和 mesh 全部为当前浏览器临时资源，退出或刷新后销毁。

## 2. 既有实体约束

### Patient / Study / Series

- 页面只显示 Patient 姓名/病历号、Study 描述/日期、Series 描述/Modality/尺寸/实例数/spacing。
- 内部 UUID、DICOM UID 和本机路径不得显示。
- Series 必须通过现有 `deriveMprEligibility()`；进入 3D 后重新请求并再次校验。
- 3D 不写回 Series 可查看状态、viewer state 或任何派生结果。

### Instance

- 使用既有 Instance `id` 构造同源 DICOM imageId。
- 实例顺序、位置、方向和尺寸只读；失败不跳过、修复、重排或删除数据。
- PixelData 只进入当前浏览器 volume 和临时 surface 输入。

## 3. 临时实体

### Advanced3dSeriesState

| Field | Shape | Rule |
|-------|-------|------|
| status | `idle/loading/success/error` | 一个时刻一个状态 |
| detail | `SeriesDetail | null` | success 时存在 |
| eligibility | `MprEligibility | null` | detail 校验后存在 |
| imageIds | ordered string array | 与 Instance 一一对应，不回写顺序 |
| errorKind | stable enum or null | `notFound/notViewable/geometry/persistence/service/unknown` |
| error | safe Chinese string or null | 不含路径、ID、UID、URL、codec 或堆栈 |

### Advanced3dSessionState

| Field | Shape | Default |
|-------|-------|---------|
| mode | `volume/mip/surface` | `volume` |
| volumePreset | `CT-Bone/CT-Soft-Tissue/CT-Lung` | `CT-Bone` |
| direction | six standard direction enum | `anterior` |
| mipThicknessMm | finite number | volume diagonal |
| surfaceThresholdHu | finite number | 300 or scalar midpoint |
| surfaceStatus | `idle/building/ready/empty/error` | `idle` |
| runtimeStatus | `creating/loading/ready/error/destroyed` | `creating` |

状态不持久化。reset 恢复默认 mode/preset/direction/full thickness/default threshold，销毁当前 surface，
但不重新请求 Series 或创建第二个 volume。

### SharedVolumeState

```text
volumeId: unique internal string
dimensions: [x, y, z]
spacing: [x, y, z] mm
origin: [x, y, z]
direction: 3×3 matrix
scalarRange: [minimum, maximum]
framesLoaded: integer
framesProcessed: integer
totalFrames: integer
maxMipThicknessMm: physical bounding-box diagonal
```

完整 ready 条件：

```text
framesLoaded == totalFrames
AND framesProcessed == totalFrames
```

### SurfaceInput

```text
sourceDimensions: [x, y, z]
sampledDimensions: [x, y, z]
sampledSpacing: [x, y, z] mm
stride: positive integer
scalarRange: [minimum, maximum]
scalarData: Float32Array
userMatrix: 4×4 local-to-DICOM-world matrix
```

规则：

1. stride 从 1 开始递增，直到 sampled dimensions 乘积 ≤4,000,000。
2. sampled dimension 每轴为 `floor((sourceSize - 1) / stride) + 1`。
3. sampled spacing 按每轴完整 voxel-center extent 计算：当 sampled dimension > 1 时，
   `(source dimension - 1) × source spacing / (sampled dimension - 1)`。
4. sampled point 均匀映射到完整 source extent，并包含首尾 voxel center；sampled dimension ≤ 1 时取 source index 0。
5. sampled vtk image 使用零 origin 和单位 direction；userMatrix 保存真实 origin/direction。
6. 原始 volume scalarData 不被转移、修改或释放。

### SurfaceResource

| Field | Shape | Rule |
|-------|-------|------|
| thresholdHu | finite in scalar range | 当前应用阈值 |
| stride | positive integer | 当前采样精度 |
| actorUid | unique internal string | 只在 viewport 内使用 |
| result | `ready/empty/error` | 三种终态 |
| actor/mapper/filter/input | owned vtk resources | 由 surface destroy 幂等释放 |

新阈值成功时才替换旧 surface；empty 或 error 不留下新 actor。surface 失败不得销毁 SharedVolumeState。

### RuntimeResources

```text
RenderingEngine 1
Orthographic VolumeViewport 1
Streaming Volume 1
Volume Actor 1
Surface Actor 0..1
ToolGroup 1
AbortController 1
DOM/Core listeners N
```

## 4. State Transitions

### Series

```text
idle -> loading -> validating -> success
               -> error -> loading (retry)
loading/validating -> cancelled (return/unmount)
```

### Runtime

```text
creating -> loading -> ready -> destroyed
    |          |          |
    +--------> error ----> destroyed
    +--------> cancelled -> destroyed
```

### Mode

```text
volume <-> mip
   ^         ^
    \       /
      surface
```

- volume：volume visible、surface hidden、COMPOSITE、last volume preset。
- mip：volume visible、surface hidden、MAXIMUM blend、CT-MIP、current slab。
- surface：volume hidden；已有 surface 时显示它，没有 surface 时显示当前阈值和“应用阈值”操作，不自动计算。

### Surface

```text
idle -> building -> ready
                 -> empty -> building (new threshold)
                 -> error -> building (retry)
ready -> building -> ready (replace old)
```

表面请求使用递增 token；旧调用结束后不得覆盖较新的 React 状态。

## 5. Cleanup Order

```text
mark cancelled/destroyed
-> abort detail and active DICOM XHRs
-> cancel volume loading + clear callbacks
-> remove owned listeners
-> remove/destroy surface actor pipeline and sampled image
-> disable/destroy ToolGroup
-> destroy RenderingEngine
-> remove dedicated volume load object
-> block all later callbacks
```

任一步失败都不得阻止后续清理；重复 destroy 不得抛出新错误。
