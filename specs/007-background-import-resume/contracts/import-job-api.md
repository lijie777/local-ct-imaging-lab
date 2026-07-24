# Import Job API Contract

Base path: `/api`; JSON 除 chunk body 外；所有 traffic 仅限 loopback。

## POST `/patients/{patient_id}/import-jobs`

Request:

```json
{
  "files": [
    {
      "relative_path": "study/series/image-001.dcm",
      "size_bytes": 1048576,
      "last_modified_ms": 1784800000000,
      "resume_fingerprint": "64-lowercase-hex"
    }
  ]
}
```

- `201 ImportJobRead`，状态 `uploading`，offset 初始为 0。
- 1–2,000 文件；单文件 ≤512 MiB；总量 ≤8 GiB；路径和 fingerprint 严格验证。
- `404 patient_not_found`；`409 import_job_conflict`；`413 import_limit_exceeded`；
  `422 validation_error`；`500 persistence_error`。

## GET `/patients/{patient_id}/import-jobs/latest`

- `200 ImportJobRead | null`，按创建时间返回最新任务。
- `404 patient_not_found`；`422 validation_error`；`500 persistence_error`。

## GET `/import-jobs/{job_id}`

- `200 ImportJobRead`；文件按 ordinal 排序。
- `404 import_job_not_found`；`422 validation_error`；`500 persistence_error`。

## PUT `/import-jobs/{job_id}/files/{file_id}/content`

Headers:

```text
Content-Type: application/octet-stream
Upload-Offset: <non-negative decimal integer>
```

Body: 1–4 MiB；最后一块可小于 4 MiB，但不得越过 `size_bytes`。

Response `200`:

```json
{
  "file_id": "uuid",
  "confirmed_offset": 4194304,
  "uploaded_bytes": 8388608,
  "total_bytes": 16777216
}
```

- 仅 `uploading` 可写；offset 必须等于当前 confirmed offset。
- 文件完成时服务端核对 fingerprint；不匹配不允许任务入队。
- `404 import_job_not_found`；`409 import_offset_conflict/import_file_mismatch/import_job_state_conflict`；
  `413 import_limit_exceeded`；`422 validation_error`；`500 persistence_error`。

## POST `/import-jobs/{job_id}/queue`

- 所有文件完整且 fingerprint 已核对时，`uploading -> queued`，返回 `202 ImportJobRead`。
- worker 唤醒由服务端内部完成，客户端不依赖进程内事件作为持久状态。
- `404 import_job_not_found`；`409 import_job_state_conflict/import_file_mismatch`；
  `422 validation_error`；`500 persistence_error`。

## DELETE `/import-jobs/{job_id}`

- `uploading/completed/failed` 可删除任务与暂存，返回 `204`。
- `queued/running` 返回 `409 import_job_state_conflict`。
- `404 import_job_not_found`；`422 validation_error`；`500 persistence_error`。

## ImportJobRead

必含：`id`、`patient_id`、`status`、`total_files`、`total_bytes`、`uploaded_bytes`、`files`、
`report`、`error_code`、`error_message`、`created_at`、`updated_at`、`started_at`、`completed_at`。
未知键拒绝；report 继续使用现有五类 `ImportReport` 合同。

## Error boundary

错误只返回稳定 code 与用户安全 message；不得包含绝对路径、SQL、堆栈、原始 chunk、fingerprint
输入或 DICOM 内容。Patient 活动任务删除冲突使用 `409 import_in_progress`。
