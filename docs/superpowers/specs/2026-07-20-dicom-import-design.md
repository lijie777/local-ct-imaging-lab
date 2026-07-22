# 本地 CT DICOM 导入与持久化设计

## 1. 目标与范围

在已完成的 `001-patient-management` 基础上增加独立 Feature
`002-dicom-import`。本功能允许用户在选中的病人下导入本地 DICOM 文件或文件夹，读取 CT
元数据，按 Study、Series、Instance 建立 SQLite 索引，将原始文件复制到本机受管目录，并在
页面显示检查、序列和逐文件导入报告。

本功能不初始化 Cornerstone3D，不显示像素，不实现轴位查看器、MPR、测量、报告、PACS、
DICOMweb、登录、云服务或外部传输。

## 2. 默认决策

- 导入使用同步 `multipart/form-data` 请求；前端显示选择、上传/处理和完成状态，不加入后台任务、
  SSE、断点续传或任务队列。
- 浏览器同时支持多文件选择和目录选择；目录中的文件仍作为同一个 `files` 字段上传。
- 后端以流式分块方式把上传内容写入本次导入的临时目录，不把整套 CT 数据读入内存。
- 先解析全部文件，再按 `StudyInstanceUID` 分组；每个 Study 独立执行持久化事务。
- 病人匹配使用 DICOM `PatientID.strip().casefold()` 与病人的规范化病历号精确比较。
- 删除病人时同步删除其 Study、Series、Instance 索引和 `data/dicom/` 中的受管目录。
- 文件系统段使用经 DICOM UID 校验的原始 UID；所有受管路径必须经过解析后确认仍位于配置的数据
  目录内，客户端文件名不得决定最终存储路径。

## 3. 方案选择

采用“按 Study 分组事务”。整批单事务会让无关 Study 因一次数据库失败共同回滚；逐文件事务又会
产生不完整 Study/Series 的中间状态。按 Study 分组可以让损坏文件和无关 Study 独立失败，同时保证
同一 Study 的索引和受管文件作为一个一致性单元提交或清理。

## 4. 架构与职责

### 4.1 后端

- `dicom_parser.py`：只负责读取元数据、规范化标签、判定文件类别和生成不含 ORM 的解析结果。
- `managed_storage.py`：只负责临时文件、受管目标路径、原子移动、失败清理和病人目录删除。
- `dicom_import.py`：负责分组、病人匹配、重复判断、Study 事务编排、报告汇总和补偿清理。
- `models/study.py`、`series.py`、`instance.py`：声明持久化结构和级联关系。
- `schemas/dicom_import.py`：声明导入报告、Study、Series、Instance 的公共响应结构。
- `api/dicom_import.py`：接收 multipart 文件并返回导入报告。
- `api/studies.py`：提供病人检查列表、Study 序列列表和 Series 实例摘要。
- 现有 Patient 服务继续拥有病人 CRUD；列表和详情中的检查数量、最近检查日期改为从 Study 数据
  派生，不把汇总列写入 Patient 表。

### 4.2 前端

- `DicomImportDialog`：文件/目录选择、导入触发、进行中状态、取消关闭规则和完整免责声明。
- `ImportReport`：分别显示成功、重复、跳过、不支持、失败数量和逐文件原因。
- `StudyList`：在病人详情下显示检查及序列摘要，并支持刷新。
- `dicomImportApi.ts`：封装 multipart 导入和 Study/Series 查询，不解析 DICOM。
- `usePatientStudies.ts`：管理检查列表、导入后刷新、取消旧请求和错误状态。
- `PatientManagementPage` 只编排入口、选中病人、导入报告和检查列表，不包含解析或存储规则。

上传路由只在事件循环中异步读取 `UploadFile` 并分块落入临时目录；pydicom 解析、受管文件操作和
同步数据库事务统一在线程池中执行，避免阻塞本机服务的其他请求。

## 5. 数据模型

### Study

- `id`: 内部 UUID 主键。
- `patient_id`: Patient 外键，删除病人时级联删除。
- `study_instance_uid`: 全局唯一 DICOM UID。
- `dicom_patient_id`: 导入时读取到的 PatientID。
- `study_date`、`study_time`、`accession_number`、`description`: 可空元数据。
- `created_at`、`updated_at`: UTC 时间。

### Series

- `id`: 内部 UUID 主键。
- `study_id`: Study 外键，级联删除。
- `series_instance_uid`: 全局唯一 DICOM UID。
- `modality`: 本功能持久化的实例固定为 `CT`。
- `series_number`、`description`、`body_part_examined`: 可空元数据。
- `rows`、`columns`: 从有效实例汇总；不一致时序列标记不可查看。
- `viewability_status`: `eligible` 或 `unsupported`。
- `viewability_reason`: 不可查看的稳定原因，可空。
- `created_at`、`updated_at`: UTC 时间。

### Instance

- `id`: 内部 UUID 主键。
- `series_id`: Series 外键，级联删除。
- `sop_instance_uid`: 全局唯一 DICOM UID，重复判断的权威键。
- `sop_class_uid`、`transfer_syntax_uid`: DICOM UID。
- `instance_number`: 可空整数。
- `image_position_patient`、`image_orientation_patient`: 可空数值数组的 JSON 文本。
- `rows`、`columns`: 可空整数。
- `managed_path`: 相对数据目录的受管文件路径，数据库中不保存任意客户端绝对路径。
- `file_size`: 受管文件字节数。
- `created_at`: UTC 时间。

不创建像素数据数据库列；像素内容只存在于受管 `.dcm` 文件。

## 6. 存储布局

```text
data/
├── patient-management.sqlite3
├── .imports/
│   └── {import_session_uuid}/
└── dicom/
    └── {patient_uuid}/
        └── {study_instance_uid}/
            └── {series_instance_uid}/
                └── {sop_instance_uid}.dcm
```

临时目录在请求结束后无条件清理。重复文件不会覆盖既有文件。最终路径存在但数据库没有对应实例时，
视为存储冲突并归入失败，不静默复用未知文件。

## 7. 导入分类

每个输入文件只属于一个最终类别：

- `success`：新的、可作为后续查看器候选的 CT 实例已经复制并写入数据库。
- `duplicate`：`SOPInstanceUID` 已存在；不再次复制或写入。
- `skipped`：可识别但不属于本功能接受范围，例如非 DICOM、非 CT、缺失 PatientID、PatientID
  不匹配或所属 Study 因病人不匹配被阻止。
- `unsupported`：CT 元数据可读且文件已保存，但传输语法或空间/尺寸元数据不足，Series 被标记为
  不可查看；本阶段仍允许查看其元数据。
- `failed`：DICOM 损坏、缺失 Study/Series/SOP 必需 UID、临时写入失败、目标文件冲突、数据库
  或受管文件操作失败。

报告必须包含总数、五类独立计数以及每个非成功文件的原始显示名、稳定错误代码和面向用户的原因。
技术异常、绝对路径和堆栈不得返回前端。

## 8. 导入数据流

1. 验证 Patient 存在并创建本次导入临时目录。
2. 分块写入每个上传文件，并保留原始显示名用于报告。
3. 使用 `pydicom.dcmread(..., defer_size=1024)` 延迟读取大值；只访问元数据和 PixelData 标签存在性，
   不访问或解码像素值。
4. 将可分组记录按 Study UID 聚合；文件级无效项立即加入报告。
5. 对每个 Study 检查 PatientID。一项不匹配或组内 PatientID 不一致时阻止整个组。
6. 在 Study 事务内检查现有 Study/Series 所属病人和全局 SOP UID 重复。
7. 将新文件先复制到同一受管文件系统中的暂存目标，再原子移动到最终路径。
8. flush 并提交 Study、Series、Instance 索引。
9. 任一步失败时回滚该 Study 的数据库记录并清理该 Study 本次新增的文件，不删除先前成功数据。
10. 汇总报告、刷新 Study 列表并清理导入临时目录。

## 9. API

- `POST /api/patients/{patient_id}/dicom-import`
  - multipart 字段：一个或多个 `files`。
  - 成功或部分成功返回 `200 ImportReport`。
  - 未知 Patient 返回 `404 patient_not_found`。
  - 没有文件或非法 UUID 返回统一 `422`。
  - 无法创建临时目录或无法完成全局导入初始化返回 `500 persistence_error`。
- `GET /api/patients/{patient_id}/studies`
  - 返回按 Study 日期、导入时间和 UID 确定排序的 Study 摘要。
- `GET /api/studies/{study_id}/series`
  - 返回 Series 摘要和实例数量。
- `GET /api/series/{series_id}`
  - 返回 Series 元数据及按空间位置、实例号、SOP UID 确定排序的 Instance 摘要。

实例空间排序规则：当 Series 全部实例具有有效且一致的方向与位置时，计算行/列方向向量叉积得到
切片法向量，并按 `dot(ImagePositionPatient, normal)` 升序；否则按 `InstanceNumber` 升序且空值
置后，最后始终以 `SOPInstanceUID` 升序打破平局。

所有接口仅通过现有 loopback FastAPI 服务暴露。

## 10. 删除一致性

删除病人前加载其完整影像索引，并把 `data/dicom/{patient_uuid}` 原子重命名到数据目录内的删除暂存
位置。数据库级联删除提交成功后永久清理暂存目录；数据库失败时把目录恢复原位。若最终清理失败，
使用删除前快照恢复数据库索引并把目录恢复原位，然后返回失败，确保不会报告成功且不会留下
数据库指向缺失文件的状态。补偿失败属于服务器严重错误，记录技术日志但只返回稳定错误体。

## 11. 测试与验收

### 后端

- 使用 pydicom 动态生成已脱敏的小型 CT fixture，以及非 DICOM、损坏、非 CT、缺失标签、病人不匹配、
  重复 UID 和不支持传输语法文件。
- 测试五类报告、按 UID 分组、PatientID 规则、部分成功、Study 事务回滚、文件清理和重启持久化。
- 测试 Study/Series/Instance 唯一索引、外键级联和 Alembic 空库升级。
- 测试删除成功、数据库失败、目录移动失败和补偿恢复。
- 测试 OpenAPI 设计合同与 FastAPI 运行时一致。

### 前端

- 测试文件和目录入口、空选择校验、导入中禁用状态、失败后保持 dialog、成功后报告和 Study 刷新。
- 测试五类报告和逐文件原因。
- 测试 Study/Series 列表的加载、空、失败和不可查看状态。
- 所有完整页面和 dialog 持续显示完整非临床免责声明。

### 真实浏览器路径

1. 创建或选择一位病人。
2. 导入一套已脱敏真实 CT 文件夹。
3. 核对 Study、Series、实例数量和五类导入报告。
4. 重新导入同一文件夹，全部既有实例报告为重复且不增加文件。
5. 混合导入有效文件、损坏文件和非 CT 文件，确认有效数据保留且每个异常有明确原因。
6. 重启前后端，确认 Study、Series 和受管文件仍存在。
7. 删除病人并确认，核对数据库索引和 `data/dicom/{patient_uuid}` 同时消失。

## 12. 成功标准

- 真实已脱敏 CT 数据可以导入、分组、列出并跨服务重启保留。
- 五类报告之和等于输入文件数，每个非成功项都有稳定原因。
- 重复导入不产生重复数据库记录或文件。
- 文件级失败不破坏无关成功数据，Study 事务失败不留下本次新增记录或文件。
- 删除病人后索引和受管文件同时删除；任何失败不得被报告为成功。
- 病人和 DICOM 数据不离开本机，不引入查看器及其他后续 Feature。
