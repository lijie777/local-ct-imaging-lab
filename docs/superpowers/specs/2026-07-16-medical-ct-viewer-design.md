# 本地医疗CT病人管理与三视图预览系统设计

## 1. 设计目标

本项目用于完整体验 GitHub Spec Kit 从需求规格到实现的工作流。最终成果是一个仅在本机运行的教学型 Web 应用，支持：

- 病人基本信息管理；
- 导入真实 CT DICOM 文件；
- 自动识别检查、序列和实例；
- 轴位、冠状位、矢状位三视图；
- 三视图十字定位线联动；
- 窗宽窗位、缩放、平移、滚轮翻页和复位；
- 重启服务后继续访问已保存的病人与影像。

系统必须在所有主要页面明确标注：

> 教学演示软件，不用于临床诊断。

## 2. 第一版范围

### 2.1 包含

- 单机、单用户、本地离线运行；
- 浏览器操作界面；
- 病人创建、编辑、搜索和删除；
- 病历号唯一性校验；
- 本地 DICOM 文件或文件夹导入；
- 使用 DICOM UID 自动组织 Study、Series 和 Instance；
- CT 体数据构建和三视图 MPR；
- 常用二维影像交互工具；
- SQLite 元数据持久化；
- 原始 DICOM 文件的本地受管存储；
- 明确区分导入成功、重复、跳过、不支持和失败的报告。

### 2.2 不包含

- 用户登录、角色权限和多用户并发；
- 云端上传与远程访问；
- PACS、Orthanc 和标准 DICOMweb；
- 诊断报告和电子病历；
- 长度、角度、面积等测量标注；
- 三维体绘制和表面重建；
- 医疗设备注册、合规认证和临床使用；
- 与医院 HIS、RIS 或其他业务系统对接。

## 3. 总体架构

系统采用本地前后端分离架构：

```text
浏览器
├── React + TypeScript + Vite
├── 病人管理
├── 检查与序列浏览
└── Cornerstone3D 三视图查看器
          │
          │ HTTP
          ↓
本机 FastAPI
├── Patient API
├── DICOM Import Service
├── Image API
└── pydicom 元数据解析
          │
          ├── SQLite 元数据
          └── 本地 DICOM 文件
```

### 3.1 前端职责

- 展示和编辑病人信息；
- 展示病人的检查和序列；
- 选择本地 DICOM 文件并上传到本机后端；
- 使用 Cornerstone3D 构建 CT volume；
- 显示轴位、冠状位和矢状位；
- 管理影像交互工具与三视图同步；
- 展示导入过程、导入报告和错误信息。

### 3.2 后端职责

- 校验并保存病人数据；
- 接收 DICOM 文件；
- 使用 pydicom 读取标签；
- 按 StudyInstanceUID、SeriesInstanceUID 和 SOPInstanceUID 组织数据；
- 检测病人不匹配、重复实例、损坏文件和不支持格式；
- 将 DICOM 文件复制到受管目录；
- 将结构化索引写入 SQLite；
- 为 Cornerstone3D 提供序列元数据和 DICOM 实例文件。

### 3.3 存储职责

SQLite 只保存结构化信息和文件路径，不保存 DICOM 像素数据。

原始文件保存在：

```text
data/
└── dicom/
    └── {patient_uuid}/
        └── {study_instance_uid}/
            └── {series_instance_uid}/
                └── {sop_instance_uid}.dcm
```

## 4. 页面与交互

### 4.1 病人管理页

页面包含：

- 按姓名或病历号搜索；
- 新建病人；
- 病人列表；
- 当前病人的基本信息；
- 当前病人的检查记录；
- 导入 DICOM 入口；
- 编辑和删除操作。

病人列表至少显示：

- 病历号；
- 姓名；
- 性别；
- 出生日期；
- 检查数量；
- 最近检查日期。

删除病人属于危险操作，必须二次确认。删除后同步删除其检查、序列、实例索引和受管 DICOM 文件。

### 4.2 CT三视图页

页面包含：

- 返回病人页入口；
- 当前病人、检查和序列信息；
- 序列选择面板；
- 轴位、冠状位、矢状位三个 viewport；
- DICOM 关键标签面板；
- 影像工具栏。

第一版工具栏包含：

- 窗宽窗位；
- 平移；
- 缩放；
- 滚轮翻页；
- 视图复位；
- 十字定位线显示与隐藏。

三视图使用同一个 CT volume。任意 viewport 中的定位点变化必须同步到另外两个 viewport。

## 5. 数据模型

### 5.1 Patient

| 字段 | 规则 |
| --- | --- |
| `id` | 内部 UUID，主键 |
| `medical_record_no` | 用户输入，唯一且必填 |
| `name` | 必填 |
| `sex` | 可选标准值，缺省为未知 |
| `birth_date` | 可选日期 |
| `created_at` | 创建时间 |
| `updated_at` | 最后更新时间 |

### 5.2 Study

| 字段 | 规则 |
| --- | --- |
| `id` | 内部 UUID，主键 |
| `study_instance_uid` | 来自 DICOM，全局唯一 |
| `patient_id` | 关联 Patient |
| `study_date` | 可为空 |
| `description` | 可为空 |
| `accession_number` | 可为空 |

### 5.3 Series

| 字段 | 规则 |
| --- | --- |
| `id` | 内部 UUID，主键 |
| `series_instance_uid` | 来自 DICOM，全局唯一 |
| `study_id` | 关联 Study |
| `modality` | 第一版必须为 CT |
| `series_number` | 可为空 |
| `description` | 可为空 |
| `slice_thickness` | 可为空 |
| `instance_count` | 成功导入的实例数量 |
| `view_status` | 可查看或不可查看 |

### 5.4 Instance

| 字段 | 规则 |
| --- | --- |
| `id` | 内部 UUID，主键 |
| `sop_instance_uid` | 来自 DICOM，全局唯一 |
| `series_id` | 关联 Series |
| `instance_number` | 可为空 |
| `file_path` | 受管目录中的相对路径 |
| `rows`、`columns` | 图像尺寸 |
| `image_position_patient` | 用于空间排序和 MPR |
| `image_orientation_patient` | 用于空间方向 |

关系为：

```text
Patient 1 ── N Study 1 ── N Series 1 ── N Instance
```

## 6. DICOM导入流程

1. 用户在某个病人下选择 DICOM 文件或文件夹。
2. 后端将上传内容放入本次导入的临时目录。
3. pydicom 逐文件读取标签。
4. 非 DICOM、损坏文件和非 CT 实例进入失败或跳过清单。
5. 有效实例按 StudyInstanceUID 和 SeriesInstanceUID 分组。
6. 后端比较 DICOM PatientID 与当前病人病历号。
7. 病人标识冲突时停止对应文件组的导入，并明确提示。
8. SOPInstanceUID 已存在时作为重复文件跳过。
9. 文件复制到受管目录，并写入 SQLite 索引。
10. 后端返回成功、重复、跳过、不支持和失败的逐项统计。

### 6.1 部分失败规则

- 单个文件损坏不影响其他有效文件导入；
- 成功文件可以提交，失败文件必须出现在报告中；
- 如果数据库事务提交失败，本次新写入的数据库记录全部回滚；
- 数据库事务失败后，清理由本次导入新复制的受管文件；
- 已在之前导入成功的文件不得因本次失败而删除。

### 6.2 MPR可用条件

序列必须至少满足：

- Modality 为 CT；
- 包含多个具有一致 Rows 和 Columns 的实例；
- 具有可用于空间排序的 ImagePositionPatient；
- 具有可解释方向的 ImageOrientationPatient；
- Cornerstone3D 支持对应传输语法和像素数据。

不满足条件的序列可以保留元数据，但必须标记为“不可查看”，并说明原因。

## 7. API边界

第一版提供以下本地 API：

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/patients` | 查询和搜索病人 |
| `POST /api/patients` | 创建病人 |
| `GET /api/patients/{id}` | 获取病人详情和检查摘要 |
| `PATCH /api/patients/{id}` | 编辑病人 |
| `DELETE /api/patients/{id}` | 删除病人及受管数据 |
| `POST /api/patients/{id}/dicom-import` | 导入 DICOM 文件 |
| `GET /api/patients/{id}/studies` | 获取病人的检查 |
| `GET /api/studies/{id}/series` | 获取检查中的序列 |
| `GET /api/series/{id}` | 获取序列元数据和实例清单 |
| `GET /api/instances/{id}/file` | 读取单个 DICOM 实例 |

所有接口只监听本机地址，不提供公网访问。

## 8. 错误处理

| 场景 | 系统行为 |
| --- | --- |
| 病历号重复 | 拒绝创建或修改，并标明冲突字段 |
| 非 DICOM 文件 | 跳过，记录文件名和原因 |
| 损坏 DICOM | 跳过，记录解析错误 |
| 非 CT 模态 | 跳过，说明第一版只支持 CT |
| 病人标识不匹配 | 阻止对应文件组导入 |
| SOPInstanceUID 重复 | 不重复复制，计入重复数量 |
| 不支持的传输语法 | 保留可读取元数据，序列标记为不可查看 |
| 文件复制失败 | 不写入对应实例记录 |
| 数据库提交失败 | 回滚记录并清理本次新复制文件 |
| 查看器加载失败 | 保留病人和检查信息，显示具体失败原因 |

错误提示必须面向普通用户描述结果，同时在后端日志中保留技术细节。

## 9. 验证策略

### 9.1 后端单元测试

- 病历号唯一性和字段校验；
- DICOM 标签读取；
- Study、Series 和 Instance 分组；
- SOPInstanceUID 重复检测；
- 病人标识匹配；
- 受管文件路径生成；
- 部分失败和事务回滚。

### 9.2 后端集成测试

- 创建病人后导入一套真实 CT 序列；
- 查询 Study、Series 和 Instance；
- 重复导入同一序列；
- 混合导入有效、损坏和非 DICOM 文件；
- 删除病人并检查数据库和文件系统同步清理。

### 9.3 前端测试

- 病人创建、编辑、搜索和删除确认；
- 检查与序列列表展示；
- 导入进度和导入报告；
- 查看器初始化；
- 工具切换与视图复位；
- 错误提示和不可查看序列状态。

### 9.4 端到端验收

完整路径必须通过：

```text
创建病人
→ 导入真实CT DICOM
→ 查看检查和序列
→ 打开三视图
→ 调整窗宽窗位
→ 在任意视图改变定位点
→ 另外两个视图同步
→ 重启服务
→ 再次打开同一病人和CT
```

## 10. 成功标准

当以下条件全部满足时，第一版视为完成：

1. 普通用户能够创建和找到病人；
2. 能导入至少一套真实 CT DICOM 序列；
3. 导入结果能够正确区分成功、重复、跳过、不支持和失败；
4. 检查和序列能够按 DICOM UID 正确组织；
5. 轴位、冠状位和矢状位能够显示同一 CT 体数据；
6. 三视图定位能够同步；
7. 窗宽窗位、缩放、平移、翻页和复位可用；
8. 重启服务后数据仍然存在；
9. 删除病人时数据库和受管文件保持一致；
10. 应用明确声明不用于临床诊断。

## 11. 已确认的设计决策

- 采用本地前后端 Web 架构，不制作桌面端；
- 使用真实 DICOM CT 文件；
- 第一版支持三视图 MPR 和联动；
- 前端使用 React、TypeScript、Vite 和 Cornerstone3D；
- 后端使用 Python、FastAPI 和 pydicom；
- 元数据使用 SQLite；
- 原始 DICOM 保存在本地受管目录；
- 第一版不引入 PACS、Orthanc、DICOMweb、登录和三维体绘制。
