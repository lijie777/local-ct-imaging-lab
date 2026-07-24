# Research: 测量与标注

## Cornerstone 原生工具

- **Decision**: 使用 Cornerstone3D 5.6.8 的 `LengthTool`、`AngleTool`、
  `RectangleROITool` 和 `ArrowAnnotateTool`。
- **Rationale**: 原生工具已经处理世界坐标、handle 编辑、绘制和 cached statistics，避免
  应用层重复实现测量数学或伪造单位。
- **Alternatives considered**: 自定义 SVG/Canvas 测量层；因坐标同步、MPR 编辑和统计一致性
  风险更高而拒绝。

## 删除范围

- **Decision**: 实现 allowlist `ScopedAnnotationEraserTool`，只查询和删除本功能四类
  annotation。
- **Rationale**: Cornerstone 原生全局擦除或全量清理可能遍历并误删 MPR Crosshairs。
- **Alternatives considered**: `EraserTool` 与 `removeAllAnnotations()`；因边界过宽而拒绝。

## 空间标定

- **Decision**: 只有 Series 内全部 image 的 row/column Pixel Spacing 有限、为正且一致时，
  才启用长度、角度和矩形 ROI；箭头文字始终可用。
- **Rationale**: 避免把像素距离展示成可信的毫米、面积或 CT 统计。
- **Alternatives considered**: 使用首张图的间距或默认 1 mm；因会产生误导结果而拒绝。

## 文字输入与生命周期

- **Decision**: 通过 React `ModalDialog` 桥接 ArrowAnnotate 的创建/编辑 callback，并在
  runtime 销毁时使待处理请求失效、精确清理自身 annotation。
- **Rationale**: 提供可访问校验、焦点恢复和确定的会话边界，同时避免浏览器 `prompt()`。
- **Alternatives considered**: 使用 Cornerstone 默认 prompt 或在 React 中保存完整
  annotation；前者不可访问，后者会复制 runtime source of truth，均拒绝。
