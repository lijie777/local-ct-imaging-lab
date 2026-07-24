# Data Model: 后台导入与断点续传

## ImportJob

| 字段 | 类型/约束 | 说明 |
| --- | --- | --- |
| `id` | UUID PK | 任务标识 |
| `patient_id` | UUID FK, cascade | 所属 Patient |
| `status` | enum string | `uploading/queued/running/completed/failed` |
| `active_slot` | 1 或 null | 活动状态为 1，终态为 null |
| `total_files` | 1–2,000 | 清单文件数 |
| `total_bytes` | 1–8 GiB | 清单总字节 |
| `uploaded_bytes` | 0–total | 所有 file confirmed offset 总和 |
| `report` | JSON/null | completed 时严格 `ImportReport` |
| `error_code/message` | string/null | failed 时用户安全错误 |
| `created_at/updated_at` | UTC-naive | 创建与更新 |
| `started_at/completed_at` | UTC-naive/null | worker 与终态时间 |

约束：

- `(patient_id, active_slot)` 唯一；SQLite 允许多个终态 null。
- `uploading/queued/running` 必须 `active_slot=1`；`completed/failed` 必须 null。
- `uploaded_bytes <= total_bytes`；completed 必须有 report 且无 error；failed 必须无 report 且有
  安全 error；非终态均无 completed_at。
- Patient `1 -> 0..n` ImportJob，Patient 删除级联终态记录；活动任务由 service 先阻止删除。

## ImportJobFile

| 字段 | 类型/约束 | 说明 |
| --- | --- | --- |
| `id` | UUID PK | 文件标识 |
| `job_id` | UUID FK, cascade | 所属任务 |
| `ordinal` | 0–1,999 | 原选择顺序 |
| `relative_path` | 1–1,024 chars | 安全相对路径/文件名 |
| `size_bytes` | 1–512 MiB | 文件大小 |
| `last_modified_ms` | non-negative int | 浏览器修改时间 |
| `resume_fingerprint` | 64 lowercase hex | metadata + 首尾采样 SHA-256 |
| `confirmed_offset` | 0–size | 已安全确认字节 |

约束：同一 job 的 `ordinal` 和 `relative_path` 分别唯一；路径不得绝对、包含空段、`.`、`..`、
NUL 或控制字符。磁盘路径只由 job UUID 与 ordinal 派生，不使用 `relative_path`。

## ImportJobRead

返回任务字段、按 ordinal 排序的全部文件、严格 `ImportReport | null` 和安全错误。客户端以服务端
返回的 `confirmed_offset` 为续传真值，不持久化浏览器 File 对象。

## 状态转换

```text
create -> uploading -> queued -> running -> completed
                    \-> running -> failed
uploading -> deleted (user discard)
completed/failed -> deleted (start-over cleanup)
running --service restart--> queued
```

- `uploading -> queued` 仅当每个文件 `confirmed_offset == size_bytes` 且 fingerprint 核对通过。
- `queued/running` 不允许用户删除；应用关闭只停止领取新任务，不承诺中断当前同步导入。
- 正常 DICOM 单文件 failed 是 completed report 的分类，不等同于 ImportJob `failed`。

## 暂存文件状态

```text
missing -> partial .part -> complete verified -> worker source -> terminal cleanup
```

- 磁盘长度大于 confirmed offset：截断到 confirmed offset。
- 磁盘长度小于 confirmed offset：事务回退 file offset，并重算 job uploaded bytes。
- 没有活动数据库 job 的目录为 orphan，可在启动清理；活动 job 目录不得被通用清理删除。
