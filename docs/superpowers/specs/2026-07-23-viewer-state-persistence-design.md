# 查看器状态持久化设计

## 背景与范围

Feature 006 为同一 CT Series 保存并恢复轴位、三视图 MPR、测量和箭头标注状态。
状态必须跨页面退出、浏览器刷新和本机服务重启保留，并在 Series 删除时一并删除。
本功能不加入账户、云同步、PACS、DICOMweb、报告、后台导入或三维渲染。

## 方案选择

采用后端 SQLite 作为唯一状态源。每个 Series 最多对应一份版本化状态，通过本机 API
读取、覆盖和删除。相较 `localStorage`，该方案可随 Series 级联清理、统一校验并跨浏览器
缓存清理保留；相较逐字段关系模型，版本化 JSON 更适合 Cornerstone 相机和 annotation
结构，且避免为每个渲染字段建立数据库列。

## 数据边界

新增 `viewer_states` 表，主键和外键均为 `series_id`，删除 Series 时级联删除。记录包含：

- `schema_version`：首版固定为 `1`。
- `payload`：轴位状态、MPR 状态和允许类型 annotation 的安全 JSON。
- `created_at`、`updated_at`：本机状态写入时间。

payload 最大 2 MiB，annotation 最多 500 条。所有数值必须有限；向量长度、工具名称、
视图名称、文字长度和对象键均使用 allowlist 校验。禁止保存 DOM、函数、错误对象、加载进度、
Crosshairs annotation、任意原型字段或未识别 Cornerstone 对象。

## 持久化状态

轴位状态包含当前切片索引、活动工具、相机显示状态和灰度显示状态。MPR 状态包含活动视图、
活动工具、Crosshairs 可见性和世界坐标、三个 viewport 的相机状态，以及同步灰度状态。
annotation 只允许 `Length`、`Angle`、`RectangleROI` 和 `ArrowAnnotate`，保存工具 metadata、
世界坐标 handles、文字和恢复渲染所需的受限统计字段；不保存 Feature 005 的对话框状态。

## API 合同

- `GET /api/series/{series_id}/viewer-state`：Series 存在但无状态时返回 `200 null`；有状态时
  返回版本、payload 和时间戳。
- `PUT /api/series/{series_id}/viewer-state`：完整替换当前 Series 状态并返回保存后的记录；
  相同请求幂等，最后一次有效写入生效。
- `DELETE /api/series/{series_id}/viewer-state`：幂等清除状态并返回 `204`。

未知 Series 返回安全的 `404 series_not_found`；版本、结构、大小或数值无效返回安全的
`422 viewer_state_invalid`；数据库异常返回 `500 persistence_error`，响应不得泄露路径、
SQL 或堆栈。

## 前端数据流

查看器先并行读取 Series 详情和已保存状态，再创建 runtime。影像完成必要加载后，runtime
先应用切片/相机/灰度/Crosshairs，再 hydrate 允许的 annotation，最后启用状态采集，避免
“恢复动作”反写半完成状态。

切片、工具、相机、灰度、Crosshairs 和 annotation 变化经过 500 ms debounce 后发送完整
快照；同一 Series 只允许最新快照覆盖旧快照。页面进入 hidden 时先用普通请求 flush；
`pagehide` 仅对不超过 60 KiB 的 PUT body 使用 keepalive fallback，更大的合法快照继续使用
普通请求。若普通请求失败，fallback 使用自己的选项重试已回队快照。保存失败不阻止查看和
编辑，页面通过 `aria-live` 显示“状态保存失败，当前调整仅在本次会话有效”，后续变化继续
重试。2 MiB 上限只作用于 `state`，不作用于包含 Series ID 和时间戳的 response envelope。

读取失败、版本不兼容或 payload 无效时，查看器使用安全默认状态正常打开并显示可重试提示；
不得把无效数据传入 Cornerstone。既有“重置”操作恢复 Feature 003/004 默认值、清除四类
annotation，并删除该 Series 的持久化状态；成功后显示“已恢复默认状态并清除保存”。

## 生命周期与并发

状态以 Series UUID 隔离，切换 Series 不得串用状态。单用户下采用 last-write-wins，无需
锁版本或冲突 UI。销毁 runtime 前先生成最终快照，之后移除监听和 annotation；失败请求不
保留对已销毁 viewport 的引用。删除 Patient/Study/Series 依赖数据库外键级联清理状态。

## 测试与验收

- 后端：迁移、模型约束、GET/PUT/DELETE、幂等覆盖、404/422/500、安全响应、级联删除和
  重启持久化。
- 前端纯函数：版本与 JSON 校验、有限数值、allowlist、2 MiB/500 条边界、旧版本降级。
- runtime：轴位和 MPR capture/apply 顺序、annotation 安全序列化/hydrate、Crosshairs
  排除、恢复期间抑制写入、debounce/flush 和失败重试。
- 真实浏览器：修改轴位与 MPR、创建四类 annotation、退出/刷新/重启后恢复；重置后再次
  进入恢复默认；损坏状态不阻止影像；所有请求保持 loopback，非临床提示持续可见。

## 排除项

不保存登录用户偏好、书签、最近查看列表、深链接、截图、报告、DICOM 修改、跨设备同步、
撤销历史、后台导入进度、分割、3D、MIP 或表面重建。
