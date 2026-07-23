# 代码审查问题修复 Implementation Plan

> **状态说明（2026-07-23）：** 本文件是历史实施计划，保留未勾选项用于过程追溯；当前需求与完成状态以对应 `specs/*/spec.md` 和 `specs/*/tasks.md` 为准。

**Goal:** 用最小改动修复五个已确认的一致性问题，并用回归测试固定行为。

**Architecture:** 后端明确区分可逆删除阶段与提交后的隔离清理阶段，并统一 DICOM 方向容差；前端用受保护的保存关闭路径、runtime `resize()` 接口和显式就绪状态保持 React 与 Cornerstone 行为一致。

**Tech Stack:** FastAPI、SQLAlchemy、pytest、React 19、TypeScript、Vitest、React Testing Library、Cornerstone3D。

---

### Task 1: 修复病人删除的一致性边界

**Files:**
- Modify: `backend/app/services/patient_service.py`
- Modify: `backend/tests/integration/test_patient_dicom_delete.py`

- [x] 新增 purge 部分删除后失败的回归测试，并先确认旧实现失败。
- [x] 数据库删除提交后不再恢复快照或原目录，保留未清理完的隔离目录并继续报告错误。
- [x] 运行病人 DICOM 删除相关测试。

### Task 2: 统一 DICOM 方向浮点容差

**Files:**
- Modify: `backend/app/services/dicom_import.py`
- Modify: `backend/tests/integration/test_dicom_import_service.py` 或直接相关测试文件。

- [x] 新增容差内接受和容差外拒绝测试，并先确认容差内用例失败。
- [x] 使用 `1e-6` 逐分量绝对误差比较方向元组。
- [x] 运行 DICOM 导入相关测试。

### Task 3: 阻止保存期间关闭病人表单

**Files:**
- Modify: `frontend/src/features/patients/components/PatientFormDialog.tsx`
- Modify: `frontend/src/features/patients/components/PatientFormDialog.edit.test.tsx`

- [x] 用 deferred Promise 覆盖保存中点击取消和按 Esc。
- [x] 禁用取消按钮并让统一关闭回调在 `saving` 时返回。
- [x] 运行病人表单组件测试。

### Task 4: 修复轴位 resize 与 runtime 就绪状态

**Files:**
- Modify: `frontend/src/features/axial-viewer/core/cornerstone.ts`
- Modify: `frontend/src/features/axial-viewer/core/cornerstone.test.ts`
- Modify: `frontend/src/features/axial-viewer/components/AxialViewport.tsx`
- Modify: `frontend/src/features/axial-viewer/components/AxialViewport.test.tsx`
- Modify: `frontend/src/features/axial-viewer/components/ViewerToolbar.tsx`
- Modify: `frontend/src/features/axial-viewer/components/ViewerToolbar.test.tsx`

- [x] 先补 runtime resize 和异步未就绪交互的失败测试。
- [x] runtime 暴露 `resize()`，`ResizeObserver` 直接调用它。
- [x] 未就绪时显示加载提示并统一禁用依赖 runtime 的控件，成功创建后再启用。
- [x] 运行轴位组件、runtime 测试和 TypeScript 检查。

### Task 5: 全量复核

- [x] 复核每项修改都能追溯到对应问题，没有无关重构。
- [x] 运行后端全量 pytest。
- [x] 运行前端全量 Vitest。
- [x] 运行 `npx tsc --noEmit`。
- [x] 汇总根因、行为影响、验证结果和 purge 残留清理风险。

## 计划自检

- 五个问题都有独立回归测试和明确成功标准。
- 未增加数据库迁移、后台清理任务、新依赖或产品功能。
- 未包含 commit、push、merge 或上传步骤。
