# Data Model: 测量与标注

Feature 005 不新增数据库实体、API payload 或持久化格式。以下对象仅存在于当前前端 runtime。

## ViewerAnnotationTool

- 值：`length`、`angle`、`rectangleRoi`、`arrowAnnotate`、`eraseAnnotation`
- 作用：稳定连接共享工具栏、轴位/MPR runtime 与 Cornerstone tool name。

## MeasurementCalibration

- `available: boolean`：当前 Series 是否可安全执行几何测量。
- `reason: string | null`：不可用时面向用户的固定原因。
- 校验规则：所有 image 的 row/column Pixel Spacing 必须有限、大于零，并在既定容差内一致。

## AnnotationTextRequest

- `mode: create | edit`：区分取消新建和取消编辑语义。
- `initialValue: string`：编辑时的原文字，新建时为空。
- `complete(value)`：提交 trim 后 1–200 个且不含换行/控制字符的文字。
- `cancel()`：新建时删除未完成箭头；编辑时保留原文字。

## Viewer Annotation Session State

- React 状态：活动工具、标定状态、annotation 数量、文字请求和清空确认状态。
- Cornerstone 状态：世界坐标、handles、cached statistics、tool group 和 viewport 关联。
- 生命周期：reset 保留；runtime destroy、Series 切换或离开查看器时精确清理；不写入任何存储。
