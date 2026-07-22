# Viewer Requirements Quality Checklist: 轴位 CT 查看器

**Purpose**: Validate that viewer interaction, secure local file access, failure recovery, safety, accessibility, and scope requirements are complete, clear, consistent, and measurable

**Created**: 2026-07-20

**Feature**: [spec.md](../spec.md)

**Note**: This checklist validates requirements quality for implementation and review; it is not an implementation test plan.

## Requirement Completeness

- [x] CHK001 可查看 Series 的资格、最小实例数量和打开入口是否完整定义？ [Completeness, Spec §FR-001-002]
- [x] CHK002 从 Patient、Study、Series 进入查看页并返回原上下文的完整流程是否定义？ [Completeness, Spec §FR-003-004]
- [x] CHK003 初始切片、实例顺序、当前/总数和三种切片导航方式是否全部有需求？ [Completeness, Spec §FR-005-009]
- [x] CHK004 窗宽窗位、平移、缩放、主工具互斥和重置行为是否全部定义？ [Completeness, Spec §FR-010-013]
- [x] CHK005 Instance 文件访问、受管路径校验、响应隐私和失败反馈是否全部定义？ [Completeness, Spec §FR-014-019]
- [x] CHK006 页面卸载、加载取消、资源释放、非临床提示和本地数据边界是否全部有要求？ [Completeness, Spec §FR-020-024]

## Requirement Clarity

- [x] CHK007 “eligible”和“unsupported”的入口边界以及重新校验时点是否无歧义？ [Clarity, Spec §FR-001-002, §Edge Cases]
- [x] CHK008 初始中间切片的奇数、偶数和单张计算规则是否明确？ [Clarity, Spec §FR-006, §Edge Cases]
- [x] CHK009 Instance 顺序的权威来源是否明确，且未重复定义另一套排序规则？ [Clarity, Spec §FR-005, §Assumptions]
- [x] CHK010 切片计数是从 1 开始显示、内部索引如何映射以及边界禁用是否明确？ [Clarity, Spec §FR-006-009]
- [x] CHK011 “重置”的切片、灰度、位置和比例四个组成部分是否具体可判定？ [Clarity, Spec §FR-012]
- [x] CHK012 不持久化状态是否明确覆盖切片、工具、平移、缩放和灰度调整？ [Clarity, Spec §FR-013]
- [x] CHK013 用户可见摘要、内部资源 ID 和绝对路径的边界是否明确区分？ [Clarity, Spec §FR-004, §FR-016]

## Requirement Consistency

- [x] CHK014 User Story 1、切片需求、Edge Cases 和成功标准对初始切片及导航的规则是否一致？ [Consistency, Spec §US1, §FR-005-009, §SC-002, §SC-004]
- [x] CHK015 工具互斥、重置和重新打开默认状态在 User Story 2 与功能需求中是否一致？ [Consistency, Spec §US2, §FR-010-013, §SC-003, §SC-006]
- [x] CHK016 unsupported 在列表中被阻止与查看页重新校验失败两种要求是否兼容？ [Consistency, Spec §US3.1, §FR-001-002, §Edge Cases]
- [x] CHK017 文件缺失、解码失败和服务失败的术语在场景、需求和成功标准中是否保持一致？ [Consistency, Spec §US3, §FR-017-019, §SC-005]
- [x] CHK018 单视口范围是否与 Non-Goals 中排除 MPR、三视图和 3D 的声明一致？ [Consistency, Spec §FR-023, §Non-Goals]

## Acceptance Criteria Quality

- [x] CHK019 “不超过 3 次可见操作打开”是否可从确定入口客观计数？ [Measurability, Spec §SC-001]
- [x] CHK020 100% 切片顺序和计数正确是否覆盖首张、中间、末张与所有导航方式？ [Measurability, Spec §SC-002]
- [x] CHK021 四项显示交互的可观察结果是否足以支持真实浏览器验收？ [Measurability, Spec §SC-003]
- [x] CHK022 单张、奇数张、偶数张和首尾边界的 100% 完成信号是否明确？ [Measurability, Spec §SC-004]
- [x] CHK023 四类失败、隐私泄露和返回能力是否有可客观判定的完成标准？ [Measurability, Spec §SC-005]
- [x] CHK024 状态不持久化、本地请求和非临床提示是否有完整可测完成信号？ [Measurability, Spec §SC-006-008]

## Scenario and Edge-Case Coverage

- [x] CHK025 首次打开、连续浏览、按钮导航、滚轮导航、退出和重开是否覆盖主要与替代流程？ [Coverage, Spec §US1-002]
- [x] CHK026 单张、奇数张、偶数张、快速连续导航和异步竞态是否有边界要求？ [Coverage, Spec §Edge Cases]
- [x] CHK027 空 Series、已删除 Series、状态变为 unsupported 和加载前退出是否有异常/恢复要求？ [Coverage, Spec §Edge Cases, §FR-017-020]
- [x] CHK028 当前切片失败时禁止自动跳过或修改数据的行为是否明确？ [Recovery, Spec §Edge Cases, §FR-018]
- [x] CHK029 视口尺寸变化和窄屏可用性是否有不遮挡安全提示与主要控制的要求？ [Coverage, Spec §Edge Cases]
- [x] CHK030 仅键盘操作、焦点可见和非颜色表达是否覆盖主要控制与状态？ [Accessibility, Spec §FR-024, §Edge Cases]

## Privacy, Safety, and Scope

- [x] CHK031 资源 ID 到受管文件的解析是否明确禁止客户端路径、绝对路径和目录逃逸？ [Privacy, Spec §FR-014-015]
- [x] CHK032 响应头、错误体和界面对绝对路径、内部 ID、codec 堆栈的禁止泄露范围是否完整？ [Privacy, Spec §FR-004, §FR-016-017]
- [x] CHK033 Patient、DICOM 元数据、文件、解码像素和网络请求的本地驻留是否全部明确？ [Privacy, Spec §Constitutional Constraints, §FR-022]
- [x] CHK034 Series 入口、查看页、加载态、空态和失败态的完整非临床提示是否全部覆盖？ [Safety, Spec §Constitutional Constraints, §FR-021]
- [x] CHK035 MPR、测量、标注、分割、报告、3D、PACS、DICOMweb、认证、云和深链接是否明确排除？ [Scope, Spec §Non-Goals]

## Dependencies and Assumptions

- [x] CHK036 对 `002-dicom-import` 的 Series 状态、实例顺序和受管文件依赖是否明确记录？ [Dependency, Spec §Assumptions]
- [x] CHK037 单用户、桌面浏览器、已脱敏教学数据和不依赖外部服务的假设是否完整？ [Assumption, Spec §Assumptions]
- [x] CHK038 当前可解码数据与 unsupported 入口阻止之间的能力边界是否明确，且未暗示自动转码？ [Assumption, Spec §Assumptions, §FR-002, §Non-Goals]
- [x] CHK039 不修改持久化模型、导入分类、排序和删除生命周期的依赖边界是否明确？ [Dependency, Spec §Non-Goals, §Assumptions]

## Notes

- All 39 items pass against the current specification.
- Focus areas: viewer interaction/accessibility and secure local DICOM access/failure recovery.
- Depth: Standard. Audience/timing: implementation reviewer before planning and again before completion.
- Cross-artifact remediation explicitly covers first-image timing and continued access to already available slices
  after one image fails; no checklist regression was introduced.
