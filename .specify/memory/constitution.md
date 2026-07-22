<!--
Sync Impact Report
- Version change: unratified template -> 1.0.0
- Modified principles:
  - Template Principle 1 -> I. 教学演示与非临床边界
  - Template Principle 2 -> II. 本地离线、单用户与数据驻留
  - Template Principle 3 -> III. 第一版范围与技术栈锁定
  - Template Principle 4 -> IV. 小模块、明确职责与最小改动
  - Template Principle 5 -> V. 分层自动化测试与端到端验收
  - Added Principle 6 -> VI. DICOM 导入可追踪与存储一致性
- Added sections:
  - 技术与范围约束
  - 开发流程与质量门禁
- Removed sections: None
- Templates and guidance:
  - ✅ updated: .specify/templates/plan-template.md
  - ✅ updated: .specify/templates/spec-template.md
  - ✅ updated: .specify/templates/tasks-template.md
  - ✅ reviewed: .specify/templates/constitution-template.md (generic scaffold retained)
  - ✅ updated: .agents/skills/speckit-tasks/SKILL.md
  - ✅ updated: .agents/skills/speckit-implement/SKILL.md
  - ✅ updated: .agents/skills/speckit-specify/SKILL.md
  - ✅ reviewed: remaining .agents/skills/speckit-*/SKILL.md files (no update required)
  - ✅ updated: docs/superpowers/specs/2026-07-16-medical-ct-viewer-design.md
  - ✅ updated: docs/superpowers/plans/2026-07-16-medical-ct-viewer-spec-kit-workflow.md
- Follow-up TODOs: None
-->

# 本地医疗 CT 病人管理与三视图预览系统项目宪章

## Core Principles

### I. 教学演示与非临床边界 (NON-NEGOTIABLE)

本系统 MUST 仅用于教学演示，不得用于临床诊断、治疗决策或医疗设备工作流。所有主要页面
MUST 持续、清晰地显示“教学演示软件，不用于临床诊断”或语义完全等价的提示；该提示不得
只出现在启动页、帮助页或容易被忽略的临时消息中。功能规格、验收场景和页面测试 MUST
验证该限制可见。此边界用于防止演示软件被误认为经过临床验证的医疗产品。

### II. 本地离线、单用户与数据驻留

第一版 MUST 只在本机离线运行并只支持单用户。前后端通信 MUST 限于本机，病人信息、
DICOM 元数据、像素数据、日志和受管文件 MUST 保留在本机，不得上传、同步或发送到外部
服务。第一版不得以“为未来准备”为理由引入账户、角色、登录认证、远程遥测或云端配置。
任何会使医疗数据离开本机的数据流均视为宪章违规。

### III. 第一版范围与技术栈锁定

产品代码 MUST 使用 React、TypeScript、Vite、Cornerstone3D、FastAPI、pydicom、
SQLAlchemy 和 SQLite。后端测试 MUST 使用 pytest；前端测试 MUST 使用 Vitest 或
React Testing Library。第一版 MUST NOT 加入云服务、登录认证、PACS、DICOMweb、
诊断报告、影像测量或三维体绘制。超出这些边界的需求必须先通过宪章修订，不得在普通功能
计划中顺带引入。固定范围用于保证教学项目能够被完整实现、理解和验收。

### IV. 小模块、明确职责与最小改动

代码 MUST 拆分为职责单一、接口明确、可独立理解和测试的小模块。前端视图、状态、API
访问和 Cornerstone3D 集成不得无边界混合；后端 API、业务规则、DICOM 解析、数据库访问
和受管文件操作必须保持清晰边界。每项改动 MUST 能直接追溯到当前功能需求，并遵循现有
项目风格。实现 MUST 使用最少必要依赖，不得重构、格式化或扩展与当前功能无关的内容。

### V. 分层自动化测试与端到端验收

后端业务规则 MUST 有 pytest 测试；前端可观察行为 MUST 有 Vitest 或 React Testing
Library 测试。每个功能 MUST 在规格中定义一条完整、可执行的端到端验收路径，并在任务中
包含执行和记录该路径的工作。测试任务不得标记为可选；适用的自动化测试和端到端验收全部
通过后，功能才可视为完成。不得仅以组件存在、接口返回或人工代码审查替代行为验证。

### VI. DICOM 导入可追踪与存储一致性

DICOM 导入 MUST 逐文件处理并明确报告五类结果：成功、重复、跳过、不支持和失败；每一类
必须有独立计数，非成功项必须保留文件标识和原因。导入逻辑不得静默忽略解析、校验、复制、
解码或数据库错误。导入失败、部分失败和删除操作结束后，SQLite 记录与本地受管 DICOM
文件 MUST 保持一致：数据库提交失败必须回滚记录并清理本次新增文件，文件操作失败不得留下
指向不存在文件的记录，删除失败不得被报告为完全成功，既有成功数据不得因后续失败被误删。

## 技术与范围约束

- 运行形态 MUST 为本机浏览器界面连接本机 FastAPI 服务；第一版不得依赖外网可用性。
- SQLite MUST 保存结构化元数据和受管文件路径；DICOM 像素数据 MUST 保存在本地受管目录。
- 新增依赖必须在实现计划中说明不可由现有技术栈完成的具体原因；仅为便利或未来扩展不得新增。
- 任何功能规格 MUST 明确列出第一版排除项，并确认未引入认证、云、PACS、DICOMweb、
  诊断报告、影像测量或三维体绘制。
- 涉及 DICOM 导入或病人删除的功能 MUST 定义失败恢复、部分成功和数据库/文件一致性规则。

## 开发流程与质量门禁

1. 规格必须包含用户可见的非临床提示、本地数据边界、明确排除项、可测试需求和端到端验收路径。
2. 实现计划必须在研究前和设计后执行 Constitution Check；任何 MUST 违规都会阻止进入实现阶段。
3. 任务清单必须包含适用的 pytest、Vitest 或 React Testing Library 测试，以及每个功能的
   端到端验收任务；DICOM 功能还必须包含五类导入报告和一致性失败路径。
4. 实现和评审必须确认模块职责、依赖必要性、范围边界和数据驻留；无关重构必须从变更中移除。
5. 完成声明必须附带测试结果和端到端路径结果。未运行的验证必须明确标记，不得推断为通过。

## Governance

本宪章优先于项目中的功能规格、实现计划、任务清单和一般开发习惯。修订必须提交明确的变更
说明、受影响原则、模板与运行文档同步结果，以及必要的迁移或重新验收计划。版本采用语义化
版本：删除或重新定义既有原则为 MAJOR；新增原则或实质扩展约束为 MINOR；不改变含义的澄清
为 PATCH。首次正式采纳版本为 1.0.0。

每次规格、计划、任务生成和代码评审 MUST 检查宪章合规性。复杂度或依赖增加必须记录其必要性
以及被拒绝的更简单方案；宪章中的 MUST 不得仅靠“复杂度说明”豁免。若需求与宪章冲突，必须先
修订宪章并完成同步影响检查，再开始实现。

**Version**: 1.0.0 | **Ratified**: 2026-07-16 | **Last Amended**: 2026-07-16
