# 高级 3D 可视化设计

## 目标与边界

为现有可查看且满足 MPR 空间条件的本机 CT Series 增加独立高级 3D 页面，提供体绘制、最大强度
投影（MIP）和真实阈值表面重建。全部像素加载、体数据构建、渲染和表面计算都在本机浏览器完成，
继续通过同源 FastAPI 读取受管 DICOM 文件。

本 Feature 不加入分割工作流、手工轮廓、诊断能力、手术规划、3D 测量、网格导出、报告、云处理、
PACS、DICOMweb、账户或远程服务。3D 页面状态不写入 Feature 006 的查看器持久化接口；每次重新进入
都恢复安全默认值。

## 方案比较

### 方案 A：共享 volume + 单 3D viewport + 模式切换（采用）

- 复用现有 Series 详情、MPR eligibility、imageId 加载和 Cornerstone 初始化边界。
- 一个 streaming volume 绑定一个 `ORTHOGRAPHIC` volume viewport。
- 体绘制与 MIP 切换同一个 volume actor 的 preset、blend mode、slab thickness 和相机。
- 表面模式从已加载 volume 的 `IImageData` 创建 vtk.js 等值面 actor，并加入同一 viewport。
- 优点：只保留一份像素、一个 WebGL context 和一套相机，模式切换可复用已加载数据，退出清理边界清晰。
- 代价：表面提取为浏览器同步计算，需要显式触发和采样上限来保护响应性。

### 方案 B：三个模式各自使用独立 viewport

组件隔离直观，但会重复 volume actor、相机、工具和 WebGL 资源。现有 MPR 压力验收已经观察过浏览器
WebGL context 上限警告，因此不采用。

### 方案 C：FastAPI 后台生成表面网格

可把计算移出浏览器，但会新增上传或读取任务、网格缓存、状态恢复、API、清理和并发边界，且偏离已批准
的本机浏览器渲染范围，因此不采用。

## 页面与入口

- `AxialViewerPage` 在 Series 满足现有 MPR eligibility 时同时提供“进入三视图”和“进入高级 3D”。
- 不满足条件时，轴位查看仍可用，并显示同一条安全原因；高级 3D 按钮禁用。
- 高级 3D 页面继续使用 `AppShell`，持续显示“教学演示软件，不用于临床诊断”。
- 页面显示 Patient、病历号、Study、日期、Series、Modality、Rows × Columns、实例数和切片间距，
  不显示内部 UUID、DICOM UID、本机路径或 codec 细节。
- 返回操作回到同一轴位 Series；再次进入时创建全新的 3D runtime。

## 模块边界

新增 `frontend/src/features/advanced-3d-viewer/`：

- `model/advanced3dViewer.ts`：模式、preset、标准观察方向、阈值范围和纯状态规则。
- `hooks/useAdvanced3dSeries.ts`：重新获取 Series、校验 eligibility、生成 imageIds，并映射用户安全错误。
- `core/advanced3dCornerstone.ts`：streaming volume、3D viewport、工具、模式切换、相机、actor 和 cleanup。
- `core/surfaceReconstruction.ts`：输入采样、方向矩阵、Marching Cubes、mesh actor 创建与释放。
- `core/advanced3dRuntimeTypes.ts`：页面与 Cornerstone adapter 之间的最小接口。
- `components/Advanced3dViewport.tsx`：runtime 生命周期、加载/失败/重试和控制状态。
- `components/Advanced3dToolbar.tsx`：模式、preset、MIP、表面和重置控件。
- `pages/Advanced3dViewerPage.tsx`：安全提示、元数据、Series 请求和返回编排。

新增 `frontend/src/types/vtk-image-marching-cubes.d.ts`，只声明当前使用的 `newInstance`、输入、阈值、
法线、合并点、更新、输出和释放方法。`@kitware/vtk.js@36.4.1` 作为 Cornerstone 已使用但本 Feature
直接导入的库，加入 `package.json` 直接依赖，避免依赖传递安装细节。

## Volume 加载与生命周期

1. 进入页面后重新请求 Series 详情，不信任轴位页中的旧数据。
2. 使用现有 eligibility 规则拒绝非 CT、不可查看、尺寸/方向不一致、少于两个不同空间位置的 Series。
3. 初始化 Cornerstone，预加载 imageIds，创建唯一 streaming volume 和唯一 `ORTHOGRAPHIC` volume viewport。
4. volume 完整加载后设置默认 `COMPOSITE` blend、`CT-Bone` preset、前方标准相机和旋转工具。
5. runtime 只在完整加载后报告 ready；部分 frame、decode、文件、volume 或 render 失败均进入安全错误状态。
6. 页面退出、请求取消、失败或重试时幂等释放 pending XHR、load callback、volume、surface actor、
   tool group、listener 和 rendering engine，并移除本 Feature 创建的缓存项。

## 体绘制

- 默认模式为体绘制，blend mode 使用 `COMPOSITE`。
- 提供 `CT-Bone`、`CT-Soft-Tissue`、`CT-Lung` 三个固定 preset，分别显示为“骨”“软组织”“肺”。
- 切换 preset 只更新现有 volume actor，不重新请求 DICOM 或创建新 volume。
- 左键旋转，辅助绑定提供平移和缩放；“重置”恢复默认相机、默认 `CT-Bone` 和完整 volume 显示。

## MIP

- MIP 模式使用 `BlendModes.MAXIMUM_INTENSITY_BLEND` 和 `CT-MIP` preset。
- 提供前方、后方、左侧、右侧、头侧、足侧六个标准观察方向；同时保留鼠标自由旋转。
- 投影厚度单位为毫米，最小值取最小 voxel spacing，最大值取 volume 物理包围盒对角线。
- 默认厚度为最大值，代表覆盖完整体数据；调整厚度调用同一 viewport 的 slab thickness，不重建 volume。
- 从 MIP 切回体绘制时恢复用户最后选择的体绘制 preset，不继承 `CT-MIP`。

## 表面重建

- 表面模式使用 vtk.js `ImageMarchingCubes` 生成真实三角 mesh，不用 volume opacity 模拟表面。
- 默认阈值为 `300 HU`；若数据范围不包含 300，则使用实际最小值和最大值的中点。
- 阈值控件以实际 scalar range 为边界，数值输入和滑块保持同步；只有点击“应用阈值”才开始重建。
- 重建前先让出一次浏览器绘制机会，显示“正在重建表面”；同步计算期间禁用模式和阈值操作。
- 为避免大 CT 直接遍历数亿 voxel，输入超过 4,000,000 个采样点时使用统一整数 stride 降采样。
  新尺寸和 spacing 保持原物理范围，scalar 使用 `Float32Array`，不修改 Cornerstone 原始 volume。
- Marching Cubes 使用 `computeNormals=true` 和 `mergePoints=true`。mesh actor 使用不透明浅骨色、漫反射和
  适量高光；volume actor 在表面模式隐藏。
- vtk.js 的该 filter 不应用 `vtkImageData.direction`，因此采样数据使用零 origin 和单位 direction，
  actor 再通过 `origin + direction × localPoint` 的 4×4 user matrix 回到 DICOM 世界坐标。
- 新阈值成功后替换旧 surface actor；空 mesh 显示“该阈值未生成可见表面”，并保留控件供再次尝试。
- 计算异常、内存不足或无效 scalar 数据只显示安全错误，不泄露堆栈、绝对路径、UID 或像素内容。

## 交互与可访问性

- 模式使用三个具名按钮并通过 `aria-pressed` 表达当前状态，不只依赖颜色。
- preset、标准方向、重置和应用阈值均可通过键盘操作；范围控件具有可读 label、当前值和单位。
- viewport 可聚焦并显示焦点轮廓；状态区使用 `aria-live`，错误区使用 `role="alert"`。
- 桌面布局为主 viewport 加侧边控制区；窄屏按标题、控制区、viewport、元数据顺序纵向排列。
- SafetyBanner、返回按钮、模式状态和错误信息不得被 canvas 或浮层遮挡。

## 错误与恢复

- Series 不存在、不可查看、几何不足、服务停止、数据库失败、本机文件缺失和未知异常继续映射为
  现有风格的中文安全消息。
- Series 请求失败时不初始化 Cornerstone；volume/runtime 失败时销毁当前 runtime，再允许“重试高级 3D”。
- 表面重建失败只清理 surface pipeline，保留已加载 volume，使用户仍可切回体绘制或 MIP。
- 快速切换模式、重试或返回时，过期 callback 不得更新新页面状态。
- 所有请求继续只访问同源 `/api` 和 `127.0.0.1`，不产生遥测、CDN 或外部网络请求。

## 测试与验收

- 纯函数测试：模式默认值、preset 映射、阈值 clamp、采样 stride、尺寸/spacing、方向 user matrix。
- adapter 测试：唯一 volume/viewport、完整加载判定、体绘制 preset、MIP blend/thickness/方向、
  surface actor 替换、空 mesh、失败隔离、幂等 cleanup 和过期 callback。
- hook 测试：重新获取 Series、eligibility、imageIds、abort、404/409/410/5xx 和安全未知错误。
- 组件/页面测试：入口、禁用原因、三模式控件、preset、MIP 方向/厚度、阈值应用、busy/empty/error、
  返回、重试、安全提示、元数据、键盘和窄屏语义。
- 全量验证：后端 pytest、前端 Vitest/RTL、TypeScript、Vite production build 和 `git diff --check`。
- 真实浏览器：使用独立临时数据目录和已脱敏 CT，验证三个模式非黑、相机交互、三 preset、六方向、
  MIP 厚度、至少两个表面阈值、空 mesh、服务/文件失败恢复、快速切换、重复进入退出和 loopback-only。
- 记录首次 3D 可见时间、表面重建时间、Console、Network、截图、volume/surface cleanup 和重启结果。

## 自检

- 无未决占位符、待澄清项或隐式持久化需求。
- 仅覆盖高级 3D 可视化，不加入分割、诊断、报告、导出、云、PACS 或 DICOMweb。
- 只有一个 streaming volume、一个 viewport 和一个 WebGL context；没有为三个模式重复资源。
- 表面为真实等值面，并明确处理大体积响应性、方向矩阵、空 mesh 和失败隔离。
- 新增直接依赖仅是 Cornerstone 当前已安装并被本 Feature 直接导入的 vtk.js 固定版本。
