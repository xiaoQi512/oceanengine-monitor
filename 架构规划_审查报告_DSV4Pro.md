# 巨量引擎监控系统整体架构规划 — 深度审查报告

> **审查者**: DeepSeek V4 Pro（WorkBuddy Ask 模式）
> **审查日期**: 2026-06-27 23:30
> **被审查文档**: `架构规划_整体方案.md` v1.0
> **审查方法**: 静态分析 + 项目上下文交叉验证（MEMORY.md / ecosystem.config.cjs / 数据库方案设计报告）

---

## 一、总体评价

文档结构完整，四层分层清晰，关键决策有对比表格，落地时间线务实。**基础评分 7.5/10**。

核心优点和核心缺陷都很突出：

- **优点**: 决策矩阵扎实（CDP → playwright 的论证充分）、迁移策略保守合理（双写验证期）、非目标声明清晰（不做分布式/流式）
- **缺陷**: 遗漏了 3 个关键模块（schema migration / 自监控 / DAL）、低估了 playwright 在 OVUI 场景的适配难度、未识别 PM2 进程 CDP 并发竞争——这是已经存在的高风险 bug

---

## 二、优点清单

| # | 优点 | 细节 |
|---|------|------|
| 1 | **量化目标明确** | 6 项指标全部有"当前→目标"对照，可度量、可验收 |
| 2 | **决策矩阵扎实** | 7 个关键决策点均列出了否决项和核心理由，防止后续翻案 |
| 3 | **技术选型务实** | playwright-core 而非 puppeteer、SQLite 而非 PG、原生 http 模块而非 Express——都是"够用就好"的克制选择 |
| 4 | **迁移策略保守** | JSON 双写 1 周验证 → 停 JSON → 历史导入，有缓冲期、有回退路径 |
| 5 | **非目标声明** | 明确不做实时流式、不做分布式、不自建前端——防止范围蔓延 |
| 6 | **风险矩阵完备** | 5 项风险均标注概率、影响、缓解措施 |
| 7 | **退役清单清晰** | 6 个文件/目录的退役阶段和替代方案一一对应 |
| 8 | **保持兼容性** | 监控逻辑、告警类型、飞书推送、OVUI 交互规则全部保留，降低迁移阻力 |

---

## 三、缺陷与遗漏

### 3.1 结构性缺陷（影响架构正确性）

#### 缺陷 1：缺少 Schema 版本迁移系统 🔴

**现状**：文档直接写了 `CREATE TABLE` 语句，假设 schema 不变。
**问题**：项目经历 v1→v2→v3 已改过 schema，未来还会变。没有 migration 系统 = 每次改表都是手工 ALTER TABLE，高危。
**建议新增**：

```sql
CREATE TABLE schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now','localtime')),
    checksum   TEXT
);
```

对应 `migrations/` 目录，PM2 启动自动执行未应用迁移。

---

#### 缺陷 2：缺少系统自监控（Observability） 🔴

**现状**：`monitor-daemon.mjs` 只检查 CDP 连通性和任务状态。
**遗漏**：不检查 SQLite 写入延迟、playwright 页面加载耗时、DuckDB ATTACH 是否成功、飞书推送失败率。
**建议新增**：

```sql
CREATE TABLE system_metrics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,        -- '5min-check' / 'v3-monitor' / 'daily-report'
    metric      TEXT NOT NULL,        -- 'page_load_ms' / 'db_write_ms' / 'push_success'
    value       REAL NOT NULL,
    tags        TEXT,                 -- JSON: {"account":"real","retry":1}
    recorded_at TEXT DEFAULT (datetime('now','localtime'))
);
```

关键 SLI：
- 快照采集成功率 > 99%
- p95 采集耗时 < 45s（留裕度给 5min 周期）
- 飞书推送成功率 > 98%

---

#### 缺陷 3：缺少统一数据访问层（DAL） 🔴

**现状**：架构文档中各脚本直接写 SQL。
**问题**：表结构变更需改所有脚本、SQL 分散无集中参数化、无类型约束。
**建议新增 `db-access.mjs`**：

```javascript
// 所有数据操作集中在此，脚本只调用封装函数
export function insertSnapshot(snapshot) { /* 参数化 INSERT */ }
export function getDailyAggregation(date, accountId) { /* DuckDB 聚合 */ }
export function recordAlert(alert) { /* INSERT + 返回ID */ }
```

---

### 3.2 Schema 设计缺陷

#### 缺陷 4：缺少 `snapshot_batches` 表（采集批次追踪） 🔴

**问题**：无法回答"本次采集是否完整？""哪些计划没采到？"
**建议新增**：

```sql
CREATE TABLE snapshot_batches (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_time         TEXT NOT NULL,
    account_id         TEXT NOT NULL,
    platform           TEXT NOT NULL,
    source_script      TEXT,              -- 'v3-monitor' / '5min-check' / 'ai-regions'
    expected_campaigns INTEGER,           -- 页面显示的计划数
    actual_snapshots   INTEGER,           -- 实际写入的快照数
    collection_ms      INTEGER,
    retry_count        INTEGER DEFAULT 0,
    status             TEXT DEFAULT 'success',
    error_detail       TEXT
);
```

---

#### 缺陷 5：`alerts` 和 `daily_summaries` 缺少 `account_id` + `platform` 🟡

`campaign_snapshots` 已加这两个字段，但 `alerts` 和 `daily_summaries` 没有。多账户场景下告警无法区分来源。

---

#### 缺陷 6：字段命名不一致 🟢

架构文档用 `consume`，原有系统（MEMORY.md）和原数据库报告用 `spend`。建议统一为 `spend`（与巨量引擎页面一致）。

---

#### 缺陷 7：时区隐式依赖 🟢

所有 `datetime('now','localtime')` 依赖 Windows 系统时区。建议内部存储 UTC，查询时转换，或至少在文档中显式声明"所有时间均为 UTC+8 北京时间"。

---

## 四、风险分析（补充与升级）

### 风险 1：Playwright OVUI 兼容性 — 概率应从中升级为高 🔴

**原文档评级**：中概率 / 高影响
**实际评级**：**高概率** / 高影响

**理由**：

| 场景 | auto-waiting 能覆盖？ | 说明 |
|------|---------------------|------|
| 元素可见性/可点击 | ✅ 能 | playwright 核心能力 |
| OVUI 下拉框选项加载完成 | ❌ 不能 | popper 是 teleported DOM，异步渲染，需 `waitForSelector` |
| 分页后表格异步重渲染 | ❌ 不能 | Vue 异步更新 DOM，可能捕获中间态 |
| 排序后数据稳定 | ❌ 不能 | 需两次快照对比确认 |
| 真实鼠标事件（OVUI 下拉框） | ⚠️ 可尝试 | `page.mouse` 底层走 CDP，但需先获取元素 boundingBox |

**结论**：`wait-utils.mjs` 中 OVUI 专用等待逻辑（如 `waitForTableRows`）**不能直接退役**，需评估后决定迁移还是保留。

**缓解措施补充**：P1 启动后先在凌晨用 `pw-client.mjs` 跑全流程冒烟测试（覆盖分页切换/排序/数据提取）。

---

### 风险 2：PM2 进程 CDP 并发竞争 — 原文档未识别 🔴

从 `ecosystem.config.cjs` 分析：

| 冲突时刻 | 进程A | 进程B | 风险 |
|---------|-------|-------|------|
| 每 :00/:15/:30/:45 | `pm2-5min` | `pm2-15min` | 同时 connectOverCDP → 同一 Tab 被两个 page 操作 |
| 23:05 | `pm2-daily-report` | `pm2-daily-summary` | 同上 |
| 21:30 | `pm2-ai-regions`（5 账户） | `pm2-5min` / `pm2-15min` | ai-regions 遍历 5 账户耗时长，与定期采集重叠 |

两个 playwright page 共享同一 Browser Context → 同时导航到同一巨量引擎 URL → 可能触发反爬或数据错乱。

**缓解方案（二选一）**：

A) **错开 cron 表达式**（轻量，推荐先做）：
```
pm2-5min:    */5 * * * *     → 保持
pm2-15min:   2,17,32,47 * * * *  → 比 5min 晚 2 分钟
```

B) **文件锁互斥**（更安全）：
```javascript
// pw-client.mjs 内建进程互斥
import { openLock, releaseLock } from './lock-utils.mjs';
export async function acquirePage(...) {
    await openLock('monitor-data/.cdp-lock', 30000);
    try { /* 采集 */ } finally { releaseLock('monitor-data/.cdp-lock'); }
}
```

---

### 风险 3：DuckDB Windows 兼容性

**原文档评级**：低概率 / 中影响
**建议调整**：中概率 / 中影响 — DuckDB Node API 较新（v1.0 2024），Windows 上 edge case 较多。

**缓解补充**：在 P2 早期（而非 P3）就做 DuckDB PoC，失败则预准备降级方案（SQLite 原生聚合或 DuckDB CLI）。

---

### 风险 4：P4 AI 执行层无安全护栏

`optimization_actions` 表有状态流转但无硬性约束。需增加：

```sql
ALTER TABLE optimization_actions ADD COLUMN max_budget_change_pct REAL DEFAULT 30.0;
ALTER TABLE optimization_actions ADD COLUMN cooldown_until TEXT;
ALTER TABLE optimization_actions ADD COLUMN requires_confirmation INTEGER DEFAULT 1;
```

执行层强制校验：
- 预算调整 ≤ ±30%
- 同一计划两次操作间隔 > 60min
- `budget_adjust` 默认需飞书确认
- 每日自动操作上限 5 次

---

## 五、优化建议

### 5.1 L1 采集层

| # | 建议 | 优先级 |
|---|------|--------|
| 1 | `pw-client.mjs` 内建进程互斥锁，防止多 PM2 进程同时操作 CDP | 🔴 |
| 2 | playwright OVUI 专用等待逻辑单独封装（`pw-ovui-wait.mjs`），不混入通用逻辑 | 🔴 |
| 3 | P1 迁移分步灰度：probe → 5min → ai-regions → 15min → daily-report | 🟡 |
| 4 | 增加 2-8s 随机延迟 + 在每个账户间加 3-5s 间隔（降低巨量检测概率） | 🟢 |

### 5.2 L2 存储层

| # | 建议 | 优先级 |
|---|------|--------|
| 5 | 新增 `schema_migrations` 系统 | 🔴 |
| 6 | 新增 `snapshot_batches` 表 | 🔴 |
| 7 | 新增 `db-access.mjs` 统一数据访问层 | 🔴 |
| 8 | `alerts` / `daily_summaries` 加 `account_id` + `platform` | 🟡 |
| 9 | JSON 历史导入前先做 schema 探测脚本，识别字段覆盖率 | 🟡 |
| 10 | 新增 `verify-dual-write.mjs` 双写一致性验证脚本 | 🟡 |
| 11 | 统一字段命名为 `spend`（废弃 `consume`） | 🟢 |
| 12 | 时区策略：存储 UTC，查询时 +8 hours | 🟢 |
| 13 | 增加 SQLite WAL checkpoint 策略 + 备份策略 | 🟢 |

### 5.3 L3 分析层

| # | 建议 | 优先级 |
|---|------|--------|
| 14 | DuckDB PoC 前置到 P2 早期验证 | 🟡 |
| 15 | ATTACH 失败时降级到 SQLite 聚合（fallback 路径） | 🟡 |

### 5.4 L4 服务层

| # | 建议 | 优先级 |
|---|------|--------|
| 16 | `/query` DDL/DML 拦截需明确实现方式（正则匹配？SQL 解析？） | 🟡 |
| 17 | `/api/export` 增加行数上限（防全表导出内存溢出） | 🟢 |
| 18 | 所有 API 增加 rate limit（同 IP 每秒最多 10 请求） | 🟢 |

### 5.5 P4 AI 闭环层

| # | 建议 | 优先级 |
|---|------|--------|
| 19 | `optimization_actions` 增加安全护栏字段 | 🟡 |
| 20 | 执行层硬编码约束（最大调整幅度/冷却期/日上限） | 🟡 |

### 5.6 文档增强

| # | 建议 | 优先级 |
|---|------|--------|
| 21 | 增加 3 张关键流程序列图（采集/告警/日报） | 🟡 |
| 22 | 每阶段增加回滚方案表格 | 🟡 |
| 23 | 增加资源成本估算 | 🟢 |
| 24 | 补充 DuckDB 替代 SQLite 的评估结论（防后续质疑） | 🟢 |

---

## 六、落地路线调整建议

```
P1 playwright 灰度迁移（调整为 3-4 天）
  ├─ Step 1: 冒烟测试 probe 脚本 + OVUI 兼容性验证
  ├─ Step 2: 迁移 pm2-5min（轻量，失败影响小）
  ├─ Step 3: 迁移 pm2-ai-regions（核心收益，修复 matchedRows=0 bug）
  ├─ Step 4: 迁移 pm2-15min（关键路径，观察 2 周期）
  └─ Step 5: 迁移 pm2-daily-report + pm2-daily-summary

P2 SQLite 存储化（调整为 3-4 天）
  ├─ Step 1: 安装 better-sqlite3 + 建 schema + schema_migrations
  ├─ Step 2: db-access.mjs DAL 层 + db-writer.mjs 双写桥
  ├─ Step 3: DuckDB PoC（前置验证 Windows 兼容性）
  ├─ Step 4: 接入采集脚本 + verify-dual-write.mjs
  ├─ Step 5: JSON 历史 schema 探测 + 导入脚本
  └─ Step 6: /query 检索面板上线

P3 DuckDB 分析层（保持，加降级路径）

P4 AI 闭环（保持，加安全护栏后再激活）
```

---

## 七、决策矩阵补充

| 决策点 | 建议补充 | 理由 |
|--------|---------|------|
| 纯 DuckDB 替代 SQLite+DuckDB | 记录评估结论 | DuckDB 写入锁较粗，多 PM2 并发写入场景 SQLite WAL 更优，双引擎方案正确 |
| `wait-utils.mjs` 是否退役 | 改为"评估后选择性退役" | OVUI 专用等待逻辑 playwright auto-waiting 无法覆盖 |
| P1 对所有脚本一刀切迁移 | 改为灰度迁移 | 降低核心路径（15min 监控）同时出问题概率 |
| PM2 cron 表达式 | 5min 和 15min 错开 2 分钟 | 消除 CDP 并发冲突 |

---

## 八、总结排序

**当前文档得分**: 7.5/10 → 修复后可达 **8.8/10**

| 优先级 | 项目 | 类型 | 如果不修 |
|--------|------|------|----------|
| 🔴 P0-1 | PM2 CDP 并发竞争 | 新增风险 | 采集数据错乱、巨量反爬触发 |
| 🔴 P0-2 | playwright OVUI 部分场景不兼容 | 已有风险升级 | P1 迁移失败、回退浪费时间 |
| 🔴 P1 | 缺少 schema migration | 缺失模块 | 每次改表手工操作，出问题难回滚 |
| 🔴 P1 | 缺少 snapshot_batches | 表缺失 | 无法检测丢计划，数据完整性无保障 |
| 🟡 P2 | 缺少 system_metrics | 缺失模块 | 自监控盲区，问题发现延迟 |
| 🟡 P2 | 缺少 db-access.mjs | 架构缺陷 | SQL 分散，表变更成本高 |
| 🟡 P2 | alerts 缺多账户字段 | Schema 缺陷 | 多账户告警混淆 |
| 🟢 P3 | 文档增强（序列图/回滚/成本） | 文档质量 | 可读性降低，交接成本高 |
| 🟢 P3 | P4 AI 安全护栏 | 未来风险 | 自动调预算可能失控 |

---

*审查模型: DeepSeek V4 Pro | 审查者: WorkBuddy Ask 模式 | 审查工具: 静态分析 + 项目上下文交叉验证*
