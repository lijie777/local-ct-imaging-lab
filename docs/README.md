# 文档状态与导航

`specs/*/spec.md` 描述当前需求，`specs/*/tasks.md` 记录对应 Feature 的完成状态；两者是判断当前功能范围与完成情况的 source of truth。

`docs/superpowers/specs/` 保存跨 Feature 的设计决策，`docs/superpowers/plans/` 保存实施时使用的历史计划。历史计划中的未勾选项用于保留当时的执行过程，不表示当前功能仍未完成；需要确认现状时，应回到对应的 `spec.md`、`tasks.md` 和当前代码、测试。

## 当前 Feature

Feature 008“高级 3D 可视化”的当前 source of truth：

- [规格](../specs/008-advanced-3d-visualization/spec.md)
- [实施计划](../specs/008-advanced-3d-visualization/plan.md)
- [任务状态](../specs/008-advanced-3d-visualization/tasks.md)
- [启动与验收证据](../specs/008-advanced-3d-visualization/quickstart.md)

配套历史设计与细化步骤保存在：

- [高级 3D 可视化设计](superpowers/specs/2026-07-23-advanced-3d-visualization-design.md)
- [高级 3D 可视化细化实施计划](superpowers/plans/2026-07-23-advanced-3d-visualization.md)

Feature 005 提供测量与标注，Feature 006 提供按 Series 的轴位/MPR/Crosshairs/annotation
持久化与安全恢复，Feature 007 增加单进程后台导入、顺序 chunk 续传、重启恢复和 Patient 删除门禁。
Feature 008 从 eligible CT 轴位页进入，在同一份本机 volume 上提供体绘制、MIP 和真实表面重建；
表面计算在浏览器本机完成，大体积会自动降低采样密度并保持物理范围和方向，且始终保留非临床使用边界。
