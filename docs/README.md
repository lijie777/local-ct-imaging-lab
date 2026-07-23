# 文档状态与导航

`specs/*/spec.md` 描述当前需求，`specs/*/tasks.md` 记录对应 Feature 的完成状态；两者是判断当前功能范围与完成情况的 source of truth。

`docs/superpowers/specs/` 保存跨 Feature 的设计决策，`docs/superpowers/plans/` 保存实施时使用的历史计划。历史计划中的未勾选项用于保留当时的执行过程，不表示当前功能仍未完成；需要确认现状时，应回到对应的 `spec.md`、`tasks.md` 和当前代码、测试。
