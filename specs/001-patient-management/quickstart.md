# Quickstart and Validation: 病人管理

> 教学演示软件，不用于临床诊断。本指南只使用虚构病人数据，不得录入真实患者信息。

本文件是实现完成后的运行、测试和浏览器验收指南，不包含实现代码，也不替代 `tasks.md`。

## Prerequisites

- Windows PowerShell
- `uv`，用于安装和锁定 Python 3.12 环境
- Node.js 24.15.x 与 npm 11.12.x
- 本机现代浏览器
- 后端端口 `127.0.0.1:8000` 和前端端口 `127.0.0.1:5173` 可用

检查工具：

```powershell
uv --version
node --version
npm --version
```

以下当前命令均从仓库根目录开始执行。

## Backend Setup

```powershell
cd backend
uv python install 3.12
uv sync --locked --group dev
uv run alembic upgrade head
uv run python -m pytest -q -p no:cacheprovider
```

预期：

- Python 环境固定在 3.12；
- Alembic 将空数据库升级到当前 head；
- pytest 的字段校验、规范化唯一性、搜索、稳定排序、CRUD、失败回滚和重启持久化测试全部通过；
- 测试数据库位于 pytest `tmp_path`，不会写入正式运行数据库。

启动本机 API：

```powershell
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

默认运行数据库：

```text
data\patient-management.sqlite3
```

需要使用其他本机运行目录时，在启动前设置：

```powershell
$env:MEDICAL_CT_APP_DATA_DIR = 'D:\path\to\local-runtime-data'
```

验证 API 可达：

```powershell
Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:8000/api/patients'
```

预期：首次运行返回空数组 `[]`。

## Frontend Setup

打开新的 PowerShell：

```powershell
cd frontend
npm ci
npm run test -- --run
npm run build
npm run dev -- --host 127.0.0.1
```

预期：

- Vitest 与 React Testing Library 测试全部通过；
- 生产构建成功；
- Vite 将相对 `/api` 请求代理到 `http://127.0.0.1:8000`；
- 浏览器访问 `http://127.0.0.1:5173`；
- 页面不需要登录、外网或任何外部服务。

## Contract Verification

设计合同：

```text
specs/001-patient-management/contracts/openapi.yaml
```

运行时入口：

- OpenAPI JSON：`http://127.0.0.1:8000/openapi.json`
- Swagger UI：`http://127.0.0.1:8000/docs`

合同测试必须验证：

- 五个 Patient 路径和方法均存在；
- `201/200/204/404/409/422/500` 与设计合同一致；
- `PatientRead` 包含内部 `id` 供 API 调用，但 UI 不显示；
- API 不返回 `medical_record_no_normalized`；
- 错误体包含稳定 `code`、`message` 和 `field_errors`；
- 合同中没有 DICOM、PACS、登录或云端接口。

## Automated Test Boundaries

### Backend pytest

- 病历号/姓名 trim、长度、控制字符和内部格式保留；
- `strip().casefold()` 唯一性及数据库唯一索引；
- 性别枚举、默认 unknown、出生日期边界；
- 查询中的 `%`、`_`、内部空格和符号；
- `updated_at DESC, medical_record_no_normalized ASC` 稳定排序；
- `422/404/409/500` 错误映射；
- flush/commit 失败回滚；
- 关闭并重建 app/engine 后创建和编辑仍存在、删除不恢复；
- Alembic 从空文件升级到 head；
- FastAPI OpenAPI 与设计合同的关键语义一致。

### Frontend Vitest/RTL

- 列表、空状态、搜索结果、无结果、加载、错误和详情均显示完整免责声明；
- 创建、编辑、删除 dialog 内重复完整免责声明；
- 前端即时校验与字段错误可访问关联；
- 后端 `422/409/500` 后表单仍打开并保留全部输入；
- 成功或明确取消后才清除草稿；
- 详情显示八项用户信息，不显示 UUID；
- 性别中文映射、UTC 时间显示、检查数量 0、最近检查日期为空；
- 删除取消不发送 DELETE，删除失败不提前移除病人；
- 搜索清除、旧请求取消和服务器排序保持。

自动化测试不得声称已经验证真实浏览器 CSS 遮挡、原生 dialog top layer 或真实服务重启路径；这些
由下一节的浏览器验收完成。

## Browser Acceptance Record

> 以下 evidence 路径是历史本机验收记录，使用 `%TEMP%` 表示当时的用户临时目录；证据文件不随仓库分发。

实现完成后，按 `spec.md` 的八步路径在真实浏览器中逐项执行。不要用组件测试结果代填“实际结果”。

### Environment

| 项目 | 记录值 |
| --- | --- |
| 执行日期 | 2026-07-17（Asia/Shanghai） |
| 执行人 | Codex；Chrome DevTools 真实浏览器验收 |
| Git commit SHA 或未提交状态 | 未提交；仓库尚无首个 commit |
| Python / uv 版本 | Python 3.12.13 / uv 0.11.28 |
| Node / npm 版本 | Node.js v24.15.0 / npm 11.12.1 |
| 浏览器及版本 | Chrome 150.0.0.0；viewport 1080 × 1309；devicePixelRatio 1 |
| SQLite 实际路径 | `%TEMP%\TestProj-T057-Final-20260717-174325\data\patient-management.sqlite3` |

### MVP Browser Checkpoint (T032)

执行前自动化基线：后端 `51 passed`；前端 `42 passed`；Vite production build 成功。

| 步骤 | 实际结果 | Pass/Fail | 证据/截图路径 |
| --- | --- | --- | --- |
| 打开空病人列表 | 页面标题为“病人管理教学演示”；显示完整免责声明、空状态和创建入口；页面无 UUID | Pass | `%TEMP%\TestProj-T032-Final-20260717-170234\01-empty-list.png` |
| 打开创建界面并创建虚构病人 | 原生 dialog 打开后焦点进入病历号输入框，dialog 内重复完整免责声明；POST 返回 201 和 `Location` header | Pass | `%TEMP%\TestProj-T032-Final-20260717-170234\02-create-dialog.png`、`03-created-details.png` |
| 查看病人详情 | 显示病历号、姓名、性别、出生日期、检查数量 0、最近检查日期空值、创建时间和最近更新时间；UUID 不可见；关闭 dialog 后焦点恢复到创建按钮 | Pass | `%TEMP%\TestProj-T032-Final-20260717-170234\03-created-details.png` |
| 重启后端并刷新 | 后端 PID 从 44524 变为 62752；使用同一 SQLite 文件；API 和浏览器重新读到 `MR-T032-FINAL`、`虚构病人验收` 和 `1990-05-20` | Pass | `%TEMP%\TestProj-T032-Final-20260717-170234\04-restart-persistence.png` |

浏览器请求只访问 `127.0.0.1:5173`、Vite 代理的 `/api`、`127.0.0.1:8000` 和内联 `data:`
资源。控制台没有业务运行异常；存在一个非阻塞 `favicon.ico` 404，以及 Chrome 对表单字段缺少
`id`/`name` 的开发者提示。Chrome DevTools 的 `fill_form` 未对原生日期输入触发 React `onChange`，
验收中补发标准 `input`/`change` 事件，并通过最终 POST 请求体确认
`birth_date: "1990-05-20"` 已实际提交。

### Search and Edit Browser Checkpoint (T044)

执行前自动化基线：后端 `58 passed`；前端 `58 passed`；Vite production build 成功。使用两位
预置虚构病人，SQLite 路径为
`%TEMP%\TestProj-T044-Final-20260717-172211\data\patient-management.sqlite3`。

| 步骤 | 实际结果 | Pass/Fail | 证据/截图路径 |
| --- | --- | --- | --- |
| 搜索虚构病人 | 输入首尾带空格且大小写不同的 `alpha`，只返回 `Alpha Patient / MR-US2-ALPHA`；`Beta Patient` 不在结果中；免责声明持续可见 | Pass | `%TEMP%\TestProj-T044-Final-20260717-172211\01-search-result.png` |
| 编辑成功 | 编辑 dialog 载入原始字段并重复完整免责声明；将姓名改为 `Alpha Updated` 后，列表和详情均使用服务器返回值更新 | Pass | `%TEMP%\TestProj-T044-Final-20260717-172211\02-edit-success.png` |
| 失败输入保留 | 将病历号改为与 `MR-US2-BETA` 等价的 `  mr-us2-beta  ` 并把姓名改为 `Draft Retained`；PATCH 返回 409，dialog 保持打开，字段草稿、字段错误和重复免责声明全部保留 | Pass | `%TEMP%\TestProj-T044-Final-20260717-172211\03-failure-draft-retained.png` |
| 重启后端后保留编辑 | 后端 PID 从 48852 变为 31120；使用同一 SQLite 文件；刷新后搜索 `updated` 仍只返回 `Alpha Updated / MR-US2-ALPHA`，页面无 UUID | Pass | `%TEMP%\TestProj-T044-Final-20260717-172211\04-restart-persistence.png` |

控制台中的 409 是本 checkpoint 主动制造的病历号冲突；未出现未解释的业务运行异常。浏览器请求
仍限定在 loopback 地址和内联资源。

### Delete Browser Checkpoint (T054)

执行前自动化基线：后端 `63 passed`；前端 `63 passed`；Vite production build 成功。使用一位
预置虚构病人，SQLite 路径为
`%TEMP%\TestProj-T054-Final-20260717-173553\data\patient-management.sqlite3`。

| 步骤 | 实际结果 | Pass/Fail | 证据/截图路径 |
| --- | --- | --- | --- |
| 删除确认与取消 | dialog 显示姓名、病历号、不可恢复后果和重复完整免责声明；初始焦点位于“取消”；取消后焦点恢复到删除按钮，网络记录中没有 DELETE | Pass | `%TEMP%\TestProj-T054-Final-20260717-173553\01-delete-confirm.png` |
| 删除失败保护 | 打开确认 dialog 后停止后端，DELETE 经 Vite 代理返回 502；dialog 和病人信息保持，页面未提前移除病人，错误信息和两处免责声明可见；恢复后端后 API 仍有该病人 | Pass | `%TEMP%\TestProj-T054-Final-20260717-173553\02-delete-failure-protected.png` |
| 删除成功 | 恢复后端后再次确认，DELETE 返回 204 且无响应体；成功响应后列表和详情才被移除，页面回到空状态 | Pass | `%TEMP%\TestProj-T054-Final-20260717-173553\03-delete-success.png` |
| 重启后不恢复 | 后端 PID 从 44524 变为 60288；使用同一 SQLite 文件；重启后 API 返回 0 条，刷新浏览器仍为空状态且页面无 UUID | Pass | `%TEMP%\TestProj-T054-Final-20260717-173553\04-delete-restart-empty.png` |

控制台中的 502 是本 checkpoint 为验证删除失败保护而主动停止后端产生的预期结果；除此之外未出现
未解释的业务运行异常。

### Eight-step acceptance path

最终验收使用 `http://127.0.0.1:5173/`，FastAPI 绑定 `127.0.0.1:8000`，独立 SQLite
文件为
`%TEMP%\TestProj-T057-Final-20260717-174325\data\patient-management.sqlite3`。
内置 Browser 因当前会话的浏览器运行时元数据不完整而无法初始化；经用户同意，真实浏览器步骤改用
Chrome DevTools 执行。证据统一保存在
`%TEMP%\TestProj-T057-Final-20260717-174325`。

| 步骤 | 操作 | 预期结果 | 实际结果 | Pass/Fail | 证据/截图路径 |
| --- | --- | --- | --- | --- | --- |
| 1 | 打开空病人列表 | 顶部显示完整免责声明；空状态和创建入口可见 | 新数据库首次加载显示“暂无病人，请创建第一位虚构病人。”，创建入口和完整免责声明可见，控制台无 error/warn | Pass | `01-empty-list.png` |
| 2 | 打开创建覆盖界面并创建虚构病人 | dialog 内重复免责声明；成功后列表显示填写字段、检查数量 0、最近检查日期为空 | 创建 dialog 初始焦点进入病历号；纯空白提交显示两个必填错误且没有发出 POST；填写 `MR-E2E-001 / E2E Patient / 男` 后 POST 返回 201，列表显示检查数量 0 和空最近检查日期 | Pass | `02-created.png`；`backend.stdout.log` |
| 3 | 打开病人详情 | 显示病历号、姓名、性别、出生日期、检查数量、最近检查日期、创建时间、最近更新时间；UUID 不显示 | 八项用户信息全部显示；出生日期和最近检查日期为空值；页面文本未出现内部 UUID | Pass | `03-details.png` |
| 4 | 按病历号或姓名子串搜索并编辑 | 搜索结果正确且横幅可见；编辑 dialog 重复横幅；合法修改成功保存 | 以首尾空白且大小写不同的 `e2e patient` 搜索只返回目标；编辑为 `E2E Patient Updated` 后 PATCH 返回 200，列表和详情同步更新 | Pass | `04-edit-success.png`；`backend.stdout.log` |
| 5 | 停止并重新启动后端，刷新浏览器 | 搜索到修改后的病人，字段保持不变 | 后端 PID 从 60820 变为 49528；继续使用同一 SQLite；刷新后搜索 `MR-E2E` 仍返回修改后的姓名和原字段 | Pass | `05-restart-persistence.png`；`uvicorn-restart-1.stdout.log` |
| 6 | 发起删除并取消 | 删除确认显示姓名、病历号和后果，重复免责声明；取消后病人仍存在 | dialog 显示姓名、病历号、不可恢复后果和完整免责声明；初始焦点位于取消；取消后焦点恢复到删除按钮，网络记录中无 DELETE | Pass | `06-delete-cancel.png` |
| 7 | 再次发起并确认删除 | 返回成功后病人从列表、搜索结果和详情入口消失 | 再次确认后 DELETE 返回 204；成功响应后才移除列表和详情，当前搜索转为无结果 | Pass | `07-delete-success.png`；`uvicorn-restart-1.stdout.log` |
| 8 | 再次停止并重新启动后端 | 被删除的病人没有恢复 | 后端 PID 从 49528 变为 62152；API 返回 0 条，刷新浏览器仍为空状态，被删除病人未恢复 | Pass | `08-final-restart.png`；`uvicorn-restart-2.stdout.log` |

### SC-009 stable ordering

为三位病人的 `updated_at` 写入同一固定值 `2026-07-17 10:00:00.000000`。记
`A=c0dc52b0-129c-46f0-bf53-b91afc8265c4`、
`B=841407f4-82ab-4d60-bd77-47e80971325f`、
`C=f95348c7-e03a-40c7-aceb-4afa4c0cb298`，分别对应 `MR-SORT-A/B/C`。

| 检查点 | 完整列表 Patient ID 顺序 | 搜索 `Sort Patient` Patient ID 顺序 | 页面可见顺序 | 结果 |
| --- | --- | --- | --- | --- |
| 首次加载 | `A, B, C` | `A, B, C` | `MR-SORT-A, MR-SORT-B, MR-SORT-C` | Pass |
| 页面刷新 | `A, B, C` | `A, B, C` | `MR-SORT-A, MR-SORT-B, MR-SORT-C` | Pass |
| 后端重启（PID 62152 → 53404） | `A, B, C` | `A, B, C` | `MR-SORT-A, MR-SORT-B, MR-SORT-C` | Pass |

三次完整列表和搜索结果顺序完全一致，且与双键排序
`updated_at DESC, medical_record_no_normalized ASC` 相符。

### Failure and boundary checks

在自动化测试通过的前提下，浏览器中至少抽查：

- 纯空白或超长字段显示具体字段错误；
- 与已有病历号仅大小写或首尾空白不同的输入返回冲突；
- 未来出生日期被拒绝；
- 失败后 dialog 和全部输入保持；
- 搜索无结果、加载和操作失败状态仍显示完整免责声明；
- 所有覆盖式界面中免责声明清晰可见。

实际补查结果：

| 检查项 | 实际结果 | 证据 | 结果 |
| --- | --- | --- | --- |
| 纯空白字段 | 创建 dialog 保持打开，病历号和姓名分别显示“此字段为必填项”，无 POST | 本轮浏览器 a11y snapshot | Pass |
| 未来出生日期与草稿保留 | 标准 `input/change` 事件写入 `2027-01-01` 后，显示“出生日期不得晚于今天”；病历号、姓名和日期草稿全部保留 | `10-future-date-validation.png` | Pass |
| casefold 冲突与失败草稿 | 病历号仅大小写/首尾空白不同返回 409，编辑 dialog、全部输入和免责声明保持 | `%TEMP%\TestProj-T044-Final-20260717-172211\03-failure-draft-retained.png` | Pass |
| 搜索无结果 | 删除成功后当前搜索显示“未找到匹配的病人”，顶部免责声明仍可见 | `07-delete-success.png` | Pass |
| 加载状态 | 已加载页面启用 Slow 3G 后提交搜索，显示“正在搜索病人…”且顶部免责声明持续可见 | `09-slow3g-loading.png` | Pass |
| 操作失败 | 主动停止后端使删除返回 502；dialog、病人数据、错误信息和两处免责声明保持 | `%TEMP%\TestProj-T054-Final-20260717-173553\02-delete-failure-protected.png` | Pass |
| 全部页面状态与 dialog 的免责声明 | 病人列表、空列表、搜索结果、搜索无结果、加载/操作失败、详情及创建/编辑/删除 dialog 均显示完整文本“教学演示软件，不用于临床诊断” | T032、T044、T054 checkpoint 与本轮 `01`–`10` 截图 | Pass |
| UUID 与网络边界 | 页面文本无 UUID；浏览器资源和 REST 请求仅访问 `127.0.0.1:5173`（由 Vite 代理到 `127.0.0.1:8000`），无非 loopback 请求 | Chrome DevTools DOM、Network、Performance entries | Pass |
| 本地存储与禁止范围 | 运行数据只写入上述本地 SQLite；实现源码和依赖清单中未出现 DICOM、Cornerstone3D、PACS、DICOMweb、登录、认证、云服务、测量、报告或 3D 功能 | SQLite 实际路径与实现源码定向检索 | Pass |

### Overall result

| 项目 | 结果 |
| --- | --- |
| 自动化测试 | Pass：后端 `63 passed, 1 warning`；前端 `10 test files / 63 tests passed`；Vite production build 成功。warning 为 Starlette/httpx deprecation，不影响功能 |
| 八步浏览器路径 | Pass：八步均由真实 Chrome 页面执行并留存截图/服务日志；SC-009 三轮顺序一致 |
| 失败/边界抽查 | Pass：字段校验、冲突草稿保留、无结果、Slow 3G 加载态、删除 502 保护及三个 dialog 均有证据 |
| Constitution 非临床与本地数据边界 | Pass：免责声明完整，页面无 UUID，请求仅 loopback，数据仅本地 SQLite，未实现禁止范围 |
| 总体结论 | Pass：Feature 验收完成，未触发 Stop Conditions |

## Stop Conditions

出现以下任一情况时不得声明 Feature 完成：

- 后端或前端测试失败；
- 任一 Checklist 存在未勾选项；
- 页面或覆盖式界面缺少完整免责声明；
- UUID 在用户界面中可见；
- 创建/编辑失败后丢失输入；
- 删除取消或持久化失败后病人被移除；
- 服务重启后已保存数据丢失或已删除病人恢复；
- 数据发送到 loopback 之外的地址；
- 实现中出现 DICOM、Cornerstone3D、PACS、登录或云服务代码。
