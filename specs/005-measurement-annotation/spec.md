# Feature Specification: 测量与标注

**Feature Branch**: `005-measurement-annotation`
**Created**: 2026-07-23
**Status**: Complete

## Scope

本功能在现有本机、单用户、非临床 CT 教学平台中，为轴位查看器和三视图 MPR 增加会话级测量与标注。使用 Cornerstone3D 5.6.8 原生世界坐标、工具和统计结果，不改变后端 API、数据库或 DICOM 受管存储。

## User Story 1 - 几何测量 (Priority: P1)

用户在具有可靠 Pixel Spacing 的轴位或 MPR viewport 中创建、选择和编辑长度、角度与矩形 ROI；结果由 Cornerstone 原生统计提供。缺少可靠标定时禁用几何测量，但保持影像查看和箭头文字标注。

### Acceptance Scenarios

1. 有效标定 Series 中，长度、角度和矩形 ROI 可创建、显示、选择并拖动修改。
2. 矩形 ROI 只显示 Cornerstone 原生面积与 CT 统计，不出现 `NaN`、`Infinity` 或应用伪造单位。
3. 任一 image ID 的 Pixel Spacing 缺失、非有限、非正数或与同 Series 不一致时，三个几何测量按钮禁用并说明原因。

## User Story 2 - 箭头文字标注 (Priority: P2)

用户绘制箭头后通过可访问对话框输入文字；可拖动箭头和文字框，并通过双击修改文字。取消新建不留下空 annotation，取消编辑保留原文字。

### Acceptance Scenarios

1. 新建文字去除首尾空白后为 1–200 个可见字符，不含换行和控制字符。
2. 非法输入保持对话框打开并显示字段错误。
3. 对话框重复非临床提示，并在结束后把焦点恢复到产生标注的 viewport。

## User Story 3 - 删除与生命周期 (Priority: P3)

用户可删除一个测量/标注或确认后清空当前 runtime 的全部四类 annotation；Crosshairs 不受影响，reset 不删除 annotation，退出或切换 Series 后不恢复 Feature 005 会话状态。

### Acceptance Scenarios

1. 单项删除只检查 Length、Angle、RectangleROI、ArrowAnnotate，重叠时只删除一个命中项。
2. 全部清空显示数量和不可恢复后果，经确认后只删除上述四类 annotation。
3. MPR Crosshairs 在测量、单项删除、全部清空和 reset 后仍保持正确状态。
4. runtime 销毁后没有 annotation、事件监听或文字 callback 泄漏。

## Functional Requirements

- **FR-001**: 轴位与 MPR MUST 提供 Length、Angle、Rectangle ROI、Arrow Annotate。
- **FR-002**: 几何测量 MUST 只在全部 `imagePlaneModule` Pixel Spacing 有限、为正且一致时启用。
- **FR-003**: 结果 MUST 使用 Cornerstone 原生世界坐标、单位和 cached statistics，MUST NOT 伪造毫米、面积或 HU。
- **FR-004**: 箭头文字 MUST 使用应用内 `ModalDialog`，MUST NOT 调用浏览器 `prompt()`。
- **FR-005**: 文字 trim 后 MUST 为 1–200 个可见字符且不含换行或控制字符。
- **FR-006**: 单项删除 MUST 只检查 Length、Angle、RectangleROI、ArrowAnnotate，并只删除一个命中项。
- **FR-007**: 全部清空 MUST 二次确认并只删除 FR-006 四类 annotation。
- **FR-008**: Crosshairs MUST 保持可见且不得被单项删除或全部清空删除。
- **FR-009**: reset MUST NOT 删除测量或标注。
- **FR-010**: runtime destroy MUST 取消交互、关闭文字请求、移除监听并精确清理本 runtime annotation。
- **FR-011**: Feature 005 MUST NOT 新增后端 API、数据库、持久化、报告、分割或 3D。
- **FR-012**: 所有主要交互 MUST 可通过键盘聚焦且保留非临床提示。

## Non-Goals

- 查看器状态、测量或标注持久化。
- 撤销/重做、截图、导出、报告、协作、分享或深链接。
- 分割、自动病灶检测、诊断建议、3D、MIP 或表面重建。
- PACS、DICOMweb、云服务、认证或远程访问。

## Success Criteria

- **SC-001**: 轴位和三个 MPR viewport 的四类工具、编辑和删除验收全部通过。
- **SC-002**: 有标定数据使用原生结果；无标定数据 100% 禁用几何测量且保留查看/文字标注。
- **SC-003**: 清空和销毁只删除本功能 annotation，Crosshairs 零误删。
- **SC-004**: 全量前端测试、TypeScript、production build、后端回归和 Windows CI 通过。
- **SC-005**: 中英文 README、文档导航、Feature 005 tasks 与 quickstart 保持一致。
