# UI Contract: 联动 CT 三视图 MPR

## 1. Purpose

本文固定 `004-three-view-mpr` 的用户可见入口、状态、控制、覆盖层、错误和返回合同。它不新增 HTTP
endpoint；Series 详情与 Instance 文件继续使用已完成的本机资源合同。

## 2. Entry Contract

轴位 Series 加载成功后，页面必须出现以下二选一状态：

### MPR available

```text
Button: 进入三视图
State: enabled
Action: opens MPR for the same Patient/Study/Series context
```

### MPR unavailable

```text
Text: 三视图暂不可用：<stable understandable reason>
Button: 三视图暂不可用
State: disabled
Axial viewer: remains usable
```

不可用原因至少覆盖：

- `至少需要两个不同空间位置的切片`
- `DICOM 缺少空间位置或方向信息`
- `DICOM 缺少图像尺寸`
- `同一序列的图像尺寸不一致`
- `同一序列的图像方向不一致`
- `当前版本不支持该传输语法`
- `查看条件不足`（未知原因安全兜底）

## 3. Page Contract

MPR 页面 heading：

```text
Eyebrow: 本机 CT 三视图
H1: CT 三视图
Notice: 仅供教学演示，请勿用于诊断或治疗决策。
Primary navigation: 返回轴位查看器
```

页面必须继续位于包含完整“教学演示软件，不用于临床诊断”的 AppShell 内。

### Context metadata

允许显示：

- 病人姓名
- 病历号
- Study 描述和日期
- Series 描述
- Modality
- Rows × Columns
- Instance 数量
- 可推导时的相邻切片间距；否则显示“不可推导”

禁止显示：

- Patient/Study/Series/Instance 内部 UUID
- DICOM UID
- volume/rendering/tool IDs
- 绝对路径、managed path、原始文件名
- URL、codec 名称、异常类型、技术堆栈

## 4. Viewport Contract

固定三个 viewport：

| ID | Visible label | Default orientation |
|----|---------------|---------------------|
| axial | 轴位 | axial |
| coronal | 冠状位 | coronal |
| sagittal | 矢状位 | sagittal |

每个 viewport 卡片必须包含：

- 可聚焦画布，accessible name 为 `CT <label>图像画布`
- `<label>` 中文名称
- `当前活动视图` 或 `非活动视图`
- `位置：x, y, z mm`，各分量一位小数
- top/right/bottom/left 病人方向标记

活动 viewport 必须同时有文字和视觉边框，不能只改变颜色。

## 5. Toolbar Contract

工具按钮固定为：

| Button name | Tool state | Primary interaction |
|-------------|------------|---------------------|
| 十字定位 | crosshairs | move shared world position |
| 窗宽窗位 | windowLevel | change shared VOI |
| 平移 | pan | change active viewport camera only |
| 缩放 | zoom | change active viewport camera only |

- 每个工具按钮通过 `aria-pressed` 表达 active。
- 任一时刻只有一个 active 主工具。
- Wheel 始终用于当前 viewport 的 slice scroll，并更新 linked position。

其他控制：

```text
显示时 button name: 隐藏十字定位线
隐藏时 button name: 显示十字定位线
Reset button name: 重置三视图
Active text: 当前视图：轴位|冠状位|矢状位
```

隐藏当前 active Crosshairs 时，active tool 自动变为 WindowLevel。重新显示只恢复线条可见性，不自动
抢占主工具；Reset 才恢复 Crosshairs 为 active。

## 6. Loading Contract

Series detail：

```text
Text: 正在校验三视图数据…
Controls: disabled
Return: enabled
```

Volume：

```text
Text: 正在构建三视图…
Optional progress: 已处理 <processed> / <total> 张
Controls: disabled until runtime can safely interact
Return: enabled
```

在三个 viewport 增量出现时仍保留进度说明；只有全部帧成功后状态变为 ready。

## 7. Error Contract

所有错误状态必须提供 `返回轴位查看器`。可恢复状态还提供 `重试三视图`。

| Error kind | Visible message | Retry |
|------------|-----------------|-------|
| Series not found | 未找到该本机 CT 序列，请返回轴位查看器 | no |
| Series not viewable | 该序列暂不可查看，请返回轴位查看器 | no |
| Geometry insufficient | 三视图暂不可用：<eligibility reason> | no |
| DICOM missing | 本机 DICOM 文件缺失，请恢复文件后重试或返回轴位查看器 | yes |
| Network/local service | 无法连接本机服务，请确认服务已启动 | yes |
| Validation request | 影像请求无效，请返回轴位查看器 | no |
| Local service internal | 本机影像服务异常，请重试或返回轴位查看器 | yes |
| Decode/volume/render | 无法构建三视图，请重试或返回轴位查看器 | yes |

错误 UI 不得回显捕获到的原始字符串。

## 8. Reset Contract

执行 `重置三视图` 后：

```text
linked position = volume center
active viewport = axial
active tool = crosshairs
crosshairs visible = true
all viewport cameras = default centered/fit state
shared VOI = volume default
pan/zoom = default per viewport
```

Reset 不重新请求 Series、不创建第二个 volume、不修改文件或数据库。

## 9. Exit and Retry Contract

### Return

- 立即停止 detail/volume/image 未完成请求。
- 销毁 MPR runtime 创建的三个画布和所有相关资源。
- 返回同一上下文的轴位页；轴位 runtime 从默认状态重新创建。
- 不显示离开页面后的错误。

### Retry

- 先完整销毁失败 runtime。
- 重新请求 Series 详情并重新执行 eligibility。
- 创建新的 runtime IDs 和 volume ID，不复用失败 volume。
- 现有持久化数据不变。

## 10. Responsive and Keyboard Contract

- 桌面：二列二行，三个 viewport + 元数据面板。
- 窄屏：轴位、冠状位、矢状位、元数据依次纵向排列；页面可滚动。
- SafetyBanner、返回、工具栏和错误动作不得被画布覆盖。
- Tab 可到达返回、重试、全部工具、显隐、重置和三个 viewport。
- Enter/Space 可触发所有 button；viewport focus 状态清晰可见。
