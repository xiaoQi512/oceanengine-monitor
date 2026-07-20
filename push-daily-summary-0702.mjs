// push-daily-summary-0702.mjs — 7/2 主号日汇总补推 (HTTP API, 无CDP)
import { createClient } from './oceanengine-api-client.mjs';
import { findLarkCli } from './monitor-utils.mjs';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE_ACCOUNT_ID = '1842681352509635';
const VIDEO_ACCOUNT_ID = '1852666142648332';
const SUMMARY_CHAT_ID = 'oc_b245ee4b255c7b25b7f8d953802c49ff';
const TARGET_DATE = '2026-07-02';
const TARGET_DATE_CN = '7月2日';

function log(...args) { console.log(`[summary-0702] ${new Date().toLocaleString()} |`, ...args); }

function httpPost(url, body, cookieData, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST', timeout: timeoutMs,
      headers: { ...cookieData.headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
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
    req.write(bodyStr); req.end();
  });
}

const parseNum = v => parseFloat(String(v || 0).replace(/,/g, '')) || 0;

async function fetchAccountStats(client, accountId, label) {
  const body = {
    DataSetKey: 'basic_ad_data',
    Dimensions: ['stat_time_day', 'cdp_marketing_goal'],
    EndTime: `${TARGET_DATE} 23:59:59`,
    StartTime: `${TARGET_DATE} 00:00:00`,
    Filters: { ConditionRelationshipType: 1, Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [accountId] }] },
    IsDownload: false,
    Metrics: ['stat_cost', 'convert_cnt', 'conversion_cost', 'clue_message_count', 'message_action', 'form'],
    OrderBy: [{ Field: 'stat_time_day', Type: 2 }],
    PageParams: { Limit: 50, Offset: 0 },
  };
  const resp = await httpPost(`https://ad.oceanengine.com/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=${accountId}`, body, client.cookieData);
  const rows = resp?.data?.StatsData?.Rows || resp?.StatsData?.Rows || [];
  let live = { consume: 0, leads: 0, forms: 0 };
  let video = { consume: 0, leads: 0, forms: 0 };
  for (const row of rows) {
    const goal = row.Dimensions?.cdp_marketing_goal?.ValueStr || '';
    const m = row.Metrics || {};
    const consume = parseNum(m.stat_cost?.ValueStr);
    const leads = parseNum(m.clue_message_count?.ValueStr);
    const forms = parseNum(m.form?.ValueStr);
    if (goal.includes('直播')) {
      live.consume += consume; live.leads += leads; live.forms += forms;
    } else if (goal.includes('短视频') || goal.includes('图文')) {
      video.consume += consume; video.leads += leads; video.forms += forms;
    }
  }
  log(`  [${label}] 直播: ¥${live.consume.toFixed(2)}/${live.leads} | 短视频: ¥${video.consume.toFixed(2)}/${video.leads}`);
  return { live, video };
}

async function main() {
  log('═══════════════════════════════════════');
  log(`  主号日汇总补推 - ${TARGET_DATE_CN}`);
  log('═══════════════════════════════════════');

  const client = await createClient({ useCache: true });

  // 直播账户 (主号直播投放)
  log('▶ 主号直播账户...');
  const liveAcct = await fetchAccountStats(client, LIVE_ACCOUNT_ID, '主号');

  // 短视频账户
  log('▶ 主号短视频账户...');
  const videoAcct = await fetchAccountStats(client, VIDEO_ACCOUNT_ID, '短视频');

  const liveConsume = liveAcct.live.consume;
  const liveLeads = liveAcct.live.leads;
  const videoConsume = videoAcct.video.consume;
  const videoLeads = videoAcct.video.leads;

  const liveCpl = liveLeads > 0 ? (liveConsume / liveLeads).toFixed(2) : '0.00';
  const videoCpl = videoLeads > 0 ? (videoConsume / videoLeads).toFixed(2) : '0.00';

  const totalConsume = liveConsume + videoConsume;
  const totalLeads = liveLeads + videoLeads;
  const totalCpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';

  log(`📊 合并: 直播¥${liveConsume.toFixed(2)}/${liveLeads} + 短视频¥${videoConsume.toFixed(2)}/${videoLeads} = ¥${totalConsume.toFixed(2)}/${totalLeads} CPL¥${totalCpl}`);

  const anchors = ['张萌', '芝芝', '三水', '小雪'];

  const msgText = [
    `【极狐区域福利营销中心】 ${TARGET_DATE_CN}数据汇总`,
    `07:00-23:00 直播时段数据`,
    `【主播】：${anchors.join(' ')}`,
    `【私信人数】：-`,
    `【线索数】：${totalLeads}`,
    `【投流费用】：${totalConsume.toLocaleString('zh-CN', {minimumFractionDigits: 2})}元（直播${liveConsume.toFixed(2)}元/短视频${videoConsume.toFixed(2)}元）`,
    `【线索成本（CPL）】：${totalCpl}元（直播CPL${liveCpl}/短视频CPL${videoCpl}）`,
  ].join('\n');

  log(`📝 推送内容:\n${msgText}`);

  const larkCli = findLarkCli();
  if (!larkCli) { log('❌ lark-cli 不可用'); return; }
  const isExe = larkCli.endsWith('.exe');
  try {
    const out = execFileSync(
      isExe ? larkCli : 'cmd.exe',
      isExe
        ? ['im', '+messages-send', '--chat-id', SUMMARY_CHAT_ID, '--text', msgText, '--as', 'bot']
        : ['/c', larkCli, 'im', '+messages-send', '--chat-id', SUMMARY_CHAT_ID, '--text', msgText, '--as', 'bot'],
      { encoding: 'utf-8', timeout: 20000, windowsHide: true, cwd: __dirname }
    );
    const parsed = JSON.parse(out);
    if (parsed.ok) log(`✅ 已推送: ${parsed.data?.message_id || 'ok'}`);
    else log(`❌ 推送失败: ${parsed.error?.message || JSON.stringify(parsed)}`);
  } catch (e) {
    log(`❌ 推送异常: ${e.message}`);
  }
}

main().catch(e => { log('FATAL:', e.message); console.error(e.stack); process.exit(1); });
