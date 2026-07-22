# Research: DICOM 导入与持久化

## 1. DICOM 元数据读取

**Decision**: 使用 pydicom 正常解析文件并设置小 `defer_size`，只读取元数据和 PixelData 标签存在性，
不访问或解码 PixelData 值。

**Rationale**: `stop_before_pixels` 无法判断像素标签是否存在；直接普通读取可能把大像素值读入内存。
延迟大值同时满足导入阶段的元数据需求和内存边界。

**Alternatives considered**: `stop_before_pixels=True`（无法判断 PixelData 标签）；直接完整读取（不必要的
内存消耗）；在导入阶段解码像素（越过 002 范围）。

## 2. 导入事务粒度

**Decision**: 文件先逐项解析，候选项按 `StudyInstanceUID` 分组，每个 Study 独立提交。

**Rationale**: 病人匹配以 Study 组为阻止单位；同一 Study 内保持一致，同时允许其他 Study 部分成功。

**Alternatives considered**: 整批单事务（一次失败影响无关 Study）；逐文件事务（容易形成不完整组）。

## 3. 上传与进度

**Decision**: 使用一个同步 multipart 请求接收多个文件；后端分块写入临时目录，前端显示选择、
进行中和结果状态。

**Rationale**: 本机单用户、第一版至少 50 个实例，不需要任务队列或断点续传；分块落盘避免整批驻留
内存。浏览器目录选择仍产生同一 `files` 字段的多个文件。

**Alternatives considered**: Base64 JSON（体积和内存浪费）；逐文件 API（报告和 Study 事务复杂）；
后台任务/SSE（当前规模不需要，增加恢复和状态模型）。

## 4. 受管路径

**Decision**: 最终路径由已经严格校验的 DICOM UID 构成，客户端文件名只用于报告；所有路径必须
解析并验证仍在配置的数据目录内。

**Rationale**: UID 提供确定、可追踪且跨重启稳定的组织方式；忽略客户端路径可以防止目录逃逸和
名称碰撞。

**Alternatives considered**: 保留上传目录结构（不可信且不稳定）；随机内部路径（降低人工追踪性）；
哈希 UID（解决极端路径长度但增加映射复杂度，当前未证明必要）。

## 5. 重复规则

**Decision**: `SOPInstanceUID` 为全局权威重复键；数据库已有实例时报告重复且不触碰现有文件。最终
路径存在但数据库无实例时报告存储冲突失败。

**Rationale**: DICOM UID 是标准身份；未知孤立文件不能被静默当作可信重复或覆盖。

**Alternatives considered**: 文件名或内容哈希重复（不能替代 DICOM 身份）；覆盖目标（破坏既有数据）。

## 6. PatientID 规则

**Decision**: DICOM PatientID 与 Patient 病历号使用 `strip().casefold()` 后精确相等；缺失、不匹配、
同组不一致或已有 Study 归属其他 Patient 时阻止整个 Study。

**Rationale**: 与 001 的唯一性语义一致，避免姓名或模糊规则造成错误归属。

**Alternatives considered**: 区分大小写（用户输入易产生无意义差异）；姓名匹配或手动覆盖（误归属风险）。

## 7. 不支持分类与查看条件

**Decision**: 导入阶段只把未压缩小端传输语法、存在像素标签且尺寸/基础空间元数据完整的 CT 标记为
`eligible`；其他元数据可读 CT 文件保存并分类为 `unsupported`，Series 保留稳定原因。003 Feature
可以增加解码器后重新评估。

**Rationale**: 002 不解码像素，但必须诚实说明后续查看可用性；保存元数据避免把可追踪 CT 静默丢弃。

**Alternatives considered**: 全部标记可查看（不可验证）；全部跳过压缩 CT（丢失元数据）；现在引入
Cornerstone/codecs（越过 Feature 边界）。

## 8. SQLite 关系和 Patient 汇总

**Decision**: Study、Series、Instance 使用数据库外键级联和全局 UID 唯一索引；Patient 的
`study_count` 与 `latest_study_date` 每次查询派生，不增加冗余汇总列。

**Rationale**: 数据源单一，避免导入/删除时维护重复统计；SQLite 必须显式启用 foreign keys。

**Alternatives considered**: Patient 冗余计数列（容易漂移）；软删除（001 已定义真实删除）。

## 9. 导入失败补偿

**Decision**: 每个 Study 跟踪本次创建的受管文件；任何文件或数据库步骤失败时 rollback 并只清理
该列表，不触碰已存在文件。

**Rationale**: 文件系统与数据库不能共享原子事务，显式补偿是满足宪章一致性要求的最小方案。

**Alternatives considered**: 先提交数据库再复制文件（会出现缺失文件引用）；先复制后不补偿（残留）。

## 10. 病人删除一致性

**Decision**: 删除前原子移动病人目录到本机删除暂存区；数据库级联删除成功后永久清除；提交失败
恢复目录；最终清除失败时使用删除前索引快照恢复数据库并恢复目录，然后返回稳定失败。

**Rationale**: 用户明确要求同步永久删除，宪章禁止删除失败被报告为成功或留下索引/文件不一致。

**Alternatives considered**: 最佳努力删除（不满足一致性）；只删除数据库（遗留医疗文件）；异步垃圾
回收（不满足同步边界）。

## 11. 新依赖必要性

**Decision**: 仅新增 `pydicom` 和 `python-multipart`。

**Rationale**: pydicom 是宪章批准并负责标准 DICOM 标签解析；python-multipart 是 FastAPI 接收
浏览器文件表单的必要解析器。现有依赖无法正确替代两者。

**Alternatives considered**: 手写 DICOM 或 multipart 解析（高风险且无必要）；新增任务队列、影像
解码器或 UI 框架（当前 Feature 不需要）。

## 12. 异步上传与同步导入边界

**Decision**: multipart 路由异步分块读取 UploadFile；完成临时落盘后在线程池执行同步解析、文件变更
和数据库事务。

**Rationale**: pydicom、常规文件系统调用和现有 SQLAlchemy Session 都是同步接口，直接在 async
路由中执行会阻塞事件循环；线程池保留现有明确事务边界且不引入异步数据库栈。

**Alternatives considered**: 整个路由使用同步函数（UploadFile 分块读取与清理不便）；改用异步数据库
和文件库（范围扩大且没有单用户收益）；直接阻塞事件循环（影响错误恢复和其他本机请求）。

## 13. 实例确定排序

**Decision**: 若 Series 全部实例具有有效且一致的 ImageOrientationPatient 和 ImagePositionPatient，
取行/列方向叉积为法向量，按位置与法向量点积升序；否则按 InstanceNumber 升序且空值置后；最终
始终按 SOPInstanceUID 升序打破平局。

**Rationale**: 点积排序符合 DICOM 空间几何，不依赖某一固定患者坐标轴；fallback 对不完整元数据仍
提供跨刷新和重启稳定的顺序。

**Alternatives considered**: 只按 z 坐标（对倾斜采集错误）；只按 InstanceNumber（可能缺失或乱序）；
文件名排序（不具备 DICOM 语义）。
