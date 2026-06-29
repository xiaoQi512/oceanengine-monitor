# 架构规划审查反馈

> **审查对象**: `架构规划_整体方案.md` v1.0（2026-06-27）  
> **审查模型**: Kimi K2.7 Code  
> **审查结论**: 方向正确，但 2 周落地节奏偏激进，部分技术细节、风险隔离、测试与数据生命周期需要补强。

---

## 一、总体评价

### 1.1 优点

| 维度 | 评价 |
|---|---|
| **技术选型合理** | playwright-core + connectOverCDP 能解决当前 `matchedRows=0` 竞态问题；SQLite + DuckDB 双引擎贴合单机场景；Parquet 归档路径正确 |
| **兼容现有系统** | PM2 进程、lark-cli 推送、chrome-guard、HTML 报表结构均保持不变，迁移冲击小 |
| **闭环完整** | 覆盖"监测 → 分析 → 建议 → 执行 → 反馈"，并预留 AI 调优接口 |
| **文档结构清晰** | 四层架构、决策矩阵、落地路线、风险清单一目了然 |

### 1.2 缺点

| 维度 | 评价 |
|---|---|
| **落地节奏过紧** | 4 阶段 2 周对兼职推进风险高，未留缓冲 |
| **退役策略激进** | P1 结束即退役 `cdp-client.mjs` / `wait-utils.mjs` / `calibrate-page.mjs`，一旦 playwright 与 OVUI 不兼容会直接中断监控 |
| **技术验证不足** | playwright 真实鼠标事件、DuckDB Node API Windows 兼容性、多账户登录态隔离均未先 POC |
| **Schema 主键缺陷** | `campaigns` 表主键仅为 `campaign_id`，未考虑同 campaign_id 跨 account/platform 冲突 |
| **数据生命周期缺失** | 只提月度 Parquet 归档，未明确归档后 SQLite 是否清理、保留多久 |
| **执行闭环细节不足** | 自动调预算的审批、校验、回滚机制未展开 |
| **测试计划缺位** | 全文档无测试/回归方案 |

---

## 二、改进建议

### 2.1 架构层面

1. **多账户登录态隔离**
   - 当前写"同 Chrome 不同 tab 复用登录态"，需验证是否会串号
   - 建议：每个 account 使用独立 `browser.newContext()`，或先做 cookie/localStorage 隔离 POC

2. **SQLite 复合主键修正**
   - `campaigns` 表改为复合主键 `(campaign_id, account_id, platform)`
   - `campaign_snapshots` 外键同步改为复合外键

3. **数据生命周期分层**
   - 热数据：30 天存 SQLite
   - 温数据：12 个月存 Parquet
   - 冷数据：按需保留
   - 归档脚本同时负责清理 SQLite 老数据

4. **服务层路由封装**
   - `/query` / `/api/charts/*` / `/trigger` / `/health` 全部手写原生路由容易臃肿
   - 建议：用轻量 router 封装，或评估引入 Express/Koa

### 2.2 落地节奏

建议由"4 阶段 2 周"调整为 **3 周 + 1 周缓冲**：

| 阶段 | 周期 | 核心目标 | 关键产出 |
|---|---|---|---|
| P1 | 1 周 | playwright 接入 + 灰度迁移 | `pw-client.mjs`、ai-regions playwright 版、旧 CDP fallback 保留 |
| P2 | 1 周 | SQLite 结构化存储 + 双写对账 | 修正 schema、`db-writer.mjs`、三方比对逻辑 |
| P3 | 1 周 | 聚合日报 + DuckDB PoC | better-sqlite3 日报上线；DuckDB 验证并行 |
| P4 | 缓冲 1 周 | 全量切换、退役旧路径、补测试与文档 | 测试报告、更新后的 MEMORY.md |

### 2.3 工程实践

1. **灰度切换与 fallback**
   - 旧 CDP 路径保留为 fallback，不要 P1 结束就退役
   - 先灰度迁移 `ai-regions.mjs`，稳定后再迁 `v3` / `5min-check`
   - 双跑期 ≥ 1 周，输出 JSON 逐字段 diff

2. **采集失败重试与死信**
   - `pw-client.mjs` 封装 3 次指数退避 + 失败截图 + 告警
   - 失败任务写入 `dead_letter_jobs` 表，避免静默丢失

3. **双写期一致性对账**
   - 保留并扩展 `data-consistency-check.mjs`
   - 页面 → JSON → SQLite 三方字段比对，日报前自动校验

4. **配置中心**
   - 新增 `config.json` 统一管理 account / platform / URL / 阈值 / 预算规则
   - 服务层支持热加载

5. **自动执行安全链**
   - `proposed → approved → executed` 三态
   - approved 必须飞书 `@确认` 或群命令确认
   - 执行前二次校验当前预算/计划状态
   - 结果写入 `optimization_actions.result`

6. **测试计划**
   - P1：OVUI 分页/排序/日期选择/表格读取回归测试
   - P2：JSON → SQLite 导入测试
   - P3：DuckDB 聚合结果与 SQLite 一致性测试

### 2.4 小程序接口

- 用户当前关注微信小程序监控界面
- `/api/charts/*` 应统一 REST/JSON 输出，字段命名稳定，支持 `start/end/account_id` 筛选，方便小程序直接消费

### 2.5 AI 闭环数据准备

- P4 AI 调优依赖历史数据质量
- P2 开始规范 `optimization_actions` 和 `feedbacks` 表字段，为火山方舟模型训练留特征

---

## 三、风险提醒

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| playwright 与 OVUI 真实鼠标事件不兼容 | 中 | 高 | P1 先 POC 分页/排序/日期选择，失败则保留 CDP fallback |
| DuckDB Node API Windows 不稳定 | 中 | 中 | P3 先 PoC，失败降级为 `better-sqlite3` 聚合或 duckdb CLI |
| 多账户登录态串号 | 中 | 高 | 用 `newContext()` 隔离，POC 验证 cookie/localStorage |
| SQLite WAL 锁竞争（双写期写并发） | 低 | 中 | 5min 间隔写入压力小，仍建议用队列串行化写 |
| 历史 JSON 导入缺字段/重复 | 中 | 低 | 导入脚本做字段映射 + `ON CONFLICT IGNORE` + 行数校验 |
| 2 周节奏导致中间态无法回滚 | 高 | 高 | 延长到 3+1 周，每个阶段设置回滚检查点 |
| 自动调预算误操作 | 低 | 高 | 必须人工确认 + 执行前二次校验 + 保留操作日志 |

---

## 四、立即可以做的 3 个小步验证

1. playwright-core 50 行 POC：连接 9222，只读 `ovui-table`，跑 10 轮分页/排序，验证是否稳定响应
2. better-sqlite3 POC：建 `campaigns` / `campaign_snapshots` 表，导入昨天 JSON，跑日报聚合 SQL 测性能
3. 多账户隔离 POC：用 playwright 分别打开东区/西区投放页，检查 cookie / localStorage 是否独立

---

## 五、审查模型

**Kimi K2.7 Code**（WorkBuddy 内置模型）
