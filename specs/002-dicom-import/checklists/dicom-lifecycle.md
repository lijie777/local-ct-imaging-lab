# DICOM Lifecycle Checklist: DICOM 导入与持久化

**Purpose**: Validate that the feature requirements completely and unambiguously define DICOM classification, grouping, persistence, recovery, privacy, and deletion consistency
**Created**: 2026-07-20
**Feature**: [spec.md](../spec.md)

**Note**: This checklist validates requirements quality for implementation and review; it is not an implementation test plan.

## Requirement Completeness

- [x] CHK001 每个输入文件的五类互斥结果及计数恒等式是否完整定义？ [Completeness, Spec §FR-007]
- [x] CHK002 成功、重复、跳过、不支持和失败各自包含哪些场景，是否都有明确边界？ [Completeness, Spec §FR-004, §FR-009-010, §Edge Cases]
- [x] CHK003 检查、序列和实例的身份、唯一性与从属关系是否完整定义？ [Completeness, Spec §FR-005, §Key Entities]
- [x] CHK004 文件/文件夹选择、空选择、进行中状态和失败后状态的需求是否齐全？ [Completeness, Spec §FR-001-002, §Edge Cases]
- [x] CHK005 检查/序列列表、实例数量、查看条件和 Patient 摘要要求是否齐全？ [Completeness, Spec §FR-016-018]
- [x] CHK006 导入、重启、取消删除、确认删除和删除失败的完整生命周期是否都有需求？ [Completeness, Spec §FR-015, §FR-019-021]

## Requirement Clarity

- [x] CHK007 PatientID 与病历号的规范化和精确比较规则是否无歧义？ [Clarity, Spec §FR-006]
- [x] CHK008 “对应检查组被阻止”的分组边界和对其他检查的影响是否清楚？ [Clarity, Spec §US2.4, §FR-006, §FR-011]
- [x] CHK009 重复的权威身份键以及重复时禁止的写操作是否明确？ [Clarity, Spec §FR-005, §FR-009]
- [x] CHK010 不支持数据是否保留元数据/文件以及必须显示的不可查看原因是否明确？ [Clarity, Spec §FR-010]
- [x] CHK011 “本次新增文件”和“先前成功数据”的边界是否足以指导失败清理？ [Clarity, Spec §FR-011-012]
- [x] CHK012 用户可见文件标识与禁止泄露的绝对路径是否明确区分？ [Clarity, Spec §FR-008, §FR-023]

## Requirement Consistency

- [x] CHK013 五类分类、User Story、Functional Requirements 和成功标准之间是否使用相同术语？ [Consistency, Spec §US2, §FR-007-012, §SC-002-005]
- [x] CHK014 PatientID 不匹配的文件级报告与 Study 组级阻止规则是否一致？ [Consistency, Spec §US2.4, §FR-006]
- [x] CHK015 部分成功要求与 Study 事务失败的全部清理要求是否兼容？ [Consistency, Spec §FR-011-012]
- [x] CHK016 Patient 删除、数据库级联和受管文件删除的完成条件是否一致？ [Consistency, Spec §US3, §FR-019-021, §SC-008]
- [x] CHK017 “不显示像素”和“允许保存不支持 CT 文件”的范围是否一致且无查看器暗示？ [Consistency, Spec §FR-003, §FR-010, §FR-024]

## Acceptance Criteria Quality

- [x] CHK018 真实 CT 首次导入的最小规模和可观察结果是否可客观验收？ [Measurability, Spec §SC-001]
- [x] CHK019 五类计数、逐项原因和输入总数关系是否可客观验收？ [Measurability, Spec §SC-002]
- [x] CHK020 重复导入的数据库与受管文件零增长要求是否量化？ [Measurability, Spec §SC-003]
- [x] CHK021 部分失败和事务失败后的零残留/既有数据保护是否量化？ [Measurability, Spec §SC-004-005]
- [x] CHK022 重启持久化、免责声明覆盖、删除清理和 loopback 边界是否有可测完成信号？ [Measurability, Spec §SC-006-009]

## Scenario and Recovery Coverage

- [x] CHK023 首次有效导入、多个 Series、重复导入和增量导入场景是否都有需求覆盖？ [Coverage, Spec §US1, §US2]
- [x] CHK024 非 DICOM、损坏、非 CT、缺失 UID、缺失 PatientID 和病人不匹配是否全部覆盖？ [Coverage, Spec §Edge Cases]
- [x] CHK025 不支持传输条件、尺寸不一致和空间信息不足是否定义了结果与用户说明？ [Coverage, Spec §US2.5, §Edge Cases]
- [x] CHK026 临时写入、目标冲突、持久化失败和删除文件失败是否都有恢复要求？ [Recovery, Spec §FR-012, §FR-014, §FR-021, §Edge Cases]
- [x] CHK027 取消删除、有影像删除、无影像删除和重启后不恢复是否全部覆盖？ [Coverage, Spec §US3, §Edge Cases]

## Privacy, Safety, and Scope

- [x] CHK028 DICOM 元数据、像素文件、报告和日志的本地驻留要求是否全部明确？ [Privacy, Spec §Constitutional Constraints, §FR-022]
- [x] CHK029 受影响页面、dialog、加载、空和失败状态的非临床提示要求是否完整？ [Safety, Spec §FR-002, §FR-018, §SC-007]
- [x] CHK030 用户响应中禁止绝对路径、数据库、堆栈和技术异常泄露的范围是否清楚？ [Privacy, Spec §FR-023]
- [x] CHK031 查看器、MPR、PACS、DICOMweb、认证、云、测量、报告和 3D 是否明确排除？ [Scope, Spec §FR-024, §Non-Goals]
- [x] CHK032 已脱敏数据和合法使用责任的假设是否明确记录且不被误作系统自动脱敏能力？ [Assumption, Spec §Assumptions]

## Dependencies and Assumptions

- [x] CHK033 对 `001-patient-management` 的依赖以及不依赖 003/004 Feature 是否明确？ [Dependency, Spec §Assumptions]
- [x] CHK034 单用户并发假设、目录选择行为和未提交选择不跨重启恢复是否明确？ [Assumption, Spec §Assumptions]
- [x] CHK035 磁盘空间不足、未知目标文件和外部存储管理是否有明确边界？ [Edge Case, Spec §Edge Cases, §Assumptions]

## Notes

- All 35 items pass against the current specification.
- Re-evaluate this checklist after planning and before declaring implementation complete.
