// fetch-short-video-cost.mjs — 一次性抓取福利营销中心账号(主账户)短视频消耗成本
// 用 statQuery API + cdp_marketing_goal 维度区分直播/短视频
// 用法: node fetch-short-video-cost.mjs [YYYY-MM-DD]

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { createClient } from './oceanengine-api-client.mjs';
import { DATA_DIR } from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'https://ad.oceanengine.com';
const ACCOUNT_ID = process.env.OEC_ACCOUNT_ID || '1842681352509635';

// 日期参数: 默认今天
const targetDate = process.argv[2] || (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

function log(...args) {
  console.log(`[fetch-short-video] ${new Date().toLocaleString()} |`, ...args);
}

// ====== HTTP POST ======
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

// ====== 构造 statQuery 请求体 (cdp_marketing_goal 维度) ======
function buildStatQueryBody(aadvid, dateStr) {
  return {
    DataSetKey: 'basic_ad_data',
    Dimensions: ['stat_time_day', 'cdp_marketing_goal'],
    EndTime: `${dateStr} 23:59:59`,
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [
        { Field: 'advertiser_id', Operator: 7, Values: [aadvid] },
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
    StartTime: `${dateStr} 00:00:00`,
  };
}

// ====== 主流程 ======
async function main() {
  log('═══════════════════════════════════════');
  log(`  福利营销中心账号 短视频消耗抓取`);
  log(`  账户ID: ${ACCOUNT_ID} | 日期: ${targetDate}`);
  log('═══════════════════════════════════════\n');

  // 创建 client (会自动刷新 Cookie)
  log('  🔄 初始化 client (自动刷新 Cookie)...');
  const client = await createClient({ useCache: false });
  log('  ✅ Cookie 就绪\n');

  const url = `${BASE_URL}/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=${ACCOUNT_ID}`;
  const body = buildStatQueryBody(ACCOUNT_ID, targetDate);

  // 3次重试
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await httpPost(url, body, client.cookieData, 15000);

      if (resp.code && resp.code !== 0 && resp.code !== 200) {
        log(`  ⚠ 第${attempt}次: code=${resp.code}, msg=${resp.message || ''}`);
        if (attempt < 3) {
          // 强制刷新 Cookie
          const COOKIE_CACHE_FILE = path.join(DATA_DIR, '.oec-cookies.json');
          try { fs.unlinkSync(COOKIE_CACHE_FILE); } catch {}
          await new Promise(r => setTimeout(r, 2000));
          const fresh = await createClient({ useCache: false });
          Object.assign(client.cookieData, fresh.cookieData);
          continue;
        }
      }

      const rows = resp?.data?.StatsData?.Rows || [];
      if (rows.length === 0) {
        log(`  ⚠ 响应无数据行`);
        log(`  🔍 原始响应:`, JSON.stringify(resp).substring(0, 500));
        process.exit(1);
      }

      // 调试: 输出原始 Dimensions 值
      log(`  📊 响应 ${rows.length} 行数据:`);
      for (const row of rows) {
        const dims = row.Dimensions || {};
        log(`    - cdp_marketing_goal: "${dims.cdp_marketing_goal?.ValueStr || ''}" | stat_time_day: "${dims.stat_time_day?.ValueStr || ''}"`);
      }
      log('');

      let liveConsume = 0, liveLeads = 0, liveForms = 0, liveConvertCost = 0;
      let videoConsume = 0, videoLeads = 0, videoForms = 0, videoConvertCost = 0;

      for (const row of rows) {
        const goal = row.Dimensions?.cdp_marketing_goal?.ValueStr || '(未知)';
        const m = row.Metrics || {};
        // ⚠️ ValueStr 含千位逗号，必须先去逗号
        const cost = parseFloat((m.stat_cost?.ValueStr || '0').replace(/,/g, '')) || 0;
        const leads = parseInt((m.clue_message_count?.ValueStr || '0').replace(/,/g, '')) || 0;
        const forms = parseInt((m.form?.ValueStr || '0').replace(/,/g, '')) || 0;
        const convertCnt = parseInt((m.convert_cnt?.ValueStr || '0').replace(/,/g, '')) || 0;
        const convertCost = parseFloat((m.conversion_cost?.ValueStr || '0').replace(/,/g, '')) || 0;

        log(`  ┌ ${goal}`);
        log(`  │  消耗: ¥${cost.toFixed(2)}`);
        log(`  │  转化数: ${convertCnt}`);
        log(`  │  转化成本: ¥${convertCost.toFixed(2)}`);
        log(`  │  私信线索: ${leads}`);
        log(`  │  表单提交: ${forms}`);
        log(`  └`);

        if (goal.includes('直播')) {
          liveConsume += cost;
          liveLeads += leads;
          liveForms += forms;
          liveConvertCost += convertCost;
        } else if (goal.includes('短视频') || goal.includes('图文')) {
          videoConsume += cost;
          videoLeads += leads;
          videoForms += forms;
          videoConvertCost += convertCost;
        }
      }

      const totalConsume = liveConsume + videoConsume;
      const totalLeads = liveLeads + videoLeads;
      const cpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
      const videoCpl = videoLeads > 0 ? (videoConsume / videoLeads).toFixed(2) : '0.00';
      const liveCpl = liveLeads > 0 ? (liveConsume / liveLeads).toFixed(2) : '0.00';

      log('\n═══════════════════════════════════════');
      log(`  📅 ${targetDate} 福利营销中心账号汇总`);
      log('═══════════════════════════════════════');
      log(`  🔴 直播:   ¥${liveConsume.toFixed(2)} | ${liveLeads}线索 | CPL ¥${liveCpl}`);
      log(`  🎬 短视频: ¥${videoConsume.toFixed(2)} | ${videoLeads}线索 | CPL ¥${videoCpl}`);
      log(`  📊 总计:   ¥${totalConsume.toFixed(2)} | ${totalLeads}线索 | CPL ¥${cpl}`);
      if (totalConsume > 0) {
        const videoRatio = (videoConsume / totalConsume * 100).toFixed(1);
        const liveRatio = (liveConsume / totalConsume * 100).toFixed(1);
        log(`  📈 占比:   直播 ${liveRatio}% | 短视频 ${videoRatio}%`);
      }
      log('═══════════════════════════════════════\n');

      // 输出 JSON 便于后续处理
      const result = {
        date: targetDate,
        accountId: ACCOUNT_ID,
        live: { consume: liveConsume, leads: liveLeads, forms: liveForms, cpl: parseFloat(liveCpl) },
        shortVideo: { consume: videoConsume, leads: videoLeads, forms: videoForms, cpl: parseFloat(videoCpl) },
        total: { consume: totalConsume, leads: totalLeads, cpl: parseFloat(cpl) },
      };
      console.log('JSON:', JSON.stringify(result, null, 2));

      process.exit(0);
    } catch (e) {
      log(`  第${attempt}次异常: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }

  log('  ❌ 3次重试失败');
  process.exit(1);
}

main().catch(e => {
  log(`致命错误: ${e.message}`);
  console.error(e);
  process.exit(1);
});
