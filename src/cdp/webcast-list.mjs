// webcast-list.mjs - 直播分析页「全部直播列表」采集 (CDP 独立tab, 不干扰投放管理监控页)
// 输出: monitor-data/webcast-list.json { updated_at, rooms: [...] }
// CLI: node src/cdp/webcast-list.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DATA_DIR } from '../utils/monitor-utils.mjs';
import { createCDPClient } from './client.mjs';

const CDP_HTTP = 'http://127.0.0.1:9222';
const TARGET_URL = 'https://ad.oceanengine.com/statistics_pages/ad_report/operation-analysis/webcast/report?aadvid='
  + (process.env.OEC_ACCOUNT_ID || '1842681352509635');
const OUT_FILE = path.join(DATA_DIR, 'webcast-list.json');

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

export async function collectWebcastList({ maxWaitMs = 45000 } = {}) {
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
    console.log(rooms.slice(0, 3).map(r => `${r.time_start} ${r.anchor || ''} ${r.name.slice(0, 20)} 观看${r.views} 停留${r.avg_stay_sec}s`).join('\n'));
  }).catch(e => { console.error('[webcast] ❌', e.message); process.exit(1); });
}
