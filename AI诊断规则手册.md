# AI 自动诊断 · 快照数据分析规则手册

> 用途：为 AI 提供结构化诊断规则，用于分析 15 分钟快照数据并生成诊断提醒
> 原则：此规则仅做数据诊断与异常标注，**不输出操作建议**（操作留给人工决策）
> 维护：新增规则追加在「规则登记」表末尾，版本号递增

---

## 一、数据来源

AI 诊断时可直接读取以下数据文件：

| 数据源 | 路径 | 内容 | 粒度 |
|--------|------|------|------|
| 最新快照 | `monitor-data/{YYYY}-{MM}-{DD}T{hh}-{mm}-{ss}.json` | 当前 15 分钟窗口的完整分析结果 | 当前时刻 |
| 历史快照 | `monitor-data/` 下按时间排序的全量文件 | 所有 15 分钟快照的完整分析结果 | 15 分钟 |
| 多日基线 | 最新快照中的 `_multiDay` 字段 | 近3天同时段统计（mean/stdev/min/max） | 天级别 |
| 班次数据 | `monitor-data/shifts-{date}.json` | 当天所有班次的计划级明细 | 天级别 |
| 日汇总 | `monitor-data/daily-summary-done-{date}.json` | 当天日汇总完成标记 | 天级别 |
| 待确认操作 | `monitor-data/pending-actions.json` | 飞书端待二次确认的操作 | 实时 |
| 操作审计 | `monitor-data/action-audit.jsonl` | P0-P2 所有操作执行记录（beforeValue/afterValue） | 事件级别 |

### 快照顶层字段速查

| 字段 | 类型 | 含义 |
|------|------|------|
| `summary` | object | 账户级汇总：totalSpend/totalConversions/avgCPA/avgCPM 等 |
| `delta` | object | 变化量：spendLast15min/spendLastHour/speedCurrent 等 |
| `active` | array | 投放中且活跃的计划列表（每条含 spend/conversions/cpa/budget 等） |
| `allSpending` | array | 所有有消耗的计划（含 active + 低消耗计划） |
| `paused` | number | 暂停计划数量 |
| `_multiDay` | object | 近 N 天同时段统计基线（entries/各指标 mean/stdev） |
| `alerts` | array | 自动告警列表（每条含 type/severity/name/detail） |
| `topNewSpenders` | array | 新增消耗 TOP5 |
| `rampingUp` | array | 起量计划 |
| `dropping` | array | 掉量计划 |
| `budgetExceededChanges` | array | 状态变化：投放中 → 超出预算 |

---

## 二、规则登记

| 版本 | 日期 | 规则 | 更新频率 | 输出类型 |
|------|------|------|:---:|------|
| v1.1 | 2026-07-28 | 直播间消耗节奏基线（Rule-001） | 每周一次 | 诊断提醒（仅标注异常，无操作建议） |

---

## 三、诊断规则

### Rule-001：直播间消耗节奏基线校准

**目标**：自动校准直播间的正常消耗节奏，用于判断当前消耗是否异常（过快/过慢/正常）。

**数据来源**：
- 近 15 天同时段快照（`_multiDay.entries` + 历史快照文件）
- 近 30 天同时段快照（历史快照文件，按日期过滤）
- 班次数据（`shifts-{date}.json`）

**计算逻辑**：

#### Step 1：提取历史消耗速度
读取最新快照 `_multiDay` 中的历史同时段日均消耗速度：

| 指标 | 来源 | 含义 |
|------|------|------|
| 15天均值 | `_multiDay.spend.mean` | 近3天同时段日均消耗均值 |
| 15天标准差 | `_multiDay.spend.stdev` | 波动幅度 |
| 15天 min/max | `_multiDay.spend.min / .max` | 极值范围 |

> 当前 `_multiDay.entries` 仅含近 3 天数据。**15 天基线**通过累加最近 15 个 `shifts-{date}.json` 的总消耗并取同时段均值；**1 个月基线**同理取最近 30 个班次文件。

#### Step 2：定义消耗节奏分级（仅诊断标注）

以 `15天均值 ± N × 标准差` 为判断阈值：

| 节奏级别 | 条件 | 标签 |
|----------|------|------|
| 过慢 | 当前时均速度 < 15天均值 - 2×stdev | pacing_slow |
| 偏慢 | 当前时均速度 < 15天均值 - 1×stdev | pacing_slightly_slow |
| 正常 | 15天均值 ± 1×stdev 范围内 | pacing_normal |
| 偏快 | 当前时均速度 > 15天均值 + 1×stdev | pacing_slightly_fast |
| 过快 | 当前时均速度 > 15天均值 + 2×stdev | pacing_fast |

#### Step 3：CPL 联动标注

消耗节奏的标注需与 CPL 联动，用于丰富诊断信息：

| 节奏 | CPL | 诊断标注 |
|------|-----|--------|
| pacing_fast | CPL < 15天均值 | 高效放量中 |
| pacing_fast | CPL > 15天均值 + 1×stdev | CPL 同步恶化 |
| pacing_slow | CPL < 15天均值 | 高效但消耗不足 |
| pacing_slow | CPL > 15天均值 | 消耗低且 CPL 高 |

#### Step 4：输出校准结果

每周一自动执行一次基线校准（或由 AI 在首次诊断时触发）。输出格式：

```markdown
## 直播间消耗节奏基线校准 · {日期}

### 15天基线（均值 ± 2σ）
- 日均消耗: ¥{mean} ± ¥{stdev}
- 时均速度: ¥{speed}/min（基于直播窗口时段均摊）
- CPL: ¥{cpaMean} ± ¥{cpaStdev}
- 样本天数: {sampleDays}

### 1个月基线
- 日均消耗: ¥{mean30}
- 时均速度: ¥{speed30}/min
- CPL: ¥{cpaMean30}
- 趋势: {上升/平稳/下降}

### 与上次校准对比
- 消耗均值变化: {变化量}（{变化率}%）
- CPL 变化: {变化量}（{变化率}%）

### 阈值设定
| 级别 | 消耗速度范围 | 触发条件 |
|------|------------|--------|
| 过慢 | < ¥{slowThreshold}/min | pacing < 均值÷4 或持续2个窗口不达标 |
| 偏慢 | ¥{slowThreshold} ~ ¥{normalLow}/min | |
| 正常 | ¥{normalLow} ~ ¥{normalHigh}/min | |
| 偏快 | ¥{normalHigh} ~ ¥{fastThreshold}/min | |
| 过快 | > ¥{fastThreshold}/min | pacing > 均值×2.5 或 CPL 同比恶化>50% |
```

**更新频率**：每周一次（周一执行）。重新计算 15 天和 1 个月基线。

**AI 诊断时的使用方式**：
1. 读取最新快照的 `delta.speedCurrent`（即时消耗速度）
2. 对照本规则的消耗节奏分级查出当前级别
3. 联动 `summary.avgCPA` 和 `_multiDay.cpa.mean` 做 CPL 标注
4. 输出诊断报告（仅描述状态与异常，不给出操作建议）

---

## 四、AI 诊断示例

### 输入
> 最新快照：delta.speedCurrent=40.7¥/min, summary.avgCPA=106.4¥, summary.totalSpend=9,788¥

### 执行流程
1. **节奏判断**：当前消耗速度 40.7¥/min，对比15天均值±1σ 确定级别
2. **CPL 联动**：当前 CPL=106.4¥，对比15天 CPL 均值 100.4¥（+6%），在正常范围内
3. **输出诊断**：「正常节奏，CPL 略高但偏差可控」——仅记录状态，不输出操作建议

### 输出模板
```markdown
## AI 诊断 · {时间}

### 当前状态
| 指标 | 当前值 | 15天均值 | 偏差 |
|------|--------|---------|------|
| 消耗速度 | {currentSpeed}¥/min | {meanSpeed}¥/min | {deviation}% |
| CPL | {currentCpl}¥ | {meanCpl}¥ | {deviation}% |
| 有消耗计划 | {allSpending}条 | - | - |

### 节奏判定
{pacingLevel}

### CPL 联动标注
{cplAnalysis}

> 注：本报告仅做数据诊断，不包含操作建议。操作决策请结合实际情况由人工判断。
```

---

## 五、版本历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-07-28 | v1.0 | Rule-001 直播间消耗节奏基线校准；数据来源速查表；AI 诊断输出模板 |
| 2026-07-28 | v1.1 | 明确诊断边界：此规则仅做数据诊断与异常标注，不输出操作建议 |
