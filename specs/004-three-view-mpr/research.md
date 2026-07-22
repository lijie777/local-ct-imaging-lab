# Phase 0 Research: 联动 CT 三视图 MPR

## Decision 1: 使用一个 streaming volume 驱动三个正交 viewport

**Decision**: 继续使用 `useMprSeries` 生成的同源 `wadouri:` image IDs，创建唯一
`cornerstoneStreamingImageVolume:<runtime-id>` volume。一个 RenderingEngine 创建 AXIAL、CORONAL、
SAGITTAL 三个 `ORTHOGRAPHIC` viewport，并通过 `setVolumesForViewports()` 绑定同一个 volume。

调用顺序固定为：初始化 Cornerstone → 安装全局失败监听 → 创建三个有尺寸的 viewport → 使用
`imageLoader.loadImage()` 逐个解析当前 `wadouri:` image ID 的 DICOM metadata → 强制移除可能存在的普通
Stack image load object → `createAndCacheVolume(volumeId, { imageIds: [...imageIds] })` → 将 volume 绑定到
三个 viewport → reset camera → 启动 streaming `volume.load(callback)` → render。

**Rationale**: 5.6.8 的默认 unknown volume loader 已是 `cornerstoneStreamingImageVolumeLoader`，无需安装
额外包或注册自定义 loader。`ORTHOGRAPHIC` 对应 VolumeViewport，三个 OrientationAxis 是公开 API。
共享一个 volume 避免重复像素缓存，也保证三个平面使用同一几何和 FrameOfReference。真实 Chrome
确认 volume 创建前必须让全部 image ID 的空间 metadata 可用；若使用会保留普通 Stack cache 的预加载，
streaming volume 会命中不具备 volume target buffer 的旧 image object，因此预加载后必须清除该 cache。

**Alternatives considered**:

- 三个独立 StackViewport：无法生成真正的冠状位和矢状位 MPR。
- 为每个 viewport 创建一个 volume：重复内存和请求，没有用户价值。
- `createAndCacheVolumeFromImages()`：未缓存图像时仍回到 streaming loader；显式 streaming volume 更清楚。
- Generic/planar next API：当前应用和 tools 均使用 5.6.8 经典接口，迁移增加无关风险。

## Decision 2: MPR eligibility 采用两阶段校验

**Decision**: 轴位页用当前 `SeriesDetail` 执行纯函数 `deriveMprEligibility()` 作为入口预判。进入 MPR 后，
独立 `useMprSeries()` 重新请求 Series 详情、重新校验，并重新生成 image IDs；随后由真实 volume 创建和
像素加载最终确认文件仍存在、codec 可解码且 volume 可构建。

入口 eligibility 依次要求：CT 且 Series eligible；至少两个 Instance；每张具有有限的三维位置、六维
方向和正数一致的 Rows/Columns；方向向量能形成非退化法向且在容差内一致；法向投影至少包含两个相差
大于 `1e-3 mm` 的位置。相邻投影差仅在近似一致时输出 slice spacing，否则显示“不可推导”。

**Rationale**: 现有 Series 摘要没有逐实例位置，单切片仍可能标记 eligible。前端 geometry 可安全预判，
但不能证明文件此刻存在或体数据一定能构建。进入后重新请求可以关闭 Series 删除/状态变化的时间窗口，
而不为入口预取所有 DICOM 像素。

**Alternatives considered**:

- 直接把 `viewability_status=eligible` 当作 MPR eligible：无法排除单切片和零空间范围。
- 后端增加 `mpr_eligible` 持久化字段：扩大 schema/迁移/合同，且仍不能证明当前文件和 codec 状态。
- 直接复用 `useAxialSeries()`：其错误已压缩为字符串，不适合 MPR 的状态分类和重新校验。

## Decision 3: CrosshairsTool 使用同一 ToolGroup，并显式管理工具互斥

**Decision**: 注册 Crosshairs、WindowLevel、Pan、Zoom 和 StackScroll。一个 ToolGroup 加入三个
viewport。StackScroll 始终绑定 Wheel；四个主工具中只有当前工具绑定 Primary。Crosshairs 配置关闭
slab thickness controls，参考线颜色按三个 viewport 区分，允许拖动定位但不加入测量或旋转功能。

切换到非 Crosshairs 工具时，Crosshairs 使用 Enabled 模式保持显示但移除 Primary bindings；隐藏时使用
Disabled 模式，并自动切到 WindowLevel。重新显示时依据当前三个 camera 重新计算中心。

**Rationale**: `ToolGroup.setToolActive()` 不会自动清除其他工具的 Primary bindings，必须先
`setToolPassive(name, { removeAllBindings: true })`。`setActivePrimaryTool()` 会 disable 旧 Crosshairs 并
隐藏参考线，不符合“保持显示但不可交互”。

**Alternatives considered**:

- Crosshairs 与 WindowLevel 同时绑定 Primary：鼠标冲突且 active 状态不可信。
- 用 CSS 隐藏十字线：annotation 和全局监听仍存在，无法表达真实工具状态。
- 开启 slab thickness handles：属于当前普通二维 MPR 不需要的高级控制。

## Decision 4: VOI 使用 runtime 内部事件同步，不使用 5.6.8 全局 synchronizer

**Decision**: 在三个 viewport element 上监听 `VOI_MODIFIED`。runtime 使用递归保护标志，将来源
viewport 的 `voiRange` 和 invert 状态写入另外两个 viewport 并 render；destroy 时使用保存的 handler
引用逐一移除。平移和缩放不设置同步器。

**Rationale**: `createVOISynchronizer()` 能正确同步 VOI，但 5.6.8 的 `Synchronizer._updateDisableHandlers()`
每次创建新的局部 disable handler，remove 时不是同一函数引用，而且把 DOM element 传给期望 viewport
info 的 remove。公开 API 无法可靠移除这些 `ELEMENT_DISABLED` closures。当前需求只需要三个 viewport
的 VOI range，同一 runtime 内的小型监听更简单、可测试且可完全清理。

**Alternatives considered**:

- `createVOISynchronizer()`：功能可用，但存在已确认的包内监听残留风险。
- camera/zoom-pan synchronizer：会违反平移和缩放只影响活动 viewport 的需求。
- 不同步 VOI：违反三视图灰度一致的已批准交互规则。

## Decision 5: 完整加载成功以帧计数判断

**Decision**: `volume.load(callback)` 只由一个 runtime 调用一次。完整成功要求 callback 中
`framesProcessed === totalNumFrames` 且 `framesLoaded === totalNumFrames`。创建前监听
`VOLUME_LOADED_FAILED`、`IMAGE_LOAD_FAILED`、`IMAGE_LOAD_ERROR` 和
`IMAGE_VOLUME_LOADING_COMPLETED`，用于分类和进度，但不把单一事件当作成功证据。

**Rationale**: `VOLUME_LOADED` 只表示 volume 对象创建成功。5.6.8 的 `loadStatus.loaded` 和
`IMAGE_VOLUME_LOADING_COMPLETED` 表示所有帧已处理，部分失败也会成立；callback 的 `success` 只反映
最后处理的帧。比较 loaded/processed/total 是唯一可靠的完整成功信号。

**Alternatives considered**:

- 等待 `VOLUME_LOADED`：过早，像素尚未全部加载。
- 只看 `result.success` 或 `loadStatus.loaded`：会把部分失败误判为完整成功。
- 重复调用 `volume.load(callback)`：加载中调用不会追加 callback，容易丢失完成通知。

## Decision 6: 继续复用并扩展现有 XHR 取消与安全错误分类

**Decision**: 从轴位 adapter 导出中性的 `abortPendingDicomLoads(imageIds)` 和已初始化模块类型，保持轴位
行为不变。MPR cleanup 先设置 cancelled 并 abort 活跃 DICOM XHR，再 `volume.cancelLoading()` 和
`clearLoadCallbacks()`，移除应用监听，disable Crosshairs，销毁 RenderingEngine/ToolGroup，最后在缓存
对象存在时移除专属 volume load object。所有步骤幂等。

事件错误继续通过稳定 HTTP 状态映射区分 404/409/410/422/500/网络失败；volume/decode/WebGL 内部文本
统一转换为“无法构建三视图，请重试或返回轴位查看器”。UI 不显示 image ID、volume ID、路径或堆栈。

**Rationale**: `volume.cancelLoading()` 主要取消队列请求，不能保证中止已发出的 XHR；现有 loader
`beforeSend/onloadend` 跟踪可以真正 abort 在途请求。专属 runtime ID 避免重试复用失败缓存。

**Alternatives considered**:

- 只调用 `cancelLoading()`：加载中退出仍可能留下网络请求。
- 清空整个 Cornerstone cache：会影响轴位或其他会话的共享缓存，范围过大。
- 返回原始 loader 错误：会泄露实现和本机信息。

## Decision 7: 页面编排保留轴位为降级路径

**Decision**: `AxialViewerPage` 保存临时 `mprOpen`，Series 成功后显示入口或 MPR 不可用原因。打开时渲染
独立 `MprViewerPage`，该页面自己重新请求详情；返回仅关闭 MPR，恢复同一轴位上下文。病人管理页不
持有 MPR 工具或 volume 状态。

**Rationale**: 保留已验收的轴位查看器和失败降级，不在病人管理页增加影像库细节，也符合总验收路径
“查看轴位 → 进入 MPR → 返回轴位”。

**Alternatives considered**:

- 替换轴位页：破坏已完成特性的独立价值和降级路径。
- 病人管理页并列两个入口：扩大管理页职责和状态分支。
- 在 PatientManagementPage 保存 MPR mode：可行，但 MPR 仅是轴位上下文内的下一层页面，额外状态不必要。

## Decision 8: 自动化测试与真实浏览器职责分离

**Decision**: Vitest/RTL 测试 eligibility、hook 状态、runtime 调用合同、工具互斥、VOI 事件、页面编排、
安全文案、可访问性和 cleanup。真实 Chrome 使用 WebGL、worker 和真实 DICOM 验证三个非黑平面、三向
Crosshairs/滚轮联动、VOI、resize、加载失败和退出资源释放。

**Rationale**: jsdom 不能证明真实 volume 几何、WebGL 渲染、Crosshairs 世界坐标或 codec 行为；真实
浏览器又不适合穷举稳定错误和生命周期分支，必须分层验证。

**Alternatives considered**:

- 只依赖组件 mock：无法证明 MPR 真正可用。
- 只做浏览器人工验收：回归慢且错误分支不可重复。
- 引入新的 E2E 框架：当前项目已有真实 Chrome 验收工作流，新增依赖无必要。

## Cornerstone3D 5.6.8 implementation risks

- `createAndCacheVolume()` 必须接收 `imageIds: [...imageIds]`；内部方向排序可能原地 reverse 数组。
- `wadouri:` image ID 在首次 volume 创建前可能尚无完整 DICOM metadata；使用非缓存 `loadImage()` 解析后，
  必须移除可能存在的 Stack image load object，再交给 streaming volume 重新加载像素。
- volume 创建需要 PixelSpacing、ImagePositionPatient、ImageOrientationPatient、Rows、Columns 等元数据；
  eligibility 无法替代真实创建测试。
- `IMAGE_LOAD_ERROR.detail.imageId` 在 5.6.8 streaming 失败路径可能因参数绑定错位变成数字 index；不能
  只靠该字段过滤，需结合 `IMAGE_LOAD_FAILED` 和最终帧计数。
- 三个 viewport DOM 在创建前必须有非零尺寸；Cornerstone 内部 `.viewport-element { height: 100% }` 要求父层
  具有确定 `height`，仅设置 `min-height` 会在真实浏览器得到零高画布。runtime 创建后立即调用一次
  `renderingEngine.resize()`，ResizeObserver 只负责后续变化。
- CrosshairsTool disable/re-enable 会重建 annotation 和监听，显隐后位置依赖当前 cameras 重新计算。
- 三个正交 camera 的 `focalPoint` 分别位于各自平面，不等于共享十字定位点；覆盖层必须用三个
  `(viewPlaneNormal, focalPoint)` 平面求交得到唯一 linked world point，并把同一结果回调给三个 viewport。
- 三个 viewport 加入 ToolGroup 并激活 Crosshairs 后，调用公开 `resetCrosshairs()` 才能可靠建立初始中心。
- `destroyToolGroup()` 本身不会调用各工具的 `onSetToolDisabled()`；cleanup 必须先显式 disable Crosshairs。

## US1 real Chrome findings (2026-07-21)

- Chrome `150.0.7871.114`、全新临时 SQLite 和六个已脱敏 CT fixture 下，主验收 `31/31` 通过。
- 三个非黑正交 viewport 首屏为 `306 ms`，低于 `8 s` 目标。
- 初始三个位置均为 `[1.0, 1.0, 2.0] mm`；轴位 Crosshairs 后均为 `[0.8, 0.7, 2.0] mm`；
  冠状位滚轮后均为 `[0.8, 0.0, 2.0] mm`；矢状位反向滚轮后均为 `[0.0, 1.0, 2.0] mm`。
- 页面显示 Patient/Study/Series、`Modality: CT`、`Rows × Columns: 2 × 2`、`切片间距: 1.0 mm`，
  未显示内部 ID；六个 DICOM 响应均为 `application/dicom`，外部请求为 `0`，Console error 为 `0`。
- 重复打开轴位/MPR 时 Chrome 报告既有 WebGL context 数量 warning，但没有 error 或黑屏；资源回收与
  多次进入退出仍由 T056、T068 和最终 A-E 验收继续验证，本轮不扩大 US1 实现范围。
