# Phase 0 Research: 高级 3D 可视化

## Decision 1: 使用一个 `ORTHOGRAPHIC` volume viewport 驱动三个模式

**Decision**: 复用 MPR 已验证的 imageId metadata 预加载和 streaming volume 创建顺序，为当前会话创建唯一
volume、RenderingEngine、`ORTHOGRAPHIC` volume viewport 和 ToolGroup。体绘制、MIP 和 surface 只切换现有 actor、
blend、preset、slab 和相机，不创建模式专属 volume。

**Rationale**: Cornerstone 5.6.8 的 `VolumeViewport3D` 类型声明虽然公开了 `setBlendMode()` 和
`setSlabThickness()`，但发布实现中的两个方法是 no-op，真实浏览器中无法改变 MIP slab。`ORTHOGRAPHIC`
volume viewport 走 `VolumeViewport` 实现，能够在同一 volume actor 上实际应用 blend、preset、slab、相机和
`addActor()`。共享资源避免重复 DICOM 请求、像素缓存和 WebGL context，符合已观察到的浏览器 context 压力边界。

**Alternatives considered**:

- 三个独立 viewport：重复内存、相机和 context，模式切换也无法自然保留视角。
- 为每个模式重新创建 volume：增加请求、延迟和 cleanup 竞态，没有用户价值。
- 后端返回渲染结果：破坏浏览器本机交互和简单单进程边界。

## Decision 2: 体绘制使用 Cornerstone 内置 CT presets

**Decision**: 默认 `COMPOSITE` blend 和 `CT-Bone`，用户可选 `CT-Bone`、`CT-Soft-Tissue`、`CT-Lung`。
通过 `viewport.setProperties({ preset })` 修改同一个 volume actor。runtime 保存最后一个 volume preset，
从 MIP 返回时恢复它。

**Rationale**: 5.6.8 自带稳定 `VIEWPORT_PRESETS`，无需自建 transfer function 编辑器或引入任意参数。
三个 preset 覆盖最容易理解的教学观察目标，满足 YAGNI。

**Alternatives considered**:

- 暴露完整 transfer function 编辑器：属于专业工作站范围，测试和可访问性成本过高。
- 只提供一个 preset：满足最小渲染但不满足已批准的多组织观察。
- 自定义硬编码 transfer function：重复已存在的 Cornerstone 数据并增加维护风险。

## Decision 3: MIP 使用 maximum blend、`CT-MIP` 和物理 slab thickness

**Decision**: MIP 模式设置 `BlendModes.MAXIMUM_INTENSITY_BLEND` 与 `CT-MIP` preset。厚度下限是三轴最小
spacing，上限是 volume 物理包围盒对角线，默认上限。六方向通过固定 `viewPlaneNormal` 和 `viewUp` 设置
相机；TrackballRotateTool 继续允许自由旋转。

**Rationale**: `ORTHOGRAPHIC` volume viewport 实际支持 blend 和 slab，不需要第二个投影 viewport。对角线
可覆盖任意相机方向下的完整 volume。具名方向让结果可重复，鼠标旋转保留探索能力。

**Alternatives considered**:

- 只使用完整体 MIP：缺少局部 slab 教学价值。
- 固定轴向 MIP：不能观察其他标准方向。
- 新建第二个正交 MIP viewport：会拆分相机和资源，违背单 viewport 决策。

## Decision 4: 表面使用真实 vtk.js `ImageMarchingCubes`

**Decision**: 直接导入 `@kitware/vtk.js/Filters/General/ImageMarchingCubes`，以 CT HU 阈值生成 `vtkPolyData`，
连接 `vtkMapper` 和 `vtkActor` 后使用 Cornerstone viewport `addActor()` 加入场景。filter 启用 normals 和 point
merge；actor 使用固定浅骨色与不透明材质。

**Rationale**: 这是当前依赖树内最小的真实等值面方案。Cornerstone 已安装 vtk.js 36.4.1，但本 Feature
直接使用它，因此固定为直接依赖。该模块发布了 JavaScript 但没有独立 `.d.ts`，需要项目内最小声明。

**Alternatives considered**:

- 用 opacity threshold 模拟表面：不产生 mesh，不满足真实表面要求。
- `@cornerstonejs/polymorphic-segmentation`：会引入 segmentation state 和转换工作流，范围过大。
- 后端 marching cubes：新增任务、网格传输、缓存和清理，不符合当前 Feature。

## Decision 5: 显式处理 Marching Cubes 的方向限制

**Decision**: `ImageMarchingCubes` 输入使用零 origin、单位 direction 和按物理 spacing 采样的数据；输出 actor
设置 4×4 user matrix，把局部点变换为 `origin + direction × localPoint` 的 DICOM 世界坐标。

**Rationale**: 36.4.1 的 filter 实现读取 origin、spacing、dimensions 和 scalars，但不读取
`vtkImageData.direction`。直接传 Cornerstone imageData 会在非单位方向或轴翻转时生成错误方向表面。
actor user matrix 能复用同一 mesh，且不修改原 volume。

**Alternatives considered**:

- 假设所有 CT direction 为单位矩阵：真实 DICOM 可包含轴翻转或斜采集，不安全。
- 逐点修改 output polydata：需要额外遍历和复制几何。
- 使用 transform filter：可行但增加另一条 vtk pipeline；actor matrix 更小。

## Decision 6: 表面采样最多 4,000,000 点并显式应用阈值

**Decision**: 计算统一整数 stride，使输出 dimensions 的乘积不超过 4,000,000。抽样到 `Float32Array`，
各轴在完整 source voxel-center extent 上均匀映射首尾采样点，并据此计算 effective spacing，保持
origin/direction user matrix 和物理范围。阈值输入变化只更新 React 值；用户点击
“应用阈值”后先让出一次绘制机会，再同步执行 Marching Cubes。

**Rationale**: 512×512×数百层直接在主线程遍历会冻结页面并可能生成不可控 mesh。统一 stride 可把常见
CT 限制在可测试规模，并明确牺牲表面细节而不改变世界范围。显式应用避免滑块每一帧重复重建。

**Alternatives considered**:

- 不设上限：真实大体积存在长时间无响应和内存崩溃风险。
- Web Worker：需要复制或转移 scalar buffer；转移会破坏 volume，复制会瞬时翻倍内存，超出当前范围。
- debounce 自动重建：仍可能在连续输入时积累不可取消的同步计算。

## Decision 7: eligibility 复用，3D hook 独立映射错误

**Decision**: 轴位入口继续使用 `deriveMprEligibility()` 作为多位置 volume 条件。高级 3D 页使用独立
`useAdvanced3dSeries()` 重新请求 Series 详情、再次校验并生成 imageIds；错误文字使用“高级 3D”语义，
不复用 MPR hook 中的“三视图”消息。

**Rationale**: 两个 feature 对空间条件相同，但页面错误上下文不同。复制一个小 hook 的状态编排比为现有
MPR 引入配置框架更外科手术式，也避免错误文案串台。

**Alternatives considered**:

- 直接使用 `useMprSeries()`：会显示不正确的三视图错误和重试文字。
- 抽取通用 viewer framework：仅两个 hook，当前收益不足以支持额外抽象。
- 后端新增 3D eligibility：重复现有前端几何规则并扩大 API。

## Decision 8: 工具绑定保持最小且可清理

**Decision**: TrackballRotate 绑定 Primary，Pan 绑定 Auxiliary，Zoom 绑定 Secondary 和 Wheel。viewport
可聚焦；六方向和 reset 使用按钮。ToolGroup 和全局工具注册遵循 MPR 的幂等模式，destroy 时只销毁本会话组。

**Rationale**: 三维页面不需要测量、Crosshairs、WindowLevel 或 StackScroll。固定并行绑定避免增加工具模式
切换 UI，同时鼠标和键盘按钮都能完成核心操作。

**Alternatives considered**:

- 把 rotate/pan/zoom 作为互斥工具：增加状态和点击次数，三维常见交互不需要。
- 直接操作 vtk interactor：绕过 Cornerstone tools 生命周期，难与当前 cleanup 方式一致。

## Decision 9: 完整加载、错误隔离和 cleanup 沿用已验证模式

**Decision**: volume 完整成功仍要求 `framesLoaded === totalNumFrames` 且
`framesProcessed === totalNumFrames`。runtime 监听本会话 image/volume 失败，使用 allowlist 安全消息。
表面错误只销毁新 surface pipeline；页面退出或 runtime 错误按 XHR → volume callbacks → surface → tools →
engine → cache 顺序幂等清理，并阻止过期 callback。

**Rationale**: Feature 004 已真实验证部分 frame、XHR abort 和专属 volume cache 语义。表面是可选派生资源，
不应把其失败升级为 volume 丢失。

**Alternatives considered**:

- 表面失败销毁整个 runtime：恢复成本高且违反模式隔离。
- 只依赖 `cancelLoading()`：不能保证 abort 已发出的 DICOM XHR。
- 回显原始 vtk/Cornerstone 错误：可能泄露 ID、URL、路径和实现细节。

## Decision 10: 自动化验证与真实浏览器分层

**Decision**: Vitest/RTL 验证模型、采样、矩阵、runtime 调用合同、hook、控件、页面、错误和 cleanup；
真实 Chrome 验证 WebGL 非黑结果、preset、MIP、surface、性能、响应式、实际 DICOM、Network 和 Console。

**Rationale**: jsdom 不能证明真实 volume rendering、MIP 投影或 mesh 可见性；真实浏览器不适合穷举所有
状态和过期 callback，二者缺一不可。

**Alternatives considered**:

- 只做组件 mock：无法证明核心视觉能力。
- 只做人工浏览器：错误分支和生命周期回归不可重复。
- 新增 E2E 框架依赖：当前已有 Chrome DevTools/临时 Playwright 验收路径，无必要进入产品依赖。
