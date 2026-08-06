// src/services/fetch-ai-regions-july-hours.mjs
// 拉取 5 个 AI 区域(东南西北中)7月详细小时广告数据,保存为 JSON 供统计分析。
//
// 口径:
//   - 时间:2026-07-01 ~ 2026-07-31,北京时间(API 返回即北京时间)
//   - API 限制:分时(stat_time_hour)只支持 7 天以内 → 按 5 段查询
//   - 维度:stat_time_hour(小时) + cdp_marketing_goal(直播/短视频+图文) + external_action(转化目标)
//   - 指标:stat_cost(消耗) + convert_cnt(转化数) + conversion_cost(转化成本) + clue_message_count(线索)
//   - 销售线索获取类计划 = external_action ∈ {多转化, 私信留资, 表单提交}
//   - 只保留有消耗(stat_cost>0)的小时
//
// 输出:monitor-data/ai-regions-2026-07-hours.json
//   结构: { capturedAt, regions: { 东区: [ {hour, goal, action, cost, conversions, conversionCost, leads} ], ... } }
//
// 用法: node src/services/fetch-ai-regions-july-hours.mjs
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, AI_REGIONS } from '../config/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://ad.oceanengine.com';
const COOKIE_CACHE_FILE = path.join(DATA_DIR, '.oec-cookies.json');
const OUT_FILE = path.join(DATA_DIR, 'ai-regions-2026-07-hours.json');

// 7月按 7 天分段(API 分时限制 7 天内)
const SEGMENTS = [
  ['2026-07-01', '2026-07-07'],
  ['2026-07-08', '2026-07-14'],
  ['2026-07-15', '2026-07-21'],
  ['2026-07-22', '2026-07-28'],
  ['2026-07-29', '2026-07-31'],
];

// 销售线索获取类转化目标
const LEAD_ACTIONS = new Set(['多转化', '私信留资', '表单提交']);

function log(...args) {
  console.log(`[ai-regions-july] ${new Date().toLocaleString()} |`, ...args);
}

function httpPost(url, body, cookieData, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      timeout: timeoutMs,
      headers: { ...cookieData.headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ _raw: data, _status: res.statusCode }); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

async function getCookieData() {
  try {
    if (fs.existsSync(COOKIE_CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(COOKIE_CACHE_FILE, 'utf-8'));
      if (cached.expireAt > Date.now()) return cached;
    }
  } catch {}
  log('  🔄 Cookie 缓存失效, 通过 CDP 提取...');
  const { createClient } = await import('./api-client.mjs');
  const client = await createClient({ useCache: false });
  return client.cookieData;
}

function buildBody(aadvid, startDate, endDate) {
  return {
    DataSetKey: 'basic_ad_data',
    Dimensions: ['stat_time_hour', 'cdp_marketing_goal', 'external_action'],
    EndTime: `${endDate} 23:59:59`,
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [aadvid] }],
    },
    IsDownload: false,
    Metrics: ['stat_cost', 'convert_cnt', 'conversion_cost', 'clue_message_count', 'message_action', 'form'],
    OrderBy: [{ Field: 'stat_time_hour', Type: 1 }],
    PageParams: { Limit: 5000, Offset: 0 },
    StartTime: `${startDate} 00:00:00`,
  };
}

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return isFinite(n) ? n : 0;
};

/**
 * 拉取单个区域整个 7 月的小时数据(5 段分段)
 * @returns {Array<{hour:string, goal:string, action:string, cost:number, conversions:number, conversionCost:number, leads:number}>}
 */
async function fetchRegionHours(region) {
  const { name, aadvid } = region;
  const all = [];
  let cookieData;
  try {
    cookieData = await getCookieData();
  } catch (e) {
    log(`  ⚠ [${name}] Cookie 获取失败: ${e.message}`);
    return all;
  }

  for (const [start, end] of SEGMENTS) {
    const url = `${API_BASE}/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=${aadvid}`;
    const body = buildBody(aadvid, start, end);
    let ok = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await httpPost(url, body, cookieData, 20000);
        if (resp.code && resp.code !== 0 && resp.code !== 200) {
          if (attempt < 3) {
            log(`  [${name}] ${start}~${end} 第${attempt}次 code=${resp.code}, 刷新 Cookie 重试...`);
            try { fs.unlinkSync(COOKIE_CACHE_FILE); } catch {}
            cookieData = await getCookieData();
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          log(`  ❌ [${name}] ${start}~${end} 失败 code=${resp.code} msg=${resp.msg}`);
          break;
        }
        const rows = resp?.data?.StatsData?.Rows || [];
        for (const row of rows) {
          const cost = num(row.Metrics?.stat_cost?.ValueStr);
          if (cost <= 0) continue; // 只保留有消耗小时
          all.push({
            hour: row.Dimensions?.stat_time_hour?.ValueStr || '',
            goal: row.Dimensions?.cdp_marketing_goal?.ValueStr || '',
            action: row.Dimensions?.external_action?.ValueStr || '',
            cost,
            conversions: parseInt(row.Metrics?.convert_cnt?.ValueStr || '0') || 0,
            conversionCost: num(row.Metrics?.conversion_cost?.ValueStr),
            leads: parseInt(row.Metrics?.clue_message_count?.ValueStr || '0') || 0,
          });
        }
        ok = true;
        log(`  ✅ [${name}] ${start}~${end}: ${rows.length} 行, 有消耗 ${rows.filter(r => num(r.Metrics?.stat_cost?.ValueStr) > 0).length} 小时`);
        break;
      } catch (e) {
        log(`  [${name}] ${start}~${end} 第${attempt}次异常: ${e.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
      }
    }
    if (!ok) log(`  ⚠ [${name}] ${start}~${end} 未成功, 跳过`);
    await new Promise(r => setTimeout(r, 1200)); // 限速,避免触发频控
  }
  return all;
}

async function main() {
  log('═══════════════════════════════════════');
  log(`  AI 区域号 7 月小时数据拉取`);
  log(`  区域: ${AI_REGIONS.length} 个 | 段: ${SEGMENTS.length} 段`);
  log('═══════════════════════════════════════');

  const result = { capturedAt: new Date().toISOString(), source: 'http-api', regions: {} };
  let totalRows = 0;

  for (const region of AI_REGIONS) {
    const rows = await fetchRegionHours(region);
    result.regions[region.name] = rows;
    totalRows += rows.length;
    log(`  [${region.name}] 累计有消耗小时行: ${rows.length}`);
  }

  // 汇总统计
  const summary = {};
  for (const [name, rows] of Object.entries(result.regions)) {
    const leadRows = rows.filter(r => LEAD_ACTIONS.has(r.action));
    const byGoal = {};
    for (const r of rows) {
      byGoal[r.goal] = byGoal[r.goal] || { cost: 0, conversions: 0, conversionCost: 0, leads: 0, hours: 0 };
      byGoal[r.goal].cost += r.cost;
      byGoal[r.goal].conversions += r.conversions;
      byGoal[r.goal].conversionCost += r.conversionCost;
      byGoal[r.goal].leads += r.leads;
      byGoal[r.goal].hours += 1;
    }
    const leadByGoal = {};
    for (const r of leadRows) {
      leadByGoal[r.goal] = leadByGoal[r.goal] || { cost: 0, conversions: 0, conversionCost: 0, leads: 0, hours: 0 };
      leadByGoal[r.goal].cost += r.cost;
      leadByGoal[r.goal].conversions += r.conversions;
      leadByGoal[r.goal].conversionCost += r.conversionCost;
      leadByGoal[r.goal].leads += r.leads;
      leadByGoal[r.goal].hours += 1;
    }
    summary[name] = {
      all: byGoal,
      leadActions: leadByGoal,
      totalHours: rows.length,
      leadActionsHours: leadRows.length,
    };
  }
  result.summary = summary;

  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), 'utf-8');
  log(`📁 已保存: ${OUT_FILE}`);
  log(`  总行数: ${totalRows}`);

  // 控制台摘要
  console.log('\n══════ 摘要 ══════');
  for (const [name, s] of Object.entries(summary)) {
    const all = Object.values(s.all).reduce((a, g) => ({
      cost: a.cost + g.cost, conversions: a.conversions + g.conversions, leads: a.leads + g.leads,
    }), { cost: 0, conversions: 0, leads: 0 });
    const lead = Object.values(s.leadActions).reduce((a, g) => ({
      cost: a.cost + g.cost, conversions: a.conversions + g.conversions, leads: a.leads + g.leads,
    }), { cost: 0, conversions: 0, leads: 0 });
    console.log(`[${name}] 有消耗小时 ${s.totalHours} | 总消耗 ¥${all.cost.toFixed(2)} / 转化 ${all.conversions} / 线索 ${all.leads}`);
    console.log(`        线索类计划: 小时 ${s.leadActionsHours} | 消耗 ¥${lead.cost.toFixed(2)} / 转化 ${lead.conversions} / 线索 ${lead.leads}`);
  }
  console.log('══════════════════');
}

main().catch(e => {
  console.error(`❌ Fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
