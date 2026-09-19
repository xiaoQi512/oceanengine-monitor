// webcast-list.mjs - 直播分析页「全部直播列表」采集
// v2 (2026-09-19): API 优先 — statQuery(ad_live_all_list) cookie 直调, 1-2s 出数据, 不再开新 tab;
//    DOM 路径保留为兜底(API 失败时降级)。字段结构与 v1 完全兼容, 小程序端零改动。
// 输出: monitor-data/webcast-list.json { updated_at, rooms: [...] }
// CLI: node src/cdp/webcast-list.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DATA_DIR } from '../utils/monitor-utils.mjs';
import { extractCookiesFromBrowser } from './cookie-provider.mjs';

const CDP_HTTP = 'http://127.0.0.1:9222';
const TARGET_URL = 'https://ad.oceanengine.com/statistics_pages/ad_report/operation-analysis/webcast/report?aadvid='
  + (process.env.OEC_ACCOUNT_ID || '1842681352509635');
const OUT_FILE = path.join(DATA_DIR, 'webcast-list.json');
const ACCOUNT_ID = process.env.OEC_ACCOUNT_ID || '1842681352509635';
// 直播列表按抖音账号(anchor)过滤, 强制必带; 默认 = 福利号抖音号(授权列表中当前在播号)
const LIVE_ANCHOR_ID = process.env.LIVE_ANCHOR_ID || '3976296223736590';
const STAT_QUERY_URL = `https://ad.oceanengine.com/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=${ACCOUNT_ID}`;

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const toNum = s => { const n = parseFloat(String(s ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };

// epoch 秒 → "MM-DD HH:mm"(北京时间), 与 DOM 口径一致
function fmtEpoch(sec) {
  const n = Number(sec);
  if (!n) return '';
  return new Date((n + 8 * 3600) * 1000).toISOString().slice(5, 16).replace('T', ' ');
}

// ---------- v2: statQuery API 直调 ----------
async function fetchLiveRoomsViaApi() {
  const cookieData = await extractCookiesFromBrowser();
  const headers = { ...cookieData.headers, 'Content-Type': 'application/json', Referer: TARGET_URL };
  headers['Cookie'] = headers['Cookie'].replace(/[^\x20-\x7E]/g, '');
  const csrf = headers['Cookie'].match(/passport_csrf_token=([^;]+)/)?.[1];
  if (csrf && !/csrftoken=/.test(headers['Cookie'])) headers['Cookie'] += '; csrftoken=' + csrf;

  const nowBj = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const startBj = new Date(Date.now() + 8 * 3600000 - 7 * 86400000).toISOString().slice(0, 10);
  const body = {
    DataSetKey: 'ad_live_all_list',
    Dimensions: ['live_room_aweme_id', 'live_room_aweme_nick_name', 'live_room_cover_url',
      'live_room_start_time', 'live_room_finish_time', 'room_id', 'live_room_status', 'live_room_title'],
    EndTime: `${nowBj} 23:59:59`,
    Extra: { is_fill_zero: 'true', refer: '' },
    Filters: { ConditionRelationshipType: 1, Conditions: [
      { Field: 'advertiser_id', Operator: 7, Values: [ACCOUNT_ID] },
      { Field: 'anchor_id', Operator: 7, Values: [LIVE_ANCHOR_ID] },
    ] },
    IsDownload: false,
    Metrics: ['cost_promotion_count', 'all_live_watch_cnt_td', 'all_live_single_watch_over_1m_cnt_td',
      'all_live_watch_ucnt_td', 'all_avg_live_watch_duration_seconds_td', 'all_live_follow_cnt_td',
      'all_live_comment_cnt_td', 'std_live_component_click_rate_td', 'std_form_submit_cnt_td'],
    OrderBy: [{ Field: 'all_live_watch_cnt_td', Type: 2 }],
    PageParams: { Limit: 20, Offset: 0 },
    StartTime: `${startBj} 00:00:00`,
  };

  const res = await fetch(STAT_QUERY_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`statQuery HTTP ${res.status}`);
  const j = await res.json();
  if (j.code !== 0) throw new Error(`statQuery code=${j.code}`);
  const rows = j.data?.StatsData?.Rows || [];

  const rooms = rows.map(r => {
    const d = r.Dimensions || {};
    const m = r.Metrics || {};
    const v = k => m[k]?.ValueStr ?? m[k]?.Value ?? '';
    const statusRaw = String(d.live_room_status?.ValueStr || '').trim();
    return {
      status: statusRaw.includes('播') && !statusRaw.includes('关') ? '直播中' : '已结束',
      name: String(d.live_room_title?.ValueStr || '').trim(),
      room_id: String(d.room_id?.ValueStr || d.room_id?.Value || ''),
      units: toNum(v('cost_promotion_count')),
      time_start: fmtEpoch(d.live_room_start_time?.Value),
      time_end: fmtEpoch(d.live_room_finish_time?.Value),
      views: toNum(v('all_live_watch_cnt_td')),
      views_1min: toNum(v('all_live_single_watch_over_1m_cnt_td')),
      watchers: toNum(v('all_live_watch_ucnt_td')),
      avg_stay_sec: toNum(v('all_avg_live_watch_duration_seconds_td')),
      follows: toNum(v('all_live_follow_cnt_td')),
      comments: toNum(v('all_live_comment_cnt_td')),
      ctr: String(v('std_live_component_click_rate_td')).replace('%', ''),
      forms: toNum(v('std_form_submit_cnt_td')),
    };
  }).filter(r => r.name);

  // 与 DOM 口径一致: 按开播时间倒序
  rooms.sort((a, b) => (b.time_start || '').localeCompare(a.time_start || ''));
  if (!rooms.length) throw new Error('API 返回 0 场次');
  return rooms;
}

// ---------- v1: DOM 采集(兜底) ----------
// 解析行: ["已结束极狐阿尔法T7...ID：768...已投单元数17个","详情","09-13 06:2909-13 23:30","极狐｜...","46973",...]
function parseRow(cells, ths) {
  const roomCell = cells[0] || '';
  const status = roomCell.startsWith('直播中') ? '直播中' : roomCell.startsWith('已结束') ? '已结束' : '';
  let name = roomCell.replace(/^(直播中|已结束)/, '');
  const idM = name.match(/ID：(\d+)/);
  const unitM = name.match(/已投单元数(\d+)个/);
  name = name.split(/ID：/)[0].replace(/[！!]+$/, '').trim();
  const timeM = (cells[2] || '').match(/(\d{2}-\d{2} \d{2}:\d{2})(\d{2}-\d{2} \d{2}:\d{2})?/);
  return {
    status,
    name,
    room_id: idM ? idM[1] : '',
    units: unitM ? Number(unitM[1]) : 0,
    time_start: timeM ? timeM[1] : '',
    time_end: timeM && timeM[2] ? timeM[2] : '',
    views: toNum(cells[4]),
    views_1min: toNum(cells[5]),
    watchers: toNum(cells[6]),
    avg_stay_sec: toNum(cells[7]),
    follows: toNum(cells[8]),
    comments: toNum(cells[9]),
    ctr: (cells[10] || '').replace('%', ''),
    forms: toNum(cells[11])
  };
}

async function collectLiveRoomsViaDom({ maxWaitMs = 45000 } = {}) {
  const { createCDPClient } = await import('./client.mjs');
  const ver = await httpGetJson(`${CDP_HTTP}/json/version`);
  const browser = await createCDPClient(ver.webSocketDebuggerUrl, { cmdTimeout: 15000 });
  const created = await browser.call('Target.createTarget', { url: 'about:blank' });
  const targetId = created?.targetId;
  if (!targetId) throw new Error('createTarget 失败');
  try {
    await sleep(1200);
    const list = await httpGetJson(`${CDP_HTTP}/json/list`);
    const page = list.find(t => t.id === targetId);
    if (!page) throw new Error('未找到新 tab');
    const pageClient = await createCDPClient(page.webSocketDebuggerUrl, { cmdTimeout: 30000 });
    await pageClient.call('Page.navigate', { url: TARGET_URL });

    // 轮询: 表头就绪 + 数字填充(第5列非'--')
    let rows = null, ths = null;
    const t0 = Date.now();
    while (Date.now() - t0 < maxWaitMs) {
      await sleep(2000);
      const probe = await pageClient.call('Runtime.evaluate', {
        expression: `(() => {
          const ths = [...document.querySelectorAll('th')].map(t => t.textContent.trim());
          const tr = document.querySelector('tbody tr');
          const tds = tr ? [...tr.children] : [];
          const filled = tds.length > 4 && tds[4].textContent.trim() !== '--' && tds[4].textContent.trim() !== '';
          return JSON.stringify({ ths, filled, rowCount: document.querySelectorAll('tbody tr').length });
        })()`,
        returnByValue: true
      });
      const info = JSON.parse(probe?.result?.value || '{}');
      if (info.ths?.length >= 10 && info.filled) {
        const dump = await pageClient.call('Runtime.evaluate', {
          expression: `(() => {
            const ths = [...document.querySelectorAll('th')].map(t => t.textContent.trim());
            const rows = [...document.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
            return JSON.stringify({ ths, rows });
          })()`,
          returnByValue: true
        });
        const parsed = JSON.parse(dump?.result?.value || '{}');
        ths = parsed.ths; rows = parsed.rows;
        break;
      }
    }
    if (!rows || !rows.length) throw new Error('表格未就绪(超时)');

    const rooms = rows
      .filter(c => Array.isArray(c) && c.length >= 12 && c[0])
      .map(c => parseRow(c, ths))
      .filter(r => r.name);
    // 按开播时间倒序
    rooms.sort((a, b) => (b.time_start || '').localeCompare(a.time_start || ''));
    return rooms;
  } finally {
    try { await browser.call('Target.closeTarget', { targetId }); } catch {}
  }
}

// ---------- 入口: API 优先, DOM 兜底 ----------
export async function collectWebcastList({ maxWaitMs = 45000 } = {}) {
  try {
    const rooms = await fetchLiveRoomsViaApi();
    console.log(`[webcast] API 直调成功: ${rooms.length} 场次`);
    return rooms;
  } catch (e) {
    console.warn(`[webcast] API 直调失败(${e.message?.slice(0, 60)}), 降级 DOM 采集...`);
    return collectLiveRoomsViaDom({ maxWaitMs });
  }
}

export function readWebcastCache() {
  try {
    const d = JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8'));
    return d.rooms || [];
  } catch { return []; }
}

export function writeWebcastCache(rooms) {
  const tmp = OUT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ updated_at: new Date().toISOString(), rooms }, null, 2), 'utf-8');
  fs.renameSync(tmp, OUT_FILE);
}

// CLI 直跑
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  collectWebcastList().then(rooms => {
    writeWebcastCache(rooms);
    console.log(`[webcast] ✅ 采集 ${rooms.length} 场次 → ${OUT_FILE}`);
    console.log(rooms.slice(0, 3).map(r => `${r.time_start} [${r.status}] ${r.name.slice(0, 20)} 观看${r.views} 停留${r.avg_stay_sec}s`).join('\n'));
  }).catch(e => { console.error('[webcast] ❌', e.message); process.exit(1); });
}
