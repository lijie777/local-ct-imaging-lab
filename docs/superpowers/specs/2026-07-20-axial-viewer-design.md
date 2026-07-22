# 本地 CT 轴位查看器设计

## 1. 目标与范围

在已完成的 `002-dicom-import` 基础上增加独立 Feature `003-axial-viewer`。本功能允许用户从当前
病人的 Study 和可查看 Series 打开一个单视口轴位 CT 查看页，按既有实例顺序浏览切片，并完成
窗宽窗位、平移、缩放和重置等最小查看操作。

本功能只用于教学演示，不提供诊断、测量、标注、报告、MPR、三视图联动、三维体绘制、PACS、
DICOMweb、登录、云服务或外部传输。

## 2. 方案比较与选择

考虑了三种入口：

1. 在病人管理页内使用弹窗。改动集中，但影像画布空间有限，交互工具、错误状态和持续安全提示
   容易拥挤，弹窗焦点管理也会增加复杂度。
2. 引入客户端路由并提供独立 URL。导航语义清晰，但当前项目没有路由依赖，仅为一个本地页面
   增加依赖和 URL 恢复规则属于超出当前需求的扩展。
3. 在现有 React 应用内用显式页面状态切换到独立查看页。可以复用当前选中的 Patient、Study、
   Series 上下文，不新增路由依赖，并为影像画布提供足够空间。

采用方案 3。`PatientManagementPage` 只保存当前要查看的 Patient、Study 和 Series 摘要；打开后渲染
`AxialViewerPage`，退出时恢复原病人管理上下文。浏览器刷新后回到病人管理页，不持久化查看器状态。

## 3. 默认交互决策

- 仅 `viewability_status = eligible` 的 Series 显示可用“打开轴位查看器”按钮。
- 不可查看 Series 不可打开，并持续显示 `viewability_reason` 的稳定、可理解原因。
- 查看器一次只加载一个 Series 的有序实例列表，并创建一个 Cornerstone3D `StackViewport`。
- 初始切片使用序列中间位置，降低打开长序列后反复滚动的成本。
- 鼠标滚轮切换切片；工具栏提供上一张、下一张，并显示“当前切片 / 总切片数”。
- 工具模式为窗宽窗位、平移和缩放，任一时刻只有一个主鼠标工具处于激活状态。
- “重置”恢复初始切片、默认视图和初始窗宽窗位；不保存任何工具或切片状态。
- 页面显示 Patient 姓名和病历号、Study 描述和日期、Series 描述和实例数，不显示内部 UUID、
  绝对路径、堆栈或原始内部异常。
- 查看页顶部持续显示完整“教学演示软件，不用于临床诊断”提示。

## 4. 架构与职责

### 4.1 后端

- `instance_service.py`：根据 Instance 资源 ID 查询数据库记录，校验所属 Series 可查看，使用
  `ManagedStorage` 将相对受管路径解析到数据目录内，并区分不存在、不可查看、文件缺失和存储错误。
- `managed_storage.py`：新增只读路径解析能力；数据库中的相对路径必须解析后仍位于配置的
  `data_dir`/`dicom_dir` 内。该层不接收客户端文件路径。
- `api/instances.py`：通过 `GET /api/instances/{instance_id}/file` 返回一个受管 DICOM 文件。
  响应为 `application/dicom`，下载文件名使用固定安全值，不暴露服务器绝对路径。
- 既有 `GET /api/series/{series_id}` 继续作为实例顺序的唯一来源，不在文件接口重复排序。
- 不新增像素缓存、解码服务或数据库字段。浏览器使用已持久化的原始 DICOM 文件。

### 4.2 前端

- `AxialViewerPage`：查看页布局、患者/检查/序列摘要、退出入口、加载/空/失败状态和安全提示。
- `AxialViewport`：只负责 Cornerstone3D rendering engine、stack viewport 生命周期、容器尺寸变化和
  当前切片同步；卸载时销毁本组件创建的 rendering engine 和 tool group。
- `ViewerToolbar`：工具模式、上一张/下一张、重置和切片计数；不直接访问 API。
- `cornerstone.ts`：Cornerstone3D 和 DICOM image loader 的单次初始化、web worker/codec 配置及
  Instance 资源 URL 转 image ID。
- `useAxialSeries`：加载 Series 详情、拒绝不可查看 Series、生成有序 image ID，并管理加载错误和
  重试。该 hook 不持久化交互状态。
- `StudyList`：为 eligible Series 提供打开回调；unsupported Series 保持禁用并显示原因。
- `PatientManagementPage`：只负责选中查看上下文和管理页/查看页切换，不包含 Cornerstone 细节。

## 5. 数据流

1. 用户在当前 Patient 的 Study 列表中选择 eligible Series。
2. 前端保存 Patient、Study、Series 摘要并切换到独立查看页。
3. `useAxialSeries` 请求 `GET /api/series/{series_id}`，取得按 `002` 规则排序的实例。
4. 前端将每个 Instance ID 转为指向 `GET /api/instances/{instance_id}/file` 的本机 image ID。
5. Cornerstone DICOM image loader 按需请求 DICOM 文件、在浏览器中解码并显示中间切片。
6. 用户滚动或点击前后切片时只切换 stack 索引，不重新查询 Series 顺序。
7. 用户切换窗宽窗位、平移或缩放工具时更新当前 tool group；重置恢复初始 stack 和相机状态。
8. 用户退出查看器后销毁 Cornerstone 资源并恢复原病人管理上下文。

所有请求必须保持在当前 loopback FastAPI 服务；不允许浏览器或后端访问外部影像服务。

## 6. 错误处理与安全边界

- Series 不存在：显示“未找到该本机 CT 序列”，允许返回病人管理页。
- Series 为 unsupported：不创建 viewport，显示导入时保存的稳定原因。
- Series 没有实例：显示“该序列没有可显示的影像实例”。
- Instance 不存在或不属于 eligible Series：文件接口返回稳定 404/409 错误体，不返回路径。
- 数据库记录存在但受管文件缺失：文件接口返回稳定 410 或等价明确错误；查看页说明本机文件缺失，
  其他已加载切片不被删除。
- DICOM 解码失败或不支持：查看页显示“无法解码该影像”，保留退出和重试能力，不显示 codec 堆栈。
- 本机服务不可连接：沿用现有 API 错误风格，显示“无法连接本机服务，请确认服务已启动”。
- 路径解析必须拒绝绝对路径、`..` 逃逸和任何解析后位于受管目录外的目标。

## 7. 依赖与最小化原则

仅增加实现 StackViewport 和基础交互所需的 Cornerstone3D 包：核心渲染、工具和 DICOM image loader。
研究阶段以当前稳定包的实际导出和 worker 初始化要求为准。不会为未来 MPR、分割、测量、标注或
三维显示预装额外功能包；若 DICOM loader 已包含完成当前无压缩测试数据解码所需 codec，不另加
独立 codec 依赖。

## 8. 测试与验收

### 后端

- 测试 Instance 文件资源成功返回 `application/dicom`，内容与受管文件一致。
- 测试未知 Instance、unsupported Series、受管文件缺失和数据库错误的稳定响应。
- 测试绝对路径、目录逃逸和受管目录外路径均被拒绝，错误响应不泄露本机路径。
- 更新 OpenAPI 合同测试，确认资源 ID、响应类型和错误码。

### 前端

- 测试 StudyList 只有 eligible Series 可以打开，unsupported Series 显示原因且不可触发打开。
- 测试查看页加载、空、Series 失败、文件/解码失败和重试状态。
- 使用可控的 Cornerstone adapter/mock 测试实例顺序、中间切片、工具切换、上一张/下一张、滚轮同步、
  重置和卸载清理；不在组件测试中假装完成真实 WebGL/DICOM 解码验收。
- 测试 Patient/Study/Series 摘要、切片计数、退出返回和完整非临床提示可见。

### 真实浏览器路径

1. 启动使用独立临时 SQLite 和受管目录的本机后端及前端。
2. 创建虚构病人并导入一套多切片、已脱敏、可查看的真实 DICOM CT Series。
3. 从 Patient → Study → eligible Series 打开轴位查看器。
4. 确认中间切片显示，当前/总切片数正确，网络请求只访问 loopback。
5. 用滚轮和前后按钮到达不同切片，确认画面和计数同步且不越界。
6. 依次验证窗宽窗位、平移、缩放和重置产生可见效果。
7. 退出并再次打开，确认查看状态未持久化且重新从默认状态开始。
8. 验证 unsupported Series 无法打开；模拟文件缺失后验证错误可理解且不泄露路径。
9. 在查看页、加载态和错误态确认完整非临床提示持续可见。

## 9. 成功标准

- 用户可在 3 次操作内从已选病人的 eligible CT Series 打开轴位图像。
- 具有至少 3 张切片的 Series 可按 `002` 确定顺序完整浏览，切片计数始终与当前画面同步。
- 窗宽窗位、平移、缩放和重置均可在真实浏览器中观察到效果。
- unsupported、缺失文件、解码失败和服务失败均有稳定、可理解且不泄露路径的反馈。
- 查看器退出时释放本次创建的资源，重新打开不会继承上次切片或工具状态。
- 所有影像请求只访问本机服务，页面持续显示完整非临床提示，且未引入排除范围功能。

## 10. 设计自检

- 无 `TBD`、`TODO` 或待选方案。
- 入口、数据顺序、文件访问和错误职责与现有 `002` 边界一致。
- Feature 仅覆盖单轴位 stack viewport，规模适合一个独立实现计划。
- 初始切片、退出行为、状态持久化、unsupported 行为和错误反馈均已明确。
