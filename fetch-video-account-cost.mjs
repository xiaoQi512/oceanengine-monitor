// fetch-video-account-cost.mjs — 主号短视频账户 (1852666142648332) 消耗抓取
// HTTP API 直拉，替代原 oceanengine-daily-summary.mjs 的 CDP proxy 路径
// 请求格式对齐 ai-regions-http.mjs (DataSetKey=basic_ad_data + stat_time_day 维度)
//
// 用法:
//   node fetch-video-account-cost.mjs              # 今日
//   node fetch-video-account-cost.mjs 2026-07-01   # 指定日期

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { createClient } from './oceanengine-api-client.mjs';

const VIDEO_ACCOUNT_ID = '1852666142648332';  // 主号短视频账户
const API_BASE = 'https://ad.oceanengine.com';

function log(...args) {
  console.log(`[fetch-video-acct] ${new Date().toLocaleString()} |`, ...args);
}

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ====== HTTP POST 封装 ======
function httpPost(url, body, cookieData, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        ...cookieData.headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ _raw: data, _status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// ====== 按日期 + cdp_marketing_goal 维度拉取 (对齐 ai-regions-http.mjs) ======
async function fetchByGoal(client, accountId, dateStr) {
  const body = JSON.stringify({
    DataSetKey: 'basic_ad_data',
    Dimensions: ['stat_time_day', 'cdp_marketing_goal'],
    EndTime: `${dateStr} 23:59:59`,
    StartTime: `${dateStr} 00:00:00`,
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [
        { Field: 'advertiser_id', Operator: 7, Values: [accountId] },
      ],
    },
    IsDownload: false,
    Metrics: [
      'stat_cost',          // 消耗
      'convert_cnt',        // 转化数
      'conversion_cost',    // 转化成本
      'clue_message_count', // 私信线索数
      'message_action',     // 私信互动数
      'form',               // 表单提交数
    ],
    OrderBy: [{ Field: 'stat_time_day', Type: 2 }],
    PageParams: { Limit: 50, Offset: 0 },
  });

  const resp = await httpPost(
    `${API_BASE}/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=${accountId}`,
    body,
    client.cookieData
  );

  // 兼容两种返回结构
  const rows = resp?.data?.StatsData?.Rows || resp?.StatsData?.Rows || [];
  if (!rows.length) {
    log(`⚠ 无数据 (raw keys: ${Object.keys(resp || {}).join(',')})`);
    log(`  resp code=${resp?.code} msg=${resp?.msg || resp?.message || ''}`);
    return [];
  }
  return rows.map(row => {
    const m = row.Metrics || {};
    const parseNum = v => parseFloat(String(v || 0).replace(/,/g, '')) || 0;
    const parseIntNum = v => parseInt(String(v || 0).replace(/,/g, '')) || 0;
    return {
      date: row.Dimensions?.stat_time_day?.ValueStr || dateStr,
      goal: row.Dimensions?.cdp_marketing_goal?.ValueStr || '?',
      consume: parseNum(m.stat_cost?.ValueStr),
      convertCnt: parseIntNum(m.convert_cnt?.ValueStr),
      conversionCost: parseNum(m.conversion_cost?.ValueStr),
      clueMessages: parseIntNum(m.clue_message_count?.ValueStr),
      messageActions: parseIntNum(m.message_action?.ValueStr),
      forms: parseIntNum(m.form?.ValueStr),
    };
  });
}

// ====== 主流程 ======
async function main() {
  const targetDate = process.argv[2] || localDateStr(new Date());
  log('═══════════════════════════════════════');
  log('  主号短视频账户消耗抓取 (HTTP API)');
  log(`  账户ID: ${VIDEO_ACCOUNT_ID} | 日期: ${targetDate}`);
  log('═══════════════════════════════════════');

  log('🔄 初始化 client...');
  const client = await createClient({ useCache: true });
  log('✅ Cookie 就绪');

  log(`📊 拉取 ${targetDate} 数据...`);
  const rows = await fetchByGoal(client, VIDEO_ACCOUNT_ID, targetDate);

  if (!rows.length) {
    log('⚠ 无数据返回');
    return;
  }

  log(`\n响应 ${rows.length} 行数据:\n`);
  let totalConsume = 0, totalLeads = 0, totalForms = 0;
  const byGoal = {};
  for (const r of rows) {
    const cpl = r.clueMessages > 0 ? (r.consume / r.clueMessages).toFixed(2) : '0.00';
    log(`┌ ${r.date} | ${r.goal}`);
    log(`│  消耗: ¥${r.consume.toFixed(2)}`);
    log(`│  私信线索: ${r.clueMessages}  表单: ${r.forms}  转化数: ${r.convertCnt}`);
    log(`│  私信互动: ${r.messageActions}`);
    log(`│  CPL: ¥${cpl} (按私信线索) / ¥${r.conversionCost.toFixed(2)} (按转化)`);
    log(`└`);
    if (!byGoal[r.goal]) byGoal[r.goal] = { consume: 0, leads: 0, forms: 0 };
    byGoal[r.goal].consume += r.consume;
    byGoal[r.goal].leads += r.clueMessages;
    byGoal[r.goal].forms += r.forms;
    totalConsume += r.consume;
    totalLeads += r.clueMessages;
    totalForms += r.forms;
  }

  const totalCpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';

  log('\n═══════════════════════════════════════');
  log(`  📅 ${targetDate} 主号短视频账户汇总`);
  log('═══════════════════════════════════════');
  for (const [goal, info] of Object.entries(byGoal)) {
    const cpl = info.leads > 0 ? (info.consume / info.leads).toFixed(2) : '0.00';
    log(`  ${goal}: ¥${info.consume.toFixed(2)} / ${info.leads}线索 / CPL¥${cpl}`);
  }
  log(`  ─────────`);
  log(`  🎬 总消耗: ¥${totalConsume.toFixed(2)}`);
  log(`  📊 总线索: ${totalLeads} (表单${totalForms})`);
  log(`  💰 综合CPL: ¥${totalCpl}`);
  log('═══════════════════════════════════════');

  console.log('\nJSON: ' + JSON.stringify({
    date: targetDate,
    accountId: VIDEO_ACCOUNT_ID,
    total: {
      consume: parseFloat(totalConsume.toFixed(2)),
      leads: totalLeads,
      forms: totalForms,
      cpl: parseFloat(totalCpl),
    },
    byGoal: Object.fromEntries(
      Object.entries(byGoal).map(([k, v]) => [k, {
        consume: parseFloat(v.consume.toFixed(2)),
        leads: v.leads,
        forms: v.forms,
      }])
    ),
    breakdown: rows,
  }, null, 2));
}

main().catch(e => {
  log(`❌ 致命错误: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
