# Data Model: 查看器状态持久化

## ViewerState 数据库实体

- `series_id: UUID`：主键，也是指向 `series.id` 的级联删除外键。
- `schema_version: int`：首版只接受 `1`。
- `payload: JSON object`：`ViewerStatePayload`，序列化后最大 2 MiB。
- `created_at`, `updated_at`: UTC-naive 本机存储时间，满足 `created_at <= updated_at`。
- 关系：Series `1 -> 0..1` ViewerState。

## ViewerStatePayload

- `axial: AxialState | null`
- `mpr: MprState | null`
- `annotations: PersistedAnnotation[]`，最多 500 条。
- 未识别键、非 JSON 值和非有限 number 均拒绝。

## AxialState

- `image_index: non-negative integer`
- `active_tool`: 既有轴位与 annotation 工具 allowlist
- `presentation`: 可选 zoom、pan、rotation、flip 值
- `voi`: 可选 lower/upper/invert，lower < upper

恢复时 `image_index` 夹取到当前 Series 边界；不可用的几何工具回退为 `windowLevel`。

## MprState

- `active_viewport`: `axial | coronal | sagittal`
- `active_tool`: 既有 MPR 与 annotation 工具 allowlist
- `crosshairs_visible: boolean`
- `crosshairs_position: Point3`
- `viewports`: 三个 viewport 各自的 `presentation` 与 `voi`

恢复顺序固定为 viewport presentation/VOI、Crosshairs、活动工具。

## PersistedAnnotation

- `viewport`: `axial | coronal | sagittal`
- `tool_name`: `Length | Angle | RectangleROI | ArrowAnnotate`
- `referenced_image_id`: 1–2048 字符、无控制字符；捕获时必须属于当前 Series 的 `imageIds`，
  恢复时若已不存在则跳过该条并计入 partial restore。MPR volume annotation 若 runtime 仅有
  `volumeId` 而没有真实 `referencedImageId`，使用当前 Series 首个 image ID 作为稳定 membership
  anchor；若 runtime 已提供 identity，则仍必须严格验证其属于当前 Series，不得用 anchor 替换
  一个明确但错误的 identity。hydrate 后把持久化 identity 写回 runtime metadata，供下一次
  完整快照继续捕获。
- `points`: Point3 数组；Length/Arrow 为 2，Angle 为 3，Rectangle ROI 为 4。
- `label`: 仅 Arrow 可用，trim 后 1–200 字符且无控制字符。
- `text_box`: 可选 `has_moved`、`world_position`、四角 `world_bounding_box`。

不保存 UID、Crosshairs、cached statistics、选择/高亮/锁定、DOM、callback 或错误状态；hydrate
后由 Cornerstone 生成新 UID 和 metadata，并重新计算统计。MPR 三个元素共享
`FrameOfReferenceUID` 时，捕获使用 annotation 的 `viewPlaneNormal`/`viewUp` 与 viewport 方向
匹配归属；不能唯一匹配时安全跳过，不把冠状位或矢状位误记为轴位。

## 状态转换

```text
missing -> valid saved -> overwritten valid -> deleted
                   \-> save failure (database remains previous valid)
invalid response -> ignored default (runtime remains usable)
over-limit capture -> local validation error (no PUT, previous valid remains)
missing image identity -> annotation skipped (other state still restored)
```
