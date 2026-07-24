# Feature Specification: 查看器状态持久化

**Feature Branch**: `006-viewer-state-persistence`
**Created**: 2026-07-23
**Status**: Complete
**Input**: 用户要求在测量与标注之后实现查看器状态持久化，并按推荐方案持续执行。

## Constitutional Constraints

- **Safety notice**: 轴位和 MPR 页面持续显示“教学演示软件，不用于临床诊断”或等价提示。
- **Data boundary**: 查看状态、病人信息和 DICOM 全部留在本机单用户服务，不访问外网。
- **Scope boundary**: 本功能不加入认证、云、PACS、DICOMweb、诊断报告、后台导入或高级 3D。
- **DICOM lifecycle**: 本功能不修改 DICOM 文件；Series 删除后关联查看状态必须一并删除。

## User Scenarios & Testing

### User Story 1 - 恢复轴位查看状态 (Priority: P1)

用户重新打开同一 Series 时，回到上次的切片、工具、灰度、缩放和平移，并看到上次保存的
测量与箭头标注，无需重复定位。

**Why this priority**: 这是状态持久化的最小可用价值，也为 MPR 使用同一存储边界提供基础。

**Independent Test**: 修改轴位状态并创建 annotation，退出和重启本机服务后重新打开同一
Series，全部受支持状态准确恢复；其他 Series 保持默认状态。

**Acceptance Scenarios**:

1. **Given** 同一 Series 已有有效保存状态，**When** 用户退出后重新打开，**Then** 切片、
   活动工具、灰度、相机和四类 annotation 恢复。
2. **Given** 另一个 Series 没有保存状态，**When** 用户打开它，**Then** 使用既有安全默认值，
   不出现前一个 Series 的状态。
3. **Given** 状态保存请求失败，**When** 用户继续查看，**Then** 影像与工具仍可使用，并明确
   提示当前变化可能只保留在本次会话。

---

### User Story 2 - 恢复 MPR 联动状态 (Priority: P2)

用户重新进入三视图时，恢复活动 viewport、工具、Crosshairs、灰度和三个视图的相机状态，
同时恢复允许的测量与箭头标注。

**Why this priority**: MPR 定位成本高于轴位，但依赖 P1 已建立的 Series 状态和 annotation 边界。

**Independent Test**: 在三个 viewport 中改变位置、相机、工具和 Crosshairs 可见性，退出并
重新进入后核对全部状态与 annotation；Crosshairs 本身不作为 annotation 保存。

**Acceptance Scenarios**:

1. **Given** 已保存有效 MPR 状态，**When** 用户重新进入三视图，**Then** 活动视图、工具、
   Crosshairs 世界位置/可见性、灰度和相机恢复。
2. **Given** MPR 中有四类允许 annotation，**When** 状态保存和恢复，**Then** annotation
   恢复且 Crosshairs 仍由 MPR runtime 独立管理。
3. **Given** 保存状态不兼容或无效，**When** 用户进入 MPR，**Then** 三视图按默认状态打开，
   无效数据不进入渲染 runtime。

---

### User Story 3 - 清除与安全降级 (Priority: P3)

用户可以用查看器的重置操作恢复默认值并清除已保存状态；损坏或过期状态不得阻止查看影像。

**Why this priority**: 用户需要从不理想或损坏的持久状态恢复，且数据异常必须安全降级。

**Independent Test**: 保存非默认状态后执行重置，再退出、刷新和重启；同一 Series 均从默认
状态开始。注入损坏/旧版本状态时，查看器正常打开并给出安全提示。

**Acceptance Scenarios**:

1. **Given** Series 有保存状态，**When** 用户执行重置，**Then** 当前 runtime 恢复默认、
   本功能 annotation 被清除、保存状态被删除，重新进入仍为默认。
2. **Given** 保存状态损坏、超限或版本不兼容，**When** 查看器读取它，**Then** 使用默认状态、
   提供重试/清除路径且不泄露内部数据。
3. **Given** Series 随 Patient 删除，**When** 删除完成，**Then** 对应查看状态 100% 级联删除。

### End-to-End Acceptance Path

1. 导入脱敏、可查看且可构建 MPR 的 CT Series，打开轴位查看器。
2. 改变切片、窗宽窗位、缩放/平移和活动工具，创建长度、角度、矩形 ROI 与箭头文字。
3. 退出、刷新页面并重启本机 FastAPI 进程，重新打开同一 Series，核对轴位状态和四类
   annotation 全部恢复；打开另一 Series，核对其仍为默认。
4. 进入 MPR，改变活动视图、Crosshairs 位置/可见性、灰度和三个相机，再次退出、刷新和
   重启后核对恢复；分别在冠状位和矢状位创建 annotation，确认刷新后仍回到原 viewport，
   且 Crosshairs 未作为普通 annotation 重复恢复。
5. 执行重置，重新进入并重启，核对同一 Series 使用默认状态且 annotation 不再恢复。
6. 写入损坏、旧版本或引用已不存在 image identity 的状态，确认影像仍可打开；不存在的
   annotation 被计入部分恢复，提示安全且 console/network 无隐私泄漏。
7. 删除病人，确认 Series 状态记录随现有 DICOM 索引一起删除。

### Edge Cases

- 已保存切片索引超过当前实例数量时，按当前 Series 边界夹取，不阻止查看。
- 相机、灰度、Crosshairs 或 handle 含 `NaN`、`Infinity`、错误向量长度时拒绝整个快照。
- 第 501 条 annotation、超过 2 MiB 的 payload 或超过 200 字符的箭头文字 MUST 使整份快照
  拒绝保存；不得截断为看似成功的合法快照。
- 恢复期间产生的 Cornerstone 事件不得把半恢复状态覆盖为最新状态。
- 快速连续交互、切换 Series、组件销毁和页面退出时，只允许最后一份完整快照生效；页面
  进入 hidden 时先发普通 flush，`pagehide` 再做 keepalive fallback。超过浏览器 keepalive
  安全额度的 body 不得设置 keepalive。
- annotation 引用已不存在的 image ID 时跳过该条并提示部分恢复，不影响其他状态。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 为每个 Series 独立保存一份版本化查看器状态。
- **FR-002**: 状态 MUST 跨查看器退出、页面刷新和本机服务重启保留。
- **FR-003**: 轴位状态 MUST 包含切片、活动工具、灰度、缩放、平移和相机显示状态。
- **FR-004**: MPR 状态 MUST 包含活动视图、活动工具、Crosshairs 可见性/世界位置、灰度和
  三个 viewport 的相机状态。
- **FR-005**: 系统 MUST 只持久化 Length、Angle、RectangleROI 和 ArrowAnnotate，MUST NOT
  把 Crosshairs 当作普通 annotation 保存。每条 annotation MUST 带当前 Series 中的
  `referenced_image_id`；MPR 中共享 Frame of Reference 的 annotation MUST 按方向归属到
  axial、coronal 或 sagittal，而不是按首次查询元素归属。对只有 `volumeId`、没有真实
  `referencedImageId` 的 MPR volume annotation，客户端 MUST 使用当前 Series 的稳定 image
  anchor 表达 membership；恢复后 MUST 将该 identity 写回 runtime metadata，确保后续保存
  不会丢失已恢复 annotation。
- **FR-006**: 箭头文字 MUST 延续 1–200 字符且无换行/控制字符规则。
- **FR-007**: 保存状态 MUST 使用固定 schema version，并拒绝未知版本、未知键和未知工具。
- **FR-008**: 所有持久化数值 MUST 为有限数；向量、对象结构和 annotation 数量 MUST 校验。
- **FR-009**: 单个 payload MUST 不超过 2 MiB，annotation MUST 不超过 500 条；任何超限
  快照 MUST 整体失败并保留之前的有效保存，不得静默截断后报告成功。
- **FR-010**: 保存 MUST 使用短延迟合并连续交互，并在 runtime 销毁/页面退出前 flush 最新
  快照。页面进入 hidden 时 MUST 提前执行普通 flush；`pagehide` fallback 仅可对不超过
  60 KiB 的 PUT body 使用 keepalive，较大 body MUST 使用普通请求；进行中的 DELETE MUST
  被 flush/destroy 等待。
- **FR-011**: 恢复 MUST 在影像和 runtime 就绪后执行，并抑制恢复过程产生的反向保存。
- **FR-012**: 无状态时 MUST 使用 Feature 003/004/005 的既有默认行为。
- **FR-013**: 无效、不兼容、读取失败或保存失败 MUST NOT 阻止影像查看和本次会话交互。
- **FR-014**: 用户 MUST 收到可访问的“已恢复”“已保存”“保存失败/仅本次会话”和“已清除”状态。
- **FR-015**: 重置 MUST 恢复默认状态、清除四类 annotation 并删除该 Series 保存状态。
- **FR-016**: 未知 Series MUST 返回安全 404；无效状态 MUST 返回安全 422；持久化失败 MUST
  返回安全 500，均不得泄露 SQL、路径、堆栈或 DICOM 内容。
- **FR-017**: 删除 Series/Study/Patient MUST 级联删除对应查看状态。
- **FR-018**: 所有状态 API 和数据流 MUST 只使用本机 loopback，不得访问外部服务。
- **FR-019**: 主要页面 MUST 持续显示非临床教学提示。

### Non-Goals

- 跨设备、跨浏览器配置同步、账户偏好、登录或多用户冲突合并。
- 书签、最近查看列表、深链接、截图、报告、导出或分享。
- 撤销/重做历史、临时对话框、加载进度、错误状态或游标样式持久化。
- DICOM 修改、PACS、DICOMweb、云服务、遥测或远程访问。
- 后台导入、断点续传、分割、3D、MIP 或表面重建。

### Key Entities

- **Viewer State**: 某个 Series 的唯一版本化状态，包含轴位、MPR、annotation 和更新时间。
- **Axial State**: 轴位切片、工具、相机和灰度状态。
- **MPR State**: 三个视图的相机、活动视图/工具、灰度和 Crosshairs 状态。
- **Persisted Annotation**: 四类允许 annotation 的安全 metadata、handles、文字和受限统计。

## Success Criteria

### Measurable Outcomes

- **SC-001**: 有效状态下，轴位和 MPR 验收字段在退出、刷新及服务重启后的恢复准确率为 100%。
- **SC-002**: 在至少两个 Series 间切换 20 次，状态串用次数为 0。
- **SC-003**: 连续交互停止后 1 秒内显示已保存，且 20 次快速相机变化产生不超过 2 次写入。
- **SC-004**: 损坏、旧版本、超限和不存在 image 引用的全部验收中，影像打开成功率为 100%。
- **SC-005**: 重置后退出、刷新和服务重启的全部验收中，恢复默认状态且旧 annotation 恢复数为 0。
- **SC-006**: 删除 Patient 后，关联查看状态残留数为 0。
- **SC-007**: 全量前后端测试、production build 和真实浏览器端到端路径全部通过。
- **SC-008**: 验收期间外部网络请求数为 0，非临床提示在所有主要查看页面持续可见。
- **SC-009**: 501 条 annotation 的捕获路径产生 0 次 PUT 并显示保存失败；合法的大于 60 KiB
  快照不设置 keepalive，页面进入 hidden 后仍启动普通 flush。

## Assumptions

- 一名本机用户操作，无并发账号；同一 Series 的最后一次有效快照覆盖之前快照。
- Series UUID 在现有 DICOM 索引生命周期内稳定，删除由现有数据库外键级联处理。
- 恢复目标使用当前 Series 的受管 image ID；引用不存在 image 的 annotation 可安全跳过。
- Feature 005 的四类 annotation 是唯一允许持久化的 annotation 类型。
