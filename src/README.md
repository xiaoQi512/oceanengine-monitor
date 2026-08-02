# src 分层骨架

本目录是《巨量引擎监控-完整方案整合文档_20260801.md》目标架构的生产代码目录。

首批已完成：

- `src/utils/logger.mjs`：统一日志，路径已改为基于项目根目录解析
- `src/utils/monitor-utils.mjs`：共享工具与配置，路径已改为基于项目根目录解析
- `src/config/index.mjs`：统一配置入口，负责 `.env`、路径、账户、飞书、Chrome 等配置
- `src/config/accounts.json`：默认账户/群/Chrome Profile 配置
- `src/db/`：当前生产数据库模块，`dual-write.mjs` 支持 `DB_V2_DUAL_WRITE` 并行灰度与 `DB_V2_PRIMARY` v2 主写开关；`migration-readiness.mjs` 提供 v2 schema 就绪检查
- `src/feishu/guard.mjs`：飞书推送守卫（根目录保留兼容转发入口）
- `src/cdp/client.mjs`：统一 CDP 客户端（根目录保留兼容转发入口）
- `src/cdp/action.mjs` / `src/cdp/auto-login.mjs` / `src/cdp/guard.mjs`：CDP 操作、自动登录与守护
- `src/platform/oec-client.mjs`：巨量引擎 HTTP API 客户端，Cookie 提取通过 `src/services/api-client.mjs` 注入（根目录保留兼容转发入口）
- `src/services/`：PM2 服务入口与 `http-routes/` 路由模块
- `src/services/api-client.mjs`：服务层 API 客户端适配器，负责注入 CDP Cookie 提取实现
- `src/utils/wait-utils.mjs` / `src/utils/autonomous-router.mjs`：共享工具迁移
- `src/utils/csrf-utils.mjs`：CSRF Token、HMAC 签名与请求校验工具
- `src/domain/helpers.mjs` / `suggestions.mjs` / `push-logic.mjs` / `report-html.mjs` / `card-builder.mjs` / `analysis-utils.mjs` / `alerts.mjs` / `analyze.mjs` / `rolling.mjs` / `quick-card.mjs` / `detailed-card.mjs` / `five-minute-logic.mjs`：监控纯业务逻辑，外部数据通过参数注入

当前根目录 `logger.mjs` / `monitor-utils.mjs` 仅作为兼容转发入口，后续业务代码按
`utils -> config -> platform -> db -> feishu -> cdp -> domain -> services -> web`
顺序迁移。
