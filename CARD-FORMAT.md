# 巨量引擎监控 · 卡片格式规范

> 适用：15分钟整刻钟推送（`oceanengine-monitor-v3.mjs` → `buildFeishuCard`）
> 更新：2026-07-16

---

## 一、卡片结构总览

```
📊 极狐直播 · 消耗 ¥{spend} ({pct}%) · {slot}           ← header
█████░░░░░ {timePct}%  (已过{elapsed}h/{window}h)          ← Section 1: 消耗节奏
███░░░░░░░ {budgetPct}%  (¥{spend} / ¥{budget})
📊 {pacing} | {slot}
🎯 预估今日 ¥{projected} | 剩余 {remaining}h
💳 账户余额: ¥{balance} (约{days}天)
──
━ 累计 ━                                                     ← Section 2: 核心指标
💰 消耗: ¥{spend} | CPL ¥{avgCPA}
🎯 转化: {conv}条
📨 开口成本: ¥{openCost} | 开口留资率: {retainRate}%
━ 近{N}分差值 ━
📊 新增消耗: +¥{deltaSpend} | 新增线索: +{deltaConv}条
📈 CPL: ¥{deltaCPL} | CPM: ¥{avgCPM} | 停留率: {retain}%
⚡ 速度: ¥{speed}/min | 有消耗 {spending}条 · 投放中 {active}条
──
🔵 节奏提醒                                                   ← Section 3: 告警
ℹ {info alerts}
──
📊 计划状态: 🔥 活跃 {n} · 💀 疑似死亡 {n}                   ← Section 4: 生命周期
🔥 起量: {names}                                              ← Section 5: 起量
📊 近{N}分钟新增消耗 TOP5                                     ← Section 6: TOP消耗
1. ➡ {name} — ¥{spend} (+{rate}%) · {N}mCPL ¥{cpl}
...
──
📅 同比昨天同时段 ({date})                                    ← Section 7: 同环比
消耗: ¥{ySpend} → ¥{spend} ({pct}) | CPL: ¥{yCPL} → ¥{cpl} ({pct})
📊 近{N}天同时段
消耗: ¥{avgSpend} → ¥{spend} ({pct}) | CPL: ¥{avgCPL} → ¥{cpl} ({pct})
──
💡 盯盘建议: {advice}                                         ← Section 8: 建议
🕐 {timestamp} · {slot}                                       ← footer
```

---

## 二、Section 1 · 消耗节奏 (pacingLines)

| 行 | 数据来源 | 变量 | 计算 |
|----|---------|------|------|
| 时间进度条 | `d.timeProgress` | `timePct` | `now() - 6:30 / (23:30 - 6:30) * 100` |
| 预算进度条 | `summary.totalSpend` / `d.dailyBudget` | `budgetPct` | `spend / budget * 100` |
| 节奏标签 | `d.pacingLabel` | - | `analysis` 中根据预算进度判定 |
| 预估今日 | `d.projectedDaily` | `projected` | `spend / timeProgress` (线性外推) |
| 账户余额 | `summary.accountBalance` | `balance` | API: `getDashboardStats().balance` |

### 数据链路
```
getDashboardStats(apiClient)
  → stats.balance, stats.todayBudget
collectAllData(apiClient)
  → totalMetrics.stat_cost → summary.totalSpend
analysis.delta
  → d.timeProgress, d.dailyBudget, d.projectedDaily, d.pacingLabel, d.elapsedHours, d.windowDuration
```

---

## 三、Section 2 · 核心指标 (metricsLines)

### 3.1 累计区

| 指标 | 变量 | 公式 | API 来源 |
|------|------|------|---------|
| 消耗 | `summary.totalSpend` | API 直出 | `collectAllData → totalMetrics.stat_cost` |
| CPL | `summary.avgCPA` | `totalSpend / totalConversions` | - |
| 转化 | `summary.totalConversions` | API 直出 | `totalMetrics.convert_cnt` |
| 开口成本 | `totalSpend / totalPrivateMsgOpen` | **每产生一次开口的平均消耗** | `message_action` (开口数) |
| 开口留资率 | `summary.openRetainRate * 100%` | `privateMsgRetain / privateMsgOpen` | `clue_message_count` (留资数) |

```
开口数:     totalMetrics.message_action    → summary.totalPrivateMsgOpen
留资数:     totalMetrics.clue_message_count → summary.totalPrivateMsgRetain
开口留资率: summary.openRetainRate = totalPrivateMsgRetain / totalPrivateMsgOpen
开口成本:   summary.totalSpend / totalPrivateMsgOpen
```

### 3.2 差值区

| 指标 | 变量 | 公式 | 来源 |
|------|------|------|------|
| 窗口分钟 | `Math.round(d.age15 \|\| 15)` | 当前快照与前次的时间差 | DB: 15分快照 |
| 新增消耗 | `d.spendLast15min` | `totalSpend - prevSnapshotTotal` | DB: 快照差值 |
| 新增线索 | `d.convLast15min` | per-campaign `convDelta` 求和 | DB: 快照差值 (-1=数据不足) |
| CPL | `d.cplLast15min` | `spendLast15min / convLast15min` | 计算 |
| CPM | `summary.avgCPM` | **累计值**（快照无展示数差值） | API: `totalMetrics.cpm_platform` |
| 停留率 | `summary.viewRetention * 100%` | **累计值**（快照无观看数差值） | `liveOneMin / liveViews` |
| 速度 | `d.speedCurrent` | `spendLast15min / age15` | 计算 |

### 差值数据链路
```
DB: 前次15分钟快照 (prev)
  → prev.totalSpend, prev.totalConversions, prev.timestamp
  → d.age15 = minutesBetween(prev.timestamp, now)
  → d.spendLast15min = summary.totalSpend - prev.totalSpend (跨天归零修复)
  → per-campaign convDelta 汇总 → d.convLast15min
  → d.cplLast15min = d.spendLast15min / d.convLast15min
  → d.speedCurrent = d.spendLast15min / d.age15

仅快照追踪: 消耗、转化
暂未追踪:   展示数(impressions)、观看数(liveViews)、停留超1分(liveOver1Min)
            → CPM、停留率回退到累计值
```

---

## 四、Section 3 · 告警 (alertLines)

仅显示 **信息级告警**（`infoAlerts`），类型：
- `pacing_fast` / `pacing_slow` — 节奏偏移
- `dead_plan` — 疑似死亡计划
- `dropping` — 计划掉量

操作级告警（`🔴 需处理`）和关注级告警（`🟡 需关注`）不在卡片中展示，通过 `sendFeishuPush` 的 `pendingSuggestions` 单独推送。

### 数据链路
```
analysis.alerts[]
  → infoAlerts = alerts.filter(type in [speed_spike, budget, pacing_fast, pacing_slow, dead_plan, dropping])
  → 每条: `ℹ ${a.name}: ${a.detail}`
```

---

## 五、Section 4 · 计划状态 (lifecycle)

| 指标 | 来源 | 条件 |
|------|------|------|
| 活跃 | `d.lifecycle.active` | `active > 0` 时显示 |
| 疑似死亡 | `d.lifecycle.dead` | `dead > 0` 时显示 |
| **整行** | `d.lifecycle.dead > 0` 时显示 | 无死亡计划时隐藏整行 |

```
d.lifecycle ← analysis.delta
  active: 时均消耗 ≥ ¥100 或 投放 < 3h
  dead:   时均消耗 < ¥100 且 已投放 ≥ 3h
```

---

## 六、Section 5 · 起量

| 指标 | 来源 | 显示条件 |
|------|------|---------|
| 起量 | `rampingUp` 数组 | `rampingUp.length > 0` |

```
rampingUp = campaignDeltas.filter(c => c.trend === '起量')
  每项: c.name + '+' + (c.changeRate * 100).toFixed(0) + '%'
```

---

## 七、Section 6 · TOP新增消耗

### 数据来源
```
topNewSpenders = campaignDeltas.sort(spendDelta desc).slice(0, 5)
  每项: ⬅/➡/🔥(trend) + name(截断18字) + ¥spendDelta + rateStr + 15mCPL
```

---

## 八、Section 7 · 同环比

### 8.1 同比昨天同时段

| 指标 | 来源 | 公式 |
|------|------|------|
| 消耗对比 | `d.yoy` | `(todaySpend / yesterdaySpend - 1) * 100%` |
| CPL对比 | `d.yoy` | `(todayCPL / yesterdayCPL - 1) * 100%` |

```
d.yoy ← loadYesterdayBaseline()
  → API: getHourlyStats({ startHour: shift.startHour, endHour: now.getHours() })
  → 提取 yesterday 的 spend, conversions, CPL
  → 对比 today vs yesterday
```

### 8.2 近N天同时段均值

| 指标 | 来源 | 公式 |
|------|------|------|
| 消耗均值 | `analysis._multiDay.spend.mean` | N日均值 vs today |
| CPL均值 | `analysis._multiDay.cpa.mean` | N日均值 vs today |

```
analysis._multiDay ← loadMultiDayBaseline()
  → 取近3天同时段数据, 计算均值+标准差
  → 对比 today vs mean
```

---

## 九、Section 8 · 时段建议

### 数据来源
```
getTimeSlotAdvice(d.timeSlot, d.budgetUsed, rampingUp.length, dropping.length)
  → 根据时段+预算进度+起量/掉量生成建议文案
```

---

## 十、API 字段映射总表

### collectAllData → pageSummary / summary

| 飞书展示 | summary 字段 | API 字段 | 说明 |
|---------|-------------|----------|------|
| 消耗 | `totalSpend` | `stat_cost` | 账户消耗 |
| 转化 | `totalConversions` | `convert_cnt` | 转化次数 |
| 开口数 | `totalPrivateMsgOpen` | `message_action` | 私信开口行动 |
| 留资数 | `totalPrivateMsgRetain` | `clue_message_count` | 私信留资料 |
| 表单提交 | `totalFormSubmit` | `form` | 表单提交数 |
| 归因线索 | `totalLeads` | `attribution_all_convert_clue_count` | 归因线索数 |
| CPM | `avgCPM` | `cpm_platform` | 千次展示成本 |
| CTR | - | `ctr` | 点击率 |
| CVR | - | `conversion_rate` | 转化率 |
| CPL | `avgCPA` | `conversion_cost` | 单次转化成本 |
| 直播间观看 | `totalLiveViews` | `luban_live_enter_cnt` | 进入直播间 |
| 停留>1分 | `totalLiveOver1Min` | `live_watch_one_minute_count` | 观看>1分钟 |
| 展示数 | `totalImpressions` | `show_cnt` | 广告展示次数 |

### getDashboardStats → stats

| 字段 | 说明 |
|------|------|
| `todaySpend` | 今日消耗 |
| `todayBudget` | 今日预算 |
| `balance` | 账户余额 |

### getProjects (isSophonx:1) → projectsPage

| 层级 | 说明 |
|------|------|
| `totalMetrics.*` | 汇总行（与 collectAllData 同字段） |
| `projects[].metrics.*` | 每条计划明细 |

---

## 十一、版本历史

| 日期 | 变更 |
|------|------|
| 2026-07-16 | 初始版本：累计/差值分区、开口成本/留资率、精简告警/建议、去账户预算余额重复 |
| 2026-07-27 | **[v3.x]** 新增操作回执卡片 (D6)：重复指令二次确认交互卡片 |

---

## 十二、操作回执卡片 v3.x

> 适用：`feishu-listener.mjs` 重复指令二次确认
> 触发：当日已执行过同一操作的指令再次发起时
> 发送：`sendConfirmCard(chatId, action, tempId, count, lastTime)` → `pushCard`

### 卡片结构

```
┌─ orange header ───────────────────┐
│ 操作确认                           │
├────────────────────────────────────┤
│                                    │
│ 当日已对 **{planName}** 执行过      │
│ {count} 次{actionType}操作          │
│ 最近一次：{lastTime}               │
│ 确认要再次执行吗？                  │
│                                    │
│ ──────────────────────────────────  │
│ └ note: 回复「执行」确认 · 回复「拒绝」取消 · 3分钟后超时   │
└────────────────────────────────────┘
```

### 数据字段

| 字段 | 来源 | 说明 |
|------|------|------|
| `planName` | `action.planName` | 操作目标计划名 |
| `count` | `checkDuplicateToday()` 返回值 `.length` | 当日同操作历史次数 |
| `lastTime` | 审计记录 `time` 字段 `HH:MM:SS` | 最近一次执行时间 |
| `actionType` | `ACTION_TEXT[action.type]` | 中文操作名（暂停/关停/恢复/加预算） |

### 回退机制

若 `pushCard` 调用失败（如 `lark-cli card` 未安装或不支持），自动回退为文本消息：

```
🟡 当日已对「{planName}」执行过 {count} 次{actionType}操作
   最近一次：{lastTime}
   确认要再次执行吗？
   回复"执行"确认 · 回复"拒绝"取消
```

### 确认流程

```
用户指令 → acknowledgeStart → 预检查 → 重复检测 → addPending + sendConfirmCard
                                                     ↓
用户回复「执行」→ dispatch(type=execute) → findPending → removePending → enqueue → 报告
用户回复「拒绝」→ dispatch(type=reject) → findPending → removePending → 取消
3分钟超时    → scanPending → sendMsg(超时取消) → removePending
```

### 文件关系

```
feishu-listener.mjs
  ├─ sendConfirmCard(chatId, action, tempId, count, lastTime)
  │     └─ pushCard(LARK_CLI, card, chatId) → feishu-push-guard.mjs
  ├─ addPending(action, chatId, meta) → pending-actions.json
  ├─ findPending(chatId, planName) → dispatch consume
  └─ scanPending() → 30s 定时器超时清理
```
