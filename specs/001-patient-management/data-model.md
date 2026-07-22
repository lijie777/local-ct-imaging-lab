# Data Model: 病人管理

## Patient

当前 Feature 只创建一个持久化实体 `Patient`，不创建 Study、Series、Instance 或任何 DICOM 表。

| 字段 | 存储类型 | 可空 | 写入来源 | 规则 |
| --- | --- | --- | --- | --- |
| `id` | UUID | 否 | 后端生成 | 主键；API 内部标识；不得作为用户可见字段显示 |
| `medical_record_no` | 字符串，最长 64 | 否 | 用户输入，经后端规范化 | 去除首尾空白；保留原大小写、内部空格和符号；1–64 个可见字符；拒绝换行和控制字符 |
| `medical_record_no_normalized` | 字符串 | 否 | 后端派生 | `medical_record_no.strip().casefold()`；唯一索引；客户端不可提交；API 不返回 |
| `name` | 字符串，最长 100 | 否 | 用户输入，经后端规范化 | 去除首尾空白；保留内部空格和标点；1–100 个可见字符；拒绝换行和控制字符 |
| `sex` | 字符串枚举 | 否 | 用户输入或默认值 | `male`、`female`、`other`、`unknown`；默认 `unknown`；数据库 CHECK 约束 |
| `birth_date` | DATE | 是 | 用户输入 | 有效日期；不得晚于运行服务所在机器的当天；不设最早日期 |
| `created_at` | UTC datetime | 否 | 后端时钟 | 创建时生成；客户端不可写；API 输出 RFC 3339 UTC `Z` 时间 |
| `updated_at` | UTC datetime | 否 | 后端时钟 | 创建时等于 `created_at`；成功编辑时更新；客户端不可写；API 输出 UTC `Z` 时间 |

### 响应层派生字段

| 字段 | 当前值 | 说明 |
| --- | --- | --- |
| `study_count` | `0` | 当前 Feature 不创建真实影像检查数据 |
| `latest_study_date` | `null` | 当前 Feature 不创建 Study |

派生字段不写入 `patients` 表，避免提前实现后续影像领域模型。

## Identity and Visibility

- `id` 是不可变内部资源标识。API 返回 `id`，用于 `GET/PATCH/DELETE /api/patients/{id}` 和前端
  组件内部选择状态。
- 前端不得在列表、详情、表单、删除确认、标题、提示文本或可访问名称中渲染 `id`。
- `medical_record_no` 是用户可见且可编辑的业务标识，不作为数据库主键或 REST 资源路径键。
- `medical_record_no_normalized` 仅用于查询和唯一性，不进入创建/编辑请求或读取响应。

## Validation Order

### 创建和编辑公共规则

1. 后端解析请求形状和字段类型。
2. 对 `medical_record_no` 和 `name` 去除首尾空白。
3. 检查 trim 后长度、可见字符以及换行/控制字符。
4. 将缺省 `sex` 解析为 `unknown`，验证枚举。
5. 验证 `birth_date` 为空或不晚于当天。
6. 由 trim 后病历号计算 `medical_record_no_normalized = casefold()`。
7. 查询规范化病历号冲突；编辑时排除当前 `id`。
8. 在同一事务中写入并 `flush()`；数据库唯一索引作为最终权威。
9. 捕获唯一约束并稳定映射为 `409 medical_record_no_conflict`。

前端可执行相同的即时格式校验，但不得计算或提交规范化字段，也不得把前端检查当成后端唯一性
和持久化成功的替代。

## Database Constraints and Indexes

| 名称 | 类型 | 字段/条件 | 目的 |
| --- | --- | --- | --- |
| `pk_patients` | 主键 | `id` | 稳定内部身份 |
| `uq_patients_medical_record_no_normalized` | 唯一索引 | `medical_record_no_normalized` | 强制 trim + casefold 等价值唯一 |
| `ix_patients_stable_sort` | 复合索引 | `updated_at DESC, medical_record_no_normalized ASC` | 支持完整列表和搜索结果的统一确定排序 |
| `ck_patients_sex` | CHECK | `sex IN ('male','female','other','unknown')` | 防止绕过 API 写入非法枚举 |
| `ck_patients_timestamp_order` | CHECK | `created_at <= updated_at` | 保证时间顺序 |

当前不为姓名搜索增加全文索引或额外规范化列；规格没有数据规模、拼音或模糊搜索要求。

## Search Semantics

`GET /api/patients?q=<text>` 的过滤规则：

- `q` 省略、空字符串或纯空白：不增加过滤，返回完整列表。
- 病历号：`q.strip().casefold()` 后在 `medical_record_no_normalized` 中做子串匹配。
- 姓名：trim 后使用 SQLite `lower(name)` 做英文字母不区分大小写的子串匹配；中文、内部空格、
  标点和符号保持原义。
- 查询中的 `%` 和 `_` 必须转义为普通字符，不得成为 LIKE 通配符。
- 过滤后统一按 `updated_at DESC, medical_record_no_normalized ASC` 排序。
- `medical_record_no_normalized` 唯一，因此第二排序键足以形成确定全序。

## Time Semantics

- 应用内部时钟返回 UTC aware datetime，测试可注入固定时钟。
- SQLite 统一保存 UTC 语义的无偏移时间；读取后在持久化边界恢复 UTC 时区。
- API 始终输出带 `Z` 的 RFC 3339 时间。
- 前端使用 `Intl.DateTimeFormat('zh-CN')` 本地化显示创建时间和最近更新时间。
- `birth_date` 是 date-only 值，按 `YYYY-MM-DD` 传输，不进行 UTC 转换。

## State Transitions

```text
不存在
  └─ POST 成功 → 已持久化

已持久化
  ├─ PATCH 成功 → 已持久化（updated_at 更新）
  ├─ POST/PATCH 校验或唯一性失败 → 状态不变
  ├─ POST/PATCH 持久化失败 → 事务回滚，状态不变
  ├─ DELETE 取消 → 状态不变，不发送 DELETE
  ├─ DELETE 持久化失败 → 事务回滚，状态不变
  └─ DELETE 成功 → 不存在（真实删除）
```

第一版没有软删除、回收站、撤销删除、并发版本列或审计历史。

## Relationships

当前没有持久化关系。`Patient` 与后续 Study/Series/Instance 的关系不在本 Feature 中建模。

## Migration Strategy

- Alembic 首个 revision 创建 `patients` 表、约束和索引。
- 正式服务启动前显式执行 `uv run alembic upgrade head`。
- 正式启动不运行 `Base.metadata.create_all()`，避免掩盖数据库版本漂移。
- 普通 pytest 可对临时数据库使用 metadata 快速建表；另设从空 SQLite 文件升级到 head 的迁移测试。
- 数据库文件、`-wal`、`-shm` 和测试临时文件不提交 Git。
