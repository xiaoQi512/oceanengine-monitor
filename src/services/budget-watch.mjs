// src/services/budget-watch.mjs v2 — AI 大区预算使用率监控 (常驻状态机)
// 流程: 每30min拉5区当日消耗(statQuery) + CDP轮转读各区实时预算(页头) → 使用率≥75%入高频集
//       高频集每5min: statQuery消耗越过80% → 拉近2h CPL → CPL<110 → 飞书监控群提醒(含手动加预算500指引)
//       每场直播可多次触发(冷却30min); 跨日重置
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import http from 'node:http';
import { DATA_DIR } from '../utils/monitor-utils.mjs';
import { getCookieData } from './ai-regions-api.mjs';
import { pushToLark } from './ai-regions-push.mjs';

const REGIONS = [
  ['东区AI直播', '1842681994872135'],
  ['西区AI直播', '1842681830951944'],
  ['南区AI直播', '1842682454270468'],
  ['北区AI直播', '1842683071403332'],
  ['中区AI直播', '1842663909080452'],
];
const FALLBACK_BUDGET = 60000;
const ENTER_RATIO = 0.75;   // 进入高频集
const ALERT_RATIO = 0.8;    // 触发报警
const CPL_GATE = 110;       // 线索成本低于 110 才报
const COOLDOWN_MS = 30 * 60000; // 同账户两次触发冷却 30min
const MONITOR_CHAT = (fs.readFileSync(path.join(DATA_DIR, '..', '.env'), 'utf8').match(/LARK_MONITOR_CHAT_ID=(.+)/) || [])[1]?.trim() || '';
const STATE_FILE = path.join(DATA_DIR, 'budget-watch-state.json');
const CDP = 'http://127.0.0.1:9222';
const log = (m) => console.log(`[budget-watch ${new Date().toLocaleTimeString('zh-CN')}] ${m}`);
const num = (s) => { const n = parseFloat(String(s ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };

const state = { date: '', budgets: {}, spend: {}, highFreq: {}, lastAlert: {}, usage: {}, _lastCdpIdx: -1 };
const todayCst = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
// 启动时恢复持久化状态 (冷却/预算缓存跨重启有效)
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (saved.date === todayCst()) {
    state.date = saved.date;
    state.budgets = saved.budgets || {};
    state.lastAlert = saved.lastAlert || {};
    for (const n of saved.highFreq || []) state.highFreq[n] = true;
    log(`已恢复当日状态: 高频[${Object.keys(state.highFreq).join(',')}] lastAlert=${Object.keys(state.lastAlert).length}`);
  }
} catch {}
function rollDate() {
  const t = todayCst();
  if (state.date !== t) {
    Object.assign(state, { date: t, budgets: {}, spend: {}, highFreq: {}, lastAlert: {}, usage: {} });
    log(`跨日重置 ${t}`);
  }
}

// ===== statQuery =====
let _headers = null;
async function apiHeaders() {
  if (_headers) return _headers;
  const cd = await getCookieData();
  const h = { ...cd.headers, 'Content-Type': 'application/json', Referer: 'https://ad.oceanengine.com/' };
  h['Cookie'] = h['Cookie'].replace(/[^\x20-\x7E]/g, '');
  const csrf = h['Cookie'].match(/passport_csrf_token=([^;]+)/)?.[1];
  if (csrf && !/csrftoken=/.test(h['Cookie'])) h['Cookie'] += '; csrftoken=' + csrf;
  _headers = h;
  return h;
}
async function statDay(acc) {
  const h = await apiHeaders();
  const body = {
    DataSetKey: 'basic_ad_data', Dimensions: ['stat_time_day'],
    EndTime: `${todayCst()} 23:59:59`,
    Filters: { ConditionRelationshipType: 1, Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [acc] }] },
    IsDownload: false, Metrics: ['stat_cost', 'convert_cnt'], PageParams: { Limit: 5, Offset: 0 },
    StartTime: `${todayCst()} 00:00:00`, Extra: { is_fill_zero: 'true', refer: '' },
  };
  const res = await fetch('https://ad.oceanengine.com/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=' + acc, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const jj = await res.json().catch(() => null);
  const rows = jj?.data?.StatsData?.Rows || [];
  return rows.reduce((a, r) => ({ cost: a.cost + num(r.Metrics?.stat_cost?.Value ?? r.Metrics?.stat_cost?.ValueStr), leads: a.leads + num(r.Metrics?.convert_cnt?.Value ?? r.Metrics?.convert_cnt?.ValueStr) }), { cost: 0, leads: 0 });
}
async function statLast2h(acc) {
  const h = await apiHeaders();
  const nowCst = new Date(Date.now() + 8 * 3600000);
  const body = {
    DataSetKey: 'basic_ad_data', Dimensions: ['stat_time_hour'],
    EndTime: nowCst.toISOString().slice(0, 19).replace('T', ' '),
    Filters: { ConditionRelationshipType: 1, Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [acc] }] },
    IsDownload: false, Metrics: ['stat_cost', 'convert_cnt'], PageParams: { Limit: 10, Offset: 0 },
    StartTime: new Date(nowCst - 2 * 3600000).toISOString().slice(0, 19).replace('T', ' '),
    Extra: { is_fill_zero: 'true', refer: '' },
  };
  const res = await fetch('https://ad.oceanengine.com/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=' + acc, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const jj = await res.json().catch(() => null);
  const rows = jj?.data?.StatsData?.Rows || [];
  return rows.reduce((a, r) => ({ cost: a.cost + num(r.Metrics?.stat_cost?.Value ?? r.Metrics?.stat_cost?.ValueStr), leads: a.leads + num(r.Metrics?.convert_cnt?.Value ?? r.Metrics?.convert_cnt?.ValueStr) }), { cost: 0, leads: 0 });
}

// ===== CDP 读页头预算+消耗 =====
function httpGet(url) {
  return new Promise((res, rej) => { http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej); });
}
async function cdpReadHeader(aadvid) {
  const tabs = await httpGet(CDP + '/json');
  const tab = tabs.find(t => t.type === 'page' && /oceanengine/.test(t.url));
  if (!tab) throw new Error('NO_TAB');
  const sock = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { sock.on('open', r); sock.on('error', j); });
  let id = 0;
  const pending = new Map();
  sock.on('message', m => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const call = (method, params = {}) => new Promise(resolve => { const i = ++id; pending.set(i, resolve); sock.send(JSON.stringify({ id: i, method, params })); });
  try {
    await call('Page.enable', {});
    await call('Page.navigate', { url: `https://ad.oceanengine.com/promotion/promote-manage?aadvid=${aadvid}` });
    await new Promise(r => setTimeout(r, 11000));
    const r = await call('Runtime.evaluate', { expression: `(() => { const t = document.body.innerText || ''; const b = t.match(/日预算[^\\d]{0,20}([\\d,\\.]+)/); const s = t.match(/日消耗[^\\d]{0,20}([\\d,\\.]+)/); return JSON.stringify({ budget: b ? Number(RegExp.$1.replace(/,/g, '')) : 0, spend: s ? Number(RegExp.$1.replace(/,/g, '')) : 0 }); })()`, returnByValue: true });
    return JSON.parse(r.result?.result?.value || '{}');
  } finally { try { sock.close(); } catch {} }
}
async function rotateBudgetRead() {
  const idx = ((state._lastCdpIdx ?? -1) + 1) % REGIONS.length;
  state._lastCdpIdx = idx;
  const [name, acc] = REGIONS[idx];
  try {
    const h = await cdpReadHeader(acc);
    if (h.budget > 0) { state.budgets[name] = h.budget; log(`CDP 读 ${name} 预算=${h.budget} 页面消耗=${h.spend}`); }
    else log(`CDP 读 ${name} 无预算值`);
  } catch (e) { log(`CDP 读 ${name} 失败: ${String(e).slice(0, 60)}`); }
}

// ===== 主循环 =====
let lastSlow = 0, lastFast = 0;
async function slowTick() {
  rollDate();
  const hour = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 13));
  if (hour < 7 || hour >= 23) return;
  await rotateBudgetRead();
  for (const [name, acc] of REGIONS) {
    try {
      const day = await statDay(acc);
      state.spend[name] = day.cost;
      const budget = state.budgets[name] || FALLBACK_BUDGET;
      const ratio = budget > 0 ? day.cost / budget : 0;
      state.usage[name] = ratio;
      if (ratio >= ENTER_RATIO && !state.highFreq[name]) {
        state.highFreq[name] = true;
        log(`${name} 使用率 ${(ratio * 100).toFixed(1)}% 进入高频跟踪`);
      } else if (ratio < 0.6 && state.highFreq[name]) {
        delete state.highFreq[name];
        log(`${name} 使用率回落 ${(ratio * 100).toFixed(1)}%, 退出高频`);
      }
    } catch (e) { log(`${name} statDay 失败: ${String(e).slice(0, 50)}`); }
    await new Promise(r => setTimeout(r, 800));
  }
}
const acc0 = (name) => (REGIONS.find(r => r[0] === name) || [])[1];
async function fastTick() {
  rollDate();
  const hour = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 13));
  if (hour < 7 || hour >= 23) return;
  for (const [name] of REGIONS) {
    if (!state.highFreq[name]) continue;
    const budget = state.budgets[name] || FALLBACK_BUDGET;
    const last = state.lastAlert[name] ? Date.parse(state.lastAlert[name]) : 0;
    if (Date.now() - last < COOLDOWN_MS) continue;
    const acc = acc0(name);
    try {
      const day = await statDay(acc);
      const ratio = budget > 0 ? day.cost / budget : 0;
      state.spend[name] = day.cost; state.usage[name] = ratio;
      if (ratio < ALERT_RATIO) continue;
      const h2 = await statLast2h(acc);
      const cpl = h2.leads > 0 ? Math.round(h2.cost / h2.leads) : 0;
      if (cpl > 0 && cpl >= CPL_GATE) { log(`${name} CPL ${cpl} ≥ ${CPL_GATE}, 不报`); continue; }
      // 开播时长: 今日首个消耗>100 的小时桶 = 场次近似开始
      const nowCst = new Date(Date.now() + 8 * 3600000);
      const hb = {
        DataSetKey: 'basic_ad_data', Dimensions: ['stat_time_hour'],
        EndTime: nowCst.toISOString().slice(0, 19).replace('T', ' '),
        Filters: { ConditionRelationshipType: 1, Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [acc] }] },
        IsDownload: false, Metrics: ['stat_cost'], PageParams: { Limit: 24, Offset: 0 },
        StartTime: `${todayCst()} 00:00:00`, Extra: { is_fill_zero: 'true', refer: '' },
      };
      const resH = await fetch('https://ad.oceanengine.com/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=' + acc, { method: 'POST', headers: await apiHeaders(), body: JSON.stringify(hb) });
      const jjH = await resH.json().catch(() => null);
      let sessionStart = null;
      for (const r of (jjH?.data?.StatsData?.Rows || [])) {
        if (num(r.Metrics?.stat_cost?.Value ?? r.Metrics?.stat_cost?.ValueStr) > 100) {
          sessionStart = String(r.Dimensions?.stat_time_hour?.ValueStr || '');
          break;
        }
      }
      let sessionMin = null;
      if (sessionStart) {
        sessionMin = Math.round((nowCst - new Date(sessionStart.replace(' ', 'T') + '+08:00')) / 60000);
      }
      const over90 = sessionMin != null && sessionMin > 90;
      const budgetAdvice = over90
        ? `⏱ 本场已开播约 ${Math.round(sessionMin / 6) / 10} 小时（超 1.5h），达到日预算上限属正常收量，不建议再加预算`
        : `✅ 量效达标（CPL<${CPL_GATE}），建议立即为该账户增加预算 500 元（投放管理页页头预算编辑）`;
      const msg = [
        `⚠️【预算预警】${name} 预算使用率 ${(ratio * 100).toFixed(1)}%（预算 ${budget.toLocaleString()}）`,
        `今日已消耗 ${Math.round(day.cost).toLocaleString()}，线索 ${Math.round(day.leads)} 条`,
        `— 近 2 小时 —`,
        `消耗 ${Math.round(h2.cost).toLocaleString()} 元，线索 ${Math.round(h2.leads)} 条，线索成本 ${cpl > 0 ? cpl + ' 元/条' : '暂无线索'}`,
        budgetAdvice,
      ].join('\n');
      const ok = await pushToLark(msg, { chatId: MONITOR_CHAT });
      if (ok) { state.lastAlert[name] = new Date().toISOString(); log(`${name} 已报警 (使用率${(ratio * 100).toFixed(1)}% CPL${cpl})`); }
    } catch (e) { log(`${name} fastTick 失败: ${String(e).slice(0, 50)}`); }
    await new Promise(r => setTimeout(r, 800));
  }
}

setInterval(() => { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ date: state.date, budgets: state.budgets, highFreq: Object.keys(state.highFreq), lastAlert: state.lastAlert }, null, 1)); } catch {} }, 300000);

async function loop() {
  const now = Date.now();
  if (now - lastSlow >= 30 * 60000) { lastSlow = now; await slowTick().catch(e => log('slowTick err ' + String(e).slice(0, 60))); }
  if (now - lastFast >= 5 * 60000) { lastFast = now; await fastTick().catch(e => log('fastTick err ' + String(e).slice(0, 60))); }
}
log('budget-watch v2 启动 (常驻; 慢循环30min/快循环5min)');
await slowTick().catch(e => log('first slow err ' + String(e).slice(0, 60)));
lastSlow = Date.now();
setInterval(() => loop().catch(e => log('loop err ' + String(e).slice(0, 60))), 30000);
