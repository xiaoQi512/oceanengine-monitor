# 巨量引擎监控系统整体架构规划 — 评审反馈

> **评审文档**: `架构规划_整体方案.md` v1.0
> **评审模型**: Qwen 3.7 Max（通义千问）
> **评审日期**: 2026-06-28
> **文档用途**: 转发给架构制作者 agent，用于 v1.1 修订

---

## 一、总体评价

**综合评分: 82/100**

| 维度 | 评分 | 评价 |
|---|---|---|
| 架构分层 | A | L1-L4 职责清晰、解耦合理 |
| 技术选型 | B+ | SQLite+DuckDB 双引擎匹配单机场景 |
| 迁移策略 | A- | JSON 双写期+分阶段落地，风险可控 |
| 文档质量 | B | 决策矩阵扎实，缺 TOC/术语表/序列图 |
| **现状对齐** | **D** | **致命：已落地的 HTTP API 主方案被完全忽视** |
| 生产完备度 | B- | 缺数据质量/告警去重/SLO/灾备/测试计划 |
| 工期估算 | C+ | 2 周偏乐观 30-50%，未留缓冲 |

### 7 项优点（应保留）

1. **四层架构分层清晰** — L1 采集 / L2 存储 / L3 分析 / L4 服务，职责无重叠
2. **量化目标明确** — 6 项指标有"当前→目标"对照，可度量可验收
3. **决策矩阵扎实** — 7 个关键决策均列出否决项和核心理由
4. **渐进式迁移** — JSON 双写 1 周验证期、分阶段退役，保守稳健
5. **非目标声明** — 明确不做实时流式/分布式/自研前端，聚焦核心路径
6. **SQLite + DuckDB 双引擎** — 分工合理，规避了 DuckDB 频繁小事务痛点
7. **退役清单清晰** — 6 个文件/目录的退役阶段与替代方案一一对应

---

## 二、P0 关键问题（3 项，必须修正否则无法推进）

### 🔴 P0-1：已落地的 HTTP API 主方案被完全忽视（最严重）

**源码证据**:
- `oceanengine-monitor-v3.mjs` 第 2 行: `// v4: HTTP API主方案 + CDP降级（速度提升30-60倍）`
- `oceanengine-api-client.mjs` 已实现完整 HTTP API 客户端（Cookie 提取 + 3 个逆向 API 端点 + 自动登录）
- `oceanengine-monitor-v3.mjs` 第 24 行: `import { createClient as createApiClient, collectAllData } from './oceanengine-api-client.mjs'`
- 生产环境 PM2 日志每天稳定运行 `🚀 巨量引擎监控启动 (v4: HTTP API + CDP降级)`

**问题**: 规划把 `playwright-core 统一接入` 作为 L1 主路径，`oceanengine-api-client.mjs` **在文档中完全没出现**。P1 走 playwright 会重复造轮子，废掉已稳定的 "HTTP 主 + CDP 兜底" 方案。

**修正方案**:
```
L1 采集层 应重写为:
  ├── 内部 API 客户端（主路径，已实现）  ← oceanengine-api-client.mjs
  ├── CDP 客户端（Cookie 提取+自动登录）  ← 仅保留 cdp-client.mjs
  └── playwright-core（异构平台兜底，腾讯/百度用，非主路径）
```

**理由**:
- 巨量走 API（已验证稳定），速度提升 30-60 倍
- CDP 仅承担 Cookie 提取 + 自动登录 + API 失效兜底
- playwright-core 留给真正需要 DOM 操作的异构平台（腾讯/百度）

### 🔴 P0-2：Chrome CDP + Playwright `newContext()` 不可行

**问题**: 文档 3.1 节写 `browser.contexts()[0]` 或 `newContext()` 隔离。但 **Chrome 通过 `connectOverCDP` 连接时无法创建新 context** — 这是 Chrome 的原生限制，只有 Playwright 自己启动的浏览器（`chromium.launch()`）才支持多 context。

5 个 AI 区域号写"同 Chrome 不同 tab 复用登录态"，但 tab 级别无隔离 — cookies/localStorage 是 context 级别的，同 context 下所有 tab 共享，无法区分账户。

**影响**: 若按文档实施，5 个 AI 区域号无法同时采集（互相覆盖登录态）。

**修正方案（三选一）**:

| 方案 | 做法 | 推荐度 |
|------|------|--------|
| A 渐进 | P1 仅迁移真人号走 playwright；AI 区域号维持现有 CDP 方案 | ⭐⭐⭐ 推荐 |
| B 多实例 | 每个账户独立 Chrome 实例（不同 `--remote-debugging-port`） | ⭐⭐ 长期目标 |
| C launch | 用 Playwright `chromium.launch()` + `userDataDir` | ⭐ 需重新处理登录 |

**注意**: 如果采纳 P0-1 的修正（巨量走 HTTP API），本问题自动降级 — API 不需要浏览器 context 隔离，仅 Cookie 提取依赖 CDP。

### 🔴 P0-3：SQLite 外键定义错误 + 缺少时间分区

**问题 A**: `campaigns` 表主键仅为 `campaign_id`（单列 TEXT PRIMARY KEY），同时又声明 `UNIQUE(campaign_id, account_id, platform)`。主键与唯一约束矛盾。`campaign_snapshots` 的 `FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)` 引用的是单列主键，跨平台/跨账户 campaign_id 重复时会关联错误。

**修正**:
```sql
CREATE TABLE campaigns (
  campaign_id   TEXT NOT NULL,
  account_id    TEXT NOT NULL,
  platform      TEXT NOT NULL DEFAULT 'oceanengine',
  campaign_name TEXT NOT NULL,
  status TEXT, daily_budget REAL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (campaign_id, account_id, platform)  -- 复合主键
);
-- campaign_snapshots 外键同步改为复合
FOREIGN KEY (campaign_id, account_id, platform)
  REFERENCES campaigns(campaign_id, account_id, platform)
```

**问题 B**: `campaign_snapshots` 缺少分区字段。高频查询（日报聚合、时段分析）依赖 `date(snapshot_time)` 函数，导致索引失效。

```sql
-- 建议增加生成列
snapshot_date TEXT GENERATED ALWAYS AS (date(snapshot_time)) STORED,
snapshot_hour INTEGER GENERATED ALWAYS AS (strftime('%H', snapshot_time)) STORED,
-- 索引改为
CREATE INDEX idx_snap_date_account ON campaign_snapshots(snapshot_date, account_id);
```

**问题 C**: `alerts` 和 `daily_summaries` 表缺少 `account_id` + `platform` 字段，多账户场景无法区分来源。

---

## 三、P1 重要改进建议（7 项）

### P1-1：PM2 进程 CDP 并发竞争（原文档未识别）

**冲突时刻**（从 `ecosystem.config.cjs` 实测）:

| 时刻 | 进程A | 进程B | 风险 |
|------|-------|-------|------|
| 每 :00/:15/:30/:45 | pm2-5min | pm2-15min | 同时操作 CDP |
| 23:05 | pm2-daily-report | pm2-daily-summary | 同上 |
| 21:30 | pm2-ai-regions (5账户) | pm2-5min/15min | 遍历5账户耗时长 |

**建议**: 错开 cron（`pm2-15min: 2,17,32,47`），并在 `pw-client.mjs` 内建文件锁互斥。

### P1-2：OVUI 兼容性验证应前置到 P1 第一步

文档将 OVUI 兼容性标记为"风险"但 P1 步骤顺序是先封装后迁移。正确顺序：

1. **先写 OVUI 验证脚本**（分页/排序/下拉框/日期选择）
2. 根据验证结果决策：兼容→继续；不兼容→保留 CDP fallback
3. 再封装 `pw-client.mjs`
4. 再迁移脚本

**注意**: `wait-utils.mjs` 中的 OVUI 专用等待逻辑（`waitForTableRows`、popper 异步渲染检测）**不能被 playwright auto-waiting 覆盖**，应单独保留或选择性退役。

### P1-3：缺少 Schema 版本迁移系统

SQLite 不支持完整 `ALTER TABLE`。需引入 `migrations/` 目录 + `schema_migrations` 表：

```sql
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now','localtime')),
    checksum TEXT
);
```

### P1-4：缺少统一数据访问层（DAL）

各脚本直接写 SQL，表结构变更需改所有脚本。建议封装 `db-access.mjs`，所有数据操作集中于此。

### P1-5：统一配置管理

`account_id`、`chat_id`、飞书 token 等硬编码在各脚本中。引入 `config/accounts.json` + `config/app.json`，PM2 通过 `env` 注入配置路径。

### P1-6：缺少系统自监控（Observability）

`monitor-daemon.mjs` 不检查 SQLite 写入延迟、playwright 页面加载耗时、DuckDB ATTACH 状态、飞书推送失败率。建议新增 `system_metrics` 表 + 定义 SLO（采集成功率 ≥99% / 查询 P95 ≤500ms）。

### P1-7：缺少测试计划

全文档无测试/回归方案。每阶段应有明确验证：
- P1: OVUI 分页/排序/日期选择回归
- P2: JSON→SQLite 导入幂等性 + 字段一致性
- P3: DuckDB 聚合结果与 SQLite 交叉校验

---

## 四、P2 优化建议（5 项）

1. **数据保留策略**: 热数据 30 天 SQLite → 温数据 12 月 Parquet → 冷数据按需保留。归档脚本同时清理主库老数据。
2. **DuckDB API 需 PoC**: `@duckdb/node-api` 实际 API 可能与文档写的不同，且 Windows 中文路径有 Unicode 风险（DuckDB 已知 Windows 路径编码 bug）。建议 P2 早期就做 PoC，失败降级到 SQLite 聚合。
3. **异常检测算法**: Z-SCORE 适合正态分布，CPA 是右偏长尾，应改用 **MAD（中位数绝对偏差）** 或 **IQR**。
4. **DuckDB 版本风险**: 当前 `@duckdb/node-api` 是 0.x，1.0 前 API 变化频繁。建议锁定版本或等 v1.0 稳定。
5. **统一字段命名**: 架构文档用 `consume`，现有系统用 `spend`。统一为 `spend`（与巨量引擎页面一致）。时区策略：存储 UTC，查询时 +8h。

---

## 五、风险提醒（7 项）

| # | 风险 | 概率 | 影响 | 缓解 |
|---|------|------|------|------|
| 1 | HTTP API 主方案被忽视，走 playwright 弯路 | **极高** | **极高** | 见 P0-1 |
| 2 | CDP connectOverCDP 不支持 newContext | 高 | 高 | 见 P0-2 |
| 3 | OVUI 事件 playwright 部分场景不兼容 | 中→高 | 高 | 前置验证+保留 fallback |
| 4 | PM2 多进程 CDP 并发竞争 | 高 | 高 | cron 错开+文件锁 |
| 5 | DuckDB Node API Windows 不稳定 | 中 | 中 | P2 早期 PoC |
| 6 | 2 周工期偏紧导致中间态无法回滚 | 中 | 高 | 延至 3+1 周 |
| 7 | P4 自动调预算误操作 | 低 | 极高 | 飞书审批+安全护栏字段 |

---

## 六、工期修正建议

| 阶段 | 规划估时 | 修正估时 | 偏差原因 |
|------|---------|---------|---------|
| P1 | 1-2 天 | **3-4 天** | 需先 PoC 验证 + API 方案评估 |
| P2 | 2-3 天 | **4-5 天** | 2184 JSON 导入 + 6 脚本改造 + 双写期 |
| P3 | 3-4 天 | **4-5 天** | Node API 较新 + Windows 兼容调试 |
| P4 | 按需 | **至少 1 周** | 飞书审批+火山方舟+执行层 |

---

## 七、v1.1 需回答的 3 个关键问题

1. **是否真的需要 playwright-core 作为 L1 主路径？** — 当前生产环境已是 HTTP API 主方案+CDP 降级，应优先复用已验证路径
2. **DuckDB ATTACH 零拷贝是真的吗？** — 要求 PoC 验证 100 万行聚合延迟，否则回退 SQLite 聚合
3. **P4 飞书审批流如何设计？** — chat_id 新增 bot 监听 vs webhook 模式

---

## 八、建议的 v1.1 L1 采集层架构（修正后）

```
┌─────────────────────────────────────────────────────────┐
│  L1 采集层  HTTP API 主 + CDP 兜底 + Playwright 异构     │
│                                                         │
│  巨量引擎（已验证稳定）:                                  │
│    oceanengine-api-client.mjs → HTTP 直连（30-60x提速）  │
│    cdp-client.mjs → Cookie 提取 + 自动登录 + API降级     │
│                                                         │
│  异构平台（腾讯/百度，预留）:                              │
│    playwright-core → DOM 操作兜底                        │
│                                                         │
│  退役: calibrate-page.mjs 评估后选择性退役               │
│  保留: wait-utils.mjs OVUI 专用等待逻辑                  │
└──────────────────────┬──────────────────────────────────┘
```

---

## 九、评审人信息

| 项目 | 内容 |
|------|------|
| **模型名称** | Qwen 3.7 Max（通义千问） |
| **模型开发商** | 阿里云 |
| **评审方式** | 静态分析 + 项目上下文交叉验证（MEMORY.md / ecosystem.config.cjs / 源码 / 日志） |
| **文档命名** | `架构规划_评审反馈_Qwen3.7Max.md` |
| **评审完成时间** | 2026-06-28T00:30+08:00 |

---

*本文档可直接作为 v1.1 修订的输入，按 P0 → P1 → P2 优先级逐条落实。*
