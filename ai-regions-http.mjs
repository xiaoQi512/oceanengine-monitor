// ai-regions-http.mjs — AI区域号汇总 (HTTP API 版, 替代 CDP proxy)
// 21:30 触发: HTTP API 直拉5个AI账户全天数据 → 区分直播/短视频 → 合并 → 推飞书群
//
// 核心API: POST /report/api/tool/agw/statistics_sophonx/statQuery
// 维度: cdp_marketing_goal (1=短视频+图文, 2=直播)
//
// 环境变量:
//   OEC_SILENT=1   静默模式
//   OEC_FORCE=1    强制执行
//   OEC_DRY_RUN=1  只采集不推送
//
// 用法:
//   常驻: pm2 start ecosystem.config.cjs --only pm2-ai-regions
//   测试: OEC_FORCE=1 OEC_DRY_RUN=1 node ai-regions-http.mjs

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
const AI_CHAT_ID = FEISHU_ANCHOR_CHAT_ID; // 上架群
const API_BASE = 'https://ad.oceanengine.com';
const COOKIE_CACHE_TTL = 2 * 60 * 60 * 1000;

// 保证 PM2 短命进程日志不丢失
process.stdout._handle?.setBlocking?.(true);
function log(...args) {
  console.log(`[ai-regions-http] ${new Date().toLocaleString()} |`, ...args);
}

function todayDateCN() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// ====== HTTP 请求封装 ======
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

// ====== Cookie 获取 (复用 api-client 的缓存, 避免重复登录) ======
const COOKIE_CACHE_FILE = path.join(DATA_DIR, '.oec-cookies.json');

async function getCookieData(aadvid) {
  // 读缓存 (2h TTL)
  try {
    if (fs.existsSync(COOKIE_CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(COOKIE_CACHE_FILE, 'utf-8'));
      if (cached.expireAt > Date.now()) {
        return cached;
      }
    }
  } catch {}

  // 缓存失效 → 调 api-client 刷新 (需要切换账户上下文)
  log(`  🔄 Cookie 缓存失效, 通过 CDP 提取 (aadvid=${aadvid})...`);
  const { createClient } = await import('./oceanengine-api-client.mjs');
  // createClient 会自动用主账户的 Cookie, 但 AI 区域号是不同账户
  // 巨量引擎的 Cookie 是全局的 (session级别), 切换 aadvid 只是切换查看视角
  // 所以可以用主账户 Cookie 调 statQuery, 只要传入对应 aadvid
  const client = await createClient({ useCache: false });
  return client.cookieData;
}

// ====== 构造 statQuery 请求体 ======
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

// ====== 调 statQuery 拉取单区域数据 ======
async function fetchRegion(region) {
  const { name, aadvid } = region;
  const today = getLocalDate();

  log(`▶ [${name}] HTTP API 拉取... aadvid=${aadvid}`);

  let cookieData;
  try {
    cookieData = await getCookieData(aadvid);
  } catch (e) {
    log(`  ⚠ [${name}] Cookie 获取失败: ${e.message}`);
    return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0, error: e.message };
  }

  const url = `${API_BASE}/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=${aadvid}`;
  const body = buildStatQueryBody(aadvid, today);

  // 最多3次重试 (Cookie 过期会自动刷新)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await httpPost(url, body, cookieData, 15000);

      // 检测 Cookie 过期 (401/403 或 code 非零)
      if (resp.code && resp.code !== 0 && resp.code !== 200) {
        if (attempt < 3) {
          log(`  [${name}] 第${attempt}次: code=${resp.code}, 刷新 Cookie 重试...`);
          // 强制刷新 Cookie
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

      // 解析行: 按 cdp_marketing_goal 区分
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

// ====== 推送飞书群 ======
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

// ====== 主流程 ======
async function main() {
  log('═══════════════════════════════════════');
  log(`  AI区域号每日汇总 (HTTP API 版)`);
  log(`  日期: ${todayDateCN()} | 账户: ${AI_REGIONS.length}个区域`);
  log('═══════════════════════════════════════\n');

  const results = [];
  for (const region of AI_REGIONS) {
    const r = await fetchRegion(region);
    results.push(r);
    await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5s间隔避免限流
  }

  // 合并统计
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

  log('\n═══════════════════════════════════════');
  log(`  汇总: 直播 ¥${totalLive.consume.toFixed(2)}/${totalLive.leads}线索 + 短视频 ¥${totalVideo.consume.toFixed(2)}/${totalVideo.leads}线索`);
  log(`  总计: ¥${grandTotal.consume.toFixed(2)} / ${grandTotal.leads}线索 / CPL ¥${cpl}`);
  log('═══════════════════════════════════════\n');

  // 构造推送文本 (保持与 oceanengine-ai-regions.mjs 原格式一致)
  const lines = [`${todayDateCN()} AI区域号数据汇总`, ''];

  for (const r of results) {
    const totalLeads = r.liveLeads + r.videoLeads;
    const totalConsume = r.liveConsume + r.videoConsume;
    const totalCpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
    const liveCpl = r.liveLeads > 0 ? (r.liveConsume / r.liveLeads).toFixed(2) : '0.00';
    const videoCpl = r.videoLeads > 0 ? (r.videoConsume / r.videoLeads).toFixed(2) : '0.00';

    lines.push(`【极狐${r.name}】 ${todayDateCN()}数据汇总`);
    lines.push(`【线索数】：${totalLeads}`);
    lines.push(`【投流费用】：${totalConsume.toFixed(2)}元（直播${r.liveConsume.toFixed(2)}元/短视频${r.videoConsume.toFixed(2)}元）`);
    lines.push(`【线索成本（CPL）】：${totalCpl}元（直播CPL${liveCpl}/短视频CPL${videoCpl}）`);
    lines.push('');
  }

  const grandCpl = grandTotal.leads > 0 ? (grandTotal.consume / grandTotal.leads).toFixed(2) : '0.00';
  lines.push(`【5区总计】 线索${grandTotal.leads} / 消耗¥${grandTotal.consume.toFixed(2)} / 综合CPL¥${grandCpl}`);

  const text = lines.join('\n');
  log(`推送文本预览:\n${text}\n`);

  if (OEC_DRY_RUN) {
    log('🟡 DRY_RUN 模式, 不推送');
  } else {
    pushToLark(text);
  }

  // 保存到 monitor-data
  const reportFile = path.join(DATA_DIR, `ai-regions-${getLocalDate()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify({
    date: getLocalDate(),
    capturedAt: new Date().toISOString(),
    source: 'http-api',
    regions: results,
    totals: { live: totalLive, video: totalVideo, grand: grandTotal, cpl: parseFloat(cpl) },
  }, null, 2));
  log(`📁 报表已保存: ${reportFile}`);
}

main().catch(e => {
  log(`❌ Fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
