// src/services/budget-watch.mjs v3 — AI 大区预算监控 (按场切割口径)
// 场次: shift_schedule 时段; 当场预算 = 账户日预算 − 历史场次直播总消耗(当日, 本场开始前)
// 当场直播已耗 / 当场预算 ≥ 80% → 飞书预警; 当场线索成本 < 110 → 自动加预算 500 (CDP, 每场上限 2 次/1000)
// 慢循环 30min: CDP 轮转读日预算; 快循环 5min: 在播场次核算
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import http from 'node:http';
import { DATA_DIR } from '../utils/monitor-utils.mjs';
import { getCookieData } from './ai-regions-api.mjs';
import { pushToLark } from './ai-regions-push.mjs';

const REGIONS = [
  ['东区AI直播', '1842681994872135', '东区营销中心'],
  ['西区AI直播', '1842681830951944', '西区营销中心'],
  ['南区AI直播', '1842682454270468', '南区营销中心'],
  ['北区AI直播', '1842683071403332', '北区营销中心'],
  ['中区AI直播', '1842663909080452', '中区营销中心'],
];
const ENTER_RATIO = 0.8;      // 当场预算使用率预警线
const CPL_GATE = 110;         // 线索成本低于 110 才加预算
const MAX_ADDS = 2;           // 单场最多加预算次数 (2×500=1000)
const MONITOR_CHAT = (fs.readFileSync(path.join(DATA_DIR, '..', '.env'), 'utf8').match(/LARK_MONITOR_CHAT_ID=(.+)/) || [])[1]?.trim() || '';
const STATE_FILE = path.join(DATA_DIR, 'budget-watch-state.json');
const CDP = 'http://127.0.0.1:9222';
const log = (m) => console.log(`[budget-watch ${new Date().toLocaleTimeString('zh-CN')}] ${m}`);
const num = (s) => { const n = parseFloat(String(s ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };

const state = { date: '', budgets: {}, sessions: {}, _lastCdpIdx: -1 };
const todayCst = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (saved.date === todayCst()) {
    state.date = saved.date; state.budgets = saved.budgets || {}; state.sessions = saved.sessions || {}; state._lastCdpIdx = saved._lastCdpIdx ?? -1;
    log(`已恢复状态: ${Object.keys(state.sessions).length} 个场次记录`);
  }
} catch {}
function persist() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1)); } catch {} }
function rollDate() {
  const t = todayCst();
  if (state.date !== t) { Object.assign(state, { date: t, budgets: {}, sessions: {} }); log(`跨日重置 ${t}`); persist(); }
}

// ===== 在播场次 (shift_schedule) =====
const db = new Database(path.join(DATA_DIR, 'oceanengine.db'), { readonly: true });
function currentSession(acc, regionName) {
  const now = new Date(Date.now() + 8 * 3600000);
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const rows = db.prepare('SELECT session_no, start_min, end_min, car_model FROM shift_schedule WHERE cst_date=? AND account_id=? ORDER BY session_no').all(todayCst(), acc);
  for (const r of rows) {
    if (mins >= r.start_min && mins < r.end_min) {
      return { sessionNo: r.session_no, startMin: r.start_min, endMin: r.end_min, carModel: r.car_model, startHour: Math.floor(r.start_min / 60) };
    }
  }
  return null;
}

// ===== statQuery: 当日直播 小时桶 (cost + clue_message_count) =====
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
async function statHourlyLive(acc) {
  const h = await apiHeaders();
  const body = {
    DataSetKey: 'basic_ad_data', Dimensions: ['stat_time_hour', 'cdp_marketing_goal'],
    EndTime: `${todayCst()} 23:59:59`,
    Filters: { ConditionRelationshipType: 1, Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [acc] }] },
    IsDownload: false, Metrics: ['stat_cost', 'clue_message_count'], PageParams: { Limit: 60, Offset: 0 },
    StartTime: `${todayCst()} 00:00:00`, Extra: { is_fill_zero: 'true', refer: '' },
  };
  const res = await fetch('https://ad.oceanengine.com/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=' + acc, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const jj = await res.json().catch(() => null);
  const hourly = {}; // hour → {cost, leads}
  let dayLiveCost = 0, dayLiveLeads = 0;
  for (const r of (jj?.data?.StatsData?.Rows || [])) {
    const goal = String(r.Dimensions?.cdp_marketing_goal?.ValueStr || '');
    if (!goal.includes('直播')) continue;
    const hh = Number(String(r.Dimensions?.stat_time_hour?.ValueStr || '').slice(11, 13));
    if (isNaN(hh)) continue;
    const c = num(r.Metrics?.stat_cost?.Value ?? r.Metrics?.stat_cost?.ValueStr);
    const l = num(r.Metrics?.clue_message_count?.Value ?? r.Metrics?.clue_message_count?.ValueStr);
    hourly[hh] = hourly[hh] || { cost: 0, leads: 0 };
    hourly[hh].cost += c; hourly[hh].leads += l;
    dayLiveCost += c; dayLiveLeads += l;
  }
  return { hourly, dayLiveCost, dayLiveLeads };
}

// ===== CDP 轮转读日预算 + 自动加预算 =====
function httpGet(url) {
  return new Promise((res, rej) => { http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej); });
}
let _adjusting = false;
async function cdpWithPage(aadvid, fn) {
  const tabs = await httpGet(CDP + '/json');
  const tab = tabs.find(t => t.type === 'page' && /oceanengine/.test(t.url));
  if (!tab) throw new Error('NO_TAB');
  const sock = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { sock.on('open', r); sock.on('error', j); });
  let id = 0;
  const pending = new Map();
  sock.on('message', m => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const call = (method, params = {}) => new Promise(resolve => { const i = ++id; pending.set(i, resolve); sock.send(JSON.stringify({ id: i, method, params })); });
  const evl = async (expression) => (await call('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
  try {
    await call('Page.enable', {});
    await call('Page.navigate', { url: `https://ad.oceanengine.com/promotion/promote-manage?aadvid=${aadvid}` });
    await new Promise(r => setTimeout(r, 12000));
    return await fn(evl, call);
  } finally { try { sock.close(); } catch {} }
}
async function rotateBudgetRead() {
  const idx = ((state._lastCdpIdx ?? -1) + 1) % REGIONS.length;
  state._lastCdpIdx = idx;
  const [name, acc] = REGIONS[idx];
  if (_adjusting) return;
  try {
    const h = await cdpWithPage(acc, async (evl) => {
      await evl(`(() => { const els = [...document.querySelectorAll('button,span,div')].filter(e => e.offsetParent !== null && (e.textContent || '').trim() === '取消'); const e = els[els.length - 1]; if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1; })()`);
      await new Promise(r => setTimeout(r, 1000));
      const t = await evl(`(() => { const b = (document.body.innerText || '').match(/日预算[^\\d]{0,20}([\\d,\\.]+)/); return b ? Number(RegExp.$1.replace(/,/g, '')) : 0; })()`);
      return b;
    });
    if (h > 0) { state.budgets[name] = h; log(`CDP 读 ${name} 日预算=${h}`); }
  } catch (e) { log(`CDP 读 ${name} 失败: ${String(e).slice(0, 60)}`); }
}
async function adjustAccountBudget(aadvid, add) {
  if (_adjusting) return { ok: false, err: '调整中(互斥)' };
  _adjusting = true;
  try {
    return await cdpWithPage(aadvid, async (evl) => {
      await evl(`(() => { const els = [...document.querySelectorAll('button,span,div')].filter(e => e.offsetParent !== null && (e.textContent || '').trim() === '取消'); const e = els[els.length - 1]; if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1; })()`);
      await new Promise(r => setTimeout(r, 1200));
      const rb = await evl(`(() => { const b = (document.body.innerText || '').match(/日预算[^\\d]{0,20}([\\d,\\.]+)/); return b ? RegExp.$1 : null; })()`);
      const cur = num(rb);
      if (!cur) return { ok: false, err: '页面无预算值' };
      const newBudget = cur + add;
      await evl(`(() => { const vis = (e) => e && e.offsetParent !== null; const kv = [...document.querySelectorAll('[class*="tool-bar-key-value"]')].filter(vis).find(e => /日预算/.test(e.textContent || '')); if (kv) { const r = kv.getBoundingClientRect(); kv.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); kv.parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); } return 1; })()`);
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 250, y: 184 });
      await new Promise(r => setTimeout(r, 1000));
      const rc = await evl(`(() => { const vis = (e) => e && e.offsetParent !== null; const wrap = [...document.querySelectorAll('.account-wallet-edit-icon-wrapper')].filter(vis)[0]; if (!wrap) return 'NO_WRAP'; wrap.dispatchEvent(new MouseEvent('click', { bubbles: true })); const icon = wrap.querySelector('iconpark-icon'); if (icon) icon.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 'CLICKED'; })()`);
      await new Promise(r => setTimeout(r, 2500));
      const rSet = await evl(`(() => {
        const vis = (e) => e && e.offsetParent !== null;
        const inp = [...document.querySelectorAll('input')].filter(vis).find(e => e.type === 'number' || /^[\\d,\\.]+$/.test(String(e.value)) || /预算/.test(e.placeholder || ''));
        if (!inp) return 'NO_INPUT';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, '${newBudget}');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return 'SET:' + inp.value;
      })()`);
      if (!String(rSet).startsWith('SET')) return { ok: false, err: '填值失败 ' + rSet };
      await new Promise(r => setTimeout(r, 800));
      await evl(`(() => { const els = [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null && /^(确定|保存)$/.test((e.textContent || '').trim())); const e = els[els.length - 1]; if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1; })()`);
      await new Promise(r => setTimeout(r, 3500));
      const rb2 = await evl(`(() => { const b = (document.body.innerText || '').match(/日预算[^\\d]{0,20}([\\d,\\.]+)/); return b ? Number(RegExp.$1.replace(/,/g, '')) : 0; })()`);
      if (rb2 === newBudget) return { ok: true, oldBudget: cur, newBudget: rb2 };
      return { ok: false, err: `预算未生效(期望${newBudget} 实际${rb2})` };
    });
  } catch (e) { return { ok: false, err: String(e).slice(0, 80) }; }
  finally { _adjusting = false; }
}

// ===== 快循环: 在播场次核算 =====
async function fastTick() {
  rollDate();
  const nowCst = new Date(Date.now() + 8 * 3600000);
  const hour = nowCst.getUTCHours();
  if (hour < 7 || hour >= 23) return;
  for (const [name, acc, regionName] of REGIONS) {
    const sess = currentSession(acc, regionName);
    if (!sess) continue; // 非在播时段
    const sk = `${todayCst()}-${acc}-${sess.sessionNo}`;
    const st = state.sessions[sk] = state.sessions[sk] || { adds: 0, alerts: 0, lastAt: 0 };
    if (_adjusting) continue;
    try {
      const { hourly, dayLiveCost } = await statHourlyLive(acc);
      // 本场已耗/线索: 本场起始小时起的桶合计 (首桶含前场尾差的误差可接受)
      let sessCost = 0, sessLeads = 0;
      for (const [hh, v] of Object.entries(hourly)) if (Number(hh) >= sess.startHour) { sessCost += v.cost; sessLeads += v.leads; }
      const beforeCost = dayLiveCost - sessCost; // 历史场次直播总消耗(当日)
      const dayBudget = state.budgets[name] || 0;
      if (!dayBudget) { log(`${name} 日预算未知(待CDP轮转), 跳过`); continue; }
      const sessBudget = dayBudget - beforeCost;
      if (sessBudget <= 0) {
        if (st.alerts < 1) {
          st.alerts++;
          await pushToLark(`⚠️【预算预警】${name} 第${sess.sessionNo}场（${sess.carModel}）\n当日直播总消耗 ${Math.round(dayLiveCost).toLocaleString()} 已超过本场可用预算（日预算 ${dayBudget.toLocaleString()} − 历史场次 ${Math.round(beforeCost).toLocaleString()}）\n本场已耗 ${Math.round(sessCost).toLocaleString()}，线索 ${Math.round(sessLeads)} 条\n预算已用尽，建议结束本场或加日预算`, { chatId: MONITOR_CHAT });
          persist();
        }
        continue;
      }
      const usage = sessCost / sessBudget;
      const cpl = sessLeads > 0 ? sessCost / sessLeads : 0;
      log(`${name} 第${sess.sessionNo}场(${sess.carModel}) 本场已耗${Math.round(sessCost)}/${Math.round(sessBudget)} = ${(usage * 100).toFixed(1)}% | CPL ${cpl > 0 ? Math.round(cpl) : '—'} | 已加${st.adds}/2`);
      if (usage < ENTER_RATIO) continue;
      const canAdd = cpl > 0 && cpl < CPL_GATE && st.adds < MAX_ADDS;
      // 预警 (每场首撞必报; 后续撞线若冷却 15min 过也可再报)
      const now = Date.now();
      if (st.lastAt === 0 || now - st.lastAt > 15 * 60000) {
        st.alerts++;
        st.lastAt = now;
        let tail;
        if (canAdd) {
          const adj = await adjustAccountBudget(acc, 500);
          if (adj.ok) {
            st.adds++;
            state.budgets[name] = adj.newBudget;
            tail = `✅ 已自动增加日预算 500 元：${adj.oldBudget.toLocaleString()} → ${adj.newBudget.toLocaleString()}（本场第 ${st.adds}/2 次，量效达标 CPL ${Math.round(cpl)}<${CPL_GATE}）`;
          } else {
            tail = `❌ 自动加预算失败（${adj.err}），请立即手动为该账户增加预算 500 元`;
          }
        } else if (st.adds >= MAX_ADDS) {
          tail = `本场已加预算 ${st.adds} 次（共 ${st.adds * 500} 元），达到单场上限，不再自动加预算`;
        } else {
          tail = `⚠️ 当场线索成本 ${Math.round(cpl)} 元 ≥ ${CPL_GATE}，量效不达标，不建议加预算，请人工关注`;
        }
        const sessStartStr = `${String(Math.floor(sess.startMin / 60)).padStart(2, '0')}:${String(sess.startMin % 60).padStart(2, '0')}`;
        const msg = [
          `⚠️【预算预警】${name} 第${sess.sessionNo}场（${sess.carModel} · ${sessStartStr} 开播）`,
          `本场预算 ${Math.round(sessBudget).toLocaleString()}，已消耗 ${Math.round(sessCost).toLocaleString()}（使用率 ${(usage * 100).toFixed(1)}%）`,
          `本场线索 ${Math.round(sessLeads)} 条，线索成本 ${cpl > 0 ? Math.round(cpl) + ' 元/条' : '暂无'}`,
          `— 近场口径 · 账户日预算 ${dayBudget.toLocaleString()} —`,
          tail,
        ].join('\n');
        await pushToLark(msg, { chatId: MONITOR_CHAT });
        persist();
      }
    } catch (e) { log(`${name} fastTick 失败: ${String(e).slice(0, 60)}`); }
    await new Promise(r => setTimeout(r, 600));
  }
}

// ===== 慢循环: CDP 轮转读日预算 =====
async function slowTick() {
  rollDate();
  const hour = new Date(Date.now() + 8 * 3600000).getUTCHours();
  if (hour < 7 || hour >= 23) return;
  await rotateBudgetRead();
}

log('budget-watch v3 启动 (按场切割口径; 慢30min/快5min)');
setInterval(() => fastTick().catch(e => log('fastTick err ' + String(e).slice(0, 60))), 5 * 60000);
setInterval(() => slowTick().catch(e => log('slowTick err ' + String(e).slice(0, 60))), 30 * 60000);
setTimeout(() => fastTick().catch(e => log('first fast err ' + String(e).slice(0, 60))), 5000);
setTimeout(() => slowTick().catch(e => log('first slow err ' + String(e).slice(0, 60))), 90000);
