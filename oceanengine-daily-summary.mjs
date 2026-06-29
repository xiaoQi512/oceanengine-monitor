// oceanengine-daily-summary.mjs — 区域福利号日汇总推送
// 23:05 触发：HTTP API 拉直播全天 + CDP 拉短视频全天 → 合并 → 推飞书群
//
// 环境变量：
//   OEC_SILENT=1   静默模式
//   OEC_FORCE=1    强制执行（测试用）
//   OEC_DRY_RUN=1  只采集不推送
//
// 用法：
//   常驻: pm2 start ecosystem.config.cjs --only pm2-daily-summary
//   测试: OEC_FORCE=1 OEC_DRY_RUN=1 node oceanengine-daily-summary.mjs

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient, getHourlyStats } from './oceanengine-api-client.mjs';
import { findLarkCli, DATA_DIR, getLocalDate } from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OEC_FORCE = process.env.OEC_FORCE === '1';
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === '1';

// ====== 配置 ======
const SPREADSHEET_TOKEN = 'GiNOslsWQhyHDPtclPscns3GnAf';
const SHEET_ID = 'j69tpS';
const SUMMARY_CHAT_ID = 'oc_b245ee4b255c7b25b7f8d953802c49ff';  // 上架群
const LIVE_ACCOUNT_ID = '1842681352509635';      // 直播账户
const VIDEO_ACCOUNT_ID = '1852666142648332';     // 短视频账户
const CDP_PROXY = 'http://localhost:3456';
const CAR_MODEL = '贝塔T1';

// 飞书表行号：6月26日=200，每天8行
const BASE_DATE = new Date(2026, 5, 26);
const BASE_ROW = 200;

function getTodayStartRow() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - BASE_DATE) / 86400000);
  return BASE_ROW + diffDays * 8;
}

function log(...args) { console.log(`[daily-summary] ${new Date().toLocaleString()} |`, ...args); }

function todayDateCN() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// ====== 1. HTTP API 拉直播全天数据 ======
async function fetchLiveAllDay() {
  log('▶ 拉取直播账户全天数据...');
  const client = await createClient({ useCache: true });
  // 全天：startHour=7, endHour=22 → 7:00-23:00
  const result = await getHourlyStats(client, {
    accountId: LIVE_ACCOUNT_ID,
    startHour: 7,
    endHour: 22,
  });
  let totalConsume = 0, totalLeads = 0;
  const hourDetails = [];
  for (const row of (result.rows || [])) {
    const rowHour = parseInt(row.hour?.match(/(\d{2}):00/)?.[1] ?? -1);
    if (rowHour < 7 || rowHour > 22) continue;
    const cost = parseFloat((row.metrics?.stat_cost?.valueStr || '0').replace(/,/g, '')) || 0;
    const leads = parseInt((row.metrics?.convert_cnt?.valueStr || '0').replace(/,/g, '')) || 0;
    totalConsume += cost;
    totalLeads += leads;
    hourDetails.push({ hour: row.hour, cost, leads });
  }
  const cpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
  log(`  ✅ 直播全天: 消耗¥${totalConsume.toFixed(2)} 线索${totalLeads} CPL¥${cpl}`);
  hourDetails.forEach(h => log(`    ${h.hour}: ¥${h.cost.toFixed(2)} / ${h.leads}线索`));
  return { totalConsume, totalLeads, cpl };
}

// ====== 2. CDP 拉短视频全天数据 ======
async function fetchVideoAllDay() {
  log('▶ 拉取短视频账户全天数据 (CDP)...');
  const today = getLocalDate();

  // 2a. 探活 CDP proxy
  const proxyAlive = await new Promise(resolve => {
    const req = http.get(`${CDP_PROXY}/targets`, { timeout: 5000 }, res => {
      res.on('data', () => {}); res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
  if (!proxyAlive) {
    log('  ⚠ CDP proxy 不可用，短视频数据填0');
    return { totalConsume: 0, totalLeads: 0, cpl: '0.00' };
  }

  // 2b. 打开短视频账户报表
  let targetId;
  try {
    const resp = await new Promise((resolve, reject) => {
      const req = http.request(`${CDP_PROXY}/new`, {
        method: 'POST',
        timeout: 15000,
        headers: { 'Content-Type': 'text/plain' },
      }, res => {
        let data = ''; res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(`https://ad.oceanengine.com/statistics_pages/ad_report/customize/report/detail/299469267?aadvid=${VIDEO_ACCOUNT_ID}`);
      req.end();
    });
    targetId = resp.targetId;
    if (!targetId) throw new Error('未获取 targetId');
  } catch (e) {
    log(`  ⚠ 打开短视频报表失败: ${e.message}`);
    return { totalConsume: 0, totalLeads: 0, cpl: '0.00' };
  }

  // 2c. 等待5秒后提取数据
  await new Promise(r => setTimeout(r, 5000));
  let videoData = { totalConsume: 0, totalLeads: 0, cpl: '0.00' };
  try {
    const evalResp = await new Promise((resolve, reject) => {
      const body = `(() => {
        const tables = document.querySelectorAll("table.ovui-table");
        if (tables.length < 2) return JSON.stringify({error: "no data table"});
        const t = tables[1];
        let sumConsume = 0, sumLeads = 0;
        for (let r = 0; r < t.rows.length; r++) {
          const cells = t.rows[r].cells;
          const time = (cells[0]?.innerText || "").trim();
          if (!time.includes("${today}")) continue;
          const consume = parseFloat((cells[2]?.innerText || "0").replace(/,/g, "")) || 0;
          const leads = parseInt((cells[3]?.innerText || "0").replace(/,/g, "")) || 0;
          sumConsume += consume;
          sumLeads += leads;
        }
        return JSON.stringify({consume: sumConsume.toFixed(2), leads: sumLeads});
      })()`;
      const req = http.request(`${CDP_PROXY}/eval?target=${targetId}`, {
        method: 'POST',
        timeout: 15000,
        headers: { 'Content-Type': 'text/plain' },
      }, res => {
        let data = ''; res.on('data', c => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });

    const parsed = JSON.parse(evalResp.value || '{}');
    videoData = {
      totalConsume: parseFloat(parsed.consume || '0'),
      totalLeads: parseInt(parsed.leads || '0'),
      cpl: '0.00',
    };
    videoData.cpl = videoData.totalLeads > 0
      ? (videoData.totalConsume / videoData.totalLeads).toFixed(2)
      : '0.00';
    log(`  ✅ 短视频全天: 消耗¥${videoData.totalConsume.toFixed(2)} 线索${videoData.totalLeads} CPL¥${videoData.cpl}`);
  } catch (e) {
    log(`  ⚠ 提取短视频数据失败: ${e.message}`);
  } finally {
    // 关闭 tab
    try {
      await new Promise((resolve) => {
        const req = http.get(`${CDP_PROXY}/close?target=${targetId}`, { timeout: 5000 }, () => resolve());
        req.on('error', () => resolve());
        req.on('timeout', () => { req.destroy(); resolve(); });
      });
    } catch {}
  }
  return videoData;
}

// ====== 3. 从飞书表读主播名 ======
function readAnchorNames() {
  log('▶ 读取主播名...');
  const larkCli = findLarkCli();
  if (!larkCli) { log('  ⚠ lark-cli 不可用'); return []; }
  const startRow = getTodayStartRow();
  const endRow = startRow + 7;
  try {
    const isExe = larkCli.endsWith('.exe');
    const out = execFileSync(
      isExe ? larkCli : 'cmd.exe',
      isExe
        ? ['sheets', '+csv-get', '--spreadsheet-token', SPREADSHEET_TOKEN, '--sheet-id', SHEET_ID, '--range', `A${startRow}:C${endRow}`]
        : ['/c', larkCli, 'sheets', '+csv-get', '--spreadsheet-token', SPREADSHEET_TOKEN, '--sheet-id', SHEET_ID, '--range', `A${startRow}:C${endRow}`],
      { encoding: 'utf-8', timeout: 20000, windowsHide: true, cwd: __dirname }
    );
    const parsed = JSON.parse(out);
    const csv = parsed?.data?.annotated_csv || '';
    // 格式: [row=N] 6月27日,07:00-09:00,薇薇
    const names = new Set();
    for (const line of csv.split('\n')) {
      const cols = line.split(',');
      if (cols.length >= 3) {
        const name = cols[2]?.trim();
        if (name) names.add(name);
      }
    }
    const result = [...names];
    log(`  ✅ 主播: ${result.join(' ')}`);
    return result;
  } catch (e) {
    log(`  ⚠ 读取主播名失败: ${e.message}`);
    return [];
  }
}

// ====== 4. 推送飞书群 ======
function pushToLark(text) {
  const larkCli = findLarkCli();
  if (!larkCli) { log('  ⚠ lark-cli 不可用'); return false; }
  const isExe = larkCli.endsWith('.exe');
  try {
    const out = execFileSync(
      isExe ? larkCli : 'cmd.exe',
      isExe
        ? ['im', '+messages-send', '--chat-id', SUMMARY_CHAT_ID, '--text', text, '--as', 'bot']
        : ['/c', larkCli, 'im', '+messages-send', '--chat-id', SUMMARY_CHAT_ID, '--text', text, '--as', 'bot'],
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
  log('🚀 日汇总推送启动');
  log(`  模式: ${OEC_DRY_RUN ? 'DRY_RUN (不推送)' : '全量 (含推送)'}`);

  // 1. 直播全天
  const live = await fetchLiveAllDay();

  // 2. 短视频全天
  const video = await fetchVideoAllDay();

  // 3. 主播名
  const anchors = readAnchorNames();

  // 4. 合并计算
  const totalConsume = live.totalConsume + video.totalConsume;
  const totalLeads = live.totalLeads + video.totalLeads;
  const totalCpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';

  log(`📊 合并汇总:`);
  log(`  直播: ¥${live.totalConsume.toFixed(2)} / ${live.totalLeads}线索 / CPL¥${live.cpl}`);
  log(`  短视频: ¥${video.totalConsume.toFixed(2)} / ${video.totalLeads}线索 / CPL¥${video.cpl}`);
  log(`  总计: ¥${totalConsume.toFixed(2)} / ${totalLeads}线索 / CPL¥${totalCpl}`);

  // 5. 格式化消息
  const msgText = [
    `【极狐区域福利营销中心】 ${todayDateCN()}数据汇总`,
    `07:00-23:00 直播时段数据`,
    `【主播】：${anchors.join(' ')}`,
    `【私信人数】：-`,
    `【线索数】：-`,
    `【投流费用】：${totalConsume.toLocaleString('zh-CN', {minimumFractionDigits: 2})}元（直播${live.totalConsume.toFixed(2)}元/短视频${video.totalConsume.toFixed(2)}元）`,
    `【线索成本（CPL）】：${totalCpl}元（直播CPL${live.cpl}/短视频CPL${video.cpl}）`,
  ].join('\n');

  log(`📝 推送内容:\n${msgText}`);

  if (OEC_DRY_RUN) {
    log('🧪 OEC_DRY_RUN=1，不推送');
    return;
  }

  // 6. 推送
  pushToLark(msgText);
  log('🏁 日汇总完成');
}

main().catch(e => {
  log('FATAL:', e.message, e.stack);
  process.exit(1);
});
