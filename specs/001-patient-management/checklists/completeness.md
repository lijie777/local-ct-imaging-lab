# 需求完整性 Checklist: 病人管理

**Purpose**: 检查 patient-management 规格是否完整、明确、一致、可衡量并具备需求追溯性
**Created**: 2026-07-17
**Feature**: [spec.md](../spec.md)

**Note**: 本清单只评价规格文本质量，不评价代码或实际运行结果。

## 非临床声明与功能边界

- [x] CHK001 规格是否完整定义了“所有病人管理页面”的范围，使评审者能够判断哪些页面必须显示非临床声明？ [Completeness, Spec §Constitutional Constraints, §FR-002]
- [x] CHK002 非临床声明的固定位置、持续可见性和完整文案是否写得足够明确，可客观判断通过或失败？ [Clarity, Spec §FR-002, §SC-005]
- [x] CHK003 覆盖式创建和编辑界面遮挡顶部横幅时的重复显示规则是否明确且无例外遗漏？ [Coverage, Spec §Clarifications, §FR-002]
- [x] CHK004 非临床声明要求在宪章约束、功能需求、边界场景和成功标准之间是否保持一致？ [Consistency, Spec §Constitutional Constraints, §Edge Cases, §FR-002, §SC-005]
- [x] CHK005 本地离线、单用户、无需登录和病人信息不得离开本机的边界是否全部写入可追溯需求？ [Completeness, Spec §Constitutional Constraints, §FR-001, §FR-021, §SC-006]

## 病人管理行为完整性

- [x] CHK006 创建病人的必填字段、可选字段、成功结果和列表反馈是否都有明确需求及验收场景？ [Completeness, Spec §User Story 1, §FR-003, §FR-010]
- [x] CHK007 病人详情必须展示的全部字段和检查摘要是否在用户故事、功能需求与成功标准中保持一致？ [Consistency, Spec §User Story 1/AC2, §FR-012, §SC-004]
- [x] CHK008 编辑允许修改的字段、成功结果及与创建相同的校验规则是否均有明确说明？ [Completeness, Spec §User Story 2/AC3-AC4, §FR-013]
- [x] CHK009 搜索的正常结果、无结果和清空搜索三个行为是否分别具有可验证的需求或验收场景？ [Scenario Coverage, Spec §User Story 2/AC1-AC2, §FR-014, §FR-015]
- [x] CHK010 删除确认、取消删除、删除成功和删除失败是否分别具有独立、无歧义的验收场景？ [Scenario Coverage, Spec §User Story 3/AC1-AC5, §FR-017, §FR-018, §FR-019]
- [x] CHK011 端到端验收路径是否串联了声明展示、创建、详情、搜索、编辑、重启恢复、取消删除、确认删除和再次重启检查？ [Completeness, Spec §End-to-End Acceptance Path]

## 字段规则与输入边界

- [x] CHK012 病历号的必填性、1 至 64 个可见字符限制和首尾空白处理是否明确且可测量？ [Clarity, Spec §FR-003, §FR-004]
- [x] CHK013 病历号内部空格与符号原样保留、换行符和控制字符被拒绝的规则是否完整定义？ [Edge Case Coverage, Spec §Clarifications, §Edge Cases, §FR-004]
- [x] CHK014 病历号唯一性是否明确覆盖去除首尾空白和不区分英文字母大小写后的等价值？ [Clarity, Spec §User Story 1/AC4, §FR-004]
- [x] CHK015 创建与编辑是否明确使用完全相同的病历号规范化和唯一性规则？ [Consistency, Spec §User Story 2/AC4, §FR-004, §FR-013]
- [x] CHK016 姓名的必填性、1 至 100 个可见字符限制、首尾空白处理、内部格式保留和控制字符拒绝是否全部明确？ [Completeness, Spec §Edge Cases, §FR-005]
- [x] CHK017 性别的可选性、允许值集合及未填写时使用“未知”的语义是否一致且无自由文本歧义？ [Clarity, Spec §FR-006, §Assumptions]
- [x] CHK018 出生日期的可选性、有效日期规则、不得晚于今天、不设任意最早日期及空值显示是否完整定义？ [Completeness, Spec §Edge Cases, §FR-007]
- [x] CHK019 空值、纯空白、超长、控制字符、重复病历号和未来出生日期等错误输入类别是否都有对应需求说明？ [Edge Case Coverage, Spec §Edge Cases, §FR-004-008]

## 表单失败与用户输入保留

- [x] CHK020 所有字段校验失败是否都要求指出具体字段和失败原因，而不是只给出笼统错误？ [Clarity, Spec §FR-008, §SC-002]
- [x] CHK021 校验失败后保持表单打开并保留全部输入的规则是否同时覆盖创建和编辑？ [Coverage, Spec §Clarifications, §FR-008, §SC-008]
- [x] CHK022 本地持久化失败后不得报告成功、保持表单打开并保留全部输入的规则是否完整明确？ [Recovery Coverage, Spec §Edge Cases, §FR-019, §SC-008]
- [x] CHK023 仅在保存成功或用户明确取消后清除输入的规则是否与所有创建、编辑失败场景一致？ [Consistency, Spec §Clarifications, §FR-008, §FR-019]
- [x] CHK024 未提交草稿无需跨页面刷新或服务重启恢复的边界是否明确，且不会与已成功保存数据的恢复要求混淆？ [Boundary Clarity, Spec §Edge Cases, §FR-019, §Assumptions]

## 搜索、空状态与稳定排序

- [x] CHK025 搜索字段范围、子串匹配、不区分英文字母大小写和忽略搜索文本首尾空白是否全部明确？ [Completeness, Spec §FR-014, §Assumptions]
- [x] CHK026 空搜索与清空搜索后恢复完整列表的行为是否有明确且一致的需求说明？ [Clarity, Spec §Edge Cases, §FR-015]
- [x] CHK027 搜索没有匹配项时的无结果状态及返回完整列表的恢复方式是否可客观判断？ [Acceptance Criteria, Spec §User Story 2/AC2, §FR-015]
- [x] CHK028 完整列表和搜索结果按最近更新时间降序的主排序规则是否明确且一致？ [Consistency, Spec §FR-016, §Assumptions]
- [x] CHK029 最近更新时间相同时按规范化病历号升序的第二排序规则是否完整定义了所用规范化语义？ [Clarity, Spec §Clarifications, §FR-004, §FR-016]
- [x] CHK030 页面刷新和服务重启后保持确定排序的成功标准是否与列表及搜索排序规则直接对应？ [Traceability, Spec §FR-016, §SC-009]

## 本地持久化与删除生命周期

- [x] CHK031 成功创建和编辑的数据必须保存在本机并在服务重启后恢复的要求是否具有明确成功标准？ [Measurability, Spec §FR-009, §SC-003]
- [x] CHK032 服务重启后的恢复范围是否明确区分已成功保存的数据、已成功删除的数据和未提交草稿？ [Consistency, Spec §User Story 1/AC3, §User Story 2/AC5, §User Story 3/AC4, §FR-019]
- [x] CHK033 创建、编辑或删除持久化失败时不得留下与用户所见状态不一致记录的要求是否清晰可判定？ [Reliability, Spec §FR-019]
- [x] CHK034 删除确认内容必须包含病人姓名、病历号和删除后果的要求是否足以判断确认信息是否完整？ [Clarity, Spec §User Story 3/AC1, §FR-017]
- [x] CHK035 取消删除后病人数据保持不变的要求是否同时出现在验收场景和成功标准中？ [Traceability, Spec §User Story 3/AC2, §SC-007]
- [x] CHK036 删除成功后病人从列表、搜索结果和详情入口消失，并在重启后不恢复的要求是否完整？ [Completeness, Spec §User Story 3/AC3-AC4, §FR-018, §SC-003]
- [x] CHK037 删除失败时不得报告成功、病人记录保持可见并说明失败原因的要求是否具有独立验收场景？ [Exception Coverage, Spec §User Story 3/AC5, §FR-019]

## 空检查状态、排除项与需求追溯

- [x] CHK038 没有影像检查时，列表和详情中的检查数量 0 与最近检查日期空值是否在场景、需求和成功标准中一致定义？ [Consistency, Spec §User Story 1, §FR-011, §SC-004]
- [x] CHK039 DICOM、CT 查看器、PACS、登录、云服务及其他影像功能是否被明确排除，且没有其他段落暗示本阶段会提供这些能力？ [Scope Consistency, Spec §Constitutional Constraints, §Non-Goals]
- [x] CHK040 FR-001 至 FR-021 是否每条都能对应至少一个用户故事验收场景、边界场景或可衡量成功标准，并且不存在无法追溯的孤立需求？ [Traceability, Spec §User Scenarios & Testing, §Functional Requirements, §Success Criteria]

## Notes

- 逐项评审规格文本；能够从规格中找到明确、无冲突且可衡量的答案时标记为 `[x]`。
- 如果某项失败，请在该项下记录缺失、歧义或冲突的位置，不要转写为代码或实现检查。
