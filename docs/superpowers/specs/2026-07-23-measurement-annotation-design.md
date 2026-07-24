# 测量与标注设计

## 背景

当前项目已完成病人管理、DICOM 导入、轴位查看和三视图 MPR。轴位查看器使用 Cornerstone3D `StackViewport`，MPR 使用一个共享 streaming volume 和轴位、冠状位、矢状位三个 `ORTHOGRAPHIC` viewport。两个查看器已有窗宽窗位、平移、缩放、切片滚动或 Crosshairs，但没有测量与文字标注。

用户希望后续依次增加测量与标注、查看器状态持久化、后台导入与断点续传，以及 3D 体绘制、表面重建和 MIP。本设计只覆盖第一个可独立交付的 Feature 005；其余能力保持独立 Feature，避免把查看器交互、数据库状态、上传协议和三维渲染耦合到一次改动中。

## 目标

1. 在轴位查看器和三视图 MPR 中提供长度、角度和矩形 ROI 测量。
2. 提供箭头文字标注，并允许创建后修改文字和位置。
3. 支持编辑既有测量、单项删除和经二次确认后的全部清空。
4. 使用 Cornerstone3D 5.6.8 原生 annotation 工具、世界坐标和统计结果，不自行实现测量数学或绘制层。
5. 对缺少可靠空间标定的数据安全降级，不显示伪造的毫米、面积或 CT 值结果。
6. 保持本机、单用户、非临床教学边界，并为 Feature 006 的状态持久化保留清晰接口。

## 明确边界

- 不新增后端 API、数据库表、Alembic 迁移或 Python 依赖。
- 不持久化查看器状态、测量或标注；退出查看器、切换 Series 或销毁 runtime 后清理本次会话状态。
- 不实现撤销/重做、截图、导出、报告、协作、分享或深链接。
- 不实现分割、自动病灶检测、密度诊断、临床阈值判断或诊断建议。
- 不实现 3D 体绘制、MIP、表面重建、PACS、DICOMweb、云服务或远程访问。
- 不新增 npm 依赖；继续使用仓库锁定的 Cornerstone3D 5.6.8。

## 总体架构

新增共享前端功能边界 `frontend/src/features/viewer-annotations/`：

- `model/viewerAnnotation.ts`：定义测量/标注工具、标定状态、文字请求和 annotation 计数等与 Cornerstone 实现无关的类型与纯函数。
- `core/annotationTools.ts`：集中映射和注册 Cornerstone 原生测量/标注工具，配置箭头文字回调，查询/清理本功能 annotation，并隔离 Cornerstone annotation state API。
- `core/ScopedAnnotationEraserTool.ts`：基于 Cornerstone `BaseTool`、当前 tool group 和 annotation state 公共 API 实现 allowlist 删除，只命中本功能四类 annotation。
- `components/MeasurementToolbar.tsx`：渲染长度、角度、矩形 ROI、箭头标注和单项删除工具；显示当前工具、标定不可用原因与当前 annotation 数量。
- `components/AnnotationTextDialog.tsx`：复用现有 `ModalDialog`，处理新建文字、修改文字、校验、取消和焦点恢复。
- `components/ClearAnnotationsDialog.tsx`：显示待清理数量与不可恢复后果，确认后才执行全部清空。

轴位和 MPR 保留各自的 runtime 生命周期、viewport 创建与既有工具编排，只通过共享 helper 接入测量工具。共享模块不创建 rendering engine、volume 或 viewport，也不依赖病人管理页面。

## 工具与交互

### 工具集合

| 用户工具 | Cornerstone 工具 | 行为 |
| --- | --- | --- |
| 长度 | `LengthTool` | 在当前图像平面绘制两点线段并显示原生标定长度。 |
| 角度 | `AngleTool` | 绘制三点角度并显示原生角度结果。 |
| 矩形 ROI | `RectangleROITool` | 显示 Cornerstone 提供的面积和 CT 像素统计；不在应用层重新计算或改写单位。 |
| 箭头标注 | `ArrowAnnotateTool` | 绘制箭头后打开文字对话框；双击既有箭头可修改文字。 |
| 删除单项 | `ScopedAnnotationEraserTool` | 点击一个可交互测量或箭头标注后只删除该项；不遍历或删除 Crosshairs。 |

既有窗宽窗位、平移、缩放、轴位切片滚动和 MPR Crosshairs 行为保持不变。测量/标注工具与现有主鼠标工具互斥；滚轮仍保留切片滚动。MPR 默认仍为 Crosshairs。切换到测量、标注或删除时，Crosshairs 线保持可见但不接收主鼠标绑定；重新选择 Crosshairs 后恢复交互。

### 编辑与清理

- 已有长度、角度和 ROI 由 Cornerstone 原生 handle 选择与拖动完成编辑。
- 箭头端点和文字框可拖动；双击箭头或文字重新打开文字对话框。
- “删除单项”使用 allowlist scoped eraser。它只向 `LengthTool`、`AngleTool`、`RectangleROITool` 和 `ArrowAnnotateTool` 查询当前 element 可交互 annotation；多个 annotation 在点击容差内重叠时，按反向创建顺序只删除第一个命中项。删除后继续保持该工具激活，直到用户切换工具。
- “全部清空”只统计并删除 `Length`、`Angle`、`RectangleROI` 和 `ArrowAnnotate`；清空前显示数量并要求确认。
- 清空和 runtime 销毁均不得调用全局 `removeAllAnnotations()`，以免删除 Crosshairs 或其他 Cornerstone 内部 annotation。实现必须按允许的 tool name 查询 annotation UID、去重后逐项删除。
- “重置查看器”只恢复相机、窗宽窗位、切片/十字定位和默认工具，不删除测量或标注。

## 文字标注对话框

Cornerstone `ArrowAnnotateTool` 默认使用浏览器 `prompt()`。本功能用注入的 `getTextCallback` 和 `changeTextCallback` 替换默认行为：

1. 用户完成新箭头后，runtime 通过 callback 请求 React 打开 `AnnotationTextDialog`。
2. 对话框使用单行输入，去除首尾空白后要求 1–200 个可见字符，拒绝换行和控制字符。
3. 新建时取消或提交空值会调用完成 callback 的空值分支，使 Cornerstone 删除未完成箭头。
4. 编辑时取消不会调用修改完成 callback，原文字保持不变。
5. 提交有效文字后调用 Cornerstone 提供的完成 callback，由原生工具更新 label、触发 annotation 事件并重绘。
6. runtime 销毁时关闭待处理对话框并使旧 callback 失效，避免在已销毁 viewport 上提交文字。

对话框重复非临床提示，打开时焦点进入输入框，取消或提交后焦点返回产生该标注的活动 viewport。保存进行期间不允许重复提交。

## 标定与显示安全

几何测量在启用前检查当前 Series 的 Cornerstone `imagePlaneModule` 元数据：

- 每个参与显示的 image ID 必须具有有限且大于零的 `rowPixelSpacing` 和 `columnPixelSpacing`。
- 同一 Series 的像素间距必须在小容差内一致；缺失、非有限、非正数或不一致均视为不可标定。
- 不可标定时禁用长度、角度和矩形 ROI，并显示“影像缺少可靠 Pixel Spacing，无法进行几何测量”；窗宽窗位、平移、缩放、Crosshairs、箭头标注和删除仍可用。
- 应用不把像素数冒充毫米，也不自行构造 ROI 的 HU、均值、最小值、最大值或标准差。显示内容只来自 Cornerstone 对已加载 CT 数据的原生统计。
- 原生统计暂时未完成时保持加载状态或占位，不把空值、`NaN` 或 `Infinity` 显示给用户。

检查发生在 runtime 已加载必要 metadata、但用户可以激活测量工具之前。Feature 005 不改变 DICOM 导入的 `eligible` 判定，因此缺少 Pixel Spacing 的 Series 仍可查看，只是不能执行几何测量。

## Runtime 集成

### 轴位查看器

- 扩展轴位工具类型和 toolbar 编排，但保持 `StackViewport`、中间切片初始位置、滚轮滚动和现有 reset 行为。
- runtime 创建时向既有 tool group 加入五个 annotation 工具，并通过 callback 报告标定状态和 annotation 数量。
- annotation 只属于当前轴位 runtime；销毁时取消未完成操作并精确清理本功能 annotation。

### 三视图 MPR

- 继续使用一个 tool group 连接三个正交 viewport；测量/标注工具在三个 viewport 可用，实际 annotation 由用户开始交互的 viewport 决定。
- Annotation 使用 Cornerstone 世界坐标；不在 React 中复制轴位、冠状位、矢状位坐标转换。
- 既有共享 VOI、独立 Pan/Zoom、Crosshairs 显隐和 position callback 不改变。
- 清理时从三个 element 查询允许的 annotation 类型，按 UID 去重后删除；Crosshairs annotation 必须保留到既有 tool group 销毁流程处理。

### 共享事件

runtime 监听 Cornerstone `ANNOTATION_COMPLETED`、`ANNOTATION_MODIFIED` 和 `ANNOTATION_REMOVED`，但只响应属于当前 runtime Frame of Reference 且 tool name 位于允许集合的事件。事件用于更新 annotation 数量和对话框状态，不把完整 Cornerstone annotation 对象存入 React state。

## 状态与生命周期

Feature 005 的状态分为：

- React UI 状态：当前工具、标定状态、annotation 数量、文字对话框、清空确认框和安全提示。
- Cornerstone runtime 状态：annotation 世界坐标、handles、cached stats、tool group 与 viewport 关联。

Feature 005 不把 annotation 写入 `localStorage`、IndexedDB、SQLite 或 URL。退出、切换 Series、加载失败或组件卸载时：

1. 取消正在绘制或编辑的 annotation。
2. 关闭并失效待处理文字 callback。
3. 移除本功能注册的 annotation 事件监听。
4. 精确删除本 runtime 的测量和箭头 annotation。
5. 执行现有 image/volume、tool group 和 rendering engine 清理。

该顺序为 Feature 006 保留扩展点：持久化版本可在第 4 步之前序列化允许类型，并在新 runtime ready 后通过 Cornerstone hydrate API 恢复，但 005 不实现该行为。

## 错误处理

- Cornerstone 工具注册或 tool group 绑定失败：沿用查看器安全错误状态，清理已创建资源，不留下半可用测量界面。
- Pixel Spacing 不可靠：只禁用几何测量，不阻断影像查看和文字标注。
- 箭头文字非法：对话框保持打开并显示字段错误，未完成 annotation 不提交。
- 对话框取消或 viewer 卸载：新建 annotation 删除，编辑 annotation 保持原值，不调用已失效 callback。
- 清理单项失败：记录不含患者信息、文字内容或内部路径的 warning，继续清理其他 UID；runtime 销毁仍继续。
- Annotation 事件来自其他 runtime、其他 Frame of Reference 或非允许工具：忽略。

## 测试与验收

### 单元与组件测试

- 工具类型、Cornerstone tool name 映射和 Pixel Spacing 校验纯函数。
- 四个原生工具和 scoped eraser 只全局注册一次，分别加入轴位和 MPR tool group。
- 主鼠标工具互斥、滚轮滚动保留、MPR Crosshairs 可见性与重新激活。
- 标定有效/缺失/零值/非有限/不一致时的工具可用状态。
- 箭头新建、修改、取消、非法文字、最大长度、焦点恢复和 runtime 销毁失效。
- Annotation 完成/修改/删除事件过滤与数量更新。
- Scoped eraser 只检查允许类型，重叠时只删除一个；全部清空二次确认、按允许类型精确删除、UID 去重和 Crosshairs 保留。
- reset 不删除 annotation；Series 切换、返回和卸载会清理 annotation 与监听。
- 轴位和 MPR toolbar 的可访问名称、`aria-pressed`、禁用状态和窄屏布局。

### 回归验证

- 全量前端 Vitest。
- TypeScript `tsc --noEmit` 和 Vite production build。
- GitHub Windows CI，包括既有后端 pytest 和 `npm audit --audit-level=moderate`。
- 中英文 README 同步把测量与标注移入已完成功能，说明 005 为会话级状态，并增加 Feature 005 文档导航。

### 真实浏览器验收

使用已脱敏、具有可靠 Pixel Spacing 和 CT rescale metadata 的本机 Series 验证：

1. 轴位中创建、编辑和删除长度、角度、矩形 ROI 与箭头标注。
2. ROI 显示 Cornerstone 原生面积和 CT 统计，结果无 `NaN`、`Infinity` 或伪造单位。
3. MPR 的三个 viewport 均可创建工具，切换工具不破坏 Crosshairs、共享 VOI、独立 Pan/Zoom 和滚轮行为。
4. 单项删除只删除目标，全部清空不删除 Crosshairs，reset 不删除测量。
5. 退出并重新进入后 005 的 annotation 不恢复，且没有跨 Series 泄漏。
6. 缺少 Pixel Spacing 的 Series 仍可查看和箭头标注，但几何测量禁用并说明原因。
7. Console、Network 和页面无未解释错误；数据仍只在 loopback 和本机内处理。

## 后续 Feature 顺序

1. **006 查看器状态持久化**：为当前 Series 保存和恢复工具状态、相机/切片、窗宽窗位、Crosshairs、测量和箭头标注；引入后端 API、SQLite schema、版本校验和安全序列化。
2. **007 后台导入与断点续传**：引入持久化导入任务、分块上传、幂等 chunk、恢复与取消协议，以及启动时任务恢复。
3. **008 高级三维查看**：在既有 streaming volume 上增加 3D volume viewport、MIP 和体绘制；表面重建的数据来源、阈值策略和是否引入分割将在该 Feature 设计时单独确认。

## 完成标准

1. 轴位和 MPR 均可使用四类测量/标注工具及单项删除。
2. 有效标定数据展示 Cornerstone 原生结果；不可标定数据不会展示误导性几何值。
3. 文字新建与修改使用可访问对话框，不调用浏览器 `prompt()`。
4. 全部清空必须确认且不影响 Crosshairs；reset 不删除 annotation。
5. 退出、切换 Series 和异常清理后没有 annotation、监听或 callback 泄漏。
6. 全量前端测试、TypeScript 检查、production build 和 Windows CI 通过。
7. 真实 Chrome/Edge 验收覆盖轴位、三个 MPR viewport、无标定降级和资源清理。
8. 中英文 README、`docs/README.md` 和 Feature 005 source-of-truth 文档保持一致。
