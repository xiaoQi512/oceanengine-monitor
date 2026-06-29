# 巨量引擎监控 — HTTP API 完整迁移方案

> 2026-06-21 | 基于逆向工程 + 真实数据验证

## 🎯 逆向工程结果

成功逆向 3 个核心 API，可在 **1-2秒** 内完成完整数据采集（对比 CDP 方案 30-70秒）。

### 已验证的 API 端点

| 端点 | 方法 | 返回 | 耗时 | 状态 |
|------|------|------|------|------|
| `POST /ad/api/promotion/projects/list` | POST (JSON) | 项目列表 + 16个指标 | ~600ms | ✅ 已验证 |
| `GET /ad/api/agw/dashboard/dashboard_stats` | GET | 账户消耗/预算/余额 | ~300ms | ✅ 已验证 |
| `POST /ad/api/agw/statistics_sophonx/statQuery` | POST (JSON) | 小时级统计+环比 | ~400ms | ✅ 已逆向 |

### 实测数据对比

```
同一个账户，同一时刻：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                  CDP方案     HTTP API方案
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总耗时            30-70s      1.1s
计划数            178+        100 (含所有有消耗)
投放中消耗        ～¥18,572   ¥18,572.00 ✅
账户消耗          ¥19,276     ¥19,428.24 (含暂停计划)
转化数            196         198
TOP1 CPA          ¥107.25     ¥107.25 ✅
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
数据一致性：核心指标完全吻合 ✓
速度提升：27-63倍
```

## 🔑 关键参数发现

### projects/list 的 `isSophonx:1` 标志

这是使 `metrics` 有数据的**关键参数**。不加此标志 → `metrics: {}`，加了 → 返回完整16个指标。

### sort_order 语义

- `sort_order: 1` + `sort_stat: 'stat_cost'` = 消耗**降序**（高→低）
- 注意：使用 `sort_stat: 'create_time'` 会改变分页结构

### Cookie 缓存策略

- Session Cookie 有效约 2 小时
- 已实现自动检测（metrics为空→强制刷新Cookie→重试）
- 缓存 TTL 设为 2 小时

### API 请求格式

```javascript
// projects/list (核心 — 替代整个CDP抓取)
POST https://ad.oceanengine.com/ad/api/promotion/projects/list?aadvid={ACCOUNT_ID}
{
  "st": "2026-06-21",          // 开始日期
  "et": "2026-06-21",          // 结束日期
  "sort_stat": "stat_cost",    // 按消耗排序
  "sort_order": 1,             // 1=降序
  "limit": 50,                 // 每页条数
  "page": 1,
  "project_status": [-1],      // -1=所有状态
  "promotion_status": [-1],
  "campaign_type": [1],        // 通投
  "fields": [                  // 需要返回的指标
    "stat_cost", "convert_cnt", "form", "message_action",
    "clue_message_count", "attribution_all_convert_clue_count",
    "ctr", "cpm_platform", "conversion_rate", "conversion_cost",
    "luban_live_enter_cnt", "live_watch_one_minute_count",
    "luban_live_comment_cnt", "live_component_click_cost"
  ],
  "isSophonx": 1,              // ← 关键！返回metrics
  "search_type": "8"
}
```

### 返回的 metrics 完整字段

```javascript
{
  stat_cost: "4,933.32",              // 消耗 (¥, 含千分位)
  convert_cnt: "46",                  // 转化数
  form: "0",                          // 表单提交
  message_action: "5",                // 私信开口
  clue_message_count: "5",            // 私信留资
  attribution_all_convert_clue_count: "46", // 归因线索
  ctr: "6.78%",                       // 点击率
  cpm_platform: "79.18",              // CPM
  conversion_rate: "1.15%",           // CVR
  conversion_cost: "107.25",          // CPA
  luban_live_enter_cnt: "2,406",      // 直播间进入
  live_watch_one_minute_count: "322", // >1分钟观看
  luban_live_comment_cnt: "17",       // 评论数
  live_component_click_cost: "12.32", // 组件点击成本
}
```

## 📋 迁移步骤

### 步骤 1：Cookie 预取（一次性，每次 session）

```bash
node -e "import {createClient} from './oceanengine-api-client.mjs'; await createClient({forceRefresh:true})"
```

Cookie 缓存在 `monitor-data/.oec-cookies.json`，2小时有效。后续 `createClient()` 自动使用缓存。

### 步骤 2：修改 oceanengine-monitor-v3 → v4

在 `main()` 函数中，将整个 CDP 连接+导航+校准+抓取流程替换为：

```javascript
import { createClient, collectAllData } from './oceanengine-api-client.mjs';

// 替代: quickConnect → waitForTableReady → ensureDataConsistency → 
//        setPageSize → sortBySpend → scrapeOnePage → 翻页循环
const client = await createClient();
const apiData = await collectAllData(client);
// apiData = { campaigns, accountSpend, accountBudget, accountBalance, pageSummary, stats }
```

### 步骤 3：数据适配

`collectAllData()` 返回的 `campaigns` 数组与 v3.1 的 `scrapeOnePage()` 输出格式**完全兼容**——直接传入 `analyzeData()` 即可。

### 步骤 4：保留 CDP 作为降级方案

当 HTTP API 不可用时（Cookie过期+Chrome未运行），自动降级到 CDP 方案：

```javascript
let data;
try {
  const client = await createClient();
  data = await collectAllData(client);
} catch (apiErr) {
  console.log('  ⚠ HTTP API失败，降级到CDP方案');
  // 原有 CDP 流程
}
```

### 步骤 5：可删除的文件（降级保留）

**可切换后不再需要（降级保留）**：
- ❌ `cdp-navigate-login.mjs`
- ❌ `force-today.mjs`
- ❌ `force-navigate.mjs`
- ❌ `goto-project-page.mjs`

**仍需保留（守护/恢复）**：
- ✅ `cdp-client.mjs` — Cookie提取 + 降级方案
- ✅ `monitor-daemon.mjs` — 健康检查 + Chrome 自动恢复

## 📊 收益预估

| 指标 | 迁移前 (CDP) | 迁移后 (HTTP) | 改善 |
|------|-------------|---------------|------|
| 单次采集耗时 | 30-70s | 1-2s | **30-60x** |
| CPU 占用 | Chrome 进程 500MB+ | Node 进程 ~50MB | **10x** |
| 失败模式 | Chrome崩溃/页面卡死 | Cookie过期(可检测) | 可控 |
| 并发能力 | 1 (单浏览器) | 无限 | ∞ |
| 可维护性 | DOM选择器脆弱 | API固定格式 | 高 |

## ⚠️ 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| API 端点变更 | 低 (内部API非公开) | 降级到 CDP 方案 |
| Cookie 提前过期 | 中 (实测2h) | 自动检测+强制刷新 |
| IP 频率限制 | 低 | 15min/次远低于阈值 |
| `_signature` 参数失效 | 低 | dashboard_stats已验证不需要 |

---

## 下一步行动

1. ✅ **已完成** — 逆向工程分析
2. ✅ **已完成** — oceanengine-api-client.mjs v2
3. ⏳ **待执行** — 修改 v3.1 → v4 (替换 main() 的 CDP 采集)
4. ⏳ **待执行** — 添加降级逻辑
5. ⏳ **待执行** — 测试 7:00-23:00 完整窗口运行
6. ⏳ **待执行** — 更新 Windows 任务计划
