# UI Contract: 高级 3D 可视化

## 1. Purpose

本文固定 `008-advanced-3d-visualization` 的入口、页面、三种模式、状态、错误和返回合同。Feature 不新增
HTTP endpoint；Series 详情和 Instance 文件继续使用现有本机资源合同。

## 2. Entry Contract

轴位 Series 加载成功后：

### Advanced 3D available

```text
Button: 进入高级 3D
State: enabled
Action: opens advanced 3D for the same Patient/Study/Series context
Sibling action: existing 进入三视图 remains available
```

### Advanced 3D unavailable

```text
Text: 高级 3D 暂不可用：<stable eligibility reason>
Button: 高级 3D 暂不可用
State: disabled
Axial viewer: remains usable
```

## 3. Page Contract

```text
Eyebrow: 本机 CT 三维可视化
H1: CT 高级 3D
Notice: 仅供教学演示，请勿用于诊断或治疗决策。
Navigation: 返回轴位查看器
```

页面必须继续位于带完整 SafetyBanner 的 `AppShell` 内。

允许显示：病人、病历号、Study 描述/日期、Series 描述、Modality、Rows × Columns、实例数、切片间距。

禁止显示：内部 UUID、DICOM UID、volume/actor/tool ID、路径、文件名、URL、codec、异常类型和堆栈。

## 4. Loading Contract

Series：

```text
Text: 正在校验高级 3D 数据…
Controls: not mounted
Return: enabled
```

Volume：

```text
Text: 正在构建高级 3D…
Progress: 已处理 <processed> / <total> 张
Controls: disabled until complete
Return: enabled
```

只有全部 frame 成功后进入 ready。

## 5. Common Viewport Contract

- 一个可聚焦画布，accessible name 为 `CT 高级 3D 图像画布`。
- 明确文字显示 `当前模式：体绘制|MIP|表面重建`。
- 左键旋转、中键平移、右键或滚轮缩放；按钮仍提供标准方向和重置。
- viewport 焦点有非颜色轮廓；canvas 不得覆盖 toolbar、状态、错误或 SafetyBanner。

## 6. Mode Toolbar Contract

固定三个模式按钮：

| Button | Mode | State expression |
|--------|------|------------------|
| 体绘制 | volume | `aria-pressed` |
| MIP | mip | `aria-pressed` |
| 表面重建 | surface | `aria-pressed` |

任一时刻只有一个 pressed。surface building 时三个按钮和会冲突的参数控件 disabled。

公共控制：

```text
Reset: 重置高级 3D
Status: aria-live polite
Errors: role=alert
```

## 7. Volume Rendering Contract

进入或 reset 默认：

```text
Mode: 体绘制
Preset: 骨
Camera: 前方标准视图并适配完整 volume
```

Preset 按钮：`骨`、`软组织`、`肺`，使用 `aria-pressed`。切换不显示 Series loading，也不发起新的
DICOM 下载。

## 8. MIP Contract

进入 MIP 后：

```text
Projection: maximum intensity
Preset: CT-MIP internal, not exposed as an extra user choice
Default thickness: 完整体数据
Unit: mm
```

方向按钮：`前方`、`后方`、`左侧`、`右侧`、`头侧`、`足侧`。当前方向有 pressed 状态；自由旋转后
状态文字改为“自由视角”，但不禁用方向按钮。

厚度控件：

- label `MIP 投影厚度`。
- range 与 number 显示同一毫米值。
- 最小/最大来自当前 volume；超出输入 clamp 到边界。
- 最大值旁显示“完整体数据”。

从 MIP 返回 volume 时恢复最后 volume preset。

## 9. Surface Contract

首次进入 surface：

```text
Threshold: 300 HU when within range, otherwise range midpoint
Action: 应用阈值
Status before apply: 当前阈值 <value> HU
```

控件：

- label `表面阈值`，range 和 number 同步。
- 显示实际最小/最大 HU。
- 若 stride >1，显示“为保证浏览器响应，已降低表面采样密度（步长 <stride>）”。

状态：

| State | Visible contract |
|-------|------------------|
| building | `正在重建表面…`，冲突控件禁用 |
| ready | `表面已生成：<threshold> HU` |
| empty | `该阈值未生成可见表面`，控件可继续 |
| error | `无法重建表面，请调整阈值或切换其他模式`，volume/MIP 仍可用 |

旧 surface 只在新 surface ready 后被替换。

## 10. Error Contract

所有页面级错误保留 `返回轴位查看器`；可恢复状态提供 `重试高级 3D`。

| Error kind | Visible message | Retry |
|------------|-----------------|-------|
| Series not found | 未找到该本机 CT 序列，请返回轴位查看器 | no |
| Series not viewable | 该序列暂不可用于高级 3D，请返回轴位查看器 | no |
| Geometry insufficient | 高级 3D 暂不可用：<eligibility reason> | no |
| DICOM missing | 本机 DICOM 文件缺失，请恢复文件后重试 | yes |
| Local service unavailable | 无法连接本机服务，请确认服务已启动 | yes |
| Local persistence/service error | 本机影像数据暂时不可用，请重试或返回轴位查看器 | yes |
| Decode/volume/render | 无法构建高级 3D，请重试或返回轴位查看器 | yes |
| Unsupported graphics | 当前浏览器无法使用高级 3D，请使用支持三维图形的现代浏览器 | no |

捕获到的原始错误字符串不得回显。

## 11. Reset, Exit, Retry, and Responsive Contract

Reset 恢复 volume/default bone/anterior/full thickness/default threshold，销毁 surface，但不重新请求 Series。

Return：立即 abort 详情和 DICOM 请求，销毁 surface/volume/tools/engine，回到同一轴位上下文，不显示晚到错误。

Retry：先完整销毁失败 runtime，再重新请求 Series 和创建新的 runtime IDs。

桌面 1280×900：viewport + 侧栏；窄屏 820×900：控制、viewport、元数据纵向可滚动。Tab 可到达返回、
重试、模式、参数、方向、reset 和 viewport；Enter/Space 可激活按钮。
