# Viewer State API Contract

Base path: `/api`; content type: `application/json`; all traffic is loopback only.

## GET `/series/{series_id}/viewer-state`

- `200 null`: Series exists and has no saved state.
- `200 ViewerStateRead`: `{series_id, schema_version, state, created_at, updated_at}`.
- `404 series_not_found`。
- `422 validation_error`（路径参数无效）或 `422 viewer_state_invalid`（数据库中的状态无法通过
  当前严格 schema 校验）。
- `500 persistence_error`。

## PUT `/series/{series_id}/viewer-state`

Request:

```json
{
  "schema_version": 1,
  "state": {
    "axial": null,
    "mpr": null,
    "annotations": []
  }
}
```

- 完整替换且幂等；返回 `200 ViewerStateRead`。
- payload 序列化后不得超过 2 MiB，annotation 不得超过 500。
- 每条 annotation 必须含 1–2048 字符且无控制字符的 `referenced_image_id`；客户端只保存
  当前 Series 的 image identity，并在恢复前重新核对。MPR volume annotation 没有真实
  `referencedImageId` 时使用当前 Series 的稳定 image anchor 表达 membership；明确但不属于
  当前 Series 的 identity 仍必须拒绝，恢复后 identity 必须写回 runtime metadata。
- 所有嵌套模型禁止未知字段，所有 number 必须有限。
- 第 501 条 annotation 或其他超限使整份 PUT 失败，不允许截断后返回成功。
- `404 series_not_found`；`422 validation_error`（路径参数无效）或
  `422 viewer_state_invalid`（body 无效）；`500 persistence_error`。

## DELETE `/series/{series_id}/viewer-state`

- Series 存在时幂等返回 `204`，无论之前是否有状态。
- `404 series_not_found`, `422 validation_error`, `500 persistence_error`。

## Browser unload behavior

- `visibilitychange` 进入 hidden 时，客户端先用普通请求 flush 最新完整快照。
- `pagehide` 作为 fallback：PUT body 不超过 60 KiB 时可设置 `keepalive: true`；更大的合法
  body 使用普通 fetch，避免触发浏览器 keepalive quota 拒绝。
- 若 `visibilitychange` 发出的普通 PUT 与 `pagehide` 重叠且普通 PUT 失败，writer 必须把最新
  完整快照重新入队，并使用 pagehide 的 keepalive 选项重试，而不是让 fallback 复用失败结果。
- DELETE 可设置 `keepalive: true`，writer 的 `flush()`/`destroy()` 必须等待进行中的 DELETE。

## Error boundary

错误遵循现有 `ErrorResponse`，只返回稳定 `code` 与用户安全 `message`；不得包含 SQL、文件
路径、堆栈、原始 payload 或 DICOM 内容。
