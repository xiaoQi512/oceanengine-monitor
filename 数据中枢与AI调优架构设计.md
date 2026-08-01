# 数据中枢与 AI 调优架构设计

> 日期：2026-08-01
> 状态：方案设计（待评审）
> 定位：完整重构方案（《完整重构方案_20260801.md》）的核心深化 —— 「采集独立 + 数据库为唯一事实源 + 操作与效果追踪全入库 + 条件触发 AI 自动调优」
> 前置：《完整重构方案_20260801.md》《前端数据抓取重构方案》《多租户架构设计_线索直播广告监控》《AI诊断规则手册》《广告计划调整_四层架构方案_v1.1》

---

## 一、设计目标

1. **采集独立**：数据抓取与业务汇报解耦，采集器只负责「抓 → 写库」，不再内嵌卡片构建/推送/分析逻辑。
2. **数据库为唯一事实源**：绝大部分监控与汇报数据从 SQLite 读取；JSON 快照降级为灾备回放，不作为读取源。
3. **调优闭环入库**：调优操作（operations）与短期效果追踪（operation_effects）全部入库，替代文件队列 + audit 文件。
4. **条件触发 AI 调优**：规则配置化（trigger_rules），命中条件后经飞书确认或自动执行 AI 调优，效果自动回写规则置信度，形成「规则 → 决策 → 执行 → 效果 → 规则」闭环。

---

## 二、目标数据流

```
┌─ 采集层（独立进程，只写）───────────────────────────────┐
│ oec-collector（5min 定时，遍历所有账户）                  │
│   └─ oec-fetch：HTTP API 直连（唯一抓取路径）              │
│       失败 → 每分钟重试 → 飞书群告警 → 恢复通知   │
│   ├─ live-watcher 职责并入（直播状态轮询）               │
│   └─ 统一 writer（事务 + 幂等 upsert）→ src/db           │
└────────────────────────────────────────────────────────┘
        │ 写
        ▼
┌─ 数据中枢 SQLite（唯一事实源）───────────────────────────┐
│  campaigns · snapshots(5min) · hourly_stats · daily_stats│
│  shifts · operations · operation_effects · trigger_rules │
│  ai_decisions · alerts · feedback · config · telemetry   │
└────────────────────────────────────────────────────────┘
        │ 读
        ├─▶ 汇报层：15min/5min卡片、日报、日汇总、Dashboard、周报PPT
        ├─▶ 监控层：shift-pusher、monitor-daemon、健康检查
        └─▶ 决策层：trigger-engine（条件触发）→ AI 调优 → operations → effects
```

**原则**
- 所有写入只经 `src/db/writer.mjs` 一个入口；所有读取只经 `src/db/dal.mjs`。
- `domain/` 层函数签名改为 `(ctx, dbApi, inputs)`，不再直接读文件。
- JSON 文件仅保留两类：采集原始报文（灾备回放）与状态锁文件（进程互斥）。

---

## 三、数据模型设计

### 3.1 通用改造
- 所有业务表增加 `account_id TEXT NOT NULL DEFAULT '1842681352509635'`（现值）与 `tenant_id TEXT DEFAULT ''`（多租户预留，见《多租户架构设计》）。
- 所有按计划查询的索引升级为 `(account_id, campaign_id, ...)` 复合前缀。

### 3.2 snapshots —— 改为 5min 粒度为主
现表以 15min 为主（`source_type` 区分 5min/15min），新模型统一 5min 采集：

```sql
CREATE TABLE IF NOT EXISTS snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_time TEXT NOT NULL,              -- UTC ISO
  snapshot_cst  TEXT NOT NULL,              -- CST HH:MM
  account_id    TEXT NOT NULL DEFAULT '',
  campaign_id   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT '',   -- 投放中/暂停/超出预算…
  daily_budget  REAL NOT NULL DEFAULT 0,
  bid           REAL,
  cost          REAL NOT NULL DEFAULT 0,    -- 当日累计
  leads         INTEGER NOT NULL DEFAULT 0,
  conversions   INTEGER NOT NULL DEFAULT 0,
  msg_open      INTEGER NOT NULL DEFAULT 0,
  msg_lead      INTEGER NOT NULL DEFAULT 0,
  form_submit   INTEGER NOT NULL DEFAULT 0,
  ctr           REAL NOT NULL DEFAULT 0,
  cpm           REAL NOT NULL DEFAULT 0,
  cvr           REAL NOT NULL DEFAULT 0,
  views         INTEGER NOT NULL DEFAULT 0,
  views_1min    INTEGER NOT NULL DEFAULT 0,
  comments      INTEGER NOT NULL DEFAULT 0,
  learning_status TEXT NOT NULL DEFAULT '',   -- learning/learned/learning_failed/not_learning
  learning_done INTEGER NOT NULL DEFAULT 0, -- 学习期是否完成 (0/1)
  source_type   TEXT NOT NULL DEFAULT 'api', -- api/cdp/dom
  raw_json      TEXT,
  UNIQUE(account_id, campaign_id, snapshot_time)
);
CREATE INDEX IF NOT EXISTS idx_snap_acc_time ON snapshots(account_id, snapshot_time);
CREATE INDEX IF NOT EXISTS idx_snap_camp_time ON snapshots(campaign_id, snapshot_time);
```

- 15min 卡片 = 最近 3 个 5min 窗口聚合（沿用现有 delta 逻辑，改为 SQL/内存聚合）。
- `UNIQUE` 保证幂等：同一时刻重复采集 upsert 而非插入。


学习期字段（计划级）：
- `learningStatus`：巨量引擎原始枚举 `learning`（学习中）/ `learned`（学习完成）/ `learning_failed`（学习失败）/ `not_learning`（无需学习）/ 空
- `learningDone`（**学习期是否完成**）：布尔 —— `learned`/`learning_failed`/`not_learning` → `true`（学习期已结束）；`learning` → `false`（学习中）
- 来源：HTTP API 提供 `learning_status` 时直取；当前逆向端点未提供时由 `oec-normalize` 按规则推断（投放时长 ≥ 24h 且转化数 ≥ 阈值 → 视为已出学习期），推断规则以实际 API 校准
- 用途：卡片「学习中」标记；`learning_failed` 计划告警；trigger-engine 条件支持 `learning_done=0` 时**禁止/延迟调优**（学习中转化不稳定）

### 3.3 shifts —— 排班/班次表（替代 shifts-*.json）
```sql
CREATE TABLE IF NOT EXISTS shifts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,                -- YYYY-MM-DD
  shift_label TEXT NOT NULL,                -- HH:MM-HH:MM
  anchor_name TEXT NOT NULL DEFAULT '',
  account_id  TEXT NOT NULL DEFAULT '',
  spend       REAL NOT NULL DEFAULT 0,
  leads       INTEGER NOT NULL DEFAULT 0,
  cpl         REAL NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'snapshot',
  detail_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(date, shift_label, account_id)
);
```

### 3.3.1 排班驱动的活跃期判定

活跃期 = 当日排班表覆盖的班次时段集合（`[{start, end, anchor}]`）；**非预定直播排期时段一律记为低活跃期**：

| 当前时间 | 采集频率 | 说明 |
|---|---|---|
| 在任一排班时段内 且 账户有消耗 | 5min 高频 | 直播进行中 |
| 在任一排班时段内 且 无消耗 | 15min 中频 | 已排班未起量 |
| **非排班时段（无预定直播）** | **30min 低频或暂停** | **低活跃期（核心变化：不再按固定 7-23 小时窗口，而按排班表精确判定）** |
| 数据陈旧 > 1h | 立即补采一次 | stale_compensation |

- 判定源：`shifts` 表当日班次；缓存缺失时回退 `getTodayShiftWindow()` 小时范围 → 再回退默认 7-23。
- 替代现有 `adaptive-scheduler.mjs` 的固定小时窗口策略（其窗口逻辑保留为回退层）。

### 3.3.2 每日排班同步与当日校对（sync-shifts，替代 sync-tomorrow-shifts）

每日 23:00 执行（重构后并入 `oec-scheduler`）：

1. **次日排班确认**（现状保留）：读飞书排班表次日班次 → 写入 `shifts` 表（date=次日）。
2. **当日排班校对**：读飞书排班表当日班次 vs `shifts` 表当日记录 —— 时段/主播变化 → 差异告警。
3. **当日换班数据校对**：`shifts` 表当日排班 vs `shift-pusher` 已生成的当日换班数据：
   - 排班时段无对应换班记录（缺班次）→ warn
   - 换班记录不在排班时段内（多余/漂移）→ warn
   - 换班主播名与排班不一致 → warn
   - 班次消耗/CPL 缺失或明显异常 → warn
4. **校对报告**：输出 `monitor-data/state/shift-audit-{date}.json` + 飞书推送（✅ 汇总 + ⚠️ 差异明细），作为日汇总前的人工核查依据。

### 3.4 operations —— 调优操作主表（替代 actions 表 + action-queue.json + action-audit.jsonl）
```sql
CREATE TABLE IF NOT EXISTS operations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id           TEXT UNIQUE,              -- traceRef/业务ID
  account_id      TEXT NOT NULL DEFAULT '',
  campaign_id     TEXT NOT NULL,
  plan_name       TEXT NOT NULL DEFAULT '',
  op_type         TEXT NOT NULL,            -- pause/resume/adjust_budget/adjust_bid
  params_json     TEXT,                     -- { value, reason, mode }
  source          TEXT NOT NULL DEFAULT 'feishu',  -- feishu/dashboard/ai_auto/ai_suggest/manual
  status          TEXT NOT NULL DEFAULT 'proposed',-- 状态机见 3.4.1
  before_value    TEXT,                     -- 执行前回读
  after_value     TEXT,                     -- 执行后回读
  trigger_rule_id INTEGER,
  ai_decision_id  INTEGER,
  trace_ref       TEXT NOT NULL DEFAULT '',
  error           TEXT,
  rollback_status TEXT,                     -- none/succeeded/failed
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  confirmed_at    TEXT,
  executed_at     TEXT,
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_ops_acc_status ON operations(account_id, status);
CREATE INDEX IF NOT EXISTS idx_ops_camp_time   ON operations(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ops_pending     ON operations(status) WHERE status IN ('proposed','pending','executing');
```

**3.4.1 状态机**
```
proposed ──(规则命中，AI建议)──▶ pending
pending  ──(飞书确认/自动放行)──▶ confirmed ──▶ executing ──▶ succeeded
pending  ──(拒绝/超时)──────────▶ rejected
executing ──(失败可回滚)────────▶ failed ──▶ rolled_back
```
- `proposed`：仅 AI 建议（未入执行队列），用于 Dashboard/AI 建议 Tab 展示。
- `pending`：进入执行队列待确认（复用现有飞书确认闭环，指令语义不变）。
- 状态迁移写 `operations_status_log`（事件表，可选，P2 再上）或仅记录时间戳。

### 3.5 operation_effects —— 短期效果追踪
```sql
CREATE TABLE IF NOT EXISTS operation_effects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL,
  account_id  TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL,
  op_type     TEXT NOT NULL,
  op_time     TEXT NOT NULL,
  window_minutes INTEGER NOT NULL,          -- 15/30/60/120
  before_cost REAL NOT NULL DEFAULT 0,
  after_cost  REAL NOT NULL DEFAULT 0,
  cost_delta  REAL NOT NULL DEFAULT 0,
  before_leads INTEGER NOT NULL DEFAULT 0,
  after_leads  INTEGER NOT NULL DEFAULT 0,
  leads_delta  INTEGER NOT NULL DEFAULT 0,
  before_cpl  REAL NOT NULL DEFAULT 0,
  after_cpl   REAL NOT NULL DEFAULT 0,
  cpl_delta   REAL NOT NULL DEFAULT 0,
  cpl_delta_pct REAL NOT NULL DEFAULT 0,
  eval_label  TEXT NOT NULL DEFAULT 'neutral',  -- high_positive/positive/neutral/negative（沿用现有阈值）
  computed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(operation_id, window_minutes)
);
```

**3.5.1 计算规则（由 effect-tracker 异步执行）**  
阈值从 `config` 表读取（`key=effect_eval_thresholds`），默认值沿用 v1.2 设定：`{"pause":{"high_positive":200,"positive":600,"neutral":1000}}`。各 op_type 可独立配置，缺失时回退硬编码默认值。
- `before` = 操作时刻前 `window` 分钟窗口的平均/累计指标（读 snapshots）
- `after` = 操作时刻后 `window` 分钟窗口的指标（读 snapshots）
- 阈值沿用现有 v1.2 设定：`pause` 后 `delta<200=high_positive, <600=positive, <1000=neutral，否则 negative`；其他 op_type 阈值按指标（cpl_delta_pct / leads_delta）配置化
- 时间不足窗口（如刚执行 10 分钟）→ 不计算，标记 `pending`，由后续轮询补齐（≤120min 后仍不足则放弃并标记 `skipped`）。

15min 卡片聚合降级：3 个 5min 窗口不足时按实有窗口数聚合，卡片注明 `partial` 标签。

### 3.6 trigger_rules —— 条件触发规则（AI诊断规则手册配置化）
```sql
CREATE TABLE IF NOT EXISTS trigger_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT UNIQUE NOT NULL,       -- Rule-001…
  description   TEXT NOT NULL DEFAULT '',
  enabled       INTEGER NOT NULL DEFAULT 1,
  scope         TEXT NOT NULL DEFAULT 'campaign', -- account/campaign/live_room
  condition_json TEXT NOT NULL,             -- 见 3.6.1
  action_template TEXT NOT NULL,            -- 见 3.6.2
  approval_mode TEXT NOT NULL DEFAULT 'confirm',   -- confirm/auto/disabled
  cooldown_minutes INTEGER NOT NULL DEFAULT 60,
  max_daily_ops INTEGER NOT NULL DEFAULT 3,
  confidence_floor REAL NOT NULL DEFAULT 0.6,
  success_rate REAL NOT NULL DEFAULT 0,     -- 由效果追踪回写
  sample_count INTEGER NOT NULL DEFAULT 0,
  version       TEXT NOT NULL DEFAULT '1.0',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

**3.6.1 condition_json 示例**
```json
{
  "metric": "cpl",              // cpl / pacing(消耗节律) / budget_overflow / leads_speed / cost_speed
  "window": "15m",              // 观察窗口
  "op": ">",                    // > / < / >= / <= / ==
  "value": 150,                 // 或引用基线: {"baseline": "multi_day", "offset_stdev": 2}
  "min_occurrences": 2,         // 连续/最近N次命中才触发
  "scope_filter": { "status": "投放中", "learning_done": 1 }   // learning_done=0 时禁止/延迟调优
}
```
**3.6.2 action_template 示例**
```json
{
  "op_type": "adjust_budget",
  "params": { "mode": "percent", "value": -20, "reason": "Rule-001 消耗过速自动降预算" },
  "guardrails": { "min_budget": 500, "max_change_pct": 30 }
}
```

### 3.7 ai_decisions —— AI 决策日志
```sql
CREATE TABLE IF NOT EXISTS ai_decisions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id     TEXT NOT NULL DEFAULT '',
  campaign_id    TEXT NOT NULL DEFAULT '',
  rule_id        INTEGER,
  decision_type  TEXT NOT NULL,             -- suggest/execute/skip
  reasoning      TEXT NOT NULL DEFAULT '',
  confidence     REAL NOT NULL DEFAULT 0,
  proposed_op_id INTEGER,
  executed_op_id INTEGER,
  context_json   TEXT,                      -- 触发时的快照上下文（供复盘）
  model          TEXT NOT NULL DEFAULT '',
  cost_estimate  REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

---

## 四、采集器设计（oec-collector）

### 4.1 职责
- 每 5min 遍历所有账户（S7 前为单账户），经 `oec-router` 抓取：计划列表、账户级统计、直播状态、预算/出价。
- 写入：`campaigns` upsert + `snapshots` upsert + `shifts` 增量 + 直播状态（`live_state` 表或 state JSON）。
- 采集原始报文 JSON 落 `monitor-data/snapshots/`（灾备回放，可 `backfill.mjs` 从文件回灌 DB）。

### 4.2 健壮性
- 单账户失败不阻塞其他账户；整体失败重试 3 次后熔断并告警（复用 `oec-router` 熔断）。
- 数据新鲜度检查：`monitor-data/state/health.json` 记录 `lastSnapshotTime`，超过 15min 未更新 → 飞书告警。
- 采集与汇报进程解耦后，汇报进程即使短暂失败也不影响数据完整性。

### 4.3 与现有模块的关系
| 现脚本 | 去向 |
|---|---|
| `oceanengine-monitor-v3.mjs`（采集部分） | 拆入 `oec-collector` |
| `oceanengine-5min-check.mjs`（采集部分） | 拆入 `oec-collector` |
| `live-watcher.mjs` | 并入 `oec-collector`（直播状态随采集写入） |
| `fetch-*.mjs` | 收敛为 `oec-collector` 的可选任务或归档 |
| 卡片构建/分析/推送 | 留在 `domain/` + 各汇报进程，不再进采集器 |

---

## 五、汇报层改造（全部改读库）

| 汇报 | 现数据源 | 目标数据源 |
|---|---|---|
| 15min 卡片 | 采集进程内实时计算 | `snapshots`（3×5min 聚合）+ `campaigns` |
| 5min 速报卡 | 采集进程内实时计算 | `snapshots`（最新窗口） |
| 日汇总 23:35 | `daily-*.json` + `shifts-*.json` | `daily_stats` / `hourly_stats` / `shifts` |
| 日报 23:05 | `daily-*.json` | `daily_stats` + `hourly_stats` |
| Dashboard | DB（部分）+ JSON | 全部 DAL |
| AI 诊断 | 快照 JSON 文件 + `_multiDay` | `snapshots` + `hourly_stats`，基线 SQL 聚合 |
| 周报 PPT | 临时抓取 | `daily_stats`（保留专用抓取为补充） |

---

## 六、条件触发引擎（trigger-engine）

### 6.1 执行流程
```
采集完成事件驱动（每5min，采集完成 → 触发，避免与采集器竞态；若采集失败则跳过本次触发）
  → trigger-engine.run(ctx, dbApi)
    1. SELECT * FROM trigger_rules WHERE enabled=1
    2. 按 scope 加载候选对象（账户/计划/直播间）
    3. 逐规则求值 condition（读 DB 最近 N 窗口）
    4. 命中且通过冷却/日上限/互斥检查：
       - 写 ai_decisions(decision_type='suggest'|'execute', confidence)
       - 写 operations(status='proposed'|'pending')
    5. 按 approval_mode 分派：
       - confirm → 推飞书确认卡片（复用现有确认闭环，指令「执行/拒绝」语义不变）
       - auto → 直接入队（action-worker 执行）
    6. 执行完成后 effect-tracker 计算 operation_effects
    7. 每日/每周回写 trigger_rules.success_rate / sample_count
```

### 6.2 安全边界（防失控）
- **审批兜底**：`auto` 模式仅允许「预算下调」「暂停」等低风险且参数受限的操作；新增预算/出价上调、暂停恢复一律 `confirm`。
- **冷却**：同 `(account, campaign, rule)` 在 `cooldown_minutes` 内不重复触发。
- **日上限**：`max_daily_ops` 每规则 + 全局 `MAX_DAILY_OPS_TOTAL`（config 表，默认 10）。
- **互斥**：同 campaign 存在 `pending/executing` 未决操作时跳过新触发。
- **参数护栏**：`action_template.guardrails` 硬校验（min_budget / max_change_pct），超限拒绝并告警。
- **熔断**：同规则连续 3 次 `failed` 或效果 `negative` 占比 > 60% → 自动 `enabled=0` + 飞书告警。
- **全量审计**：每次 AI 决策与执行均在 `ai_decisions` + `operations` 留痕，可一键回滚（复用现有 rollback）。

### 6.3 规则效果回写
- 每操作执行满 120min 后，按 `operation_effects` 的 `eval_label` 汇总：
  `success_rate = (high_positive + positive) / total`
- 低于 `confidence_floor` 的规则降权（`enabled` 保留但排序靠后），由人工复核。

---

## 七、分阶段实施（并入主重构路线图）

| 阶段 | 交付 | 验收标准 |
|---|---|---|
| D0 数据模型（1-2 天） | schema 迁移：新表 + account_id 列；operations 兼容 actions（视图或双写） | 迁移脚本幂等可回滚；`npm run check` 通过 |
| D1 采集器独立（3-5 天，依赖 S3 工具链 + S4 拆分结果，将拆分后的采集职责组合为 oec-collector 独立进程） | `oec-collector` 上线 5min 粒度；卡片/汇总改读库（新旧并行 diff） | 卡片与 DB 数据一致；JSON 不再被消费方读取 |
| D2 操作闭环入库（2-3 天） | `operations`/`operation_effects` 替换文件队列与 audit；effect-tracker 上线 | 队列/审计文件停写；Dashboard 审计 Tab 读库 |
| D3 规则引擎（3-4 天） | `trigger_rules` + trigger-engine，先 `confirm` 模式（Rule-001 试点） | 条件命中推送确认卡片；拒绝/确认均入 operations |
| D4 AI 自动执行（灰度 1-2 周） | `auto` 模式开放低风险操作；效果回写规则置信度 | 自动操作全部留痕、可回滚；日上限/熔断生效；无失控事件 |

依赖关系：D1 依赖抓取重构 P0-P2；D2 依赖 S2（数据库统一）；D3 依赖 D1+D2；D4 依赖 D3 + 多租户可选。

---

## 八、数据生命周期与保留策略

> 5min 高频化后数据量约为 15min 时代的 3 倍（实测 ~4000 行/天），必须配套保留策略，防止 DB 无限膨胀。

### 8.1 保留策略（按表）

| 表 | 保留期 | 策略 | 理由 |
|---|---|---|---|
| `snapshots`（快照明细） | **90 天** | 超期按日归档/清理：先导出归档（可选 `VACUUM INTO` 或 JSON 备份）→ 分批 DELETE；每月一次 `VACUUM` 回收空间 | 明细数据量大，90 天覆盖规则基线与效果追踪需要 |
| `hourly_stats` / `daily_stats`（物化聚合） | **长期保留** | 不清理 | 体积小（~240+15 行/天），是历史分析/基线的数据源 |
| `daily_summaries` / `shifts` | 长期保留 | 不清理 | 汇报与排班历史 |
| `operations` / `operation_effects` | **永久保留** | 不清理 | 审计要求（操作留痕、效果可回溯） |
| `ai_decisions` | 永久保留 | 不清理 | 审计与规则复盘 |
| `alerts` / `feedback` | 1 年 | 超期归档后清理 | 告警复盘窗口 |
| `campaigns` | 长期保留 | 保留当前值 | 计划主数据 |
| `telemetry` | 90 天 | 超期清理 | 运维诊断 |
| 原始报文 JSON（`monitor-data/snapshots/`） | 30 天 | 超期清理 | 灾备回放窗口 |

### 8.2 实现机制

- 新增 `scripts/purge-data.mjs`：按日 cron（每日 04:00 低峰）执行，保留期从 `config` 表读取（`key=data_retention_*`），可配置覆盖。
- 删除策略：分批 `DELETE ... WHERE snapshot_time < ?`（每次 5000 行 + 事务），避免长事务锁库与 WAL 膨胀；每月一次 `VACUUM`。
- 归档（可选）：超期 `snapshots` 先导出为 `monitor-data/archive/snapshots-YYYY-MM.parquet|jsonl`，确认归档成功后再删除。
- 保留期变更：改 `config` 表即可，无需改代码。

### 8.3 量级估算（90 天窗口）

- `snapshots` ≈ 4000 行/天 × 90 ≈ 36 万行；DB 规模控制在 ~120-150MB（当前 41MB / 3.2 万行）。
- 多租户后按账户数线性增长，保留期可按账户独立配置（`account_id` 维度）。

---

## 九、风险与回滚

| 风险 | 等级 | 缓解 |
|---|---|---|
| 汇报读库出现延迟/缺数据 | 高 | 采集器健康检查 + 陈旧数据告警；JSON 灾备回放兜底 |
| 迁移历史操作数据丢失 | 中 | actions→operations 双写；`backfill.mjs` 从 audit jsonl 回灌 |
| AI 自动操作失控 | 高 | 审批兜底 + 冷却 + 日上限 + 护栏 + 熔断 + 一键回滚 + 全量审计 |
| 规则误判（如 40102 数据缺失） | 中 | `min_occurrences` 防抖；条件求值失败即跳过并告警，不默认触发；40102 端点缺失时记录缺失标记并告警，不接 DOM 备选源 |
| 效果窗口数据不完整 | 低 | 延迟补齐机制；窗口超时放弃并标记 |

---

## 十、量化验收指标

| 指标 | 现状 | 目标 |
|---|---|---|
| 消费方读 JSON 文件 | 全部 | 0（仅灾备回放） |
| 操作数据存储 | 文件队列+audit+actions 表 | operations + effects 单表闭环 |
| 汇报数据源 | 混合（JSON+DB） | 100% DB |
| 规则配置 | 静态 md 文档 | DB 配置化 + 效果回写 |
| AI 自动调优 | 无 | confirm 灰度 → auto 受控放量 |
| 效果追踪 | 仅 snapshotBefore（15min 单点） | 15/30/60/120min 多窗口 |

---

## 十一、附录：与《完整重构方案》的衔接

- 本设计是主重构方案的**核心深化**：目标架构中的 `domain/`、`db/`、`services/` 均按本设计落地。
- 主重构方案路线图更新：S2 后插入 D0-D2；S4 后插入 D3；D4 与 S7（多租户）并行或其后。
- 现有四层架构（审计/确认/熔断/回滚）全部保留，语义映射到 `operations` 状态机与 trigger-engine 安全边界。
