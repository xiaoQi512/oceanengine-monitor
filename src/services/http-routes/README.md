# src/services/http-routes

HTTP 服务路由模块，由 `src/services/http-server.mjs` 调度。

已拆分：

- `static.mjs`：Dashboard、PWA、vendor 静态资源
- `api-snapshots.mjs`：`/api/snapshots`、`/api/snapshots/5m`
- `api-campaigns.mjs`：`/api/campaigns`、`/api/campaigns/grouped`
- `api-alerts.mjs`：`/api/alerts`
- `api-live.mjs`：`/api/live-status`
- `api-accounts.mjs`：`/api/accounts`、`/api/accounts/:id`
- `api-ops.mjs`：`/api/manual-push`、`/api/repush`
- `api-report.mjs`：`/report`、`/daily*`、`/history`、`/mark-ignored`
- `api-feedback.mjs`：`/feedback`
- `api-actions.mjs`：`/api/actions`、`/api/pending`、`/api/audit/recent`、`/api/actions/rollback`
- `api-snapshots-trend.mjs`：`/api/snapshots/trend`
- `api-ai.mjs`：`/api/ai/learning-data`

HTTP 路由已完成当前拆分计划；剩余工作转向 cron 服务、数据库统一与文档归档。

路由模块已由 `tests/http-routes.test.mjs` 覆盖基本响应与归一化逻辑。
