// oceanengine-ai-regions.mjs — AI区域号每日汇总推送
// 21:30 触发：CDP 依次拉5个AI账户全天数据 → 区分直播/短视频 → 合并 → 推飞书群
//
// 环境变量：
//   OEC_SILENT=1   静默模式
//   OEC_FORCE=1    强制执行（测试用）
//   OEC_DRY_RUN=1  只采集不推送
//
// 用法：
//   常驻: pm2 start ecosystem.config.cjs --only pm2-ai-regions
//   测试: OEC_FORCE=1 OEC_DRY_RUN=1 node oceanengine-ai-regions.mjs

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findLarkCli, DATA_DIR, getLocalDate, AI_REGIONS, CDP_PROXY_URL, FEISHU_ANCHOR_CHAT_ID } from './monitor-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === '1';
const CDP_PROXY = CDP_PROXY_URL;
const AI_CHAT_ID = FEISHU_ANCHOR_CHAT_ID;  // 上架群

// 保证 PM2 短命进程日志不丢失（关闭 stdout 缓冲）
process.stdout._handle?.setBlocking?.(true);
function log(...args) {
  console.log(`[ai-regions] ${new Date().toLocaleString()} |`, ...args);
}

function todayDateCN() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ====== HTTP 请求封装 ======
function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST', timeout: timeoutMs,
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
}

// ====== 拉取单个区域数据 ======
async function fetchRegion(region) {
  const { name, aadvid, reportId } = region;
  const today = getLocalDate();
  const url = `https://ad.oceanengine.com/statistics_pages/ad_report/customize/report/detail/${reportId}?aadvid=${aadvid}`;

  log(`▶ [${name}] 拉取... aadvid=${aadvid}`);

  // 打开 tab
  let targetId;
  try {
    const resp = await httpPost(`${CDP_PROXY}/new`, url, 15000);
    targetId = resp.targetId;
    if (!targetId) throw new Error('未获取 targetId');
  } catch (e) {
    log(`  ⚠ [${name}] 打开tab失败: ${e.message}`);
    return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0, error: e.message };
  }

  // 等待页面加载 + 提取数据（最多10次尝试，变长等待）
  const extractScript = `(() => {
    const tables = document.querySelectorAll("table.ovui-table");
    if (tables.length < 2) return JSON.stringify({error: "no data table", count: tables.length});
    const t = tables[1];
    let liveConsume = 0, liveLeads = 0, videoConsume = 0, videoLeads = 0;
    let matchedRows = 0;
    for (let r = 0; r < t.rows.length; r++) {
      const cells = t.rows[r].cells;
      const time = (cells[0]?.innerText || "").trim();
      const scene = (cells[1]?.innerText || "").trim();
      const consume = parseFloat((cells[2]?.innerText || "0").replace(/,/g, "")) || 0;
      const leads = parseInt((cells[3]?.innerText || "0").replace(/,/g, "")) || 0;
      if (!time.includes("${today}")) continue;
      matchedRows++;
      if (scene === "直播") { liveConsume += consume; liveLeads += leads; }
      else if (scene.includes("短视频") || scene.includes("图文")) { videoConsume += consume; videoLeads += leads; }
    }
    return JSON.stringify({
      liveConsume: liveConsume.toFixed(2), liveLeads,
      videoConsume: videoConsume.toFixed(2), videoLeads,
      matchedRows, totalRows: t.rows.length
    });
  })()`;

  // 变长等待策略：前5次 3s, 后5次 5s（共10次，最长45s）
  const MAX_ATTEMPTS = 10;
  let data = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const delay = attempt < 4 ? 3000 : 5000;
    await sleep(delay);
    try {
      const resp = await httpPost(`${CDP_PROXY}/eval?target=${targetId}`, extractScript, 15000);
      const parsed = JSON.parse(resp.value || '{}');
      // ⚠️ 关键修复：不只检查 !error，还要检查 matchedRows > 0
      // 否则 table DOM 存在但数据行未填充时也会认为"成功"
      if (parsed.error) {
        log(`  [${name}] 第${attempt + 1}次: ${parsed.error} (tables=${parsed.count || '?'})`);
        continue;
      }
      if (parsed.matchedRows === 0 || parsed.totalRows === 0) {
        log(`  [${name}] 第${attempt + 1}次: matchedRows=${parsed.matchedRows} totalRows=${parsed.totalRows} — 数据未就绪`);
        continue;
      }
      data = parsed;
      break;
    } catch (e) {
      log(`  [${name}] 第${attempt + 1}次异常: ${e.message}`);
    }
  }

  // 关闭 tab
  try { await httpGet(`${CDP_PROXY}/close?target=${targetId}`, 5000); } catch {}

  if (!data || data.error) {
    log(`  ❌ [${name}] 拉取失败: ${data?.error || `所有${MAX_ATTEMPTS}次尝试无有效数据`}`);
    return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0, error: data?.error || 'no valid data' };
  }

  const result = {
    name,
    liveConsume: parseFloat(data.liveConsume),
    liveLeads: data.liveLeads,
    videoConsume: parseFloat(data.videoConsume),
    videoLeads: data.videoLeads,
  };
  const totalLeads = result.liveLeads + result.videoLeads;
  const totalConsume = result.liveConsume + result.videoConsume;
  const cpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
  log(`  ✅ [${name}] 直播¥${result.liveConsume.toFixed(2)}/${result.liveLeads}线索 + 短视频¥${result.videoConsume.toFixed(2)}/${result.videoLeads}线索 = CPL¥${cpl}`);
  return result;
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
  log('🚀 AI区域号汇总推送启动');
  log(`  模式: ${OEC_DRY_RUN ? 'DRY_RUN (不推送)' : '全量 (含推送)'}`);

  // 1. 探活 CDP proxy
  try {
    await httpGet(`${CDP_PROXY}/targets`, 5000);
  } catch (e) {
    log(`❌ CDP proxy 不可用: ${e.message}`);
    process.exit(1);
  }

  // 2. 依次拉5个区域
  const results = [];
  for (const region of AI_REGIONS) {
    const result = await fetchRegion(region);
    results.push(result);
    await sleep(1000); // 区域间间隔
  }

  // 3. 格式化消息
  const lines = [`${todayDateCN()} AI区域号数据汇总`, ''];

  let grandTotalLeads = 0, grandTotalConsume = 0;

  for (const r of results) {
    const totalLeads = r.liveLeads + r.videoLeads;
    const totalConsume = r.liveConsume + r.videoConsume;
    const totalCpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
    const liveCpl = r.liveLeads > 0 ? (r.liveConsume / r.liveLeads).toFixed(2) : '0.00';
    const videoCpl = r.videoLeads > 0 ? (r.videoConsume / r.videoLeads).toFixed(2) : '0.00';

    grandTotalLeads += totalLeads;
    grandTotalConsume += totalConsume;

    lines.push(`【极狐${r.name}】 ${todayDateCN()}数据汇总`);
    lines.push(`【线索数】：${totalLeads}`);
    lines.push(`【投流费用】：${totalConsume.toFixed(2)}元（直播${r.liveConsume.toFixed(2)}元/短视频${r.videoConsume.toFixed(2)}元）`);
    lines.push(`【线索成本（CPL）】：${totalCpl}元（直播CPL${liveCpl}/短视频CPL${videoCpl}）`);
    lines.push('');
  }

  // 总计
  const grandCpl = grandTotalLeads > 0 ? (grandTotalConsume / grandTotalLeads).toFixed(2) : '0.00';
  lines.push(`【5区总计】 线索${grandTotalLeads} / 消耗¥${grandTotalConsume.toFixed(2)} / 综合CPL¥${grandCpl}`);

  const msgText = lines.join('\n');
  log(`📝 推送内容:\n${msgText}`);

  if (OEC_DRY_RUN) {
    log('🧪 OEC_DRY_RUN=1，不推送');
    return;
  }

  // 4. 推送
  pushToLark(msgText);

  // 5. 保存数据到文件
  try {
    const dataFile = path.join(DATA_DIR, `ai-regions-${getLocalDate()}.json`);
    fs.writeFileSync(dataFile, JSON.stringify({ date: getLocalDate(), results, grandTotalLeads, grandTotalConsume, grandCpl }, null, 2));
    log(`📁 数据已保存: ${dataFile}`);
  } catch (e) {
    log(`  ⚠ 保存数据文件失败: ${e.message}`);
  }

  log('🏁 AI区域号汇总完成');
}

main().catch(e => {
  log('FATAL:', e.message, e.stack);
  process.exit(1);
});
