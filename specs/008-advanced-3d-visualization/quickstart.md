# Quickstart and Acceptance Guide: 高级 3D 可视化

## 1. Prerequisites

- Windows PowerShell；命令从仓库根目录执行。
- Node `24.15.x`、npm `11.12.x`、Python `3.12.x`、uv、Chrome。
- 验收数据为已脱敏本机 CT DICOM，至少两个不同空间位置，具有完整像素、尺寸、spacing、position 和 orientation。
- 使用新的独立临时数据目录，不读取或修改默认 `data/`。
- Browser 插件若仍因会话 `sandboxPolicy` 元数据问题不可用，沿已批准 fallback 使用 Chrome DevTools 或临时
  Playwright；不要反复调用同一失败 browser surface。

## 2. Automated Verification

```powershell
Push-Location frontend
npm test -- --run src/features/advanced-3d-viewer src/features/axial-viewer/pages/AxialViewerPage.test.tsx
npm test -- --run
npm run build
Pop-Location

Push-Location backend
uv run python -m pytest -q -p no:cacheprovider
Pop-Location

git diff --check HEAD
```

Expected:

- 高级 3D 目标测试通过。
- 前端全量 Vitest/RTL、TypeScript noEmit 和 production build 通过。
- 后端 Feature 005–007 回归通过；Feature 008 无后端产品代码和迁移。
- diff 无 whitespace error。

## 3. Isolated Production Runtime

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidence = Join-Path $env:TEMP "local-ct-imaging-lab-e2e-008-$stamp"
$env:MEDICAL_CT_APP_DATA_DIR = Join-Path $evidence 'data'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null

Push-Location frontend
npm run build
Pop-Location

Push-Location backend
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8892
Pop-Location
```

打开 `http://127.0.0.1:8892/`。FastAPI 必须直接托管 `frontend/dist`，只存在一个后端进程。

停止时先使用 `Get-NetTCPConnection -LocalPort 8892 -State Listen` 确认 owner PID，只停止该 PID。

## 4. Acceptance Data

1. 创建虚构 Patient，病历号与 fixture DICOM PatientID 一致。
2. 导入一个满足高级 3D 条件的 CT Series；记录实例数、dimensions、spacing、scalar range 和 volume voxel 数。
3. 准备一个单位置或缺几何 Series 用于 blocked 入口。
4. 准备 missing-file 恢复方法，不把绝对路径写进 UI 截图。
5. 若主 fixture surface 采样不触发 stride，另准备 synthetic 大 dimensions adapter test；production 浏览器只需记录
   当前真实 fixture 是否触发采样提示，不伪造临床数据。

## 5. Real Chrome Acceptance

### A. Entry, safety, and default volume

- [X] 病人管理、轴位页和高级 3D 页持续显示完整非临床提示。
- [X] eligible Series 同时显示可用“进入三视图”和“进入高级 3D”。
- [X] blocked Series 解释原因，轴位可用，两个高级入口按各自合同禁用。
- [X] 进入 3D 时重新 GET Series；删除/变为 unsupported 后不创建 volume。
- [X] 页面显示允许的 Patient/Study/Series 摘要，不显示内部 ID、UID 或路径。
- [X] 默认模式为体绘制、骨 preset、前方视角，画面非黑且首屏 ≤10 秒。
- [X] rotate/pan/zoom 可用；reset 恢复默认相机、骨 preset 和完整体范围。

### B. Volume presets and MIP

- [X] 骨、软组织、肺三个 preset 都产生可观察变化，且无新 DICOM 请求。
- [X] MIP 切换 ≤2 秒，模式文字和 pressed 状态正确。
- [X] 前方、后方、左侧、右侧、头侧、足侧六方向可重复选择。
- [X] 自由旋转后可再次用方向按钮恢复标准视角。
- [X] 默认 thickness 覆盖完整体数据；至少两个较小毫米值产生可观察变化。
- [X] 超出范围的 number 输入被限制到合法值。
- [X] 从 MIP 返回 volume 恢复最后选择的 volume preset。

### C. Surface reconstruction

- [X] 首次 surface 准备 300 HU；若范围不含 300，准备并显示中点；点击“应用阈值”后才开始计算。
- [X] building 状态在计算前可见，模式和阈值冲突控件禁用。
- [X] 默认阈值生成真实着色几何表面，支持同一相机 rotate/pan/zoom。
- [X] 第二个有效阈值替换表面并产生可观察几何差异。
- [X] 空结果显示“该阈值未生成可见表面”，可调整后恢复。
- [X] 若 stride >1，显示采样提示且表面物理位置/方向与 volume 一致。
- [X] 表面失败后 volume 和 MIP 仍可切换，不需要重新下载 Series。
- [X] surface ready 后执行 reset 会销毁 surface，并恢复 volume、骨 preset、前方视角、完整 thickness 和默认阈值。
- [X] 标准验收数据每次 ready/empty/error 在 15 秒内返回。

### D. Failures, accessibility, and layout

- [X] missing file 显示安全 410 语义；恢复文件后 retry 成功。
- [X] 停止 8892 owner 后显示本机服务错误；重启同一数据目录后 retry 成功。
- [X] decode/volume/render 原始错误不显示 codec、ID、URL、路径或堆栈。
- [X] 1280×900 为 viewport + 控制侧栏；820×900 纵向可滚动且无遮挡。
- [X] Tab 可到达返回、模式、preset、方向、thickness、threshold、应用、reset、viewport。
- [X] pressed、busy、empty 和 error 均有非颜色文字表达，焦点清晰。

### E. Cleanup, restart, and locality

- [X] loading 中返回会 abort DICOM 请求，页面无晚到错误。
- [X] surface building 前/后快速切换、返回和 retry 不让旧结果覆盖新状态。
- [X] 连续三次进入/退出后仍可完成三个模式，不出现资源上限导致的黑屏或失败。
- [X] 返回后轴位可用；再次进入恢复默认 volume/bone/anterior，而非上次状态。
- [X] 停止并重启 FastAPI 后，同一持久化 Patient/Series 可重新构建 3D。
- [X] Network 100% loopback；成功路径 Console 无未处理 error。
- [X] 记录 Chrome 版本、首屏时间、两次 surface 时间、截图、Network、Console 和 evidence directory。

## 6. Evidence Record

完成后追加：

```text
Evidence directory: %LOCALAPPDATA%\Temp\local-ct-imaging-lab-e2e-008-20260724-091216
Acceptance data: 64×64×24, spacing 1×1×1.5 mm, scalar range -1000..1500 HU, 24 slices
Backend full regression: 268 passed, 1 existing StarletteDeprecationWarning, 77.12 s
Frontend targeted/full regression: runtime+viewport 53 passed; full 52 files / 451 tests passed
Production build: passed, 1989 modules transformed
Alembic empty database: 004_create_import_jobs (head)
Chrome version: 150.0.0.0, Windows 1280×900 and 820×900
Default volume first-visible time: approximately 1059 ms on the first production entry; final cached check approximately 711 ms
MIP switch: approximately 255 ms; 1/10/30/95.54187563576508 mm produced distinct canvas hashes
Surface threshold/time 1: 300 HU, approximately 45-67 ms, ready
Surface threshold/time 2: 800 HU, approximately 42 ms, ready with distinct geometry
Surface empty/error: -1000 HU returned empty; injected scalar-read failure returned safe error and recovered
Sampling stride: 1; production fixture correctly showed no downsampling notice
Console: final successful path contained no error or warning
Network: 100% http://127.0.0.1:8892 or same-origin blob; no external request
1280x900 / 820x900: passed; resize remained non-black and no horizontal overflow
Failure recovery: missing-file 410 retry approximately 1075 ms; stopped-service retry approximately 849 ms
Repeated cleanup: three enter/exit cycles passed; final cycle completed volume, MIP, and surface
Restart persistence: Patient E2E008 and both Series remained available after same-data-directory FastAPI restart
Screenshots: volume-bone-final-1280x900.png, volume-bone-resize-fixed-final-820x900.png, surface-300-1280x900.png
Port-owner cleanup: stopped final 8892 owner PID 8988; no listener remained; moved DICOM file was restored
```

Production acceptance also found and fixed three regressions before completion: responsive resize could produce an all-black
canvas, Cornerstone initialization changed the viewport to `tabindex="-1"`, and a same-frame surface-build/MIP switch could
leave controls permanently busy. Each issue has an automated regression test and was reverified in the production bundle.

只有自动化、build 和 A–E 全部通过后，才把 `spec.md` 状态改为 `Complete` 并勾选全部 `tasks.md`。
