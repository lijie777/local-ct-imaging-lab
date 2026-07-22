# Phase 0 Research: 轴位 CT 查看器

## Decision 1: Cornerstone3D 依赖使用同版本 5.6.8

**Decision**: 增加 `@cornerstonejs/core@5.6.8`、`@cornerstonejs/tools@5.6.8` 和
`@cornerstonejs/dicom-image-loader@5.6.8`，三个直接依赖保持完全同版本。

**Rationale**: 2026-07-20 的 npm stable version 均为 5.6.8。包的 peer dependencies 明确要求同版本
Cornerstone metadata/core 组合；锁定一致版本减少 API 和 worker/codec 不兼容。DICOM loader 已包含
本功能所需解码器，不需要为当前未压缩验收数据另加独立 codec 包。

**Alternatives considered**:

- 继续不引入 Cornerstone：无法满足宪章锁定技术栈和真实 DICOM 像素查看。
- 安装不同 minor 版本：peer dependency 风险高且无用户价值。
- 预装 volume/MPR 相关包：超出 `003` 范围，拒绝。

## Decision 2: 使用 StackViewport 和 `wadouri:` 同源资源

**Decision**: 每次查看创建一个 `RenderingEngine` 和 `StackViewport`，以既有 Series 详情的有序
Instance 列表生成 `wadouri:http://<current-origin>/api/instances/{id}/file` image IDs，并以
`floor(total / 2)` 作为 `setStack` 初始索引。

**Rationale**: npm 5.6.8 类型声明确认 `StackViewport.setStack(imageIds, currentImageIdIndex)`、
`setImageIdIndex`、`scroll`、`getCurrentImageIdIndex`、`resetCamera` 和 `resetProperties` 均为公开 API。
StackViewport 按需读取切片，不构建 volume，正好满足单轴位 viewer 和不实现 MPR 的范围。

**Alternatives considered**:

- 创建 volume viewport：会提前引入体数据和 MPR 方向，超出范围。
- 后端先解码为 PNG：会重复实现窗宽窗位、空间元数据和像素处理，并改变原始 DICOM 数据链。
- 使用浏览器 File 对象：已导入文件不再由用户重新选择，且无法验证受管存储边界。

## Decision 3: Cornerstone 初始化和工具绑定集中在 adapter

**Decision**: 单次调用 core `init()`、DICOM loader `init({maxWebWorkers})` 和 tools `init()`；注册
`WindowLevelTool`、`PanTool`、`ZoomTool` 和 `StackScrollTool`。StackScroll 绑定
`MouseBindings.Wheel`，三种主工具按当前选择互斥绑定 `MouseBindings.Primary`。

**Rationale**: 5.6.8 公共导出包含上述四个工具、`ToolGroupManager` 和 `MouseBindings.Wheel`。
集中 adapter 可以让 React 组件只依赖一个小 runtime 接口，并在 jsdom 测试中替换真实 WebGL。

**Alternatives considered**:

- 在 React page 直接调用所有 Cornerstone API：生命周期和 UI 状态耦合，难以测试。
- 自行监听 wheel 并调用 `scroll`：能工作但重复 tools 已提供的标准事件处理。
- 同时激活多个 primary 工具：鼠标绑定冲突且用户无法判断当前行为。

## Decision 4: 通过 Instance 资源 ID 提供只读 DICOM 文件

**Decision**: 新增 `GET /api/instances/{instance_id}/file`。服务先查询 Instance 与所属 Series，要求
Series 仍为 eligible，再把 `managed_path` 作为相对 `data_dir` 路径解析；绝对路径或解析后不在
`dicom_dir` 内的路径被拒绝。成功返回 `application/dicom`，不附带服务器文件名或路径。

**Rationale**: 浏览器只知道内部资源 ID，无法提交任意路径。数据库仍是资源身份的 source of truth，
ManagedStorage 仍是路径边界的 source of truth。FastAPI `FileResponse` 可以流式发送文件而不将整个
DICOM 读入 Python 内存。

**Alternatives considered**:

- 在 Series 详情暴露 `managed_path`：泄露存储结构并扩大路径攻击面。
- 接受 query path：允许客户端影响文件系统定位，拒绝。
- 把 DICOM bytes 放进数据库或 JSON/base64：增加复制、内存和迁移成本，无必要。

## Decision 5: 稳定区分文件资源失败

**Decision**: 使用 `instance_not_found`(404)、`series_not_viewable`(409)、
`dicom_file_missing`(410)、`validation_error`(422) 和 `persistence_error`(500)。路径逃逸和数据库内部
错误统一映射为 `persistence_error`，用户响应只包含稳定中文说明。

**Rationale**: 404、409 和 410 分别表达身份不存在、资源当前状态不允许查看、索引存在但本机文件已
缺失。安全路径异常不应告诉客户端具体违规路径。

**Alternatives considered**:

- 所有失败返回 404：隐藏了可恢复的 Series/文件状态差异。
- 返回原始 OSError/SQLAlchemy/codec 文本：会泄露路径和内部实现。
- 文件缺失自动删除索引：违反只读功能和 `002` 一致性边界。

## Decision 6: 真实浏览器与组件测试职责分离

**Decision**: pytest 验证资源和路径安全；Vitest/RTL 通过 runtime adapter mock 验证状态、顺序、工具、
重置和 cleanup；真实 Chrome 使用实际 Cornerstone/WebGL 和真实 DICOM fixture 验证像素显示及交互。

**Rationale**: jsdom 不提供可靠 WebGL、worker 或真实 DICOM 解码，组件测试不能替代端到端验收；反之，
所有错误和边界只靠浏览器人工操作也不可重复。

**Alternatives considered**:

- 只做真实浏览器：回归定位慢，异常分支难稳定覆盖。
- 在 jsdom 模拟一个 canvas 后宣称真实查看通过：证据不足。
- 引入完整 E2E 框架：当前项目已有真实 Chrome 验收路径，新增框架不必要。
