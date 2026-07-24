# Implementation Plan: 高级 3D 可视化

**Branch**: `008-advanced-3d-visualization` | **Date**: 2026-07-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-advanced-3d-visualization/spec.md`

## Summary

在现有轴位查看和 MPR 旁新增独立高级 3D 页面。页面重新获取并校验 CT Series，用一个 Cornerstone
streaming volume 和一个 `ORTHOGRAPHIC` volume viewport 提供体绘制与 MIP；表面模式从已加载体数据创建经过安全
采样的 vtk.js 等值面 actor。全部状态为当前浏览器会话临时状态，失败和退出只清理本 Feature 资源。

## Technical Context

**Language/Version**: TypeScript 5.9.3、React 19.2.7；后端回归环境 Python 3.12.13

**Primary Dependencies**: Cornerstone3D core/tools/dicom-image-loader 5.6.8、vtk.js 36.4.1、Vite 8.1.5；
FastAPI 继续托管 `frontend/dist`

**Storage**: 只读现有 SQLite 与本机受管 DICOM 文件；无新表、迁移、网格文件或持久化状态

**Testing**: Vitest 4.1.10、React Testing Library 16.3.2、pytest 9.1.1、真实 Chrome production 验收

**Target Platform**: Windows 本机、现代 Chrome/WebGL、单用户 loopback 服务

**Project Type**: FastAPI + React/Vite 单仓库 Web 应用，production 由一个 FastAPI 进程交付

**Performance Goals**: 标准验收 CT 首个非黑 3D 画面 ≤10 秒；已加载后 volume/MIP 切换 ≤2 秒；
标准验收 CT 表面重建 ≤15 秒或返回可恢复错误

**Constraints**: 本机离线、无外部请求；单 volume、单 viewport、单 WebGL context；表面采样最多
4,000,000 点；表面计算失败不得破坏 volume；所有错误为用户安全中文消息

**Scale/Scope**: 一个 Series、三个模式、三个 volume presets、六个 MIP 标准方向、一个临时 surface actor；
不支持多 Series 融合、分割、导出或状态持久化

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Safety boundary — PASS**: 轴位页和高级 3D 页继续位于 `AppShell`，规格、UI 合同和验收要求所有状态
  持续显示非临床提示。
- **Local data boundary — PASS**: 只使用同源 Series/Instance 资源；像素、volume、mesh 和证据均留在本机，
  Network 必须 100% loopback。
- **Scope and stack — PASS**: 使用宪章批准的 React/TypeScript/Vite/Cornerstone/FastAPI；vtk.js 已是
  Cornerstone 依赖且因直接导入固定为直接依赖。不加入认证、云、PACS、DICOMweb 或诊断报告。
- **Modularity and minimal change — PASS**: 新 feature 按 model/hook/runtime/surface/component/page 分责；
  只对轴位页增加入口和 App 增加样式，不重构 Patient、导入、MPR 或后端职责。
- **Verification — PASS**: 计划包含纯函数、hook、adapter、组件、页面、全量回归、production build 和
  真实 Chrome/DICOM 三模式验收。
- **DICOM consistency — PASS**: 高级 3D 全流程只读；加载、表面、退出和重试不得写数据库、改变 Instance
  顺序或修改受管文件及五类导入报告。

**Pre-research gate result**: 全部 PASS，无阻断项。

## Project Structure

### Documentation (this feature)

```text
specs/008-advanced-3d-visualization/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── advanced-3d-ui.md
├── checklists/
│   ├── requirements.md
│   └── advanced-3d-quality.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
└── tests/                                   # 只运行现有全量回归；无产品代码改动

frontend/
├── package.json                             # vtk.js 36.4.1 直接依赖
├── package-lock.json
└── src/
    ├── app/App.tsx                          # 导入高级 3D 样式
    ├── features/
    │   ├── axial-viewer/pages/
    │   │   ├── AxialViewerPage.tsx          # 新增高级 3D 入口和返回编排
    │   │   └── AxialViewerPage.test.tsx
    │   └── advanced-3d-viewer/
    │       ├── components/
    │       │   ├── Advanced3dToolbar.tsx
    │       │   ├── Advanced3dToolbar.test.tsx
    │       │   ├── Advanced3dViewport.tsx
    │       │   └── Advanced3dViewport.test.tsx
    │       ├── core/
    │       │   ├── advanced3dCornerstone.ts
    │       │   ├── advanced3dCornerstone.test.ts
    │       │   ├── advanced3dRuntimeTypes.ts
    │       │   ├── surfaceReconstruction.ts
    │       │   └── surfaceReconstruction.test.ts
    │       ├── hooks/
    │       │   ├── useAdvanced3dSeries.ts
    │       │   └── useAdvanced3dSeries.test.tsx
    │       ├── model/
    │       │   ├── advanced3dViewer.ts
    │       │   └── advanced3dViewer.test.ts
    │       └── pages/
    │           ├── Advanced3dViewerPage.tsx
    │           └── Advanced3dViewerPage.test.tsx
    ├── styles/advanced-3d-viewer.css
    └── types/vtk-image-marching-cubes.d.ts
```

**Structure Decision**: 保持现有 `backend/` + `frontend/`，新增独立 `advanced-3d-viewer`。Series 请求和
Cornerstone runtime 不追加进已较大的 MPR adapter；surface reconstruction 单独封装，以便独立测试采样、
方向和释放。vtk module declaration 放在全局 `src/types`，只补第三方缺失声明。

## Phase 0: Research Outcomes

研究结论见 [research.md](research.md)。已解决 `ORTHOGRAPHIC` volume viewport、preset、MIP blend/slab、标准相机、
Marching Cubes 类型缺失、direction 不生效、大体积采样、actor 切换、完整加载、错误和 cleanup。
无未决澄清项。

## Phase 1: Design Outcomes

- 数据和临时状态：[data-model.md](data-model.md)
- 用户界面与状态合同：[contracts/advanced-3d-ui.md](contracts/advanced-3d-ui.md)
- 自动化与真实浏览器验证：[quickstart.md](quickstart.md)

## Post-Design Constitution Check

- **Safety boundary — PASS**: UI 合同要求入口、加载、三个模式、surface busy/empty/error 和窄屏状态都保留
  完整非临床提示。
- **Local data boundary — PASS**: 合同不新增 HTTP endpoint，quickstart 要求 production Network 全部 loopback。
- **Scope and stack — PASS**: 设计只新增已存在传递依赖的直接声明，不引入后端服务、worker、数据库或远程能力。
- **Modularity and minimal change — PASS**: surface 采样/mesh、Cornerstone runtime 和 React 编排各有独立接口；
  MPR 仅被复用 eligibility 纯函数，不承担 3D runtime 职责。
- **Verification — PASS**: quickstart 覆盖三个用户故事、失败恢复、性能、accessibility、cleanup、restart 和 locality。
- **DICOM consistency — PASS**: 所有状态转换只影响当前浏览器资源，任何失败均不修改数据库或文件。

**Post-design gate result**: 全部 PASS，可进入任务生成。

## Complexity Tracking

无宪章违规，不需要复杂度豁免。
