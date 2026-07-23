# Quickstart: DICOM 导入与持久化验证

## Purpose

本指南用于验证 `002-dicom-import` 的自动化测试和真实浏览器路径。只使用已脱敏或测试生成的 CT
DICOM 文件。不要将真实患者数据放入仓库、截图或日志。

## Prerequisites

- Windows 10/11
- Python 3.12 与 uv
- Node.js 与 npm
- 一套至少 50 个实例的已脱敏 CT 数据，PatientID 可与测试病历号匹配
- 本机端口 `127.0.0.1:8000`、`127.0.0.1:5173` 可用

以下当前命令均从仓库根目录开始执行。

## Install and migrate

```powershell
$env:MEDICAL_CT_APP_DATA_DIR = Join-Path (Get-Location) 'data'
Set-Location backend
uv sync --locked --group dev
uv run alembic upgrade head
```

预期：数据库升级到 `002_create_dicom_index`，创建 Study、Series 和 Instance 索引表；
`data/dicom/` 由首次成功导入按需创建。

## Automated tests

### Backend

```powershell
Set-Location backend
uv run python -m pytest -q -p no:cacheprovider
```

必须覆盖：

- 动态已脱敏 CT fixture 和不解码像素的元数据读取；
- 五类结果与计数恒等式；
- PatientID、UID、非 CT、损坏、缺失标签和不支持条件；
- 重复导入、按 Study 部分成功、事务回滚和当前操作文件清理；
- Study/Series/Instance 查询、排序和 Patient 动态检查摘要；
- Alembic 空库升级、外键级联和设计/运行时 OpenAPI 一致性；
- 病人删除的目录暂存、提交失败恢复、清除失败补偿和重启不恢复。

### Frontend

```powershell
Set-Location frontend
npm ci
npm test -- --run
npm run build
```

必须覆盖：

- 文件/目录选择、空选择、导入中状态、焦点和完整免责声明；
- multipart 请求、错误映射、失败保留、成功清理和刷新；
- 五类报告及非成功原因；
- Study/Series 加载、空、失败、排序和不支持状态；
- 现有 Patient 创建、搜索、编辑和删除行为回归。

## Run locally

### Backend

```powershell
$env:MEDICAL_CT_APP_DATA_DIR = Join-Path (Get-Location) 'data'
Set-Location backend
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Frontend

```powershell
Set-Location frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

打开 `http://127.0.0.1:5173/`。

## Contract

设计合同：`specs/002-dicom-import/contracts/openapi.yaml`

运行时入口：

- OpenAPI JSON：`http://127.0.0.1:8000/openapi.json`
- Swagger UI：`http://127.0.0.1:8000/docs`

合同不得包含外部服务器、认证、PACS、DICOMweb、查看器、测量、报告或 3D 接口。

## Browser acceptance record

> 以下 evidence 路径是历史本机验收记录，使用 `%TEMP%` 表示当时的用户临时目录；证据文件不随仓库分发。

### US1 checkpoint（2026-07-20）

- 浏览器路径：Chrome DevTools fallback，原因是 in-app Browser 初始化失败：
  `codex/sandbox-state-meta: missing field 'sandboxPolicy'`。
- URL / viewport：`http://127.0.0.1:5173/`，1440 × 1000；前后端仅监听
  `127.0.0.1:5173` 与 `127.0.0.1:8000`。
- 临时数据根：`%TEMP%\TestProj-002-US1-20260720`。
- Patient：`MR-DICOM-US1 / DICOM 验收病人`；初始检查数 0，导入 dialog 内重复显示完整免责声明。
- Fixture：动态生成的 50 个已脱敏 CT 实例，同一 Study / Series；浏览器原生多文件输入显示已选择 50 个文件。
- 首次导入报告：Total 50，Success 50，Duplicate 0，Skipped 0，Unsupported 0，Failed 0。
- 导入后页面：检查数量 1，最近检查日期 `2026-07-20`，Study 1，Series 1，Instance 50，
  Series 显示“可供后续查看”。
- SQLite / 文件核对：`patients=1`、`studies=1`、`series=1`、`instances=50`，受管 `.dcm` 50 个。
- 后端重启并刷新浏览器后，上述 Patient 摘要、Study、Series 和 Instance 数量保持不变。
- DOM 核对：免责声明可见，不显示 UUID 或 Windows 绝对路径；Network 记录仅包含 loopback 与内联资源。
- Console 仅有无关的 `favicon.ico 404`，无 React、Vite 或业务运行错误。
- 证据：`01-initial.png`、`02-import-selected.png`、`03-import-report.png`、
  `04-study-list.png`、`05-after-restart.png`，以及同目录 backend/frontend 日志。

### US2 checkpoint（2026-07-20）

- 浏览器：独立 Chrome DevTools context，`http://127.0.0.1:5173/`；数据根为
  `%TEMP%\TestProj-002-US2-20260720`。
- 首次批次：3 个有效 CT，报告 `3 success / 0 duplicate / 0 skipped / 0 unsupported / 0 failed`；
  对应数据库 `1 Study / 1 Series / 3 Instances`，受管文件 3 个。
- 完全重复批次：同 3 个文件报告 `0 success / 3 duplicate / 0 skipped / 0 unsupported / 0 failed`；
  明细代码均为 `duplicate_sop_instance_uid`，对应实例和受管副本未增加。
- 混合批次：有效 CT、损坏 DICOM、非 CT、PatientID 不匹配和缺少几何的 CT 各 1 个；报告
  `1 success / 0 duplicate / 2 skipped / 1 unsupported / 1 failed`，Total 5 与五类合计一致。
- 混合明细：损坏为 `damaged_dicom`，非 CT 为 `non_ct_modality`，病人不匹配为
  `patient_mismatch`，缺少几何为 `missing_geometry`；文件名、中文原因和稳定代码均可展开查看。
- 混合批次后数据库为 `3 Studies / 3 Series / 5 Instances`，受管文件 5 个；再次重复初始批次前后
  均保持 5 Instances / 5 files，证明重复导入不增长；成功和不支持数据均保留。
- 证据：`01-duplicate-report.png`、`02-mixed-report.png` 和同目录 backend/frontend 日志。

### US3 checkpoint（2026-07-20）

- 数据与页面延续 US2 临时环境；后端重启到最新代码后执行删除取消、确认和重启不恢复。
- 删除 dialog 重复显示完整免责声明，并明确说明将同步删除病人、检查、序列、实例索引和受管
  DICOM 文件；取消后 Patient、Study 列表和不支持原因继续可见。
- 取消前后数据库保持 `1 Patient / 3 Studies / 3 Series / 5 Instances`，受管文件保持 5 个。
- 确认删除后页面进入空病人状态；数据库 `patients/studies/series/instances` 均为 0，受管 `.dcm`
  和病人目录均为 0。
- 再次重启后端并新开浏览器后仍显示空病人状态，删除的病人和影像数据未恢复；免责声明可见，
  DOM 不显示 UUID 或绝对路径，所有网络请求仅访问 loopback 或内联资源。
- Chrome DevTools 在删除 dialog 截图阶段传输中断（`Transport closed`），后半段使用本机已有
  `puppeteer-core` 启动隔离 Chrome 完成，未安装新依赖，也未以 API/组件测试代替页面交互。
- 证据：`03-delete-dialog-puppeteer.png`、`04-after-delete-cancel.png`、
  `05-after-delete-success.png`、`06-after-delete-restart.png` 和同目录 backend/frontend 日志。

### Environment

| 项目 | 记录值 |
| --- | --- |
| 执行日期 | 2026-07-20 |
| 执行人 | Codex |
| Git commit SHA 或未提交状态 | `002-dicom-import`，仓库尚无首个 commit，全部为未提交状态 |
| Python / uv 版本 | Python 3.12.13 / uv 0.11.28 |
| Node / npm 版本 | Node v24.15.0 / npm 11.12.1 |
| 浏览器及 viewport | Chrome 150.0.7871.114，1440 × 1000；in-app Browser 失败后使用本机既有 `puppeteer-core` 隔离 Chrome |
| SQLite 实际路径 | `%TEMP%\TestProj-002-Final-20260720\data\patient-management.sqlite3` |
| 受管 DICOM 根目录 | `%TEMP%\TestProj-002-Final-20260720\data\dicom` |
| 已脱敏 fixture 来源与实例数 | `backend/tests/dicom_factory.py` 动态生成；首次 50 个 CT，混合批次 5 个文件 |

### Complete acceptance path

| 步骤 | 操作 | 预期结果 | 实际结果 | Pass/Fail | 证据路径 |
| --- | --- | --- | --- | --- | --- |
| 1 | 创建或选择 PatientID 匹配的病人 | 页面和详情显示完整免责声明；初始检查数为 0 | 创建 `MR-DICOM-FINAL / 最终 DICOM 验收病人`；免责声明可见，检查数 0 | PASS | `01-patient-created.png` |
| 2 | 打开导入 dialog 并选择已脱敏 CT 文件夹 | dialog 重复免责声明，显示当前病人和已选文件数 | 文件夹入口可见；通过同一 multipart `files` 字段的原生多文件入口选择目录内 50 个文件，dialog 显示病人和 50 | PASS | `02-initial-selected.png` |
| 3 | 完成首次导入 | 五类之和等于文件数；有效 Study/Series 出现；检查数和最近日期更新 | 50 success；1 Study / 1 Series / 50 Instances / 50 files；检查数 1，日期 `2026-07-20` | PASS | `03-initial-report.png`、`04-initial-study.png` |
| 4 | 重新导入同一文件夹 | 既有实例全部为 duplicate；数据库和受管文件数不增加 | 50 duplicate，代码 `duplicate_sop_instance_uid`；初始 Study 仍为 50 Instances，无新受管副本 | PASS | `05-duplicate-report.png` |
| 5 | 混合导入有效、损坏和非 CT 文件 | 无关有效数据保留；异常文件分别显示类别和原因 | `1 success / 2 skipped / 1 unsupported / 1 failed`；四个非成功原因和代码可展开；最终 3 Studies / 52 Instances / 52 files | PASS | `06-mixed-report.png` |
| 6 | 重启前后端并刷新 | Patient 摘要、Study、Series、Instance 数量和不支持原因保持 | 重启后检查数 3、初始 50 Instances、`missing_geometry` 和 52 个文件保持 | PASS | `07-after-restart.png` |
| 7 | 发起删除后取消 | 数据库索引和受管目录保持不变 | dialog 重复免责声明且说明影像清理；取消未发 DELETE，仍为 1/3/3/52 和 52 files | PASS | `08-delete-dialog.png` |
| 8 | 再次确认删除并重启 | Patient、影像索引和该病人受管目录全部消失且不恢复 | DELETE 204；四表、`.dcm`、病人目录和 staging 均为 0；重启后仍为空 | PASS | `09-delete-success.png`、`10-after-delete-restart.png` |

### Five-category accounting

| 导入批次 | Total | Success | Duplicate | Skipped | Unsupported | Failed | 合计一致 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 首次真实 CT | 50 | 50 | 0 | 0 | 0 | 0 | PASS |
| 完全重复导入 | 50 | 0 | 50 | 0 | 0 | 0 | PASS |
| 混合异常导入 | 5 | 1 | 0 | 2 | 1 | 1 | PASS |

### Boundary checks

- 浏览器、API、日志和受管文件中不出现未脱敏患者数据。
- 所有网络请求只访问 loopback 地址和内联资源。
- UI 不显示 UUID、绝对受管路径、数据库错误或堆栈。
- 导入 dialog、报告、检查/序列列表及加载、空、失败状态显示完整免责声明。
- 失败 Study 无本次新增数据库记录或受管文件残留。
- 删除取消零变更；删除成功后数据库和受管目录都不存在。
- 实现中没有 Cornerstone3D 初始化、查看器、MPR、PACS、DICOMweb、登录、云、测量、报告或 3D。

最终源码与运行边界复核（2026-07-20）：生产源码和依赖中未发现上述越界能力；`http://` 配置仅有
`127.0.0.1:5173 → 127.0.0.1:8000` 与运行时 loopback server；公共 schema、API 和前端不包含
`managed_path` 或 `file_size`；最终验收结束时 `.imports`、`.delete-staging` 和受管 DICOM 文件数均为 0。

### Overall result

| 项目 | 结果 |
| --- | --- |
| 后端自动化测试 | PASS：108 passed，1 个 Starlette/httpx 弃用警告，无功能失败 |
| 前端自动化测试和 build | PASS：16 suites / 74 tests；TypeScript 与 Vite production build 通过 |
| 五类报告与部分失败 | PASS：三批计数恒等；异常原因/代码可见；故障注入验证失败 Study 零残留 |
| 重启持久化 | PASS：删除前重启保持 3 Studies / 52 Instances / 52 files |
| 删除一致性 | PASS：取消零变更；确认后数据库、受管目录和 staging 为 0；重启不恢复 |
| 非临床与本地数据边界 | PASS：页面/dialog 提示可见；DOM 无 UUID/绝对路径；页面请求仅 loopback/内联资源 |
| 总体结论 | PASS：`002-dicom-import` 完整验收通过 |

## Stop conditions

出现以下任一情况时不得声明 Feature 完成：

- 自动化测试或 build 失败；
- 任一 Checklist 存在未勾选项；
- 五类计数之和不等于输入文件数或异常项没有原因；
- 重复导入新增记录或受管文件；
- 失败 Study 留下本次新增记录或文件，或删除失败造成数据库/文件不一致；
- 重启后成功数据丢失或已删除数据恢复；
- 数据发送到 loopback 之外；
- 页面或 dialog 缺少完整免责声明，或 UI 泄露绝对路径；
- 实现越界加入查看器、MPR、PACS、DICOMweb、登录、云、测量、报告或 3D。
