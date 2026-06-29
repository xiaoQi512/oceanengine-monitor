# 巨量引擎监控系统自主优化方案

> 角色：Autonomous Optimization Architect
> 日期：2026-06-22
> 目标：在已有的 HTTP API + CDP 降级体系之上，建立可量化的自主优化闭环，提升效率、降低成本并消除失控风险。

---

## 一、基线瓶颈分析

通过阅读 `oceanengine-monitor-v3.mjs`、`oceanengine-5min-check.mjs`、`oceanengine-api-client.mjs`、`cdp-client.mjs`、`calibrate-page.mjs`、`data-consistency-check.mjs`、`monitor-daemon.mjs`、`monitor-utils.mjs`，识别出以下四类性能瓶颈：

| 层级 | 瓶颈 | 当前表现 | 风险 |
|---|---|---|---|
| 数据采集 | CDP 路径仍作为部分流程的默认入口 | 页面校准（日期/搜索/状态/排序）多次重试，固定等待 1.5-5s | 单次采集可达 30-90s，Chrome 崩溃即中断 |
| 调度策略 | Windows 任务计划固定 15min/5min 触发 | 低谷期与高峰期同等频率，浪费 lark-cli/API 调用 | 无效执行约占 30% |
| 推送通道 | lark-cli 失败触发重试，无指数退避 | 已出现重复发送，且 content is not valid JSON 时重复构造消息 | 群消息噪音、API 调用成本 |
| 决策反馈 | 建议抑制基于简单计数，无运行时成本/延迟感知 | 无法判断「HTTP API 是否变慢」并自动切到 CDP/缓存 | 潜在漏采、预算失控 |

当前系统已具备 **HTTP API 主路径 + CDP 降级** 的良好基础（v4 标注提速 30-60x），但缺失：**运行时路由决策、成本/延迟遥测、自动阴影测试、硬性熔断**。

---

## 二、优化目标（SMART）

1. **效率**：监控任务端到端延迟 P95 从当前 45s 降至 10s（API 路径）/ 60s（CDP 降级路径）。
2. **成本**：非监控时段自动降频，预计减少 30% 无效调用；推送失败重试成本降低 50%。
3. **稳定性**：单点故障（API 限流/CDP 崩溃/lark 异常）实现 5s 内自动降级，目标 99.9% 任务完成率。
4. **进化速度**：新 API/模型可在 1 小时内接入阴影测试，无需改动主流程。

---

## 三、四层治理架构

### Layer 4：生产流量 Guardrail
- **主路径**：`oceanengine-api-client.mjs`（HTTP API）。
- **降级路径**：`cdp-client.mjs` + `calibrate-page.mjs`。
- **兜底路径**：本地缓存快照 / 上一次有效数据 / 人工告警。
- **路由决策**：由 Autonomous Router 根据实时评分选择路径，而非写死优先级。

### Layer 3：实时遥测（Telemetry）
- 记录每次执行的：latency、cost、success、errorType、dataFreshness、pathUsed。
- 存储在 `monitor-data/telemetry.jsonl`，按日轮转。
- 关键指标窗口：最近 20 次执行 + 最近 1 小时聚合。

### Layer 2：阴影竞技场（Shadow Arena）
- 5% 的生产输入被异步复制到新路径/模型做影子测试。
- 用 LLM-as-a-Judge 或结构化 diff 评分。
- 仅在统计显著且成本可接受时才提升路由权重。

### Layer 1：自主治理器（Autonomous Governor）
- 路由权重自更新。
- 成本上限熔断：单次执行超过 `maxCostPerRun` 立即切换。
- 异常流量阻断：失败率突增 / 402 / 429 / 500% 流量峰值 → 熔断 + 飞书告警。

---

## 四、数学评估标准（示例）

对任何路径或模型进行评分前，必须预先定义：

| 维度 | 权重 | 计分规则 |
|---|---|---|
| 成功率 | 30% | 最近 20 次成功次数 / 20 × 30 |
| 延迟 | 25% | `max(0, 25 - (P95_latency_s / 2))` |
| 成本 | 25% | `25 × (cheapest_cost / actual_cost)` |
| 数据完整性 | 15% | 返回字段完整度 × 15 |
| 准确性 | 5% | 与 CDP  golden 结果对比误差 < 2% 得 5 分 |

**Promotion 条件**：新路径连续 30 次阴影执行评分 ≥ 当前主路径评分 + 5%，且成本不高于主路径 110%。

---

## 五、核心模块设计

### 5.1 智能路由器（autonomous-router.mjs）

职责：
- 维护 provider 列表（HTTP API / CDP / Cache）。
- 按历史评分排序，依次尝试，单次执行成本超限即跳过。
- 每个 provider 独立熔断状态。

关键约束：
- 最大重试 2 次。
- 单次执行超时 15s（API）/ 60s（CDP）。
- 成本上限 `maxCostPerRun` 默认 0.01 USD（本地 API 几乎为零，主要限制 lark 重试与外部模型）。

### 5.2 遥测记录器（telemetry.mjs）

职责：
- 每次执行后追加 JSONL：timestamp、provider、latencyMs、success、costEstimate、errorType、dataRows。
- 提供聚合查询：`getProviderScore(provider, window)`、`rankProviders()`。

### 5.3 阴影竞技场（shadow-arena.mjs）

职责：
- 采样生产输入（如 5%）。
- 在后台对新 provider 执行并记录结果。
- 使用 `judge.mjs` 对比主路径输出。
- 不阻塞主流程、不发送真实告警。

### 5.4 LLM-as-a-Judge（judge.mjs）

用于对比「HTTP API 返回的 campaigns 列表」与「CDP 抓取列表」的差异：
- 字段缺失检测（精确规则）。
- 数值差异 > 5% 标红。
- 输出 JSON：{ score, accuracyIssues, costIssues, recommendation }。

### 5.5 熔断器（circuit-breaker.mjs）

状态：
- `CLOSED`：正常。
- `OPEN`：最近 5 次失败 ≥ 3 次，或连续 402/429 ≥ 3 次，或成本 > 上限 200%。
- `HALF_OPEN`：30s 后允许一次探测。

### 5.6 动态调度器（adaptive-scheduler.mjs）

- 监控时段（7:00-23:00）且当前有活跃投放：5min/15min 高频。
- 夜间/无消耗：降至 30min 或暂停。
- 数据过旧（>1h）自动补偿一次立即执行。

---

## 六、实施路线

### Phase 1：基线与边界（Week 1）
- [x] 完成基线瓶颈分析（CDP 路径重、固定调度、lark-cli 无熔断、缺少 telemetry）。
- [x] 实现 `autonomous-router.mjs` + `CircuitBreaker` + `Provider` + 评分排序。
- [x] 实现 `shadow-arena.mjs`、`adaptive-scheduler.mjs` 原型。

### Phase 2：推送通道熔断守卫（已落地）
- [x] 新增 `feishu-push-guard.mjs`：统一包装 lark-cli 推送。
- [x] 参数：timeout 20s、maxRetries 1、circuit OPEN 阈值 2 次失败 / 4 次窗口 / 60s 恢复期。
- [x] 识别 `content is not valid JSON` 等异常返回，失败时 fallback 到 `monitor-data/push-fallback/` 本地日志。
- [x] 已接入：
  - `oceanengine-monitor-v3.mjs`：`sendFeishuPush`（卡片）、严重告警截图、`sendReportFileToChat`（HTML 报表文件）。
  - `oceanengine-daily-report-scheduler.mjs`：23:05 日报卡片推送。
  - `feishu-listener.mjs`：文本回复消息。

### Phase 3：路由与阴影测试（Week 2-3）
- [ ] 将 v3/5min 的主流程数据采集改由 `AutonomousRouter` 驱动（HTTP API / CDP / Cache）。
- [ ] 接入 `shadow-arena.mjs`，对 CDP 路径做 shadow 回归（验证 API 数据准确性）。
- [ ] 实现 `judge.mjs`，对比 API 与 CDP 差异。
- [ ] 若 API 连续显著优于 CDP，自动提升 API 权重。

### Phase 4：自治闭环（Week 4）
- [ ] `adaptive-scheduler.mjs` 替代固定 Windows 任务计划频率。
- [ ] 接入飞书告警：熔断、异常流量、自动路由切换。
- [ ] 每日本地 dashboard 生成（基于 telemetry）。

---

## 七、预期收益

| 指标 | 当前 | 目标 | 验证方式 |
|---|---|---|---|
| 单次采集 P95 延迟 | 45s | 10s（API） | telemetry.jsonl |
| 任务完成率 | 约 96% | 99.9% | daemon-health.json |
| 无效调度比例 | ~30% | <10% | scheduler 日志 |
| 推送重复率 | 偶发 | 0% | suggestion-history + lark 返回码 |
| lark-cli 重试风暴 | content-is-not-valid-JSON 时重复构造 | 1 次重试 + 60s 熔断 | feishu-push-guard 单元测试 |
| 新路径上线周期 | 数天手工验证 | 1h 阴影测试 | shadow-arena 记录 |

---

## 八、关键原则（不可妥协）

1. **绝不实施开放式重试循环**：每次外部调用必须有超时、重试上限和更便宜的 fallback。
2. **绝不凭主观判断模型/API 优劣**：所有 promotion 必须基于预先定义的数学评分。
3. **阴影测试绝不污染生产**：新路径结果只用于评分，真实告警只由主路径触发。
4. **熔断后必须通知到人**：自动恢复是目标，但关键熔断事件（OPEN、成本超限）必须飞书告警。
