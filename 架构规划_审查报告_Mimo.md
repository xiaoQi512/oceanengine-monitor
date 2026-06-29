# 巨量引擎监控系统 — 架构规划审查报告

> **审查模型**: Mimo 2.5 Pro
> **审查日期**: 2026-06-28
> **审查对象**: 架构规划_整体方案.md (v1.0)
> **审查结论**: 方案整体可行，但有 4 个 P0 缺陷需修正，8 个 P1 优化建议

---

## 一、总体评价

### ✅ 优点

| 维度 | 评价 |
|------|------|
| 技术选型 | playwright-core 优于 puppeteer，auto-waiting 根治竞态问题 |
| 双引擎设计 | SQLite(OLTP) + DuckDB(OLAP) 分工明确，ATTACH 零搬迁 |
| 渐进迁移 | JSON 双写期 1 周验证，风险可控 |
| 退役清单 | 明确列出 6 个待退役文件，避免遗留死代码 |
| 决策矩阵 | 每个选型都有否决项和核心理由，可追溯 |

### ⚠️ 缺陷概览

| 优先级 | 数量 | 关键问题 |
|--------|------|----------|
| P0 (阻塞) | 4 | 外键缺陷、context 策略矛盾、缺重试、时区未定义 |
| P1 (重要) | 8 | 数据保留、DuckDB 并发、异常检测算法、OVUI 验证缺失等 |
| P2 (建议) | 6 | schema 版本、物化视图、全文搜索、备份策略等 |

---

## 二、P0 缺陷 (必须修正)

### 2.1 campaign_snapshots 外键缺陷

**问题**: 当前 FK 仅关联 `campaign_id`，但 `campaigns` 表的 PK 是复合键 `(campaign_id, account_id, platform)`。

```sql
-- ❌ 当前设计
FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)

-- ✅ 修正为
FOREIGN KEY (campaign_id, account_id, platform)
  REFERENCES campaigns(campaign_id, account_id, platform)
```

**影响**: 跨账户/跨平台数据可能关联错误，导致分析结果混乱。

---

### 2.2 多账户 context 策略矛盾

**问题**: 文档 3.2 节写"同 Chrome 不同 tab"共享登录态，但实际会导致：
- 多个 context 共享同一个 BrowserContext → 会话/Cookie 冲突
- 并发操作同一页面 → DOM 状态混乱

**修正方案**:

| 账户类型 | context 策略 | 原因 |
|----------|-------------|------|
| 真人号 | `browser.contexts()[0]` | 复用已登录 session |
| AI 区域号 | `browser.newContext({ storageState })` | 物理隔离，需提前导出各账户 storageState |

```javascript
// AI区域号必须用独立 context
const aiContext = await browser.newContext({
  storageState: 'monitor-data/auth/ai-east.json'  // 预先导出的登录态
});
```

**前置工作**: 需要手动登录一次每个 AI 账户，导出 `storageState` JSON 文件。

---

### 2.3 缺少重试机制

**问题**: 采集层没有错误恢复逻辑。网络抖动、页面加载超时会导致单次采集失败。

**修正**: 复用现有 `cdp-client.mjs` 的 3 次指数退避逻辑，封装到 `pw-client.mjs`:

```javascript
async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === maxRetries - 1) throw err;
      await page.waitForTimeout(1000 * Math.pow(2, i));  // 1s, 2s, 4s
    }
  }
}
```

---

### 2.4 snapshot_time 时区未定义

**问题**: Schema 中 `snapshot_time TEXT NOT NULL` 未定义时区。Windows 机器可能产生本地时间，跨日分析时 23:00 采集的数据可能被归到次日。

**修正**: 统一使用 UTC ISO 8601 格式：

```sql
snapshot_time TEXT NOT NULL  -- 格式: 2026-06-28T15:05:00.000Z (UTC)
```

展示时再转换为本地时间 (UTC+8)。

---

## 三、P1 优化建议

### 3.1 数据保留策略

**问题**: 未定义数据生命周期，SQLite 会无限增长。

**建议**: 三级存储策略

| 层级 | 保留期 | 存储 | 查询 |
|------|--------|------|------|
| 热数据 | 7 天 | SQLite (主表) | 直接查询 |
| 温数据 | 8-30 天 | SQLite (归档表) | 直接查询 |
| 冷数据 | >30 天 | Parquet 文件 | DuckDB COPY FROM |

```sql
-- 月度归档脚本
COPY (
  SELECT * FROM campaign_snapshots
  WHERE snapshot_time < date('now', '-30 days')
) TO 'monitor-data/archive/2026-05.parquet' (FORMAT PARQUET);

-- 归档后删除
DELETE FROM campaign_snapshots
WHERE snapshot_time < date('now', '-30 days');
```

---

### 3.2 DuckDB 并发锁

**问题**: DuckDB 单写者模型，多个 PM2 进程同时 ATTACH 可能冲突。

**建议**:
- 分析查询统一走 `analysis.duckdb`，由单一 worker 进程执行
- 或改用 DuckDB 的 `ACCESS_MODE READ_ONLY` + 写操作串行化

```javascript
// 读操作：并发安全
const db = await duckdb.createConnection('analysis.duckdb');
await db.run(`ATTACH 'oceanengine.db' AS ocean (READ_ONLY)`);

// 写操作：串行执行
const writeQueue = new PQueue({ concurrency: 1 });
await writeQueue(() => archiveToParquet());
```

---

### 3.3 异常检测算法

**问题**: Z-SCORE 假设正态分布，但广告数据呈长尾分布（少数计划消耗占比大）。

**建议**: 改用 IQR (四分位距) 或滚动百分位：

```javascript
// IQR 异常检测
const q1 = percentile(data, 25);
const q3 = percentile(data, 75);
const iqr = q3 - q1;
const lowerBound = q1 - 1.5 * iqr;
const upperBound = q3 + 1.5 * iqr;
const isAnomaly = value < lowerBound || value > upperBound;
```

---

### 3.4 OVUI 专项验证脚本

**问题**: 风险评估中提到 OVUI 组件需真实鼠标事件，但 P1 路线没有专项验证步骤。

**建议**: P1 第 1 天增加 `pw-ovui-test.mjs`：

```javascript
// 验证清单
const tests = [
  { name: '分页切换', fn: () => testPagination(page) },
  { name: '排序点击', fn: () => testSorting(page) },
  { name: '下拉选择', fn: () => testDropdown(page) },
  { name: '汇总行读取', fn: () => testSummaryRow(page) },
];

for (const test of tests) {
  const result = await test.fn();
  console.log(`${result ? '✅' : '❌'} ${test.name}`);
}
```

若任一失败，保留 CDP `Input.dispatchMouseEvent` 作为 fallback。

---

### 3.5 API 认证加强

**问题**: 仅监听 127.0.0.1 不够，本地恶意脚本仍可访问。

**建议**: 所有 `/api/*` 和 `/trigger` 端点加 Bearer token：

```javascript
const API_TOKEN = process.env.API_TOKEN || crypto.randomUUID();

function authMiddleware(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== API_TOKEN) {
    throw new Error('Unauthorized');
  }
}
```

---

### 3.6 监控系统自监控

**问题**: 监控系统本身没有被监控。`monitor-daemon.mjs` 的健康检查结果没有持久化。

**建议**:
- daemon-health.json 已存在，增加 `/health` 端点返回最新状态
- 飞书推送增加"系统异常"卡片（CDP 断连、SQLite 损坏、磁盘满）

---

### 3.7 日志标准化

**问题**: 各脚本使用 `console.log` / `console.error`，无结构化日志。

**建议**: 引入 `pino` (轻量 JSON logger)：

```javascript
const pino = require('pino');
const log = pino({ level: 'info' }, pino.destination('monitor-data/app.log'));

log.info({ account: 'ai-east', consume: 1234 }, '采集完成');
log.error({ err, page: url }, '采集失败');
```

便于后续日志分析和告警。

---

### 3.8 配置外置

**问题**: 账户列表、阈值、时段定义散落在代码中。

**建议**: 统一到 `monitor-data/config.json`：

```json
{
  "accounts": [
    { "id": "1842681352509635", "name": "真人号", "context": "ocean-real" }
  ],
  "thresholds": {
    "cpa_rise_pct": 120,
    "speed_surge_pct": 150,
    "budget_warn_pct": 85
  },
  "time_periods": [
    { "name": "冷启动", "start": "07:00", "end": "09:00" }
  ]
}
```

---

## 四、P2 建议 (可选优化)

### 4.1 Schema 版本管理

在 SQLite 中增加 `schema_version` 表，记录 migration 脚本版本，便于后续升级。

### 4.2 DuckDB 物化视图

对高频查询（日报聚合、7 日趋势）创建物化视图，避免重复计算：

```sql
CREATE MATERIALIZED VIEW daily_summary AS
SELECT
  account_id,
  date(snapshot_time) AS dt,
  SUM(consume) AS total_consume,
  SUM(leads) AS total_leads
FROM campaign_snapshots
GROUP BY account_id, date(snapshot_time);
```

### 4.3 SQLite FTS5 全文搜索

对 `campaign_name` 建立全文索引，支持模糊搜索：

```sql
CREATE VIRTUAL TABLE campaigns_fts USING fts5(campaign_name, content='campaigns');
```

### 4.4 JSON 导入兼容性

2184+ JSON 文件可能缺少 `account_id` / `platform` 字段。导入脚本需：
- 检测文件名模式推断账户
- 缺失字段填充默认值
- 记录导入日志，支持重跑

### 4.5 playwright CDP 状态预检

连接前检查 Chrome 是否已登录：

```javascript
const pages = await context.pages();
const loginPage = pages.find(p => p.url().includes('login'));
if (loginPage) {
  log.warn('检测到登录页面，等待人工登录...');
  await notifyUser('请在 Chrome 中完成登录');
}
```

### 4.6 备份策略

SQLite WAL 模式下，直接复制 `.db` 文件可能损坏。建议：

```bash
# 使用 SQLite 在线备份
sqlite3 oceanengine.db ".backup 'backup/oceanengine-$(date +%Y%m%d).db'"
```

PM2 进程每日凌晨自动执行。

---

## 五、路线图调整建议

| 阶段 | 原计划 | 建议调整 | 原因 |
|------|--------|----------|------|
| P1 | 1-2 天 | 2-3 天 | 需增加 OVUI 验证 + 回滚测试 |
| P2 | 2-3 天 | 3 天 | JSON 导入 + 字段兼容需额外时间 |
| P3 | 3-4 天 | 3 天 | DuckDB PoC 成功可按原计划 |
| 每阶段 | 无 | +0.5 天 | 回滚测试窗口 |

---

## 六、总结

**方案整体评价**: 技术选型合理，架构分层清晰，渐进迁移策略风险可控。

**核心改进点**:
1. 修正 FK 复合键 + context 物理隔离 (P0)
2. 增加重试机制 + 时区统一 (P0)
3. 定义数据保留策略 (P1)
4. OVUI 专项验证前置 (P1)

**建议**: 修正 P0 后即可启动 P1，P1 完成后再做 P3 (DuckDB)，AI 闭环 (P4) 按需推进。

---

_审查完成 — Mimo 2.5 Pro_
