# Quickstart and Acceptance Guide: 联动 CT 三视图 MPR

## 1. Prerequisites

- Windows PowerShell；以下当前命令均从仓库根目录开始执行。
- 后端依赖已安装，前端已安装 Cornerstone3D 5.6.8 三个现有直接依赖。
- Chrome 支持 WebGL 与 Web Worker。
- 验收数据必须为已脱敏、本机 CT DICOM；至少三张，具有 PixelSpacing、ImagePositionPatient、
  ImageOrientationPatient、Rows、Columns 和 PixelData。
- 使用新的独立临时数据目录，不读取或修改默认 `data/`。

## 2. Automated Verification

```powershell
Push-Location backend
uv run python -m pytest -q -p no:cacheprovider
Pop-Location

Push-Location frontend
npm ci
npm test -- --run
npm run build
Pop-Location
```

Expected:

- 后端全量 pytest 通过。
- 前端全量 Vitest/RTL 通过。
- TypeScript 检查和 Vite production build 通过。
- 本功能不增加后端代码、数据库迁移或 npm 直接依赖。

### Baseline before 004 implementation

- 003 final backend: `119 passed, 1 warning`；warning 为既有 `StarletteDeprecationWarning`。
- 003 follow-up frontend: `23` test files, `115 passed`。
- 003 production build: PASS，`1950` modules transformed；Cornerstone externalization 和大 chunk warning
  为已知非阻断项。
- 003 真实 DICOM/Chrome 证据：
  `%TEMP%\TestProj-003-Final-20260720-135352`。

## 3. Isolated Runtime

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidence = Join-Path $env:TEMP "TestProj-004-Final-$stamp"
$env:MEDICAL_CT_APP_DATA_DIR = Join-Path $evidence 'data'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
```

终端 1：

```powershell
Set-Location backend
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

终端 2：

```powershell
Set-Location frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

浏览器打开 `http://127.0.0.1:5173`。确认 8000/5173 只监听 loopback。

## 4. Prepare Acceptance Data

1. 创建虚构病人，病历号与已脱敏 fixture 的 DICOM PatientID 一致。
2. 导入至少三张同一 Study/Series、方向和尺寸一致、空间位置不同且包含 PixelData 的 CT DICOM。
3. 准备一个单切片或重复位置 Series，用于 MPR eligibility 阻止场景。
4. 记录可见 Patient/Study/Series 摘要和实例数；证据不记录内部 UUID、DICOM UID 或服务器路径。
5. 导入后保存 fixture 在独立 data directory 中的恢复方式，用于 missing-file 验收。

## 5. Real Chrome Acceptance

> 以下 evidence 路径是历史本机验收记录，使用 `%TEMP%` 表示当时的用户临时目录；证据文件不随仓库分发。

### A. Entry, eligibility, and default views

- [x] 病人管理、轴位页、MPR 页、加载和错误状态均显示完整“教学演示软件，不用于临床诊断”。
- [x] eligible 多位置 Series 的轴位页显示可用“进入三视图”，一次可见操作进入。
- [x] 单切片/重复位置 Series 显示“至少需要两个不同空间位置的切片”，MPR 按钮禁用且轴位可用。
- [x] 进入 MPR 时重新请求 Series 详情；已删除/变为 unsupported 的 Series 不创建 volume。
- [x] 三视图页显示 Patient/Study/Series、Modality、Rows × Columns、实例数和可用 spacing，不显示内部 ID。
- [x] 轴位、冠状位、矢状位三个 viewport 均显示非黑影像，初始 linked position 位于 volume 中心。
- [x] 从进入 MPR 到三个非黑 viewport 可见不超过 8 秒。

### B. Linked position and orientation

- [x] 三个 viewport 显示正确中文名称、病人方向标记、位置和活动状态文字。
- [x] 在轴位拖动 Crosshairs，冠状位和矢状位画面/位置同步。
- [x] 在冠状位拖动或滚动，轴位和矢状位同步。
- [x] 在矢状位拖动或滚动，轴位和冠状位同步。
- [x] 快速连续滚动/拖动不越界，最终三个位置一致且 Console 无错误。
- [x] 点击或聚焦每个 viewport，工具栏“当前视图”文字同步更新。

### C. Tools, visibility, reset, and layout

- [x] Crosshairs、WindowLevel、Pan、Zoom 四个主工具互斥且 active 状态清晰。
- [x] 任一 viewport 调整 WindowLevel 后，三个 viewport 灰度一致变化。
- [x] Pan 只移动活动 viewport；另两个 viewport 相机不被同步。
- [x] Zoom 只缩放活动 viewport；另两个 viewport 相机不被同步。
- [x] 隐藏十字线后三个视图都不显示线，当前位置保留；重新显示回到该位置。
- [x] 重置恢复中心位置、三相机、默认 VOI、可见十字线、Crosshairs 工具和 axial active。
- [x] 桌面为二乘二；窄屏依次显示三视图和元数据，SafetyBanner/工具/返回不被遮挡。
- [x] 键盘可操作返回、工具、显隐、重置、重试并聚焦三个 viewport，焦点清晰。

### D. Return, retry, and safe failures

- [x] 返回轴位查看器后原上下文和轴位浏览可用；再次进入不恢复上次 MPR 状态。
- [x] 暂时移除一个受管 DICOM 文件后，MPR 显示本机文件缺失，不泄露路径并可重试/返回。
- [x] 恢复文件后重试创建全新 runtime/volume，三视图恢复。
- [x] 停止后端后进入/重试显示本机服务错误；重启后端后重试恢复。
- [x] 模拟 decode/volume/render 失败时只显示安全“无法构建三视图”，无 codec/ID/URL/堆栈。
- [x] 失败和重试不修改数据库、Instance 顺序和其他受管文件。

### E. Cleanup, locality, restart, and final evidence

- [x] 在首批 DICOM 请求仍 pending 时返回轴位页，请求被 abort，MPR canvas 数量归零且无后续错误。
- [x] 多次进入/退出后没有重复 tool、listener、volume ID 或 WebGL context 泄漏导致的功能失败。
- [x] Network 只访问 `127.0.0.1`；DICOM 为 `application/dicom`，没有外部请求。
- [x] 成功路径 Console 无 error；预期 missing/service/abort 只产生对应资源错误。
- [x] 重启前后端后重新打开同一持久化 Patient/Series，三视图仍可构建且默认状态正确。
- [x] 记录 Chrome 版本、首屏耗时、Console、Network、截图和 evidence directory。
- [x] 停止临时服务并确认 `127.0.0.1:8000`、`127.0.0.1:5173` 无监听。

## 6. Evidence Record

真实证据按下方 US1、US2、US3、final 和 pre-publication 分阶段保存；记录字段包括 evidence directory、
自动化、build、Chrome、耗时、Console、Network、A-E、pending cleanup、screenshots 和 cleanup。

### US1 checkpoint: T033-T034 (2026-07-21)

```text
Evidence directory: %TEMP%\TestProj-004-US1-20260721-103403
Frontend full regression: 28 test files, 177 tests passed
Targeted runtime regression: 1 test file, 10 tests passed
Production build: PASS, 1957 modules transformed
Chrome: 150.0.7871.114, system Chrome, headless Playwright fallback
Browser availability: Browser plugin invocation previously failed because the tool layer omitted sandboxPolicy metadata
Main browser acceptance: 31/31 passed
First three-view image time: 306 ms
Initial linked position: all three 1.0, 1.0, 2.0 mm
Axial Crosshairs: all three 0.8, 0.7, 2.0 mm
Coronal wheel: all three 0.8, 0.0, 2.0 mm
Sagittal reverse wheel: all three 0.0, 1.0, 2.0 mm
Console: 0 errors; existing repeated WebGL-context warnings recorded for later cleanup validation
Network: 0 external requests; 6 DICOM responses, all application/dicom
Return to axial: PASS
Checkpoint cleanup: 127.0.0.1:8000 and 127.0.0.1:5173 listeners stopped
Screenshots: 01-single-slice-disabled.png, 02-mpr-default.png, 03-mpr-linked.png,
             04-returned-axial.png, 05-sagittal-linked.png
Deferred A-B items: deleted/unsupported revalidation, rapid continuous interaction, loading/error banner states;
                    these remain unchecked for their later story/final acceptance tasks
```

### US2 checkpoint: T050-T052 (2026-07-21)

```text
Evidence directory: %TEMP%\TestProj-004-US2-20260721-131713
Browser availability: Browser plugin invocation previously failed because the tool layer omitted sandboxPolicy metadata;
                      reused the existing temporary Playwright installation without adding a dependency
Targeted US2 regression: 5 test files, 31 tests passed
Frontend full regression: 30 test files, 191 tests passed
Production build: PASS, 1958 modules transformed; existing Cornerstone externalization and large chunk warnings only
Chrome: 150.0.7871.114, system Chrome, headless Playwright fallback
Browser acceptance: 29/29 passed
Tools: Crosshairs, WindowLevel, Pan, and Zoom remained mutually exclusive
Shared VOI: all three viewport canvas hashes changed after axial WindowLevel interaction
Independent cameras: Pan changed only coronal; Zoom changed only sagittal
Crosshairs visibility: SVG line counts changed from [4,4,4] to [0,0,0]; linked position was preserved
Reset: restored 1.0, 1.0, 2.0 mm center, axial active, Crosshairs visible/active,
       and the exact initial VOI/camera canvas hashes
Layout: desktop two-by-two at 1440 × 1000; four items stacked vertically at 800 × 1000
Keyboard: Tab order reached six toolbar controls then axial, coronal, and sagittal viewports;
          Space and Enter activated tool buttons; viewport focus outline was visible
Runtime accessibility fix: Cornerstone changed viewport tabIndex to -1 and prevented native Tab;
                           runtime now restores tabIndex=0 and preserves native Tab navigation with cleanup
Console: 0 errors, 0 warnings
Network: 0 external requests
Screenshots: 01-window-level-synchronized.png, 02-crosshairs-hidden.png,
             03-reset-default.png, 04-narrow-layout.png
```

### US3 checkpoint: T067-T068 (2026-07-21)

```text
Evidence directory: %TEMP%\TestProj-004-US3-20260721-134928
Targeted US3 regression: 5 test files, 73 tests passed
Frontend full regression: 30 test files, 219 tests passed
Production build: PASS, 1958 modules transformed; existing Cornerstone externalization and large chunk warnings only
Chrome: 150.0.7871.114, system Chrome, headless Playwright fallback
Browser acceptance: 19/19 passed
Missing file: backend responses [410,200,200,200,200]; UI showed the approved safe missing-file message,
              preserved Instance order and managed-file count, and recovered after restoring the file
Runtime error fix: Cornerstone emitted XMLHttpRequest status 410 correctly; MprViewportGrid had overwritten the
                   approved rejected runtime message with the generic fallback, and now preserves only allowlisted messages
Service recovery: stopped backend produced the approved local-service error; restarted backend rebuilt the same Series
Pending cleanup: a fresh Browser context forced an uncached DICOM request; return removed all MPR state and the request
                 was aborted or safely discarded without a late UI error
Repeated cleanup: three consecutive enter/return cycles remained functional
Console: 0 unexpected errors; expected injected resource errors were one 410 and one Vite-proxy 502
         Repeated multi-context stress produced WebGL context-limit warnings, but all cleanup cycles remained functional;
         final isolated A-E acceptance must record the clean-run warning count separately
Network: 0 external requests; loopback-only PASS
Screenshots: 01-single-slice-blocked.png, 02-missing-file.png, 03-missing-file-recovered.png,
             04-service-stopped.png, 05-service-recovered.png, 06-returned-after-cleanup-cycles.png
```

### Final automated verification: T071-T073 (2026-07-21)

```text
Backend: 119 passed, 1 warning in 19.37s
Backend warning: existing StarletteDeprecationWarning from fastapi.testclient/httpx compatibility
Frontend: 30 test files, 219 tests passed
Production build: PASS, TypeScript noEmit PASS, Vite 8.1.5, 1958 modules transformed
Build warnings: existing Cornerstone codec Node-module externalization and large chunk warnings; non-blocking
Dependency check: no backend product change, database migration, or new npm direct dependency
```

### Final isolated A-E acceptance: T074-T075 (2026-07-21)

```text
Evidence directory: %TEMP%\TestProj-004-Final-20260721-142304
Data setup: fresh SQLite upgraded with `uv run alembic upgrade head`; six de-identified fixtures copied into the
            isolated managed DICOM directory; no default `data/` was read or modified
Chrome: 150.0.7871.114, system Chrome, headless Playwright fallback
A-B: 31/31 checks passed; first three non-black viewport time 349 ms; 6/6 DICOM responses were HTTP 200
     `application/dicom`; patient/axial/MPR/single-slice entry, metadata, safety banner, linked Crosshairs and wheel
     movement, return-to-axial and locality passed
C: 29/29 checks passed; WindowLevel shared VOI, Pan/Zoom camera isolation, Crosshairs visibility, reset, desktop
   two-by-two, narrow layout and keyboard focus/activation passed; 0 Console warnings/errors in this isolated run
D-E: 19/19 checks passed; 410 missing-file recovery, 502 stopped-service recovery, backend restart persistence,
     pending-load return cleanup, three repeated enter/exit cycles and loopback passed
Additional edge acceptance: 13/13 checks passed; Series revalidation 409 prevented volume creation, invalid DICOM
                        produced only the safe generic error, rapid wheel/drag stayed within one finite linked position,
                        and re-entry restored the complete default state
Restart persistence: 6/6 checks passed after stopping and restarting both backend and frontend
Console: expected injected resource errors only (410 missing file, 502 stopped-service proxy, 409 revalidation);
         no unexpected errors in any segment; repeated cleanup segments recorded WebGL context-limit warnings but
         remained functionally correct, while the isolated C and restart runs were warning/error free
Network: 100% loopback; no external requests in all segments
Screenshots: `screenshots-ab`, `screenshots-c`, `screenshots-de`, `screenshots-extra`, `screenshots-restart`
Cleanup: stopped final backend PID 65084 and frontend PID 3228; confirmed no listeners on 127.0.0.1:8000/5173
```

只有自动化、build 和 A-E 全部通过后，才将 `spec.md` 状态更新为 `Complete` 并勾选全部 tasks。

### Pre-publication regression verification (2026-07-22)

```text
Backend: 140 passed, 2 skipped, 1 warning in 22.19s
Backend skips: 2 real-directory symlink safety tests skipped because the current Windows environment lacks
               symlink creation privilege (WinError 1314)
Backend warning: existing StarletteDeprecationWarning from fastapi.testclient/httpx compatibility
Frontend: 30 test files, 224 tests passed
Production build: PASS, TypeScript noEmit PASS, Vite 1958 modules transformed;
                  existing Cornerstone externalization and large chunk warnings only
Storage cleanup: startup retry, safe staging isolation, failure continuation, and service startup behavior PASS
Documentation: root README startup commands, data-directory contract, scope boundaries, and local links PASS
Scope: existing Starlette, Cornerstone build and WebGL context-limit warnings intentionally unchanged
```
