# 后台导入与断点续传设计

## 目标与边界

在现有本机单用户 DICOM 导入之上增加可持久化的导入任务。浏览器按顺序分块上传，刷新、关闭
对话框或本机服务重启后可继续；全部文件上传完成后，由 FastAPI 单进程内唯一 worker 在后台
调用现有 `import_dicom_files`，继续输出成功、重复、跳过、不支持和失败五类逐文件报告。

本 Feature 不加入 Redis、Celery、多 worker、并行上传、远程目录扫描、跨设备续传、账户、云、
PACS、DICOMweb 或诊断报告。现有同步 multipart 接口保留兼容，不在本 Feature 中删除。

## 方案比较

### 方案 A：SQLite 任务 + 顺序分块 + 单进程 worker（采用）

- SQLite 保存任务、文件清单、确认 offset、状态和最终报告。
- 浏览器每次只上传一个文件的一个 chunk；服务端确认后才推进 offset。
- 单一后台 worker 串行执行现有导入服务。
- 优点：符合本机单进程交付，重启可恢复，不增加基础设施，数据库与文件边界可测试。
- 代价：仅支持当前浏览器重新选择同一批本机文件，不支持跨设备或多任务并行。

### 方案 B：FastAPI BackgroundTasks 包装现有 multipart

实现最少，但请求中断后上传内容和任务状态都丢失，无法满足断点续传与重启恢复，因此不采用。

### 方案 C：Celery/Redis 或独立 worker 服务

可扩展并行和分布式任务，但破坏“一个后端进程即可运行”的交付形态，也超出单用户本机范围，
因此不采用。

## 数据模型

### ImportJob

- `id`：UUID。
- `patient_id`：级联到现有 Patient。
- `status`：`uploading | queued | running | completed | failed`。
- `active_slot`：活动状态固定为 `1`，终态为 `null`；`patient_id + active_slot` 唯一，保证每位
  病人最多一个活动任务。
- `total_files`、`total_bytes`、`uploaded_bytes`：清单与聚合进度。
- `report`：完成时保存严格 `ImportReport` JSON；基础设施失败时为空。
- `error_code`、`error_message`：只保存用户安全错误，不保存路径、堆栈或 DICOM 内容。
- `created_at`、`updated_at`、`started_at`、`completed_at`。

### ImportJobFile

- `id`、`job_id`、`ordinal`。
- `relative_path`：浏览器目录相对路径或文件名，规范化后不得为空、绝对、包含 `.`/`..` 或控制字符。
- `size_bytes`、`last_modified_ms`。
- `resume_fingerprint`：浏览器对路径、大小、修改时间及文件首尾合计最多 64 KiB 计算 SHA-256；
  用于重新选择时避免把同名同大小的另一文件续接到旧内容。
- `confirmed_offset`：服务端已经安全落盘并提交到 SQLite 的字节数。

迁移新增 `import_jobs` 和 `import_job_files`。暂存文件位于
`data/.import-jobs/{job_id}/{ordinal}.part`，与现有请求级 `data/.imports` 分离。

## API 合同

- `POST /api/patients/{patient_id}/import-jobs`：提交 1–2,000 项清单；单文件不超过 512 MiB，
  总量不超过 8 GiB；返回任务和文件 ID/offset。
- `GET /api/patients/{patient_id}/import-jobs/latest`：返回最新任务或 `null`，供刷新后找回。
- `GET /api/import-jobs/{job_id}`：返回任务、文件进度和完成报告。
- `PUT /api/import-jobs/{job_id}/files/{file_id}/content`：请求头 `Upload-Offset`，body 为最多
  4 MiB 的 `application/octet-stream`；offset 必须等于当前确认值，响应返回新确认值。
- `POST /api/import-jobs/{job_id}/queue`：仅当所有文件完整且 fingerprint 核对通过时，把任务
  从 `uploading` 改为 `queued`，返回 `202`。
- `DELETE /api/import-jobs/{job_id}`：只允许删除 `uploading`、`completed` 或 `failed`；
  `queued/running` 返回安全 `409`，避免 worker 与清理竞态。

所有错误继续使用现有 `ErrorResponse`。新增稳定错误码覆盖任务不存在、活动任务冲突、offset
冲突、文件不匹配、任务状态冲突和 chunk 超限。

## 上传与恢复流程

1. 浏览器选择文件/目录，生成稳定相对路径、大小、修改时间和轻量 fingerprint。
2. 没有活动任务时创建清单；已有 `uploading` 任务时要求重新选择同一批文件。
3. 前端逐文件匹配清单，并从服务端 `confirmed_offset` 开始按 4 MiB 顺序上传。
4. 服务端在任务级串行边界内核对 offset，把 chunk 写入 `.part`，flush 后更新 SQLite offset。
5. 若进程在文件写入后、offset 提交前退出，恢复时以 SQLite offset 为准并截断多出的尾部，
   让客户端安全重传；若实际文件短于确认 offset，则把确认值回退到实际长度。
6. 最后一块完成时，服务端重算 fingerprint；不一致则拒绝入队，不混合两个本机文件。
7. 全部文件完成后前端调用 queue。之后可关闭对话框，worker 仍继续处理。
8. 对话框打开时每秒轮询；完成后展示现有五类报告并刷新 Study/Series 列表。

## 后台 worker 与重启

- FastAPI lifespan 启动一个进程内唯一 worker；它使用独立 SQLAlchemy Session 串行领取最早
  `queued` 任务，再调用现有 `import_dicom_files`。
- 正常的逐文件失败属于完成报告，不把任务标成 `failed`；只有数据库、存储或未预期异常进入
  `failed`，并返回用户安全消息。
- 启动时把遗留 `running` 改回 `queued`。现有导入按 Study 提交，重启后已提交实例会由既有
  SOP Instance UID 幂等规则报告为 duplicate，未提交内容继续处理。
- `uploading` 保持原状态和 offset；`queued` 自动继续；终态只保留报告，暂存目录尽快删除。
- 启动清理只删除没有活动数据库任务的孤立 `.import-jobs` 目录，不触碰可续传文件。
- 应用关闭时停止领取新任务；正在执行的同步导入不承诺进程内取消，异常退出后由上述规则恢复。

## 病人删除与一致性

存在 `uploading`、`queued` 或 `running` 任务时，病人删除返回安全 `409 import_in_progress`。
终态任务没有暂存文件，Patient 删除可继续并由外键级联删除任务/文件记录。这样避免后台 worker、
Patient 级联和暂存目录之间产生孤儿或跨病人写入。

## 前端交互

- 复用现有 DICOM 导入对话框和报告组件，不新增独立任务中心。
- 新建任务时显示“准备清单、上传字节进度、后台处理中、完成、失败”状态。
- `uploading` 状态关闭对话框或刷新会暂停浏览器上传；重新打开后提示重新选择同一文件/文件夹。
- `queued/running` 可关闭对话框，后台继续；重新打开后显示当前状态。
- `completed` 显示现有五类报告；`failed` 提供删除任务并重新开始，不自动重试未知基础设施错误。
- 非临床提示保持持续可见；错误不显示本机绝对路径、堆栈或 DICOM 内容。

## 测试与验收

- 后端 pytest：迁移约束、清单限制、路径安全、offset 冲突、chunk/总量、fingerprint、状态机、
  单活动任务、worker 串行、重启 requeue、孤立目录清理、Patient 删除冲突和五类报告持久化。
- 前端 Vitest/RTL：manifest/fingerprint、顺序 chunk、从 offset 续传、文件不匹配、刷新找回、
  polling、关闭后后台继续、完成报告和可访问状态。
- production 浏览器：上传中刷新并续传；上传完成后关闭对话框并确认后台完成；FastAPI 重启后
  `uploading` 与 `running` 两条路径恢复；网络/console 无外部请求和未处理错误。

## 自检

- 无 `TBD`、`TODO` 或待澄清项。
- 仅覆盖后台导入与断点续传，不引入 3D 或无关重构。
- 任务、暂存文件、Patient 删除和现有五类导入报告的状态转换一致。
- 方案保持一个 FastAPI 进程即可运行，未新增第三方依赖或外部服务。
