# Research: 查看器状态持久化

## 存储形态

- **Decision**: 每个 Series 一行 SQLite 记录，独立 `schema_version` 与 JSON payload，使用
  完整快照 PUT。
- **Rationale**: Series 外键可级联清理；JSON 适配相机/annotation 演进；单用户无需差量合并。
- **Alternatives considered**: `localStorage` 会产生孤儿和浏览器缓存依赖；逐字段关系表过度拆分。

## Cornerstone 相机状态

- **Decision**: 只捕获公开 `getViewPresentation()`/`setViewPresentation()` 与
  `getProperties()`/`setProperties()` 的 allowlist 字段，切片单独保存。
- **Rationale**: 避免序列化 vtk 内部相机、actor、DOM 或不可移植对象。
- **Alternatives considered**: 原样保存 `getCamera()`；字段更接近内部实现且包含不需要的值。

## Annotation 恢复

- **Decision**: 将四类 annotation 转成受限 DTO；恢复时调用 Cornerstone
  `utilities.annotationHydration()` 重新建立当前 viewport metadata，再设置安全 label/textBox，
  标记 invalidated 以重算统计并触发 annotation render。DTO 必须保存当前 Series 的
  `referenced_image_id`，恢复前重新核对 identity；MPR capture 使用 annotation 与 viewport 的
  `viewPlaneNormal`/`viewUp` 确定三视图归属。真实 MPR volume annotation 只有 `volumeId` 时，
  使用当前 Series 首个 image ID 作为稳定 membership anchor；已有真实 identity 时严格验证，
  不匹配则跳过。hydrate 后把持久化 identity 写回 runtime metadata，避免恢复后的 annotation
  在下一次保存时丢失。
- **Rationale**: 比 `restoreAnnotations()` 覆盖全局 manager 更安全，可排除 Crosshairs、未知
  工具、旧 image ID 和内部字段；方向匹配可避免共享 Frame of Reference 时把冠状/矢状标注
  误记到轴位。
- **Alternatives considered**: 保存/恢复完整 annotation manager；会覆盖其他 runtime state 并
  信任任意嵌套对象。

## MPR Crosshairs

- **Decision**: 保存工具的有限 `toolCenter` 和可见性；恢复使用公开 `setToolCenter()`，不保存
  Crosshairs annotation。
- **Rationale**: Crosshairs 是 MPR runtime 控制状态，Feature 005 已明确禁止作为普通标注清理。
- **Alternatives considered**: 从相机交点重新推导；无法保证恢复用户最后明确定位。

## 写入调度

- **Decision**: 500 ms trailing debounce、单 Series last-write-wins、一次只发送一个 PUT；有新
  快照时在当前请求结束后立即发送最新值。第 501 条 annotation 使本地 codec 拒绝整份快照，
  不发送 PUT。页面进入 hidden 时先普通 flush；`pagehide` 再使用 keepalive fallback，但 PUT
  body 大于 60 KiB 时自动退回普通 fetch。若 hidden 的普通请求仍在进行且失败，pagehide
  fallback 使用自己的 keepalive 选项重试已回队的最新快照。DELETE 使用 keepalive 并由
  flush/destroy 跟踪等待。
- **Rationale**: 控制 CAMERA/VOI 高频事件，同时不会丢失最终完整快照。
- **Alternatives considered**: 每事件 PUT 会造成写放大；固定 interval 会延迟并产生空闲写入。

## 恢复顺序

- **Decision**: 验证 payload → 完成影像/volume 初始化 → 应用切片与 view presentation/VOI →
  应用 Crosshairs → hydrate annotations → 激活工具 → 开启 capture。
- **Rationale**: Cornerstone 需要目标影像、volume 和 tool group 已存在；抑制中间事件反写。
- **Alternatives considered**: runtime 创建前恢复；目标 viewport 尚不存在，无法安全 hydrate。
