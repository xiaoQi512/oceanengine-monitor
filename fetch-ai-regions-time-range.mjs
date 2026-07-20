// fetch-ai-regions-time-range.mjs — 按时间段重新抓取AI区域号数据并推送飞书群
// 用途: 测试重新抓取指定时间范围的主播数据

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findLarkCli, DATA_DIR, getLocalDate,
  AI_REGIONS, FEISHU_ANCHOR_CHAT_ID,
} from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === '1';
const AI_CHAT_ID = FEISHU_ANCHOR_CHAT_ID;
const API_BASE = 'https://ad.oceanengine.com';
const COOKIE_CACHE_FILE = path.join(DATA_DIR, '.oec-cookies.json');

const TARGET_DATE = process.env.OEC_DATE || getLocalDate();
const START_HOUR = parseInt(process.env.OEC_START_HOUR || '9');
const END_HOUR = parseInt(process.env.OEC_END_HOUR || '11');

function log(...args) {
  console.log(`[ai-regions-range] ${new Date().toLocaleString()} |`, ...args);
}

function todayDateCN(dateStr) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

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

async function getCookieData(aadvid) {
  try {
    if (fs.existsSync(COOKIE_CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(COOKIE_CACHE_FILE, 'utf-8'));
      if (cached.expireAt > Date.now()) {
        return cached;
      }
    }
  } catch {}

  log(`  🔄 Cookie 缓存失效, 通过 CDP 提取 (aadvid=${aadvid})...`);
  const { createClient } = await import('./oceanengine-api-client.mjs');
  const client = await createClient({ useCache: false });
  return client.cookieData;
}

function buildStatQueryBody(aadvid, dateStr, startHour, endHour) {
  return {
    DataSetKey: 'basic_ad_data',
    Dimensions: ['stat_time_hour', 'cdp_marketing_goal'],
    EndTime: `${dateStr} ${String(endHour).padStart(2, '0')}:59:59`,
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [
        { Field: 'advertiser_id', Operator: 7, Values: [aadvid] },
      ],
    },
    IsDownload: false,
    Metrics: [
      'stat_cost',
      'convert_cnt',
      'conversion_cost',
      'clue_message_count',
      'message_action',
      'form',
    ],
    OrderBy: [{ Field: 'stat_time_hour', Type: 1 }],
    PageParams: { Limit: 100, Offset: 0 },
    StartTime: `${dateStr} ${String(startHour).padStart(2, '0')}:00:00`,
  };
}

async function fetchRegion(region, dateStr, startHour, endHour) {
  const { name, aadvid } = region;

  log(`▶ [${name}] HTTP API 拉取... aadvid=${aadvid}, ${dateStr} ${startHour}:00-${endHour}:59`);

  let cookieData;
  try {
    cookieData = await getCookieData(aadvid);
  } catch (e) {
    log(`  ⚠ [${name}] Cookie 获取失败: ${e.message}`);
    return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0, error: e.message };
  }

  const url = `${API_BASE}/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=${aadvid}`;
  const body = buildStatQueryBody(aadvid, dateStr, startHour, endHour);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await httpPost(url, body, cookieData, 15000);

      if (resp.code && resp.code !== 0 && resp.code !== 200) {
        if (attempt < 3) {
          log(`  [${name}] 第${attempt}次: code=${resp.code}, 刷新 Cookie 重试...`);
          try { fs.unlinkSync(COOKIE_CACHE_FILE); } catch {}
          cookieData = await getCookieData(aadvid);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
      }

      const rows = resp?.data?.StatsData?.Rows || [];
      if (rows.length === 0) {
        log(`  ⚠ [${name}] 响应无数据行`);
        return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0, error: 'no rows' };
      }

      let liveConsume = 0, liveLeads = 0, liveForms = 0;
      let videoConsume = 0, videoLeads = 0, videoForms = 0;

      for (const row of rows) {
        const goal = row.Dimensions?.cdp_marketing_goal?.ValueStr || '';
        const m = row.Metrics || {};
        const cost = parseFloat(m.stat_cost?.ValueStr || '0') || 0;
        const leads = parseInt(m.clue_message_count?.ValueStr || '0') || 0;
        const forms = parseInt(m.form?.ValueStr || '0') || 0;

        if (goal.includes('直播')) {
          liveConsume += cost;
          liveLeads += leads;
          liveForms += forms;
        } else if (goal.includes('短视频') || goal.includes('图文')) {
          videoConsume += cost;
          videoLeads += leads;
          videoForms += forms;
        }
      }

      const result = {
        name,
        liveConsume, liveLeads, liveForms,
        videoConsume, videoLeads, videoForms,
      };
      const totalLeads = liveLeads + videoLeads;
      const totalConsume = liveConsume + videoConsume;
      const cpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
      log(`  ✅ [${name}] 直播¥${liveConsume.toFixed(2)}/${liveLeads}线索 + 短视频¥${videoConsume.toFixed(2)}/${videoLeads}线索 = CPL¥${cpl}`);
      return result;
    } catch (e) {
      log(`  [${name}] 第${attempt}次异常: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }

  log(`  ❌ [${name}] 3次重试失败`);
  return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0, error: 'max retries' };
}

function pushToLark(text) {
  const larkCli = findLarkCli();
  if (!larkCli) { log('  ⚠ lark-cli 不可用'); return false; }
  const isExe = larkCli.endsWith('.exe');
  try {
    const out = execFileSync(
      isExe ? larkCli : 'cmd.exe',
      isExe
        ? ['im', '+messages-send', '--chat-id', AI_CHAT_ID, '--text', text, '--as', 'bot']
        : ['/c', larkCli, 'im', '+messages-send', '--chat-id', AI_CHAT_ID, '--text', text, '--as', 'bot'],
      { encoding: 'utf-8', timeout: 20000, windowsHide: true, cwd: __dirname }
    );
    const parsed = JSON.parse(out);
    if (parsed.ok) {
      log(`  ✅ 已推送飞书群: ${parsed.data?.message_id || 'ok'}`);
      return true;
    }
    log(`  ❌ 推送失败: ${parsed.error?.message || JSON.stringify(parsed)}`);
    return false;
  } catch (e) {
    log(`  ❌ 推送异常: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log(`  AI区域号时间段数据采集`);
  console.log(`  日期: ${TARGET_DATE} | 时段: ${START_HOUR}:00-${END_HOUR}:59`);
  console.log(`  模式: ${OEC_DRY_RUN ? 'DRY_RUN (不推送)' : '全量 (含推送)'}`);
  console.log('═══════════════════════════════════════');
  console.log('');

  const results = [];
  for (const region of AI_REGIONS) {
    const r = await fetchRegion(region, TARGET_DATE, START_HOUR, END_HOUR);
    results.push(r);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  const totalLive = results.reduce((s, r) => ({
    consume: s.consume + r.liveConsume,
    leads: s.leads + r.liveLeads,
    forms: s.forms + r.liveForms,
  }), { consume: 0, leads: 0, forms: 0 });

  const totalVideo = results.reduce((s, r) => ({
    consume: s.consume + r.videoConsume,
    leads: s.leads + r.videoLeads,
    forms: s.forms + r.videoForms,
  }), { consume: 0, leads: 0, forms: 0 });

  const grandTotal = {
    consume: totalLive.consume + totalVideo.consume,
    leads: totalLive.leads + totalVideo.leads,
  };
  const cpl = grandTotal.leads > 0 ? (grandTotal.consume / grandTotal.leads).toFixed(2) : '0.00';

  console.log('═══════════════════════════════════════');
  console.log(`  汇总: 直播 ¥${totalLive.consume.toFixed(2)}/${totalLive.leads}线索 + 短视频 ¥${totalVideo.consume.toFixed(2)}/${totalVideo.leads}线索`);
  console.log(`  总计: ¥${grandTotal.consume.toFixed(2)} / ${grandTotal.leads}线索 / CPL ¥${cpl}`);
  console.log('═══════════════════════════════════════');
  console.log('');

  const lines = [`${todayDateCN(TARGET_DATE)} AI区域号【${START_HOUR}:00-${END_HOUR}:59】数据汇总`, ''];

  for (const r of results) {
    const totalLeads = r.liveLeads + r.videoLeads;
    const totalConsume = r.liveConsume + r.videoConsume;
    const totalCpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
    const liveCpl = r.liveLeads > 0 ? (r.liveConsume / r.liveLeads).toFixed(2) : '0.00';
    const videoCpl = r.videoLeads > 0 ? (r.videoConsume / r.videoLeads).toFixed(2) : '0.00';

    lines.push(`【极狐${r.name}】 ${todayDateCN(TARGET_DATE)} ${START_HOUR}:00-${END_HOUR}:59数据`);
    lines.push(`【线索数】：${totalLeads}`);
    lines.push(`【投流费用】：${totalConsume.toFixed(2)}元（直播${r.liveConsume.toFixed(2)}元/短视频${r.videoConsume.toFixed(2)}元）`);
    lines.push(`【线索成本（CPL）】：${totalCpl}元（直播CPL${liveCpl}/短视频CPL${videoCpl}）`);
    lines.push('');
  }

  const grandCpl = grandTotal.leads > 0 ? (grandTotal.consume / grandTotal.leads).toFixed(2) : '0.00';
  lines.push(`【5区总计】 线索${grandTotal.leads} / 消耗¥${grandTotal.consume.toFixed(2)} / 综合CPL¥${grandCpl}`);

  const text = lines.join('\n');
  console.log(`推送文本预览:`);
  console.log(text);
  console.log('');

  if (!OEC_DRY_RUN) {
    pushToLark(text);
  } else {
    console.log('🟡 DRY_RUN 模式, 不推送');
  }

  const reportFile = path.join(DATA_DIR, `ai-regions-${TARGET_DATE}-${START_HOUR}-${END_HOUR}.json`);
  fs.writeFileSync(reportFile, JSON.stringify({
    date: TARGET_DATE,
    timeRange: `${START_HOUR}:00-${END_HOUR}:59`,
    capturedAt: new Date().toISOString(),
    source: 'http-api',
    regions: results,
    totals: { live: totalLive, video: totalVideo, grand: grandTotal, cpl: parseFloat(cpl) },
  }, null, 2));
  console.log(`📁 报表已保存: ${reportFile}`);
}

main().catch(e => {
  console.error(`❌ Fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});