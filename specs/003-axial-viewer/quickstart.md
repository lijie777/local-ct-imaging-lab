# Quickstart and Acceptance Guide: 轴位 CT 查看器

## 1. Prerequisites

- Windows PowerShell，仓库根目录为 `D:\work\TestAI\TestProj`。
- 后端依赖已由 `uv sync` 安装，前端依赖已由 `npm install` 安装。
- Chrome 可用，并允许本机 WebGL 与 Web Worker。
- 验收数据必须为已脱敏的本机 CT DICOM；不得使用真实可识别病人数据。
- 使用新的独立临时数据目录，不读取或修改默认 `data/`。

## 2. Automated Verification

```powershell
cd D:\work\TestAI\TestProj\backend
uv run pytest -q

cd D:\work\TestAI\TestProj\frontend
npm test -- --run
npm run build
```

Expected:

- 后端全部 pytest 通过。
- 前端全部 Vitest/RTL 通过。
- TypeScript 检查和 Vite production build 通过。

### Baseline before 003 implementation

- 2026-07-20 backend baseline: `108 passed, 1 warning` (`StarletteDeprecationWarning`).
- 2026-07-20 frontend baseline: `16` test files, `74 passed`.
- Cornerstone3D direct dependencies are locked to `5.6.8`.
- `instance-file.openapi.yaml` parsed successfully with a one-shot YAML parser and declares only
  `http://127.0.0.1:8000`.

## 3. Isolated Runtime

选择唯一证据目录，例如：

```powershell
$evidence = Join-Path $env:TEMP 'TestProj-003-Final-20260720'
$env:MEDICAL_CT_APP_DATA_DIR = Join-Path $evidence 'data'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
```

终端 1：

```powershell
cd D:\work\TestAI\TestProj\backend
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

终端 2：

```powershell
cd D:\work\TestAI\TestProj\frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

浏览器打开 `http://127.0.0.1:5173`。确认服务没有绑定非 loopback 地址。

## 4. Prepare Viewable and Unsupported Data

1. 创建虚构病人，病历号与 fixture 的 DICOM PatientID 一致。
2. 导入至少三张同一 Study/Series、方向和尺寸一致、包含 PixelData 的已脱敏 CT DICOM。
3. 再导入一个缺失查看几何条件的 CT fixture，形成 unsupported Series。
4. 记录 Patient、Study、Series 和实例数量；不在证据中记录内部 UUID 或服务器绝对路径。

## 5. Real Chrome Acceptance

### A. Entry and default image

- [x] 病人管理页和 Study/Series 区域显示完整“教学演示软件，不用于临床诊断”。
- [x] eligible Series 有“打开轴位查看器”；unsupported Series 不可打开并显示稳定原因。
- [x] 从当前病人进入查看页不超过 3 次可见操作。
- [x] 从点击 eligible Series 打开到首张轴位影像可见不超过 5 秒。
- [x] 查看页显示 Patient 姓名/病历号、Study 描述/日期、Series 描述/实例数，不显示内部 UUID。
- [x] 具有 3 张切片时默认显示第 2 张；偶数 fixture 按 `floor(total / 2)` 规则抽查。
- [x] 当前/总切片计数正确，完整非临床提示持续可见。

### B. Slice navigation

- [x] 鼠标滚轮可向前、向后切换，图像与计数同步。
- [x] 上一张/下一张与滚轮顺序一致。
- [x] 首张时上一张禁用，末张时下一张禁用，快速连续操作不越界。
- [x] Network 中的 Series 和 DICOM 请求只访问 `127.0.0.1`，没有外部请求。

### C. Viewer tools and reset

- [x] 窗宽窗位拖动产生可见灰度变化，工具栏标识当前工具。
- [x] 平移产生可见位置变化，切片顺序不变。
- [x] 缩放产生可见比例变化，切片顺序不变。
- [x] 重置恢复初始中间切片、默认灰度、居中位置和适合视口比例。
- [x] 键盘可以到达并操作返回、切片、工具和重置按钮，焦点可见。

### D. Exit, reopen, and failures

- [x] 返回病人管理页后原病人详情和 Study/Series 列表仍可使用。
- [x] 再次打开同一 Series 不恢复上次切片、工具、平移、缩放或灰度状态。
- [x] 将一个受管 DICOM fixture 暂时移出独立数据目录后，对应请求显示文件缺失错误。
- [x] 文件缺失错误可重试或返回，页面、响应和控制台不显示绝对路径或内部堆栈。
- [x] 一个后续切片缺失或解码失败时，已成功显示的其他切片仍可通过切片控制访问，不自动跳过失败实例。
- [x] 恢复 fixture 后重试可以重新查看；数据库和其他受管文件未被修改。
- [x] 停止后端后查看页显示本机服务错误；重启后端后重试恢复。
- [x] 加载态和所有错误态持续显示完整非临床提示。

## 6. Evidence Record

### 2026-07-20 final acceptance

- Evidence directory:
  `C:\Users\lijie\AppData\Local\Temp\TestProj-003-Final-20260720-135352`.
- Backend: `119 passed, 1 warning`; the warning is the existing
  `StarletteDeprecationWarning` for FastAPI TestClient/httpx compatibility.
- Frontend: `23` test files, `115 passed`.
- Production build: PASS (`tsc --noEmit` and Vite 8.1.5, `1950` modules transformed).
  Cornerstone codec bundles still emit non-blocking browser-externalization and large-chunk warnings.
- Browser: Chrome `150.0.7871.114`, real Cornerstone canvas, Web Worker and DICOM decoding.
- First non-black image: `1679 ms`, below the `5 s` acceptance limit.
- Console: success path contained no errors; the intentional local-service abort and missing-file
  checks produced only their expected browser resource errors.
- Network: loopback only; no external request. DICOM responses used `application/dicom`; the
  missing-file recovery produced `410` followed by a new `200` after restore, with `no-store`
  preventing a stale cached 410.
- A-D acceptance: all checks PASS, including disabled unsupported Series, middle slice, buttons,
  wheel, WindowLevel, Pan, Zoom, reset, keyboard return, reopen defaults, local-service retry,
  status-specific missing-file safety message and recovery.
- Pending-load cleanup: with the first DICOM response paused, returning to patient management
  produced `net::ERR_ABORTED`, removed the viewer canvas and produced no Console error.
- Screenshots: `01-patient-management.png`, `02-import-report.png`, `03-viewer-default.png`,
  `04-viewer-tools-reset.png`, `05-missing-file-error.png`, `06-recovered-viewer.png`.
- Cleanup: temporary backend/frontend processes stopped; `127.0.0.1:8000` and
  `127.0.0.1:5173` confirmed with no listener.
