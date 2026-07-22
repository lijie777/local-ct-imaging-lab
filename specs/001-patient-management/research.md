# Research: 病人管理

## 研究结论

本阶段没有剩余未决技术问题。用户已固定技术栈、数据字段、接口边界和测试框架；研究只
负责在这些边界内选择最小、可测试且符合 Constitution 的实现方式。

## Decision 1：前端仅使用 React 基础能力、原生 Fetch 和原生 CSS

**Decision**: 生产依赖只使用 `react` 和 `react-dom`；开发与测试使用 TypeScript、Vite、
`@vitejs/plugin-react`、Vitest、jsdom、React Testing Library、jest-dom 和 user-event。HTTP 使用
原生 `fetch`/`AbortController`，时间显示使用 `Intl.DateTimeFormat`，模态使用原生 `<dialog>`。

**Rationale**: 当前只有一个页面、五个 REST 接口和四个可编辑字段，React hooks、受控表单和纯函数
足以处理状态、草稿与即时校验。最少依赖更符合离线、本机和教学项目的可理解性要求。

**Alternatives considered**: Axios、React Query、Redux/Zustand、React Hook Form、Zod、React Router、
MUI、Ant Design、shadcn/ui、Tailwind、CSS-in-JS 和日期库均被拒绝；当前需求不足以证明其复杂度。

## Decision 2：应用外壳固定横幅，所有覆盖式界面内部重复声明

**Decision**: `AppShell` 顶部永久渲染不可关闭的 `SafetyBanner`。列表、空列表、搜索结果、无结果、
加载、错误和详情状态都位于该外壳内。创建、编辑和删除使用原生模态 `<dialog>`，三个 dialog 内部
始终重复完整声明，而不是尝试用 z-index 判断底层横幅是否仍清晰可见。

**Rationale**: 原生 dialog 进入浏览器 top layer，backdrop 可能遮暗普通层级中的横幅；直接复用同一
横幅组件能确定性满足规格。原生 dialog 还减少自制焦点圈定、Escape 和背景 inert 的错误风险。

**Alternatives considered**: 仅固定底层横幅、自制 ARIA 模态、Toast 或启动提示均不能稳定满足持续
可见要求。删除确认初始焦点放在“取消”，点击遮罩不执行删除。

## Decision 3：同步 FastAPI/SQLAlchemy 栈和显式迁移

**Decision**: 后端采用同步 FastAPI 路由和同步 SQLAlchemy Session。运行依赖为 FastAPI、Uvicorn、
SQLAlchemy、Pydantic 和 Alembic；测试依赖为 pytest 和 HTTPX。Python 3.12 与锁文件由 `uv` 管理。
正式数据库只通过 `alembic upgrade head` 建立和升级，不在服务启动时调用 `create_all()`。

**Rationale**: 单机单用户 CRUD 没有异步数据库吞吐需求。同步栈更易理解和测试。Alembic 是唯一
额外的结构管理依赖：数据库必须跨重启保留，后续功能会增加表，`create_all()` 不能升级已有结构。

**Alternatives considered**: `AsyncSession`/`aiosqlite`、自动启动迁移、仅靠 `create_all()`、通用 Unit
of Work 和领域事件均被拒绝。普通隔离测试允许用 metadata 快速建表，并另设迁移冒烟测试。

## Decision 4：业务服务直接持有查询和事务，不增加 Repository 框架

**Decision**: router 只处理 HTTP；schema 只处理 JSON 形状；validation 模块实现纯字段规则；
`patient_service.py` 使用注入的 Session 完成查询、业务校验、唯一性预检查、`flush()`、提交和回滚；
SQLAlchemy model 只声明表与约束；统一异常处理器负责 REST 错误映射。

**Rationale**: 单实体 CRUD 需要明确边界，但不需要再包一层通用 Repository 抽象。业务服务直接使用
Session 既能保持 router 干净，又避免一次性框架化。

**Alternatives considered**: Repository + Unit of Work、DDD aggregate、CQRS 和领域事件均延期，只有
出现第二个调用者、替代存储或复杂跨聚合事务时才重新评估。

## Decision 5：展示病历号与规范化病历号分离

**Decision**: `medical_record_no` 保存经 `strip()` 后、保留原大小写、内部空格和符号的展示值；
`medical_record_no_normalized` 由后端执行 `strip().casefold()` 派生，客户端不可写，并建立唯一索引。
数据库唯一索引是最终兜底，service 预查询只用于产生更友好的错误。

**Rationale**: 分离字段同时满足用户展示和严格唯一性。SQLite `NOCASE` 不能完整等价 Python
`casefold()`；只做预查询则存在检查和写入之间的竞争窗口。

**Alternatives considered**: 只存规范化值会丢失展示形式；只用 `COLLATE NOCASE` 或 service 预查询
不能成为最终权威；不执行额外 Unicode NFKC/NFC、符号折叠或内部空白压缩，因为规格未要求。

## Decision 6：UTC 时间采用明确的应用时钟语义

**Decision**: 创建时 `created_at == updated_at`；成功编辑只更新 `updated_at`；客户端不可写两个
时间字段。应用使用可注入的 UTC 时钟。SQLite 按 UTC 语义保存无偏移时间，API 边界恢复为 UTC
aware datetime 并输出带 `Z` 的 RFC 3339 字符串。

**Rationale**: SQLite 不真正保存时区偏移；明确存储约定比依赖数据库 `now()` 更可预测，也便于用
固定时钟测试相同更新时间下的第二排序键。

**Alternatives considered**: SQLite `CURRENT_TIMESTAMP`、不透明的 ORM `onupdate` 和本地时区存储均
被拒绝。出生日期保持纯 `DATE`，不得经 UTC 时间转换产生日期偏移。

## Decision 7：运行数据放在项目本机 `data/` 目录

**Decision**: 默认数据库为 `data/patient-management.sqlite3`，与批准设计中后续 `data/dicom/` 的
本机受管数据根保持一致。`MEDICAL_CT_APP_DATA_DIR` 可覆盖目录以支持测试和本机部署。数据库、
`-wal`、`-shm` 和临时文件必须写入 `.gitignore`。

**Rationale**: 可见的项目级运行目录最适合当前教学流程，便于确认重启前后使用同一数据库，同时
仍满足数据不离开本机。测试可用 `tmp_path` 完全隔离。

**Alternatives considered**: `%LOCALAPPDATA%` 更适合安装后的桌面产品，但当前没有安装器或多环境
部署要求，会让教学验收路径更隐蔽；把数据库放入 `backend/` 源码目录则容易误提交。

## Decision 8：REST 契约统一错误结构，UUID 仅作内部标识

**Decision**: API 返回 `id` 供组件状态和详情/编辑/删除请求使用，但 UI 不得把 UUID 渲染到列表、
详情、表单、删除确认、标题或可访问名称中。`medical_record_no_normalized` 永不进入 API。错误体统一
为 `error.code`、`error.message` 和 `field_errors[]`，稳定映射 `422/404/409/500`。

**Rationale**: REST 资源需要稳定标识，而规格禁止的是把内部 UUID 作为用户字段显示。稳定字段错误
键能让前端显示精确错误，而无需解析中文消息或 FastAPI 默认错误结构。

**Alternatives considered**: 用病历号作路由键会让可编辑业务标识承担资源身份；把 UUID 放进浏览器
路由会使其直接出现在地址栏，因此第一阶段使用单页组件状态，不增加 `/patients/:id` 前端路由。

## Decision 9：单一搜索参数和服务器权威排序

**Decision**: `GET /api/patients?q=...` 同时匹配病历号或姓名。查询值先 trim；空值返回完整列表；
病历号查询 casefold 后匹配规范化列，姓名用 SQLite `lower()` 满足英文字母不区分大小写；`%` 和
`_` 作为普通文本转义。完整列表和搜索统一按 `updated_at DESC`、
`medical_record_no_normalized ASC` 排序。前端不重新排序。

**Rationale**: 单一参数符合规格且保持接口最小。规范化病历号唯一，因此第二排序键形成确定全序。

**Alternatives considered**: 分页、全文检索、拼音、模糊搜索、客户端排序和额外搜索索引均不在当前
范围；没有真实规模证据时不提前引入。

## Decision 10：服务器确认后更新 UI，草稿只存在于打开表单

**Decision**: 不做乐观创建、编辑或删除。成功后采用服务器返回规范值并刷新列表；失败保持原有
列表、详情和覆盖界面。创建/编辑使用受控表单，`422/409/500` 后保留全部原始输入，仅保存成功或
用户通过取消、关闭或 Escape 明确取消时清除；不写入 localStorage 或 IndexedDB。

**Rationale**: 后端是校验和持久化最终权威。等待提交成功可直接避免 UI 与 SQLite 不一致，并严格
满足失败草稿保留和刷新后无需恢复未提交草稿的边界。

**Alternatives considered**: 乐观更新和跨刷新草稿持久化均扩大范围并削弱失败一致性。

## Decision 11：分层自动化测试加固定浏览器验收记录

**Decision**: pytest 使用 `tmp_path` 下的真实 SQLite 文件；持久化测试关闭并重建 app/engine；迁移
测试从空文件升级到 head。Vitest/RTL 覆盖即时校验、REST 错误映射、草稿保留、全部页面状态横幅、
三个 dialog、详情八项字段和 UUID 不可见。真实浏览器按 spec 八步路径执行并在 Quickstart 表格中
记录环境、Git SHA、实际结果、Pass/Fail 和证据。

**Rationale**: jsdom 不能证明真实 CSS 遮挡、dialog top layer 或服务重启持久化；固定人工验收记录
在不增加 Playwright 的前提下补足真实浏览器证据。

**Alternatives considered**: Playwright/Cypress 被用户明确排除；快照测试不能替代行为断言；纯内存
SQLite 不能可靠模拟多连接和重启。

## Scope Confirmation

- 当前仅创建 Patient 表和五个 Patient REST 接口。
- `study_count=0`、`latest_study_date=null` 是响应层派生值，不持久化、不创建影像表。
- 不安装 pydicom、Cornerstone3D，不创建 DICOM、Study、Series、Instance、PACS、登录或云服务代码。
- 参考设计文档中删除影像数据、DICOM 导入和查看器相关内容全部延期到后续独立 Feature。
