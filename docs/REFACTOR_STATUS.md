# 重构状态

基线：`refactor-baseline` 标签已存在，`scripts/ci-test.mjs` 当前 3/3 通过。

## 2026-08-01 首批

- 建立 `src/` 分层骨架说明
- 迁移 `logger.mjs` 到 `src/utils/logger.mjs`
- 迁移 `monitor-utils.mjs` 到 `src/utils/monitor-utils.mjs`
- 根目录保留兼容转发入口，现有 30+ 引用方无需改动

## 2026-08-01 第二批

- 新增 `src/config/index.mjs` 过渡配置入口，暴露路径、账户、飞书、Chrome 等配置
- 迁移生产使用的 `db/` 到 `src/db/`，根目录 `db/` 保留兼容转发入口
- `scripts/ci-test.mjs` 仍为 3/3 通过

说明：`tests/refresh-materialized-lock.test.mjs` 为既有遗留测试，当前
`src/db/refresh-materialized.mjs` 未导出该测试期望的锁函数，迁移前同样不匹配。

## 2026-08-01 第三批

- 新增 `src/config/accounts.json`，`src/config/index.mjs` 已读取并校验账户配置
- 迁移 `feishu-push-guard.mjs` 到 `src/feishu/guard.mjs`
- 迁移 `cdp-client.mjs` 到 `src/cdp/client.mjs`
- 迁移 `wait-utils.mjs`、`autonomous-router.mjs` 到 `src/utils/`
- 根目录均保留兼容转发入口，CI 3/3 通过

下一步建议继续主题 A：迁移 `cdp-action`、`chrome-guard`，随后进入 `src/services/` 与 PM2 入口迁移。

## 2026-08-01 审查修复

- 补齐 `cdp-client` / `wait-utils` / `autonomous-router` 根入口的默认导出
- `src/config/index.mjs` 改为配置单一来源，`monitor-utils` 从配置层导入并兼容导出
- 支持 `LARK_REPORT_CHAT_ID`，同时保留旧 `LARK_ANCHOR_CHAT_ID` 兼容
- 新增 `tests/refactor-compat.test.mjs` 并纳入 CI
- 修复 `src/db/refresh-materialized.mjs` 并发锁实现，遗留锁测试 21/21 通过

当前 CI：4/4 通过。

## 2026-08-01 第四批

- 迁移 `oceanengine-api-client.mjs` 到 `src/platform/oec-client.mjs`
- 迁移 `oec-auto-login.mjs`、`cdp-action.mjs`、`chrome-guard.mjs` 到 `src/cdp/`
- `src/cdp/client.mjs`、自动登录与守护进程改为使用 `CDP_PORT` / `CDP_PROXY_PORT` 配置
- PM2 `chrome-guard` 入口切换为 `src/cdp/guard.mjs`
- 根目录全部保留兼容转发入口，CI 4/4 通过

下一步建议：迁移 `feishu-listener` / `action-queue-worker` 等服务入口，开始搭建 `src/services/`。

## 2026-08-01 第五批

- 新增 `src/services/`，迁移 `feishu-listener.mjs` 到 `src/services/feishu-listener.mjs`
- 迁移 `action-queue-worker.mjs` 到 `src/services/action-worker.mjs`
- listener 群 ID、Bot ID、账户 ID 改从 `src/config` 读取，状态文件继续留在项目根目录
- PM2 两个常驻进程已重建并指向 `src/services/` 新入口，启动日志正常

下一步建议：迁移 `live-watcher` / `shift-pusher` / `feedback-server` 服务入口。

## 2026-08-01 第六批

- 迁移 `live-watcher.mjs` 到 `src/services/live-watcher.mjs`
- 迁移 `oceanengine-shift-pusher.mjs` 到 `src/services/shift-pusher.mjs`
- 迁移 `巨量引擎快照数据库/snapshot-db.mjs` 到 `src/db/snapshot-db.mjs`
- PM2 `live-watcher`、`shift-pusher` 已重建并指向 `src/services/` 新入口，启动日志正常

下一步建议：迁移 `feedback-server` 到 `src/services/http-server.mjs` 与 `src/services/http-routes/`。

## 2026-08-01 第七批

- 迁移 `feedback-server.mjs` 到 `src/services/http-server.mjs`
- 路径改为基于 `PROJECT_ROOT` / `DATA_DIR`，API 客户端改走 `src/platform/oec-client.mjs`
- PM2 `feedback-server` 已重建并指向 `src/services/http-server.mjs`
- `/health`、`/dashboard-v2`、`/api/snapshots` 均返回 HTTP 200

下一步建议：稳定运行后拆分 `http-server.mjs` 路由，并迁移 cron 类服务。

## 2026-08-01 第八批

- 新增 `src/services/http-routes/`
- 拆分 `static.mjs`：Dashboard、PWA、vendor 静态资源
- 拆分 `api-snapshots.mjs`：`/api/snapshots`、`/api/snapshots/5m`
- `feedback-server` 已重启，静态与快照接口全部 HTTP 200

下一步建议：继续拆分 trend / campaigns / actions / ai / alerts / live-status / accounts 路由。

## 2026-08-01 第九批

- 新增 `src/services/http-routes/api-campaigns.mjs`
- 拆分 `/api/campaigns`、`/api/campaigns/grouped` 路由
- `feedback-server` 已重启，campaigns 与既有接口均返回 HTTP 200

下一步建议：继续拆分 `/api/snapshots/trend`、actions、ai、alerts、live-status、accounts 路由。

## 2026-08-01 审查修复

- `/api/accounts` 账户 ID 与 AI 对话预算改从 `src/config` 读取
- 五个服务入口改为导入安全模式，新增 `*-cli.mjs` 独立启动入口
- PM2 已切换为 CLI 入口，启动时执行 `assertConfig()` fail-fast
- 新增 `tests/http-routes.test.mjs`，CI 提升到 5/5
- 清理 `MIME`、`get5mLatest`、未使用 `DB_PATH` 与重复 `getApiClient`

## 2026-08-01 第十批

- 新增 `api-alerts.mjs`、`api-live.mjs`、`api-accounts.mjs`
- 拆分 `/api/alerts`、`/api/live-status`、`/api/accounts`、`/api/accounts/:id`
- 路由单测覆盖 alerts / live-status / accounts，CI 5/5 通过
- 接口验证全部 HTTP 200

下一步建议：继续拆分 `/api/snapshots/trend`、actions、ai、manual-push、repush、report。

## 2026-08-01 第十一批

- 新增 `api-ops.mjs`，拆分 `/api/manual-push`、`/api/repush`
- 新增 `api-report.mjs`，拆分 `/report`、`/daily*`、`/history`、`/mark-ignored`
- 路由单测覆盖 ops / report，CI 5/5 通过
- `feedback-server` 已重启，报表/历史/标记及既有 API 均 HTTP 200

下一步建议：继续拆分 `/api/snapshots/trend`、actions、ai、feedback。

## 2026-08-01 第十二批

- 新增 `api-feedback.mjs`，拆分 `/feedback` 页面路由
- 路由单测覆盖 feedback，CI 5/5 通过
- `feedback-server` 已重启，`/feedback` 参数校验返回 HTTP 400，健康检查 HTTP 200

下一步建议：继续拆分 `/api/snapshots/trend`、actions、ai。

## 2026-08-01 第十三批

- 新增 `api-actions.mjs`，拆分 `/api/actions`、`/api/pending`、`/api/audit/recent`、`/api/actions/rollback`
- 路由单测覆盖 actions 入队与查询，CI 5/5 通过
- `feedback-server` 已重启，actions / pending / audit 均 HTTP 200

下一步建议：继续拆分 `/api/snapshots/trend`、ai。

## 2026-08-01 第十四批

- 新增 `api-snapshots-trend.mjs`，拆分 `/api/snapshots/trend`
- 路由单测覆盖 trend，CI 5/5 通过
- `feedback-server` 已重启，trend 与既有接口均 HTTP 200

下一步建议：继续拆分 `/api/ai/learning-data`。

## 2026-08-01 第十五批

- 新增 `api-ai.mjs`，拆分 `/api/ai/learning-data`
- `src/services/http-server.mjs` 已降至约 21KB / 490 行
- 路由单测覆盖 AI，CI 5/5 通过
- `feedback-server` 已重启，AI 与既有接口均 HTTP 200

HTTP 路由拆分完成当前计划；下一步转向 cron 服务迁移、数据库统一与根目录文档归档。

## 2026-08-01 第十六批

- 迁移 4 个 cron 服务到 `src/services/`：
  - `cron-daily-report.mjs`
  - `cron-daily-summary.mjs`
  - `cron-sync-shifts.mjs`
  - `cron-ai-regions.mjs`
- 路径改为基于 `PROJECT_ROOT`，根目录保留兼容入口
- PM2 配置已指向 `src/services/` 新路径，CI 5/5 通过

注意：当前停止中的 cron 进程未重建，下次通过 `ecosystem.config.cjs` 启动时会加载新路径。

## 2026-08-01 第十七批

- 迁移 `巨量引擎监控数据库/` v2 模块到 `src/db/v2/`
- 修正 v2 模块项目根路径与 `DATA_DIR` 引用
- 根目录 `巨量引擎监控数据库/` 保留兼容入口，导入安全
- CI 5/5 通过

## 2026-08-01 第二十六批

- 新增 `src/domain/helpers.mjs`，抽取 15min 监控中的纯工具函数
- `monitor-15min.mjs` 移除本地 `escHtml`、`parsePlanBudget`、`parseSnapshotTime`、`computeLinearSlope`、`progressBar`、`getTimeSlotAdvice`
- 新增 `tests/domain-helpers.test.mjs`，CI 提升到 6/6 通过

下一步建议：继续抽取分析、卡片构建、HTML 生成等大块逻辑。

## 2026-08-01 第二十七批

- 新增 `src/domain/suggestions.mjs`，抽取 `shouldSuggest` 与 `getSuggestionInsight`
- `monitor-15min.mjs` 移除本地建议去重与摘要逻辑
- 单测覆盖建议模块，CI 6/6 通过

下一步建议：继续抽取 HTML 生成与卡片构建。

## 2026-08-01 审查修复第四轮

- 修复 `getSuggestionInsight` 全 ignored 场景下的 `NaN%` 除零问题
- `shouldSuggest` / `shouldPush` 增加空值防御
- `monitor-15min` 排班窗口改为惰性初始化，模块导入不再触发 lark-cli
- dual-write 增加 legacy/v2 双方结果记录，旧 writer 失败时不再写 v2
- CI 6/6 通过

## 2026-08-01 第二十八批

- 新增 `src/domain/push-logic.mjs`，抽取 `shouldPush`
- `monitor-15min.mjs` 移除本地推送决策逻辑，改为注入 `loadLastPush`
- 单测覆盖推送决策，CI 6/6 通过

下一步建议：继续抽取 HTML 生成与卡片构建。

## 2026-08-01 第二十四批

- v2 `snapshots` 增加 `status` 兼容列与迁移 `003_compat_status.sql`
- v2 DAL 迁移改为逐语句执行并幂等跳过重复列/已存在对象
- 新增 `src/db/v2/compat-writer.mjs`，提供与旧 writer 一致的 `insertSnapshot` / `verifyConsistency` / `insertAction` / `closeDb`
- `src/db/index.mjs` 暴露 `v2Compat` 命名空间
- CI 5/5 通过

下一步建议：用 v2 兼容层做并行写入灰度，确认数据一致后切换生产。

## 2026-08-01 第二十九批

- 新增 `src/domain/report-html.mjs`，抽取 `generateHTML` 为纯函数 `generateMonitorHTML`
- 新增 `src/domain/card-builder.mjs`，抽取 `buildFeishuCard` 为纯函数 `buildCardMessage`
- `monitor-15min.mjs` 保留薄包装，负责 DB TOP5、建议历史副作用与上下文注入
- 新增 `tests/domain-outputs.test.mjs`，CI 提升到 7/7 通过

下一步建议：继续抽取 `monitor-15min` 的分析/告警大块逻辑，或收敛 `src/db/` 与 `src/db/v2/`。

## 2026-08-01 第三十批

- 新增 `src/domain/analysis-utils.mjs`，抽取趋势、同比/多日基线、3h 窗口与生命周期判定纯算法
- `monitor-15min.mjs` 仅保留 daily JSON 文件读取与日期上下文包装
- 新增 `tests/domain-analysis.test.mjs`，CI 提升到 8/8 通过

下一步建议：继续抽取 `analyzeData` 的告警规则大块逻辑，或收敛 `src/db/` 与 `src/db/v2/`。

## 2026-08-01 第三十一批

- 修复 `src/platform/oec-client.mjs` 直接依赖 `src/cdp/` 的分层违规，改为 Cookie 提取器依赖注入
- 新增 `src/cdp/cookie-provider.mjs` 与 `src/services/api-client.mjs`，服务层统一从 adapter 获取 API 客户端
- `snapshot-db` 清理不可达的 `createClient` 兜底，只接受调用方注入的 `apiClient`
- 新增 `scripts/check-imports.mjs` 分层 import 检查并纳入 CI，CI 提升到 10/10 通过

下一步建议：继续抽取 `analyzeData` 的告警规则大块逻辑，或收敛 `src/db/` 与 `src/db/v2/`。

## 2026-08-01 第三十二批

- 新增 `src/domain/alerts.mjs`，抽取 `analyzeData` 内全部告警规则为纯函数 `buildAlerts`
- `monitor-15min.mjs` 负责计算趋势、同比、生命周期与指标上下文，再调用 `buildAlerts`
- `monitor-15min.mjs` 从 2442 行降至 2098 行
- 新增 `tests/domain-alerts.test.mjs`，CI 提升到 11/11 通过

下一步建议：继续收敛 `src/db/` 与 `src/db/v2/`，或迁移根目录剩余旧脚本。

## 2026-08-01 第三十三批

- 迁移 `csrf-utils.mjs` 到 `src/utils/csrf-utils.mjs`，根目录保留兼容转发入口，`tests/csrf.test.mjs` 改走 `src`
- 新建 `archive/root-legacy/`，归档 21 个无引用的根目录旧脚本
- 根目录 `.mjs` 从 46 降至 25，且全部为兼容/瘦入口，不再有大型旧业务脚本
- CI 11/11 通过

下一步建议：收敛 `src/db/` 与 `src/db/v2/`，或继续迁移剩余根目录兼容入口。

## 2026-08-01 第三十四批

- `src/db/dual-write.mjs` 新增 `DB_V2_PRIMARY=1` 主写开关，支持 v2 compat 主写、旧 writer 可选同步
- 新增 `src/db/README.md`，明确旧 writer、v2、v2Compat、双写灰度的依赖关系
- `.env.example` 增加 `DB_V2_PRIMARY=0`
- `tests/refactor-compat.test.mjs` 增加写入模式开关测试，CI 11/11 通过

下一步建议：运行并行写入并对比数据一致后，将 `DB_V2_PRIMARY=1` 设为生产默认，再移除旧 writer 入口。

## 2026-08-01 第三十五批

- 新增 `src/domain/analyze.mjs`，将 `analyzeData` 整体迁入 domain，外部数据通过参数注入
- `monitor-15min.mjs` 的 `analyzeData` 改为薄包装，只负责加载历史快照、基线、趋势和生命周期上下文
- `monitor-15min.mjs` 从 2098 行降至 1733 行
- 新增 `tests/domain-analyze.test.mjs`，CI 提升到 12/12 通过

下一步建议：继续收敛 `src/db/` 与 `src/db/v2/`，或迁移剩余根目录兼容入口。

## 2026-08-01 第三十六批

- 新增 `src/domain/rolling.mjs`，抽取 5min 监控的 `getSpend` / `getConv` / `calcRolling`
- `monitor-5min.mjs` 改为注入 `minutesBetween` 与当前时间调用 domain 环比计算
- 新增 `tests/domain-rolling.test.mjs`，CI 提升到 13/13 通过

下一步建议：继续抽取 5min 卡片构建与详细卡片逻辑，或收敛数据库主写。

## 2026-08-02 第三十七批

- 新增 `src/domain/quick-card.mjs`，抽取 5min 速报卡片构建纯函数
- `monitor-5min.mjs` 的 `pushToLark` 只保留推送守卫与卡片发送，卡片内容由 domain 构建
- 新增 `tests/domain-quick-card.test.mjs`，CI 提升到 14/14 通过

下一步建议：继续抽取 5min 详细卡片构建逻辑，或推进数据库主写收敛。

## 2026-08-02 第三十八批

- 新增 `src/domain/detailed-card.mjs`，抽取 5min 详细卡片构建纯函数
- `monitor-5min.mjs` 的 `pushDetailedCard` 只保留数据准备与推送，卡片元素/指标/头部由 domain 构建
- 新增 `tests/domain-detailed-card.test.mjs`，CI 提升到 15/15 通过

下一步建议：推进数据库主写收敛，或继续抽取 5min 主流程中的业务逻辑。

## 2026-08-02 第三十九批

- 新增 `src/db/migration-readiness.mjs`，提供 v2 schema 就绪检查纯函数
- 新增 `scripts/check-db-v2.mjs`，可检查当前 `monitor-data/oceanengine.db` 是否满足 v2 主写条件
- 当前实际数据库检查结果：v2 schema 就绪，`schema_version=2.0`
- 新增 `tests/db-migration-readiness.test.mjs`，CI 提升到 16/16 通过

下一步建议：开启 `DB_V2_DUAL_WRITE=1` 运行并行写入，确认数据一致后设置 `DB_V2_PRIMARY=1`。

## 2026-08-02 第四十批

- 旧 writer 支持 `OCEANENGINE_DB_PATH` 环境变量覆盖，便于隔离测试
- 新增 `tests/db-compat-write.test.mjs`，验证旧 writer 与 v2 compat 在临时库写入结果一致
- `dual-write` 的 v2 主写模式增加失败回退旧 writer 的安全兜底
- `.env.example` 将 `DB_V2_PRIMARY` 调整为 `1`，作为 v2 主写推荐配置
- CI 17/17 通过

下一步建议：在生产 `.env` 开启 `DB_V2_PRIMARY=1`，并保留 `DB_V2_DUAL_WRITE=1` 观察一段时间的同步写入结果。

## 2026-08-02 第四十一批

- `dual-write.mjs` 默认改为 v2 主写，`DB_V2_PRIMARY=0` 可回退旧 writer
- v2 主写失败会自动回退旧 writer，避免单点断写
- `refactor-compat` 增加默认模式断言，CI 17/17 通过

下一步建议：保持 `DB_V2_DUAL_WRITE=1` 运行一段时间做数据对比，确认后移除旧 writer 入口。

## 2026-08-02 第四十二批

- 新增 `src/domain/five-minute-logic.mjs`，抽取 5min 运行窗口判断与 HTTP 项目归一化
- `monitor-5min.mjs` 主流程改为调用 `shouldRun5min` 与 `buildApiSnapshot`
- 新增 `tests/domain-five-minute-logic.test.mjs`，CI 提升到 18/18 通过

下一步建议：继续抽取 5min 数据修正、推送节流和快照保存决策，或推进旧 writer 入口移除。

## 2026-08-02 第四十三批

- `five-minute-logic.mjs` 增加转化回退、CDP 零消耗跳过、近 5 分钟 CPM、推送节流和整刻钟判断
- `monitor-5min.mjs` 主流程的数据修正与推送决策改为调用 domain 纯函数
- 扩展 `tests/domain-five-minute-logic.test.mjs`，CI 18/18 通过

下一步建议：继续抽取快照保存与推送分支编排，或推进旧 writer 入口移除。

## 2026-08-02 第四十四批

- `src/db/index.mjs` 顶层 `insertSnapshot` / `verifyConsistency` / `insertAction` / `closeDb` 切换为 v2Compat
- 旧 writer 收敛为 `legacy` 命名空间，仅供回退、双写与兼容测试使用
- `refactor-compat` 增加 legacy 命名空间断言，CI 18/18 通过

下一步建议：观察 v2 主写运行稳定后，移除旧 writer 根兼容入口并归档 `src/db/writer.mjs`。

## 2026-08-02 第四十五批

- 新增 `src/services/snapshot-store.mjs`，抽取快照/日志文件读取
- `monitor-15min.mjs` 移除本地 `readSnapshot`、`readDailyLog`、`loadPreviousSnapshots`、`loadTodaysSnapshots`
- 新增 `tests/snapshot-store.test.mjs`，CI 提升到 19/19 通过
- `monitor-15min.mjs` 从约 74KB 降至约 72KB

下一步建议：继续抽取 CDP 抓取/分页/排序逻辑到 `src/cdp/`。

## 2026-08-02 第四十六批

- 新增 `src/cdp/page-actions.mjs`，抽取 `closePopups` / `waitForTableReady` / `hasNextPage` / `clickNextPage`
- `monitor-15min.mjs` 移除本地实现，并清理未使用导入
- 新增 `tests/page-actions.test.mjs`，CI 提升到 20/20 通过
- `monitor-15min.mjs` 降至约 69KB

下一步建议：继续抽取 `setPageSize` / `sortBySpend` / `scrapeOnePage` 到 `src/cdp/`。

## 2026-08-02 第四十七批

- 新增 `src/cdp/monitor-scraper.mjs`，抽取 `scrapeOnePage`
- `monitor-15min.mjs` 移除本地单页抓取实现
- 新增 `tests/monitor-scraper.test.mjs`，CI 提升到 21/21 通过
- `monitor-15min.mjs` 降至约 62KB

下一步建议：继续抽取 `setPageSize` / `sortBySpend` 到 `src/cdp/`。

## 2026-08-02 第四十八批

- 新增 `src/cdp/page-setup.mjs`，抽取 `setPageSize` / `sortBySpend`
- `monitor-15min.mjs` 移除本地分页与排序实现
- 新增 `tests/page-setup.test.mjs`，CI 提升到 22/22 通过
- `monitor-15min.mjs` 降至约 50KB

下一步建议：继续抽取 Chrome 守护/数据断层标记/推送状态等剩余逻辑。

## 2026-08-02 第四十九批

- 新增 `src/cdp/monitor-chrome.mjs`，抽取 `checkChrome` / `launchChrome`
- `monitor-15min.mjs` 移除本地 Chrome 探活/拉起实现，并清理未使用导入
- 新增 `tests/monitor-chrome.test.mjs`，CI 提升到 23/23 通过
- `monitor-15min.mjs` 降至约 49KB

下一步建议：继续抽取数据断层标记/建议历史/推送状态等剩余逻辑。

## 2026-08-02 第五十批

- 新增 `src/services/push-state.mjs`，抽取 `loadLastPush` / `saveLastPush` / `appendPushLog` / `PUSH_TYPES`
- `monitor-15min.mjs` 移除本地推送状态与日志实现
- 新增 `tests/push-state.test.mjs`，CI 提升到 24/24 通过
- `monitor-15min.mjs` 降至约 47KB

下一步建议：继续抽取数据断层标记/建议历史/余额告警状态等剩余逻辑。

## 2026-08-02 第五十一批

- 新增 `src/services/monitor-state.mjs`，抽取数据断层标记、Webhook、建议历史逻辑
- `monitor-15min.mjs` 移除本地 `recordDataGap` / `readWebhookFile` / `recordPendingSuggestions` / `markIgnoredSuggestions`
- 新增 `tests/monitor-state.test.mjs`，CI 提升到 25/25 通过
- `monitor-15min.mjs` 降至约 45KB

下一步建议：继续抽取余额/预算告警状态与剩余编排逻辑。

## 2026-08-02 第五十二批

- 新增 `src/services/alert-state.mjs`，抽取余额/预算告警状态读写
- `monitor-15min.mjs` 移除本地 `BALANCE_ALERT_FILE` / `ACCOUNT_BUDGET_ALERT_FILE` 及对应状态函数
- 新增 `tests/alert-state.test.mjs`，CI 提升到 26/26 通过
- `monitor-15min.mjs` 降至约 44KB

下一步建议：继续抽取余额/预算告警卡片发送或主流程剩余编排逻辑。

## 2026-08-02 第五十三批

- 新增 `src/services/alert-push.mjs`，抽取余额/预算专用告警发送
- `monitor-15min.mjs` 移除本地 `sendBalanceAlert` / `sendAccountBudgetAlert`
- 新增 `tests/alert-push.test.mjs`，CI 提升到 27/27 通过
- `monitor-15min.mjs` 降至约 36KB

下一步建议：继续抽取 `sendFeishuPush` 主推送编排或剩余监控流程逻辑。

## 2026-08-02 第五十四批

- 新增 `src/services/monitor-push.mjs`，抽取 `sendFeishuPush` 主推送编排
- `monitor-15min.mjs` 移除本地主推送实现
- 新增 `tests/monitor-push.test.mjs`，CI 提升到 28/28 通过
- `monitor-15min.mjs` 降至约 33KB

下一步建议：继续抽取 `main()` 主流程中剩余编排逻辑，或推进旧 writer 入口移除。

## 2026-08-02 第五十五批

- 新增 `src/domain/monitor-summary.mjs`，抽取监控摘要控制台输出
- `monitor-15min.mjs` 主流程改为调用 `printMonitorSummary`
- 新增 `tests/monitor-summary.test.mjs`，CI 提升到 29/29 通过
- `monitor-15min.mjs` 降至约 28KB

下一步建议：继续抽取主流程采集/落盘子步骤，或推进旧 writer 入口移除。

## 2026-08-02 审查修复

- 修复 `monitor-15min.mjs` 中未定义 `LOG_FILE` 的问题，改为 `monitor-data/monitor-v3.log`
- `CONFIG.larkCli` 改为惰性初始化，消除 canonical 模块 import 副作用
- 删除已禁用的 CDP fallback 死代码，并清理相关导入
- 增强 `monitor-push` / `alert-push` / `monitor-summary` 测试覆盖
- `monitor-15min.mjs` 降至约 24KB，CI 29/29 通过

## 2026-08-02 第五十六批

- 新增 `src/services/monitor-io.mjs`，抽取 `saveDailyLog` 与 `sendReportFileToChat`
- `monitor-15min.mjs` 移除本地日报落盘与报表文件发送实现，改为依赖注入调用
- 新增 `tests/monitor-io.test.mjs`，CI 提升到 30/30 通过
- `monitor-15min.mjs` 降至约 20KB / 463 行

## 2026-08-02 第五十七批

- 新增 `src/services/monitor-collect.mjs`，抽取直播状态检查与 HTTP API 数据采集编排
- `monitor-15min.mjs` 移除本地直播检查/采集实现，并清理 CDP 截图死代码与未使用导入
- 新增 `tests/monitor-collect.test.mjs`，CI 提升到 31/31 通过
- `monitor-15min.mjs` 降至约 17KB / 430 行

## 2026-08-02 第五十八批

- `src/services/monitor-io.mjs` 新增 `saveSnapshot` 与 `writeHtmlReport`
- `monitor-15min.mjs` 移除本地 JSON/SQLite 双写与 HTML 报表生成实现
- 扩展 `tests/monitor-io.test.mjs` 覆盖落盘成功/失败与报表生成，CI 仍 31/31 通过
- `monitor-15min.mjs` 降至约 16.5KB / 410 行

## 2026-08-02 第五十九批

- 新增 `src/services/monitor-runtime.mjs`，抽取运行日志轮转与物化视图刷新
- `monitor-15min.mjs` 移除本地日志截断与收尾刷新实现
- 新增 `tests/monitor-runtime.test.mjs`，CI 提升到 32/32 通过
- `monitor-15min.mjs` 降至约 16KB / 393 行

## 2026-08-02 第六十批

- 新增 `src/services/monitor-card.mjs`，抽取 DB TOP5 查询、建议历史副作用与飞书卡片上下文编排
- `monitor-15min.mjs` 移除本地 `buildFeishuCard` 与未使用的告警独立入口
- 新增 `tests/monitor-card.test.mjs`，CI 提升到 33/33 通过
- `monitor-15min.mjs` 降至约 13KB / 321 行

## 2026-08-02 第六十一批

- 新增 `src/services/monitor-report.mjs`，抽取 HTML 报表建议历史副作用与上下文注入
- `monitor-15min.mjs` 移除本地 `generateHTML`，改为报表目录调用注入
- 新增 `tests/monitor-report.test.mjs`，CI 提升到 34/34 通过
- `monitor-15min.mjs` 降至约 12.5KB / 310 行

## 2026-08-02 第六十二批

- 新增 `src/services/analysis-context.mjs`，抽取趋势、同比/多日基线、3h 窗口与分析上下文编排
- `monitor-15min.mjs` 移除本地 `analyzeData` 与基线包装函数
- 新增 `tests/analysis-context.test.mjs`，CI 提升到 35/35 通过
- `monitor-15min.mjs` 降至约 10KB / 253 行

## 2026-08-02 第六十三批

- 新增 `src/services/monitor-config.mjs`，抽取 15min 监控运行配置与告警阈值
- `monitor-15min.mjs` 移除本地 `CONFIG` 与排班窗口惰性初始化
- 新增 `tests/monitor-config.test.mjs`，CI 提升到 36/36 通过
- `monitor-15min.mjs` 降至约 7KB / 180 行

## 2026-08-02 第六十四批

- `src/services/monitor-push.mjs` 新增 `createPushDeps`，集中装配主推送依赖
- `monitor-15min.mjs` 移除大量推送状态/告警导入与参数组装，只传配置、干跑模式和卡片构建器
- 扩展 `tests/monitor-push.test.mjs` 覆盖依赖装配，CI 仍 36/36 通过
- `monitor-15min.mjs` 降至约 6KB / 159 行

## 2026-08-02 第六十五批

- `src/services/monitor-io.mjs` 新增 `sendReportIfEnabled`，合并报表开关/有效性判断/发送与路径输出
- `src/services/monitor-runtime.mjs` 新增 `ensureDataDir`
- `monitor-15min.mjs` 移除直接文件系统数据目录准备与报表发送分支
- 扩展 `tests/monitor-io.test.mjs` / `tests/monitor-runtime.test.mjs`，CI 仍 36/36 通过
- `monitor-15min.mjs` 降至约 5.6KB / 145 行

## 2026-08-02 第六十六批

- 新增 `src/services/monitor-cli.mjs`，抽取通用 CLI 运行与错误处理
- `monitor-15min.mjs` 的 `runCli` 改为调用统一运行器，保留数据断层记录
- 新增 `tests/monitor-cli.test.mjs`，CI 提升到 37/37 通过
- `monitor-15min.mjs` 降至约 5.4KB / 143 行

## 2026-08-02 第六十七批

- 新增 `src/services/monitor-cycle.mjs`，将 `main()` 完整编排抽为可注入依赖的单轮运行周期
- `monitor-15min.mjs` 降至 33 行 / 约 1KB，仅保留配置、CLI 运行与数据断层记录
- 新增 `tests/monitor-cycle.test.mjs`，CI 提升到 38/38 通过

## 2026-08-02 第六十八批

- 清理 `monitor-15min.mjs` 过时 v4/CDP 降级注释，改为当前薄入口说明
- 增强 `tests/monitor-cycle.test.mjs`，覆盖排班参数、干跑模式、HTML 账户名与推送依赖传递
- CI 仍 38/38 通过，`monitor-15min.mjs` 降至 32 行 / 约 0.98KB

## 2026-08-02 第六十九批

- `monitor-5min.mjs` 的 `runCli` 改为复用 `src/services/monitor-cli.mjs` 统一运行器
- 移除 5min 入口本地 `FATAL` 错误处理与直接 `process.exit`
- `tests/refactor-compat.test.mjs` 与完整 CI 38/38 通过

## 2026-08-02 第七十批

- 新增 `src/services/five-min-snapshot.mjs`，抽取 5min 快照文件加载
- `monitor-5min.mjs` 移除本地 `loadRecent5minSnapshots`，统一走独立模块
- 新增 `tests/five-min-snapshot.test.mjs`，CI 提升到 39/39 通过
- `monitor-5min.mjs` 降至约 20.6KB / 420 行

## 2026-08-02 第七十一批

- 新增 `src/services/five-min-push.mjs`，抽取 5min 快速速报推送
- `monitor-5min.mjs` 移除本地 `pushToLark`，改为调用 `pushQuickReport`
- 新增 `tests/five-min-push.test.mjs`，CI 提升到 40/40 通过
- `monitor-5min.mjs` 降至约 19.7KB / 394 行

## 2026-08-02 第七十二批

- 新增 `src/services/five-min-detailed-push.mjs`，抽取整块 15 分钟详细卡片推送
- `monitor-5min.mjs` 移除本地 `pushDetailedCard`，并清理 API/卡片/推送相关导入
- 新增 `tests/five-min-detailed-push.test.mjs`，CI 提升到 41/41 通过
- `monitor-5min.mjs` 降至约 10.7KB / 224 行

## 2026-08-02 第七十三批

- `src/services/five-min-snapshot.mjs` 新增 `saveFiveMinSnapshot`，抽取 JSON/SQLite 快照落盘
- `monitor-5min.mjs` 移除本地快照写入分支与 `nowISO`，统一调用独立保存接口
- 扩展 `tests/five-min-snapshot.test.mjs`，CI 仍 41/41 通过
- `monitor-5min.mjs` 降至约 9.9KB / 201 行

## 2026-08-02 第七十四批

- 新增 `src/services/five-min-collect.mjs`，抽取 HTTP 采集与 CDP 降级编排
- `monitor-5min.mjs` 移除本地采集块，主流程仅处理采集失败退出
- 新增 `tests/five-min-collect.test.mjs`，CI 提升到 42/42 通过
- `monitor-5min.mjs` 降至约 6.5KB / 158 行

## 2026-08-02 第七十五批

- 新增 `src/services/five-min-push-state.mjs`，抽取 last-push 状态与推送频率判断
- `monitor-5min.mjs` 移除文件状态读写与本地 `atomicWriteAtomic`
- 新增 `tests/five-min-push-state.test.mjs`，CI 提升到 43/43 通过
- `monitor-5min.mjs` 降至约 6.2KB / 145 行

## 2026-08-02 第七十六批

- 新增 `src/services/five-min-cycle.mjs`，将 5min 主流程整体抽为可注入依赖的运行周期
- `monitor-5min.mjs` 降为 23 行薄入口，仅保留配置与 CLI 运行
- 新增 `tests/five-min-cycle.test.mjs`，CI 提升到 44/44 通过

## 2026-08-02 第七十七批

- 新增 `scripts/smoke-monitor-cycles.mjs`，用真实 `CONFIG` 配合模拟依赖冒烟验证 15min / 5min 两个运行周期
- 冒烟脚本纳入 CI，完整 CI 提升到 45/45 通过

## 2026-08-02 第七十八批

- `src/services/monitor-cli.mjs` 新增 `onSuccess` 回调，支持常驻与跑完即退场景
- `feishu-listener` / `action-worker` 的 `runCli` 改为复用统一 CLI 运行器
- 扩展 `tests/monitor-cli.test.mjs`，CI 仍 45/45 通过

## 2026-08-02 第七十九批

- 新增 `scripts/check-pm2-paths.mjs`，校验 `ecosystem.config.cjs` 中 12 个应用的启动脚本与重复名称
- 检查脚本纳入 CI，完整 CI 提升到 46/46 通过

## 2026-08-02 第八十批

- `cron-ai-regions` / `cron-sync-shifts` / `cron-daily-summary` / `shift-pusher` / `live-watcher` 的 `runCli` 全部改为复用 `runMonitorCli`
- 移除 5 处本地 `catch + process.exit` 错误处理，服务入口错误策略统一
- CI 仍 46/46 通过

## 2026-08-02 第八十一批

- `scripts/check-pm2-paths.mjs` 扩展校验：env 对象、args、cwd、日志目录、Node 解释器、autorestart 与 cron_restart 组合
- 修正校验规则：常驻应用允许带每日重启 cron，跑完即退应用必须配置 cron
- CI 仍 46/46 通过

## 2026-08-02 第八十二批

- 补齐 `.env.example` 中缺失的项目变量与测试开关
- 新增 `scripts/check-env-example.mjs`，校验代码引用的环境变量已记录或属于系统/运行白名单
- 检查脚本纳入 CI，完整 CI 提升到 47/47 通过

## 2026-08-02 第八十三批

- 新增 `scripts/check-root-entries.mjs`，校验根目录 25 个 `.mjs` 均为兼容/薄入口并指向 `src/db`
- 仅允许 `send-chat.mjs` 作为根目录独立工具，限制根入口不超过 2KB
- 检查脚本纳入 CI，完整 CI 提升到 48/48 通过

## 2026-08-02 第八十四批

- 新增 `scripts/check-refactor-status.mjs`，固化薄入口与核心重构模块约束
- 当前进度：根入口 25 | `src/services` 44 | `src/domain` 13 | tests 48
- 检查脚本纳入 CI，完整 CI 提升到 49/49 通过

## 2026-08-02 第八十五批

- 新增 `src/services/action-store.mjs`，抽取 action 队列读写与串行锁
- `action-worker.mjs` 移除本地锁/队列实现，统一调用独立存储模块
- 新增 `tests/action-store.test.mjs`，CI 提升到 50/50 通过
- `action-worker.mjs` 降至约 17KB / 455 行

## 2026-08-02 第八十六批

- `src/services/action-store.mjs` 新增 `getSnapshotBefore` / `writeAudit`，抽取审计日志与快照读取
- `action-worker.mjs` 移除本地审计实现与 `fs/path/DB` 直接依赖，统一调用存储模块
- 扩展 `tests/action-store.test.mjs`，CI 仍 50/50 通过
- `action-worker.mjs` 降至约 14.4KB / 384 行

## 2026-08-02 第八十七批

- 新增 `src/services/feishu-listener-state.mjs`，抽取 listener 队列、pending 表与队列写锁
- `feishu-listener.mjs` 移除本地队列/待办存储实现及 `crypto` 依赖
- 新增 `tests/feishu-listener-state.test.mjs`，CI 提升到 51/51 通过
- `feishu-listener.mjs` 降至约 29.7KB / 722 行

## 2026-08-02 第八十八批

- `src/services/feishu-listener-state.mjs` 新增 chat state 文件读写与当日重复检测
- `feishu-listener.mjs` 移除本地 `getStateFile` / `loadState` / `saveState` / `checkDuplicateToday`
- 扩展 `tests/feishu-listener-state.test.mjs`，CI 仍 51/51 通过
- `feishu-listener.mjs` 降至约 28.8KB / 699 行

## 2026-08-02 第八十九批

- 新增 `src/services/feishu-listener-commands.mjs`，抽取命令规则、消息识别与计划名解析
- `feishu-listener.mjs` 移除本地 `CMD_RULES` / `msgText` / `isBotMsg` / `isAtMention` / `cleanAtText` / `parseCommand` / `extractPlanName`
- 新增 `tests/feishu-listener-commands.test.mjs`，CI 提升到 52/52 通过
- `feishu-listener.mjs` 降至约 25.4KB / 607 行

## 2026-08-02 第九十批

- 新增 `src/services/feishu-listener-messaging.mjs`，抽取消息发送、表情反应、消息拉取与执行反馈
- `feishu-listener.mjs` 移除本地 `sendMsg` / `addReaction` / `fetchMessages` / `reportResult`
- 新增 `tests/feishu-listener-messaging.test.mjs`，CI 提升到 53/53 通过
- `feishu-listener.mjs` 降至约 22.9KB / 548 行

## 2026-08-02 第九十一批

- 新增 `src/services/feishu-listener-actions.mjs`，抽取确认卡片、操作中文名与 pending 超时扫描
- `feishu-listener.mjs` 移除本地 `sendConfirmCard` / `scanPending` / `ACTION_TEXT`
- 新增 `tests/feishu-listener-actions.test.mjs`，CI 提升到 54/54 通过
- `feishu-listener.mjs` 降至约 20.4KB / 470 行

## 2026-08-02 第九十二批

- 新增 `src/services/feishu-listener-ai.mjs`，抽取账户上下文、计划列表缓存与 AI 对话
- `feishu-listener.mjs` 移除本地 `getAccountContext` / `getCampaignList` / `callAI`
- 新增 `tests/feishu-listener-ai.test.mjs`，CI 提升到 55/55 通过
- `feishu-listener.mjs` 降至约 16KB / 366 行

## 2026-08-02 第九十三批

- `src/services/feishu-listener-ai.mjs` 新增 `handleAtMention`，抽取 @ 提及回复流程
- `feishu-listener.mjs` 移除本地 `handleAtMention`，主循环改为调用 AI 模块
- 扩展 `tests/feishu-listener-ai.test.mjs`，CI 仍 55/55 通过
- `feishu-listener.mjs` 降至约 15.4KB / 349 行

## 2026-08-02 第九十四批

- 新增 `src/services/feishu-listener-dispatch.mjs`，整体抽取预检查、确认入队、队列操作与命令分发
- `feishu-listener.mjs` 移除本地 `dispatch` / `acknowledgeStart` / `precheckAction` / 队列历史函数
- 新增 `tests/feishu-listener-dispatch.test.mjs`，CI 提升到 56/56 通过
- `feishu-listener.mjs` 降至约 6.4KB / 148 行

## 2026-08-02 第九十五批

- 新增 `src/services/feishu-listener-run.mjs`，抽取 listener 主循环、消息轮询与状态更新
- `feishu-listener.mjs` 降为 12 行薄入口，仅保留 CLI 启动
- 新增 `tests/feishu-listener-run.test.mjs`，CI 提升到 57/57 通过

## 2026-08-02 第九十六批

- 新增 `src/services/action-executor.mjs`，抽取飞书反馈、HTTP/CDP 执行、Chrome 熔断与状态回读
- `action-worker.mjs` 移除本地执行器实现及浏览器/API 直接依赖
- 新增 `tests/action-executor.test.mjs`，CI 提升到 58/58 通过
- `action-worker.mjs` 降至约 9.5KB / 257 行

## 2026-08-02 第九十七批

- 新增 `src/services/action-worker-run.mjs`，抽取 `processHead` / `runOnce` / `runWatch` 运行编排
- `action-worker.mjs` 降为 23 行 CLI 入口壳，仅保留 watch/单次启动与兼容导出
- 新增 `tests/action-worker-run.test.mjs`，CI 提升到 59/59 通过

## 2026-08-02 第九十八批

- 新增 `src/services/http-analysis.mjs`，抽取快照、计划分组、效果追踪、规则提取与最近告警计算
- `http-server.mjs` 移除本地辅助函数块并清理 `fs/path/Database` 依赖
- 新增 `tests/http-analysis.test.mjs`，CI 提升到 60/60 通过
- `http-server.mjs` 降至约 7KB / 188 行

## 2026-08-02 第九十九批

- 新增 `src/services/shift-pusher-state.mjs`，抽取日志、车型、日期与防重放推送锁
- `shift-pusher.mjs` 移除本地日志/车型/锁状态实现
- 新增 `tests/shift-pusher-state.test.mjs`，CI 提升到 61/61 通过

## 2026-08-02 第一百批

- 新增 `src/services/shift-pusher-schedule.mjs`，抽取排班读取、班次结束分钟与结束检测
- `shift-pusher.mjs` 移除本地排班读取/结束检测实现
- 新增 `tests/shift-pusher-schedule.test.mjs`，CI 提升到 62/62 通过
- 整体进度：根入口 25 | services 57 | domain 13 | tests 61

## 2026-08-02 第一百零一批

- 新增 `src/services/shift-pusher-eod.mjs`，抽取日终任务触发与去重
- `shift-pusher.mjs` 移除本地 EOD 任务实现与 `spawn` 依赖
- 新增 `tests/shift-pusher-eod.test.mjs`，CI 提升到 63/63 通过
- 整体进度：根入口 25 | services 58 | domain 13 | tests 62

## 2026-08-02 第一百零二批

- 新增 `src/services/shift-pusher-run.mjs`，抽取今日排班缓存、轮询调度、强制模式与主入口
- `shift-pusher.mjs` 移除本地轮询/主流程实现，仅保留 `runShift` 业务与 CLI 入口
- 新增 `tests/shift-pusher-run.test.mjs`，CI 提升到 64/64 通过
- 整体进度：根入口 25 | services 59 | domain 13 | tests 63

## 2026-08-02 第一百零三批

- 新增 `src/services/shift-sync.mjs`，抽取次日排班同步核心（读取、解析、缓存）
- `cron-sync-shifts.mjs` 降为 22 行薄入口，仅保留日志与 CLI 启动
- 新增 `tests/shift-sync.test.mjs`，CI 提升到 65/65 通过
- 整体进度：根入口 25 | services 60 | domain 13 | tests 64

## 2026-08-02 第一百零四批

- 新增 `src/services/ai-regions-core.mjs`，抽取 HTTP、Cookie、统计查询、区域拉取与飞书推送
- `cron-ai-regions.mjs` 移除本地 HTTP/统计/推送实现，降至 85 行
- 新增 `tests/ai-regions-core.test.mjs`，CI 提升到 66/66 通过
- 整体进度：根入口 25 | services 61 | domain 13 | tests 65

## 2026-08-02 第一百零五批

- 新增 `src/services/daily-summary-core.mjs`，抽取会话读取、直播/短视频全天拉取、主播名与推送
- `cron-daily-summary.mjs` 移除本地核心实现，降至 81 行
- 新增 `tests/daily-summary-core.test.mjs`，CI 提升到 67/67 通过
- 整体进度：根入口 25 | services 62 | domain 13 | tests 66

## 2026-08-02 第一百零六批

- 新增 `src/services/daily-report-core.mjs`，抽取近 7 天对比、时段分组与日报卡片构建
- `cron-daily-report.mjs` 移除本地对比/卡片构建实现
- 新增 `tests/daily-report-core.test.mjs`，CI 提升到 68/68 通过
- 整体进度：根入口 25 | services 63 | domain 13 | tests 67

## 2026-08-02 审查修复

- `cron-daily-report` 推送改为 `await` 并移除 `process.exit`，CLI 错误由统一入口捕获
- `http-analysis` 快照索引缓存改为按 `dataDir` 隔离
- `shift-pusher-run` 轮询路径透传 `dataDir` / 排班读取函数
- `daily-summary-core` 增加空班次保护
- 清理 `cron-daily-report` 未使用导入，补充缓存隔离与空班次测试

## 2026-08-02 第一百零七批

- 新增 `src/services/shift-pusher-shift.mjs`，抽取单班次数据拉取、写表、推送与 EOD 触发
- `shift-pusher.mjs` 降为 16 行入口壳，仅保留环境变量与调度接线
- 新增 `tests/shift-pusher-shift.test.mjs`，CI 提升到 69/69 通过
- 整体进度：根入口 25 | services 64 | domain 13 | tests 68

## 2026-08-02 第一百零八批

- 新增 `src/services/alert-cards.mjs`，抽取余额/账户预算告警卡片构建
- `alert-push.mjs` 移除本地卡片构建与 TOP/撞线计算，降至 128 行
- 新增 `tests/alert-cards.test.mjs`，CI 提升到 70/70 通过
- 整体进度：根入口 25 | services 65 | domain 13 | tests 69

## 2026-08-02 第一百零九批

- 修复 `http-server` 抽取后未导出 `DB_PATH` / `ANOMALY_*` 常量导致的运行时引用错误
- 新增 `src/services/http-feedback-store.mjs`，抽取反馈写锁与记录
- `http-server.mjs` 移除本地反馈存储实现，降至 155 行
- 新增 `tests/http-feedback-store.test.mjs`，CI 提升到 71/71 通过
- 整体进度：根入口 25 | services 66 | domain 13 | tests 70

## 2026-08-02 第一百一十批

- 新增 `src/services/five-min-detailed-context.mjs`，抽取详细卡片指标/趋势/TOP 上下文
- `five-min-detailed-push.mjs` 移除本地指标组装，降至 76 行
- 新增 `tests/five-min-detailed-context.test.mjs`，CI 提升到 72/72 通过
- 整体进度：根入口 25 | services 67 | domain 13 | tests 71

## 2026-08-02 第一百一十一批

- 新增 `src/services/daily-report-run.mjs`，抽取日报采集、对比、卡片与推送运行编排
- `cron-daily-report.mjs` 降为 7 行入口壳
- 新增 `tests/daily-report-run.test.mjs`，CI 提升到 73/73 通过
- 整体进度：根入口 25 | services 68 | domain 13 | tests 72

## 2026-08-02 第一百一十二批

- `scripts/check-refactor-status.mjs` 新增服务单文件体积守卫（≤ 20KB）
- 当前 `src/services` 最大文件约 12.7KB，满足约束
- CI 仍 73/73 通过

## 2026-08-02 第一百一十三批

- 新增 `src/services/feishu-listener-handlers.mjs`，拆分 info/reject/暂停/预算/执行命令处理器
- `feishu-listener-dispatch.mjs` 降至 56 行，仅保留分支路由
- 新增 `tests/feishu-listener-handlers.test.mjs`，CI 提升到 74/74 通过
- 整体进度：根入口 25 | services 69 | domain 13 | tests 73

## 2026-08-02 第一百一十四批

- 新增 `src/services/action-process.mjs`，抽取 action 队首处理纯编排
- `action-worker-run.mjs` 降至 57 行，仅保留默认依赖装配与 runOnce/runWatch
- 新增 `tests/action-process.test.mjs`，CI 提升到 75/75 通过
- 整体进度：根入口 25 | services 70 | domain 13 | tests 74

## 2026-08-02 第一百一十五批

- `daily-summary-core.mjs` 新增 `buildDailySummaryMessage`，抽取日汇总模板
- `cron-daily-summary.mjs` 移除本地消息构建，降至 62 行
- 扩展 `tests/daily-summary-core.test.mjs`，CI 仍 75/75 通过

## 2026-08-02 第一百一十六批

- `check-refactor-status.mjs` 新增 `runCli` 入口行数守卫（≤ 120 行）
- 守卫发现 `live-watcher.mjs` 超限，新增 `live-watcher-run.mjs` 并将入口降为 8 行
- 新增 `tests/live-watcher-run.test.mjs`，CI 提升到 76/76 通过
- 整体进度：根入口 25 | services 71 | domain 13 | tests 75

## 2026-08-02 第一百一十七批

- `ai-regions-core.mjs` 新增 `summarizeAiRegions` / `buildAiRegionsReport` / `todayDateCN` / `fmtMoney`
- `cron-ai-regions.mjs` 移除本地汇总与报告模板，降至 62 行
- 扩展 `tests/ai-regions-core.test.mjs`，CI 仍 76/76 通过

## 2026-08-02 第一百一十八批

- 新增 `src/services/http-snapshot.mjs`，拆分快照读取、文件索引与 DB 查询
- `http-analysis.mjs` 通过 `export *` 保持对外接口兼容，并移除本地快照/DB 实现
- 新增 `tests/http-snapshot.test.mjs`，CI 提升到 77/77 通过
- 整体进度：根入口 25 | services 72 | domain 13 | tests 76

## 2026-08-02 第一百一十九批

- 新增 `src/services/http-delivery.mjs` 与 `src/services/http-effect.mjs`
- `http-analysis.mjs` 降为兼容再导出入口，保留最近快照/告警/清洗函数
- 新增 `tests/http-delivery.test.mjs` / `tests/http-effect.test.mjs`，CI 提升到 79/79 通过
- 整体进度：根入口 25 | services 74 | domain 13 | tests 78

## 2026-08-02 第一百二十批

- 新增 `src/services/daily-report-push.mjs`，抽取日报卡片推送与失败抛出
- `daily-report-run.mjs` 移除本地推送实现
- 新增 `tests/daily-report-push.test.mjs`，CI 提升到 80/80 通过
- 整体进度：根入口 25 | services 75 | domain 13 | tests 79

## 2026-08-02 第一百二十一批

- 新增 `src/services/shift-pusher-message.mjs`，抽取换班推送消息构建
- `shift-pusher-shift.mjs` 改用消息构建模块
- 新增 `tests/shift-pusher-message.test.mjs`

## 2026-08-02 第一百二十二批

- 新增 `src/services/daily-report-data.mjs`，抽取日报数据读取与指标汇总
- `daily-report-run.mjs` 移除本地读取/指标计算
- 新增 `tests/daily-report-data.test.mjs`

## 2026-08-02 第一百二十三批

- 新增 `src/services/daily-summary-common.mjs`，抽取日志、日期、排班读取公共工具
- `daily-summary-core.mjs` 改为再导出公共模块
- 新增 `tests/daily-summary-common.test.mjs`

## 2026-08-02 第一百二十四批

- 新增 `src/services/daily-summary-fetch.mjs`，抽取直播/短视频全天拉取
- `daily-summary-core.mjs` 移除本地 fetch 实现

## 2026-08-02 第一百二十五批

- 新增 `src/services/shift-pusher-snapshot.mjs`，抽取换班首场快照修正
- `shift-pusher-shift.mjs` 移除本地首场修正并清理 `fs/path` 依赖
- 新增 `tests/shift-pusher-snapshot.test.mjs`
- 整体进度：根入口 25 | services 80 | domain 13 | tests 83，CI 84/84 通过

## 2026-08-02 审查修复

- `daily-report-data.loadDailyEntries` 增加 `logFn`，恢复缺失/损坏/无数据分支业务日志
- `daily-summary-fetch` 对 `client.cookieData?.headers` 增加空值保护
- `daily-summary-core` 改为显式 re-export，消除 `export *` 静默覆盖风险
- 补充 `daily-report-data` 文件缺失、JSON 损坏、无有效采样三个失败路径测试
- CI 仍 84/84 通过

## 2026-08-02 第一百二十六至一百三十五批

- 126: 新增 `daily-report-insights.mjs`，抽取日报洞察
- 127: 新增 `daily-report-slots.mjs`，抽取分时段增量
- 128: 新增 `daily-report-collect.mjs`，抽取最终采集
- 129: 新增 `ai-regions-http.mjs`，拆分 AI 区域 HTTP/Cookie/拉取
- 130: 新增 `ai-regions-report.mjs`，拆分汇总与报告模板
- 131: 新增 `ai-regions-push.mjs`，拆分飞书推送
- 132: 新增 `daily-summary-push.mjs`，拆分主播名/推送/消息
- 133: 新增 `shift-pusher-sheet.mjs`，拆分写表与主播名读取
- 134: 新增 `shift-pusher-fetch.mjs`，拆分换班数据拉取
- 135: 完成 10 批模块统一接入与测试
- 整体进度：根入口 25 | services 89 | domain 13 | tests 88，CI 89/89 通过

下一步：按约定进行本轮 10 批后的统一代码审查。

## 2026-08-02 统一审查修复（126-135 批）

- 新增 `src/services/daily-report-html.mjs`，修复日报 HTML 生成脚本缺失问题
- `daily-report-run` 改为直接生成 HTML，并将最终采集切到 `src/services/monitor-15min-cli.mjs`
- `ai-regions-report` 恢复标题与【5区总计】汇总行，避免消息模板回归
- `daily-summary-push.readAnchorNames` 增加 `getLocalDateFn` 注入
- `daily-report-insights` 增加有限数值保护，`daily-report-collect` 增加响应错误监听
- `shift-pusher-eod` 日终任务切到 `src/services/cron-*-cli.mjs`，避免新代码引用根业务模块
- 新增 `tests/daily-report-html.test.mjs`，CI 提升至 90/90 通过
- 整体进度：根入口 25 | services 90 | domain 13 | tests 89

## 2026-08-02 第一百三十六至一百四十五批

- 136: 新增 `five-min-context.mjs`，下沉 5min 详细卡片上下文
- 137: 新增 `daily-report-comparison.mjs`，抽取日报同比/7日均
- 138: 新增 `effect-rules.mjs`，抽取操作效果规则
- 139: 新增 `ai-context-prompt.mjs`，抽取 AI 上下文与提示词
- 140: 新增 `action-guard.mjs`，抽取 action 编码守卫
- 141: 新增 `daily-report-wait.mjs`，抽取日报等待与去重
- 142: 新增 `shift-metrics.mjs`，抽取换班 CPL/归一化
- 143: 新增 `snapshot-time.mjs`，抽取快照时间解析
- 144: 新增 `ai-regions-stats.mjs`，抽取 AI 区域行统计
- 145: 新增 `feishu-command-parser.mjs`，下沉飞书命令解析
- 整体进度：根入口 25 | services 90 | domain 23 | tests 99，CI 100/100 通过

## 2026-08-02 第一百四十六至一百五十五批

- 146: 新增 `campaign-index.mjs`，拆分计划索引
- 147: 新增 `trend-analysis.mjs`，拆分趋势检测
- 148: 新增 `baseline-analysis.mjs`，拆分昨日/多日均值基线
- 149: 新增 `window-analysis.mjs`，拆分 3 小时窗口分析
- 150: 新增 `lifecycle-analysis.mjs`，拆分生命周期推断
- 151: 新增 `quick-card-top.mjs`，抽取速报 TOP5 增量
- 152: 新增 `progress-bar.mjs`，统一文本进度条
- 153: 新增 `monitor-summary-lines.mjs`，拆分监控摘要文本
- 154: 新增 `feishu-listener-queue.mjs`，拆分 listener 队列操作
- 155: 新增 `ai-regions-api.mjs`，拆分 AI 区域 HTTP API 层
- 统一审查修复：`ai-regions-api` 恢复 `[ai-regions]` 日志前缀
- 整体进度：根入口 25 | services 92 | domain 31 | tests 109，CI 110/110 通过

## 2026-08-02 第一百五十六至一百七十五批

- 156: 新增 `api-normalization.mjs`，拆分 API 项目归一化
- 157: 新增 `api-snapshot.mjs`，拆分 5min 快照构建与回退
- 158: 新增 `five-minute-schedule.mjs`，拆分运行窗口/推送决策
- 159: 新增 `parse-utils.mjs`，拆分预算/快照时间解析
- 160: 新增 `delivery-summary.mjs`，拆分投放形式分类与分组汇总
- 161: 新增 `card-sections.mjs`，拆分卡片节奏/指标区块
- 162: 新增 `card-alert-classifier.mjs`，拆分卡片告警分类
- 163: 新增 `daily-log-entry.mjs`，拆分日报日志条目
- 164: 新增 `html-report-decision.mjs`，拆分 HTML 报表发送决策
- 165: 新增 `shift-pusher-cache.mjs`，拆分换班排班缓存
- 166: 新增 `daily-summary-request.mjs`，拆分日汇总请求体/行解析
- 167: 新增 `snapshot-file.mjs`，拆分快照文件读取
- 168: 新增 `snapshot-db.mjs`，拆分快照 DB 查询
- 169: 新增 `feishu-message-format.mjs`，拆分飞书执行结果消息
- 170: 新增 `pending-suggestions.mjs`，拆分待处理建议合并
- 171: 新增 `alert-card-lines.mjs`，拆分告警卡片文本
- 172: 新增 `shift-schedule.mjs`，拆分换班结束判断
- 173: 新增 `effect-evaluation.mjs`，拆分操作效果评级
- 174: 新增 `five-min-cycle-log.mjs`，拆分 5min 日志格式
- 175: 新增 `action-result.mjs`，拆分 action 结果与审计
- 统一审查修复：5min 非直播日志保留当前时刻
- 整体进度：根入口 25 | services 95 | domain 48 | tests 129，CI 130/130 通过

## 2026-08-02 最优先模块拆分

- `daily-report-html.mjs` 模板下沉到 `daily-report-html-template.mjs`
- `report-html.mjs` 表格/漏斗片段下沉到 `report-html-parts.mjs`
- `alerts.mjs` 拆分为 `window-alerts`、`multiday-alerts`、`plan-alerts`
- `analyze.mjs` 拆分为计划分类、页面校准、计划增量、节奏分析
- `card-builder.mjs` TOP 与基线区块下沉到 `card-top-lines`、`card-baselines`
- `api-actions.mjs` 核心入队/回滚下沉到 `api-actions-core`
- `api-snapshots-trend.mjs` 聚合逻辑下沉到 `api-snapshots-trend-data`
- `http-server.mjs` 请求路由下沉到 `http-server-handler`
- `shift-pusher-shift.mjs` CLI/重试下沉到 `shift-pusher-lark`
- `action-process.mjs` HTTP/CDP 重试下沉到 `action-process-steps`
- 统一审查修复：清理 `http-server` 未使用的依赖参数
- 整体进度：根入口 25 | services 98 | domain 59 | tests 136，CI 137/137 通过

## 2026-08-02 29 个大文件拆完

- 服务层 18 个大文件全部拆至 4KB 以下，含 `static`、`action-executor`、`alert-push`、`live-watcher`、`monitor-push`、`daily-summary`、`listener-state`、`api-live`、`five-min-collect`、`listener-ai`、`shift-pusher-run`、`handlers`、`shift`、`five-min-cycle`、`action-process`、`daily-report-run`、`api-actions`、`api-snapshots-trend`
- 领域层 11 个大文件全部拆至 4KB 以下，含 `report-html`、`analyze`、`daily-report-html-template`、`five-min-context`、`multiday-alerts`、`report-html-parts`、`plan-alerts`、`card-builder`、`monitor-summary-lines`、`baseline-analysis`、`detailed-card`
- 新增大量单一职责领域/服务模块，原入口保持兼容导出
- 当前进度：根入口 25 | services 122 | domain 99 | tests 136，CI 137/137 通过
- 全量 `src` 语法检查、分层 import、根入口与约束检查均通过

## 2026-08-01 第二十五批

- 新增 `src/db/dual-write.mjs`，支持 `DB_V2_DUAL_WRITE=1` 时旧 writer 与 v2 compat 并行写入
- v2 compat `insertSnapshot` 增加幂等删除，避免重复快照
- `monitor-5min`、`monitor-15min`、`action-worker` 接入 dual-write 包装
- 默认关闭并行写入，生产行为不变
- `.env.example` 增加 `DB_V2_DUAL_WRITE=0`
- CI 5/5 通过

下一步建议：继续统一 `src/db/` 与 `src/db/v2/` 两套数据库入口，随后做根目录文档与临时文件归档。

## 2026-08-01 审查修复第二轮

- 4 个 cron canonical 模块改为导出 `runCli()`，新增 `cron-*-cli.mjs` 独立入口
- PM2 配置切到 cron CLI 入口，并删除 daemon 中旧路径的停止 cron 条目
- 新增 `src/db/index.mjs` 数据库统一入口，覆盖生产写入/物化刷新/快照与 v2 命名空间
- `tests/refactor-compat.test.mjs` 增加 cron 导入安全与数据库统一入口测试，CI 5/5 通过

下一步建议：根目录临时文件与历史文档归档，随后继续收敛 `src/db/` 与 `src/db/v2/`。

## 2026-08-01 第十八批

- 创建 `archive/root-debug/`，归档 45 个根目录调试残留、备份与旧日志
- 归档前确认无生产/测试引用
- 根目录代码文件从 92 降至 58，全部文件从 231 降至 186
- CI 5/5 通过

下一步建议：继续归档历史方案文档到 `docs/archive/`，并收敛 `src/db/` 与 `src/db/v2/`。

## 2026-08-01 第十九批

- 创建 `docs/archive/` 与归档说明
- 归档 22 个历史方案/评审/审查/选型/决策文档
- 根目录 Markdown 从 53 降至 31
- CI 5/5 通过

下一步建议：继续收敛 `src/db/` 与 `src/db/v2/`，并迁移 `pm2-15min` / `pm2-5min` 到 `src/services/`。

## 2026-08-01 第二十批

- 迁移 `calibrate-page.mjs` 到 `src/cdp/calibrate-page.mjs`
- 迁移 `oceanengine-5min-check.mjs` 到 `src/services/monitor-5min.mjs`
- PM2 配置已切换为 `src/services/monitor-5min.mjs`，并删除旧停止的 `pm2-5min` 条目
- CI 5/5 通过

下一步建议：迁移 `oceanengine-monitor-v3.mjs` 到 `src/services/monitor-15min.mjs`。

## 2026-08-01 第二十一批

- 迁移 `data-consistency-check.mjs` 到 `src/cdp/data-consistency-check.mjs`
- 迁移 `oceanengine-monitor-v3.mjs` 到 `src/services/monitor-15min.mjs`
- 更新 monitor-v3 全部相对导入与 `.feishu-webhook` 根路径
- PM2 配置已切换为 `src/services/monitor-15min.mjs`，并删除旧停止 `pm2-15min` 条目
- CI 5/5 通过

下一步建议：继续收敛 `src/db/` 与 `src/db/v2/`，并处理剩余根目录文档。

## 2026-08-01 第二十二批

- 继续归档 8 个历史文档到 `docs/archive/`
- 根目录 Markdown 从 31 降至 23
- CI 5/5 通过

下一步建议：继续收敛 `src/db/` 与 `src/db/v2/`。

## 2026-08-01 第二十三批

- `monitor-5min`、`monitor-15min`、`action-worker` 数据库引用改为 `src/db/index.mjs` 统一入口
- 生产写入/物化刷新统一经由 `src/db/index.mjs` 转发
- `action-queue-worker` 已重启，CI 5/5 通过

下一步建议：继续对比 schema，逐步把 v2 迁移为唯一数据库实现。

## 2026-08-01 审查修复第三轮

- `monitor-5min`、`monitor-15min` 改为导出 `runCli()`，新增独立 CLI 入口
- PM2 配置与根兼容入口切到 `monitor-*-cli.mjs`
- `action-worker` 恢复直接引用 `src/db/writer.mjs`，避免统一入口加载多余模块
- `src/db/index.mjs` 明确标注旧 writer 为当前生产基线，v2 暂为迁移候选
- 修复有效文档中指向已归档文件的引用
- CI 5/5 通过

## 2026-08-01 第二十四批

- v2 `snapshots` 增加 `status` 兼容列与迁移 `003_compat_status.sql`
- v2 DAL 迁移改为逐语句执行并幂等跳过重复列/已存在对象
- 新增 `src/db/v2/compat-writer.mjs`，提供与旧 writer 一致的 `insertSnapshot` / `verifyConsistency` / `insertAction` / `closeDb`
- `src/db/index.mjs` 暴露 `v2Compat` 命名空间
- CI 5/5 通过

下一步建议：用 v2 兼容层做并行写入灰度，确认数据一致后切换生产。
