# Research: 后台导入与断点续传

## 暂存目录边界

- **Decision**: 可续传任务使用 `data/.import-jobs/{job_id}`，保留现有 `data/.imports` 作为同步
  multipart 请求级临时目录。
- **Rationale**: 现有启动清理会删除 `.imports` 子目录，不能保存跨重启 offset；独立目录允许按
  数据库活动任务精确清理。
- **Alternatives considered**: 修改 `.imports` 全局清理语义会混淆短期 request session 与持久任务。

## 活动任务唯一性

- **Decision**: 状态为 `uploading/queued/running` 时 `active_slot=1`，终态为 null，并对
  `(patient_id, active_slot)` 建唯一约束。
- **Rationale**: SQLite 允许多个 null，因此可保留终态报告，同时从数据库层保证每 Patient 最多
  一个活动任务，不依赖进程内竞态判断。
- **Alternatives considered**: 只在 service 查询；并发创建请求可能越过检查。部分唯一索引可行，
  但 active slot 更容易跨 ORM、迁移和测试表达。

## 续传协议

- **Decision**: 客户端顺序发送最多 4 MiB 的 binary chunk，每次携带当前 `Upload-Offset`；服务端
  只接受等于 SQLite `confirmed_offset` 的请求并返回新 offset。
- **Rationale**: 单用户下无需并行分片或复杂 upload session 协议；确认 offset 足以保证重试幂等。
- **Alternatives considered**: 单次 multipart 无法续传；并行 range upload 增加锁、合并和校验复杂度。

## 磁盘与数据库崩溃一致性

- **Decision**: chunk 写入/flush 后提交新 offset；恢复时 SQLite offset 是真值。磁盘更长则截断
  未确认尾部，磁盘更短则把 offset 回退到实际长度。
- **Rationale**: 进程可能在文件写入与数据库提交之间退出；安全重传最后一块优于假定其成功。
- **Alternatives considered**: 信任文件长度会把部分写入当成功；每 chunk 双文件 rename 复杂且无必要。

## 文件重新匹配

- **Decision**: 使用安全相对路径、大小、修改时间和 SHA-256 resume fingerprint。fingerprint 输入
  为 metadata 与文件首尾合计最多 64 KiB；文件完整上传后服务端重算并核对。
- **Rationale**: 浏览器不能在刷新后无授权重开文件；重新选择必须防止同名同大小文件拼接。首尾
  采样避免把 512 MiB 文件整体载入内存，且无需新 hashing 依赖。
- **Alternatives considered**: 仅路径/大小误匹配风险更高；浏览器 Web Crypto 不提供增量流式 SHA-256，
  全文件 `arrayBuffer()` 内存边界不可接受。

## 后台执行模型

- **Decision**: FastAPI lifespan 启动一个 daemon worker，独立 Session 串行 claim 最早 queued job，
  调用现有 `import_dicom_files` 并保存报告。
- **Rationale**: 保持一个后端进程即可运行；现有导入同步且已有事务/文件回滚，不需要新队列系统。
- **Alternatives considered**: FastAPI BackgroundTasks 不跨重启；Celery/Redis 违反交付和范围边界。

## 重启语义

- **Decision**: 启动时把 `running` 恢复为 `queued`；`uploading` 保持 offset；queued 自动继续。
  已按 Study 提交的数据重跑时由 SOP Instance UID 去重并报告 duplicate。
- **Rationale**: 现有导入按 Study 提交，无法原子覆盖整个 job；at-least-once 重跑在既有幂等边界上
  最简单且保持文件/数据库一致。
- **Alternatives considered**: 重写导入为逐文件 checkpoint 会扩大 Feature、改变已验收报告语义。

## Patient 删除

- **Decision**: 活动任务存在时 Patient DELETE 返回 `409 import_in_progress`；不尝试取消 running。
- **Rationale**: 同步 pydicom/文件事务缺少安全中断点，阻止删除比跨线程取消更可靠。
- **Alternatives considered**: 级联删除 job 会让 worker 继续使用已删除 Patient；强制取消会留下未知
  数据库/文件状态。

## 前端交互

- **Decision**: 复用 `DicomImportDialog` 和 `ImportReport`，新增 manifest/uploader/hook；对话框打开时
  1 秒轮询 queued/running。关闭 uploading 会 abort 并暂停，关闭 queued/running 不取消后端。
- **Rationale**: 满足用户可见恢复且不新增任务中心或 Patient 页面结构。
- **Alternatives considered**: 全局任务中心和长期历史超出当前单用户需求。
