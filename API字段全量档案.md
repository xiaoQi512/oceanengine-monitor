# 巨量引擎监控 · API 字段全量档案

> 来源：projects/list + dashboard/stats + hourly/stats + 5分钟快照 + collectAllData + session/stats + online_room
> 状态标记：✅ 已入库使用 | ⬜ 已解析未入库 | 🔒 40102拦截 | ❌ 未尝试

---

## 一、projects/list（73 字段，核心数据源）

### 1.1 状态层级（7 字段）

| API字段 | 类型 | 枚举/示例 | 状态 | DB字段 |
|---------|------|------|:---:|------|
| `project_status` | int | 0=启用, 2=暂停 | ✅ | campaigns.status |
| `project_status_name` | str | "启用"/"暂停" | ✅ | campaigns.status |
| `project_status_first` | int | 0=投放中, 2=未投放 | ⬜ | — |
| `project_status_first_name` | str | "投放中"/"未投放" | ⬜ | — |
| `project_status_second` | array | [] 正常 / [2] 已暂停 | ⬜ | — |
| `project_status_second_name` | str | "" 正常 / "已暂停" | ⬜ | — |
| `campaign_status` | int | 2=活跃, 3=已暂停 | ⬜ | — |

**映射关系**：
```
project_status=0, first=0, second=[] → 启用+投放中+单元正常 (7条)
project_status=2, first=2, second=[2] → 暂停+未投放+已暂停 (192条)
```

### 1.2 优化/学习状态（1 字段）

| API字段 | 类型 | 枚举 | 状态 | 说明 |
|---------|------|------|:---:|------|
| `campaign_opt_status` | int | 0=学习期, 1=完成 | ⬜ | 0 对应7条新/重启计划，1 对应 192 条老计划 |

### 1.3 投放模式（8 字段）

| API字段 | 类型 | 枚举 | 状态 |
|---------|------|------|:---:|
| `delivery_mode` | int | 3=稳定成本-常规版 | ⬜ |
| `delivery_mode_internal` | int | 3 | ⬜ |
| `delivery_scene_name` | str | "稳定成本-常规版" | ⬜ |
| `smart_bid_type` | int | 0=关闭 | ⬜ |
| `deep_bid_type` | int | 0=标准 | ⬜ |
| `project_bid` | float | 出价金额 | ⬜ |
| `ad_pricing` | int | 9=oCPM | ⬜ |
| `ad_pricing_name` | str | "oCPM" | ⬜ |

### 1.4 时间/排期（10 字段）

| API字段 | 类型 | 说明 | 状态 |
|---------|------|------|:---:|
| `create_time` | datetime | 计划创建时间 | ⬜ |
| `start_time` | datetime | 投放开始时间 | ⬜ |
| `end_time` | datetime | 投放结束（74%为2036年=无限期） | ⬜ |
| `modify_time` | datetime | 最后修改时间 | ⬜ |
| `project_aggregate_modify_time` | datetime | 聚合修改时间（含子级操作） | ⬜ |
| `week_schedule_type` | int | 0=全天, 1=指定时段 | ⬜ |
| `delivery_duration` | int | 投放时长 | ⬜ |
| `auto_extend` | obj | 自动扩展预算配置 | ⬜ |
| `delivery_package` | int | 投放包类型 | ⬜ |
| `delivery_package_period` | — | 投放包周期 | ⬜ |

### 1.5 转化目标（4 字段）

| API字段 | 类型 | 枚举 | 状态 |
|---------|------|------|:---:|
| `external_action` | int | 192=私信留资(133), 100=多转化(36), 2=表单提交(30) | ⬜ |
| `external_action_name` | str | "私信留资"/"多转化事件"/"表单提交" | ⬜ |
| `deep_external_action_name` | str | 深度转化目标名 | ⬜ |
| `clue_new_customer` | — | 新客线索 | ⬜ |

### 1.6 创意/资产（5 字段）

| API字段 | 类型 | 枚举 | 状态 |
|---------|------|------|:---:|
| `asset_type` | int | 1001=企业号落地页(全部) | ⬜ |
| `asset_type_name` | str | "企业号落地页" | ⬜ |
| `landing_type` | int | 1=销售线索收集(全部) | ⬜ |
| `landing_type_name` | str | "销售线索收集" | ⬜ |
| `delivery_medium_name` | str | "企业号落地页" | ⬜ |

### 1.7 预算/出价（5 字段）

| API字段 | 类型 | 说明 | 状态 |
|---------|------|------|:---:|
| `campaign_budget` | float | ✅ | campaigns.daily_budget |
| `campaign_budget_mode` | int | 1=总预算, 2=日预算 | ⬜ |
| `campaign_budget_mode_name` | str | "总预算"/"按日预算" | ⬜ |
| `project_deep_cpa_bid` | float | 深度CPA出价 | ✅ | campaigns.bid |
| `project_bid` | float | 出价 | ⬜ |

### 1.8 营销/定向（6 字段，大部分为空对象）

| API字段 | 类型 | 状态 |
|---------|------|:---:|
| `marketing_info` | obj | {} 空对象 | ⬜ |
| `promotion_strategy` | obj | {} 空对象 | ⬜ |
| `audience` | obj | {} 空对象 | ⬜ |
| `inventory` | obj | {} 空对象 | ⬜ |
| `campaign_type` | int | 1=通投(全部) | ⬜ |
| `is_search_plan` | bool | false(全部) | ⬜ |

### 1.9 其他标识（27 字段，大部分为固定值或空）

| API字段 | 说明 | 状态 |
|---------|------|:---:|
| `project_id` | 项目ID | ✅ campaigns.campaign_id |
| `project_name` | 项目名 | ✅ campaigns.name |
| `campaign_id` | 广告系列ID | ⬜ |
| `advertiser_id` | 广告主ID | ⬜ |
| `project_first_roi_goal` | ROI目标 | ⬜ |
| `project_roi_goal` | ROI目标 | ⬜ |
| `shop_multi_roi_goals` | 多ROI目标 | {} 空 | ⬜ |
| `metrics` | 指标对象 | {} 空（需isSophonx参数） | ⬜ |
| 其余 19 字段 | classify/can_boost等 | 全部为 undefined/固定值 | — |

---

## 二、dashboard/stats（10 字段，账户级）

| API字段 | 类型 | 说明 | 状态 |
|---------|------|------|:---:|
| `advertiserName` | str | 广告主名 | ✅ |
| `todaySpend` | float | 今日消耗 | ✅ |
| `todayBudget` | float | 今日预算 | ✅ |
| `balance` | float | 账户余额 | ✅ |
| `validBalance` | float | 有效余额 | ✅ |
| `cash` | float | 现金余额 | ✅ |
| `grant` | float | 赠款余额 | ✅ |
| `brandCost` | float | 品牌消耗 | ⬜ |
| `bidCost` | float | 竞价消耗 | ✅ |
| `budgetMode` | int | 预算模式 | ⬜ |

---

## 三、hourly/stats（7 指标 × 24 小时）

### 3.1 指标列表

| metric | 含义 | 结构 |
|--------|------|------|
| `stat_cost` | 消耗金额 | `{value, valueStr, comparison, ratio}` |
| `show_cnt` | 展示次数 | 同上 |
| `click_cnt` | 点击数 | 同上 |
| `convert_cnt` | 转化数 | 同上 |
| `conversion_cost` | 线索成本(CPA) | 同上 |
| `cpm_platform` | 千次展示成本 | 同上 |
| `form` | 表单提交数 | 同上 |

### 3.2 对比字段结构

每个指标含4个子字段：
| 子字段 | 含义 |
|--------|------|
| `value` | 当前值 |
| `valueStr` | 格式化字串 |
| `comparison` | 对比值（昨日同时段） |
| `ratio` | 环比变化率 |

状态：⬜ 全部未入库

---

## 四、5分钟快照（5m-*.json，核心监控数据）

### 4.1 账户级指标

| 字段 | 类型 | 说明 | 状态 |
|------|------|------|:---:|
| `accountSpend` | float | 账户累计消耗 | ✅ |
| `accountBudget` | float | 账户日预算 | ✅ |
| `accountBalance` | float | 账户余额 | ✅ |
| `summarySpend` | float | 汇总消耗 | ⬜ |
| `totalConv` | int | 总转化数 | ✅ |
| `activeCount` | int | 投放中计划数 | ✅ |
| `spendingCount` | int | 有消耗计划数 | ⬜ |
| `impressions` | int | 展示数 | ⬜ |
| `liveViews` | int | 直播间观看 | ⬜ |
| `liveOver1Min` | int | 观看>1分钟 | ⬜ |
| `_recentCPM` | float | 最近CPM | ⬜ |
| `time` | str | 快照时间 | ✅ |
| `_method` | str | 采集方式 | ⬜ |

### 4.2 滚动窗口（_rolling）

| 字段 | 类型 | 说明 | 状态 |
|------|------|------|:---:|
| `_rolling.last5min` | float | 近5分钟消耗 | ⬜ |
| `_rolling.last5minMinutes` | float | 实际分钟数 | ⬜ |
| `_rolling.convLast5min` | int | 近5分钟转化 | ⬜ |
| `_rolling.windows` | array | 历史窗口数组 | ⬜ |

---

## 五、collectAllData（计划级汇总）

### 5.1 顶层字段

| 字段 | 说明 | 状态 |
|------|------|:---:|
| `campaigns` | 计划数组 | ✅ |
| `accountSpend` | 账户消耗 | ✅ |
| `accountBudget` | 账户预算 | ✅ |
| `accountBalance` | 账户余额 | ✅ |
| `pageSummary` | 页面汇总 | ⬜ |
| `stats` | 统计对象 | ⬜ |
| `elapsed` | 采集耗时(秒) | ⬜ |
| `method` | 采集方式 | ⬜ |
| `totalProjects` | 总计划数 | ⬜ |
| `totalPages` | 总页数 | ⬜ |

### 5.2 计划级（campaigns[].*）

| 字段 | 类型 | 说明 | 状态 |
|------|------|------|:---:|
| `id` | str | 项目ID | ✅ snapshots.campaign_id |
| `name` | str | 项目名 | ✅ |
| `status` | str | 状态("投放中"/"暂停") | ✅ |
| `rawStatus` | str | 原始状态("启用") | ⬜ |
| `optStatus` | int | 优化状态 | ⬜ |
| `spend` | float | 累计消耗 | ✅ snapshots.cost |
| `conversions` | int | 转化数 | ✅ snapshots.conversions |
| `formSubmit` | int | 表单提交 | ✅ snapshots.form_submit |
| `privateMsgOpen` | int | 私信打开 | ✅ snapshots.msg_open |
| `privateMsgRetain` | int | 私信留资 | ✅ snapshots.msg_lead |
| `attributionClue` | int | 归因线索 | ⬜ |
| `leads` | int | 线索数 | ✅ snapshots.leads |
| `ctr` | float | 点击率 | ✅ snapshots.ctr |
| `cpm` | float | 千次展示成本 | ✅ snapshots.cpm |
| `cvr` | float | 转化率 | ✅ snapshots.cvr |
| `cpa` | float | 单次行动成本 | ⬜ |
| `budget` | float | 预算 | ⬜ |
| `budgetMode` | str | 预算模式 | ⬜ |
| `liveEnter` | int | 直播间进入 | ⬜ |
| `liveViews` | int | 直播间观看 | ✅ snapshots.views |
| `liveOneMin` | int | 观看>1分钟 | ✅ snapshots.views_1min |
| `liveOver1Min` | int | 观看>1分钟('22接口) | ⬜ |
| `liveComment` | int | 评论数 | ✅ snapshots.comments |

---

## 六、session/stats（直播场次）

| 字段 | 类型 | 说明 | 状态 |
|------|------|------|:---:|
| `total.cost` | float | 场次总消耗 | ⬜ |
| `total.leads` | int | 场次总线索 | ⬜ |
| `rows` | array | 场次明细（通常为空） | ⬜ |

---

## 七、online_room（直播间实时状态）

| 字段 | 类型 | 说明 | 状态 |
|------|------|------|:---:|
| `room_id` | str | 房间ID | ⬜ |
| `room_title` | str | 房间标题 | ⬜ |
| `room_status` | str | 状态码 | ⬜ |
| `room_start_time` | int | 开始时间戳 | ⬜ |
| `online_user_count` | int | 在线人数 | ⬜ |
| `is_live` | bool | 是否直播中 | ⬜ |

---

## 八、操作审计（action-audit.jsonl，P0-P2产物）

| 字段 | 类型 | 说明 | 状态 |
|------|------|------|:---:|
| `time` | datetime | 审计时间 | ✅ |
| `traceRef` | str | 追踪引�� | ✅ |
| `actionType` | str | 操作类型 | ✅ |
| `planName` | str | 计划名 | ✅ |
| `projectId` | str | 项目ID | ✅ |
| `source` | str | 来源(feishu/dashboard/manual) | ✅ |
| `beforeValue` | obj | 操作前状态 | ✅ |
| `afterValue` | obj | 操作后状态 | ✅ |
| `result` | obj | 执行结果 | ✅ |
| `workerPid` | int | 执行进程PID | ✅ |

---

## 统计总览

| 端点 | 字段数 | 已入库 | 未入库 | 拦截 |
|------|:---:|:---:|:---:|:---:|
| projects/list | 73 | 6 | 67 | 0 |
| projects/detail | — | 0 | 0 | 🔒 |
| adgroups/list | — | 0 | 0 | 🔒 |
| live_room/list | — | 0 | 0 | 🔒 |
| dashboard/stats | 10 | 8 | 2 | 0 |
| hourly/stats | 7指标×24h | 0 | 7 | 0 |
| 5m snapshots | 17 | 5 | 12 | 0 |
| collectAllData | 10顶层+22计划级 | 15 | 17 | 0 |
| session/stats | 2 | 0 | 2 | 0 |
| online_room | 5 | 0 | 5 | 0 |
| action-audit | 9 | 9 | 0 | 0 |
| **合计** | **≈130** | **~45** | **~85** | **3端点** |

---

## 版本

| 日期 | 变更 |
|------|------|
| 2026-07-30 | 初始版本：projects/list+stats+snapshots+audit 全量归档 |
