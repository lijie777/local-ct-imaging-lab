# Quickstart: 后台导入与断点续传

## Prerequisites

- 使用脱敏、本机 CT DICOM fixture，包含可产生五类报告的样本。
- production 前端由同一 FastAPI 进程托管，浏览器只访问 loopback。
- 使用独立临时 `MEDICAL_CT_APP_DATA_DIR`，不得污染用户正式数据。

## Automated verification

Status: Passed on 2026-07-23.

```powershell
cd backend
uv run python -m pytest -q -p no:cacheprovider
# 268 passed, 1 warning in 75.12s

cd ..\frontend
npm test -- --run
# 44 files passed, 351 tests passed
npm run build
# tsc --noEmit and Vite production build passed; 1,978 modules transformed
```

空库迁移已完成 `001 -> 002 -> 003 -> 004_create_import_jobs`；模型约束、外键、active slot
唯一性、offset 对账和安全暂存测试均通过。后端测试唯一 warning 是 Starlette/httpx 的弃用提示，
不影响本 Feature 行为。

## Production browser acceptance

Status: Passed for the production single-process flow on 2026-07-23. The in-app Browser runtime was
blocked by session metadata (`sandboxPolicy` missing), so the previously approved Chrome DevTools
fallback was used against the real FastAPI-served production build.

1. 在 `http://127.0.0.1:8891/` 创建虚构 Patient，选择 16 MiB 脱敏 fixture 并开始任务。
2. 刷新前已确认 8 MiB；刷新后重新打开 dialog 并选择同一文件，首个续传 PUT 使用
   `Upload-Offset: 8388608`，没有重传已确认的前 50%。
3. 另一次 partial upload 在同一 FastAPI 进程停止并以相同数据目录重启后，重新打开任务仍显示“任务已保存”；
   续传首个 PUT 使用 `Upload-Offset: 4194304`，返回确认位置 `8388608`。
4. 在 Slow 3G 下上传首个 4 MiB chunk 后切为 Offline，服务端已确认 chunk 但浏览器丢失响应；界面立即恢复
   文件选择、“继续上传”和“放弃任务”。恢复网络后，客户端先 GET 最新任务，首个重试 PUT 使用
   `Upload-Offset: 4194304` 并确认到 `8388608`，随后成功入队，未从 0 重传。
5. 选择 9 个 mixed fixture，production 页面显示 `成功 1 / 重复 1 / 跳过 4 / 不支持 1 / 失败 2 / 合计 9`；
   每个非成功文件均显示安全原因和稳定 code，关闭 dialog 后 Patient 的 Study/Series 列表刷新。
6. 在真实 uvicorn owner PID `45128` 处理 2,000 文件任务且页面显示 running 时强制停止进程；SQLite 保留
   `running` 行和 2,000 个 staging 文件。使用相同数据目录重启后任务重新执行并到达终态。为稳定观察恢复中间态，
   另用 production schema/service transition 准备 2,000 个独立 Study 的持久化 `running` fixture 后启动真实
   uvicorn；浏览器明确显示“后台正在处理 DICOM”，最终显示 `成功 2000 / 合计 2000`。终态 job staging 不存在，
   `.import-jobs` orphan 数为 0。
7. 用同名、同大小、同修改时间但首字节不同的 fixture 续传，界面拒绝并显示“重新选择的文件与当前导入任务不匹配”，
   未发送续传 chunk。
8. 活动上传期间删除 Patient 收到 `409 import_in_progress`；点击“放弃任务”后 DELETE 返回 `204`，任务和
   `.import-jobs` 暂存目录清理完成。
9. `backend/tests/integration/test_import_job_worker.py` 的两次 application lifespan 路径作为补充自动化，验证
   offset 保留、`running -> queued`、已提交 SOP duplicate、串行处理和无孤立 staging；它不替代上述真实
   production 浏览器与进程重启证据。
10. 1280×900 与 820×900 视口布局、非临床提示、焦点和进度/报告可访问名称均正常；请求全部为
   loopback 或内联 data URL，无外部网络请求。一次预期的 Patient 删除 `409` 在 DevTools
   console 中留下资源错误记录，属于被测冲突响应；重新加载后的当前验收路径无 console message。

## Final result

Status: Feature 007 complete. Final independent review found no remaining Critical, Important, or Minor
findings and reported `Ready to merge: Yes`. Feature 008 (3D volume rendering, surface reconstruction, and
MIP) remains the next feature.
