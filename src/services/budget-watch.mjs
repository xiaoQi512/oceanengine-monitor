// src/services/budget-watch.mjs v3 — AI 大区预算监控 (按场切割口径)
// 场次: shift_schedule 时段; 当场预算 = 账户日预算 − 历史场次直播总消耗(当日, 本场开始前)
// 当场直播已耗 / 当场预算 ≥ 80% → 飞书预警; 当场线索成本 < 110 → 自动加预算 500 (CDP, 每场上限 2 次/1000)
// 慢循环 30min: CDP 轮转读日预算; 快循环 5min: 在播场次核算
import fs from 'node:fs';
import path from 'node:path';
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

const state = { date: '', budgets: {}, sessions: {}, _lastCdpIdx: -1, newSessionDone: {} };
const todayCst = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (saved.date === todayCst()) {
    state.date = saved.date; state.budgets = saved.budgets || {}; state.sessions = saved.sessions || {}; state._lastCdpIdx = saved._lastCdpIdx ?? -1;
    state.newSessionDone = saved.newSessionDone || {};
    log(`已恢复状态: ${Object.keys(state.sessions).length} 个场次记录`);
  }
} catch {}
function persist() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1)); } catch {} }
function rollDate() {
  const t = todayCst();
  if (state.date !== t) { Object.assign(state, { date: t, budgets: {}, sessions: {}, newSessionDone: {} }); log(`跨日重置 ${t}`); persist(); }
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
      return t;
    });
    if (h > 0) { state.budgets[name] = h; log(`CDP 读 ${name} 日预算=${h}`); }  } catch (e) { log(`CDP 读 ${name} 失败: ${String(e).slice(0, 60)}`); }
}
async function adjustAccountBudget(aadvid, add, opts = {}) {
  if (_adjusting) return { ok: false, err: '调整中(互斥)' };
  _adjusting = true;
  try {
    return await cdpWithPage(aadvid, async (evl, call) => {
      await evl(`(() => { const els = [...document.querySelectorAll('button,span,div')].filter(e => e.offsetParent !== null && (e.textContent || '').trim() === '取消'); const e = els[els.length - 1]; if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1; })()`);
      await new Promise(r => setTimeout(r, 1200));
      const rb = await evl(`(() => { const b = (document.body.innerText || '').match(/日预算[^\\d]{0,20}([\\d,\\.]+)/); return b ? RegExp.$1 : null; })()`);
      const cur = num(rb);
      if (!cur) return { ok: false, err: '页面无预算值' };
      // 绝对值模式: 页头预算已 ≥ 目标 → 无需调整; 否则增量 = 目标 − 当前
      if (opts.absoluteTarget != null) {
        if (cur >= opts.absoluteTarget) return { ok: true, skipped: true, oldBudget: cur, newBudget: cur };
        add = opts.absoluteTarget - cur;
      }
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

// ===== 快循环: 在播场次核算 (场次=实际消耗段切割, 适应提前开播/排期调整) =====
async function fastTick() {
  rollDate();
  const nowCst = new Date(Date.now() + 8 * 3600000);
  const hour = nowCst.getUTCHours();
  if (hour < 7 || hour >= 23) return;
  for (const [name, acc, regionName] of REGIONS) {
    const sk0 = `${todayCst()}-${acc}`;
    if (_adjusting) continue;
    try {
      const { hourly, dayLiveCost } = await statHourlyLive(acc);
      // 场次切割: 按小时桶消耗序列分段 (段内连续, 空桶≥1 即切分)
      const hours = Object.keys(hourly).map(Number).sort((a, b) => a - b);
      if (!hours.length) continue;
      const segs = [];
      let seg = { startH: hours[0], endH: hours[0] };
      for (let i = 1; i < hours.length; i++) {
        if (hours[i] - hours[i - 1] <= 1) seg.endH = hours[i];
        else { segs.push(seg); seg = { startH: hours[i], endH: hours[i] }; }
      }
      segs.push(seg);
      // 当前场次 = 最后一段 (且当前小时 ≥ 段首; 段已结束且当前小时 > endH+1 → 无在播)
      const cur = segs[segs.length - 1];
      const liveNow = hour <= cur.endH + 1; // 段末尾 1 小时内仍视为本场
      if (!liveNow) { delete state.sessions[sk0]; continue; }
      const sessNo = segs.length; // 当日第几段
      const sk = `${sk0}-s${sessNo}`;
      const st = state.sessions[sk] = state.sessions[sk] || { adds: 0, alerts: 0, lastAt: 0 };
      if (_adjusting) continue;
      // 本场已耗/线索: 本段小时桶合计
      let sessCost = 0, sessLeads = 0;
      for (const [hh, v] of Object.entries(hourly)) if (Number(hh) >= cur.startH) { sessCost += v.cost; sessLeads += v.leads; }
      const beforeCost = dayLiveCost - sessCost; // 历史场次直播总消耗(当日, 含更早段)
      const dayBudget = state.budgets[name] || 0;
      if (!dayBudget) { log(`${name} 日预算未知(待CDP轮转), 跳过`); continue; }
      const sessBudget = dayBudget - beforeCost;
      if (sessBudget <= 0) {
        if (st.alerts < 1) {
          st.alerts++;
          await pushToLark(`⚠️【预算预警】${name} 今日第${sessNo}场直播（${String(cur.startH).padStart(2, '0')}:00 实际开播）\n当日直播总消耗 ${Math.round(dayLiveCost).toLocaleString()} 已超过本场可用预算（日预算 ${dayBudget.toLocaleString()} − 历史场次 ${Math.round(beforeCost).toLocaleString()}）\n本场已耗 ${Math.round(sessCost).toLocaleString()}，线索 ${Math.round(sessLeads)} 条\n预算已用尽，建议结束本场或加日预算`, { chatId: MONITOR_CHAT });
          persist();
        }
        continue;
      }
      const usage = sessCost / sessBudget;
      const cpl = sessLeads > 0 ? sessCost / sessLeads : 0;
      const sessStartStr = `${String(cur.startH).padStart(2, '0')}:00（实际开播）`;
      log(`${name} 第${sessNo}场 本场已耗${Math.round(sessCost)}/${Math.round(sessBudget)} = ${(usage * 100).toFixed(1)}% | CPL ${cpl > 0 ? Math.round(cpl) : '—'} | 已加${st.adds}/2`);
      if (usage < ENTER_RATIO) continue;
      const canAdd = cpl > 0 && cpl < CPL_GATE && st.adds < MAX_ADDS;
      const now = Date.now();
      const cdOk = st.lastAt === 0 || now - st.lastAt > 15 * 60000;
      log(`${name} 触发判定: usage=${(usage * 100).toFixed(1)}% cpl=${Math.round(cpl)} canAdd=${canAdd} cdOk=${cdOk}`);
      if (!cdOk) continue;
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
      const msg = [
        `⚠️【预算预警】${name} 今日第${sessNo}场直播（${sessStartStr}）`,
        `本场预算 ${Math.round(sessBudget).toLocaleString()}，本场已消耗 ${Math.round(sessCost).toLocaleString()}（使用率 ${(usage * 100).toFixed(1)}%）`,
        `本场线索 ${Math.round(sessLeads)} 条，线索成本 ${cpl > 0 ? Math.round(cpl) + ' 元/条' : '暂无'}`,
        `— 场次口径 · 账户日预算 ${dayBudget.toLocaleString()} · 历史场次已耗 ${Math.round(beforeCost).toLocaleString()} —`,
        tail,
      ].join('\n');
      await pushToLark(msg, { chatId: MONITOR_CHAT });
      persist();
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

// ===== 新场开播预算保障 (用户规则 2026-09-28): 检测到新直播开始 → 本场预算 1500 =====
// 账户日预算实际调整为: 历史场次总消耗 + 1500, 向上凑整百; 只上调不下调; 60s 检测, 每 room 幂等一次
const NEW_SESSION_BUDGET = 1500;
function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
  });
}
async function newSessionBudgetTick() {
  rollDate();
  const hour = new Date(Date.now() + 8 * 3600000).getUTCHours();
  if (hour < 7 || hour >= 23) return;
  let j;
  try { j = await httpGetJson('http://127.0.0.1:8899/api/ai-regions-sessions'); } catch (e) { log(`新场检测: sessions API 拉取失败 ${String(e).slice(0, 50)}`); return; }
  if (!j || !Array.isArray(j.regions)) return;
  log(`新场检测: ${j.regions.reduce((a, r) => a + (r.sessions || []).filter(s => s.status === 'live').length, 0)} 个在播房间`);
  const byAadvid = new Map(REGIONS.map(([n, a]) => [a, n]));
  for (const rg of j.regions) {
    const displayName = byAadvid.get(rg.aadvid);
    if (!displayName) continue;
    const live = (rg.sessions || []).find(s => s.status === 'live' && s.roomId);
    if (!live) continue;
    const doneKey = `${todayCst()}|${live.roomId}`;
    const rec0 = state.newSessionDone?.[doneKey];
    if (rec0 && rec0.done) continue; // 成功处理过才跳过; 失败记录继续重试
    const otherCost = (rg.sessions || []).filter(s => s.roomId !== live.roomId).reduce((a, s) => a + (s.cost || 0), 0);
    const target = Math.ceil((otherCost + NEW_SESSION_BUDGET) / 100) * 100;
    const attemptsKey = `${todayCst()}|${live.roomId}`;
    state.newSessionDone = state.newSessionDone || {};
    const rec = state.newSessionDone[attemptsKey] = state.newSessionDone[attemptsKey] || { attempts: 0, firstAt: Date.now() };    const sk0 = `${todayCst()}-${rg.aadvid}`;
    const sessNo = (rg.sessions || []).filter(s => s.roomId !== live.roomId && s.status !== 'planned').length + 1;
    if (rec.attempts >= 5) { if (rec.alerted !== true) { rec.alerted = true; await pushToLark(`❌【新场开播预算保障失败】${displayName} 新直播(${live.start} 开播)连续 ${rec.attempts} 次调整日预算失败(目标 ${target.toLocaleString()}), 请立即手动调整`, { chatId: MONITOR_CHAT }); persist(); } continue; }
    const cur = state.budgets[displayName] || 0;
    try {
      const adj = await adjustAccountBudget(rg.aadvid, target, { absoluteTarget: target });
      if (adj.ok) {
        state.budgets[displayName] = adj.newBudget;
        state.newSessionDone[doneKey] = { done: true, at: Date.now(), target, newBudget: adj.newBudget };
        persist();
        if (adj.skipped) {
          log(`${displayName} 新场(${live.start})预算已足(页头 ${adj.oldBudget.toLocaleString()} ≥ 目标 ${target.toLocaleString()}), 无需调整`);
        } else {
          await pushToLark([
            `🆕【新场开播 · 预算保障】${displayName}`,
            `检测到新直播开播（${live.start}，当日第 ${sessNo} 场），本场预算 ${NEW_SESSION_BUDGET} 元`,
            `历史场次总消耗 ${Math.round(otherCost).toLocaleString()} + 本场 ${NEW_SESSION_BUDGET} → 向上凑整百 = ${target.toLocaleString()}`,
            `✅ 账户日预算已自动调整：${adj.oldBudget.toLocaleString()} → ${adj.newBudget.toLocaleString()}`,
          ].join('\n'), { chatId: MONITOR_CHAT });
          log(`${displayName} 新场开播, 日预算 ${adj.oldBudget} → ${adj.newBudget} (target=${target})`);
        }
      } else {
        rec.attempts = (rec.attempts || 0) + 1;
        log(`${displayName} 新场预算调整失败(${adj.err}), 第 ${rec.attempts} 次重试`);
        persist();
      }
    } catch (e) { rec.attempts = (rec.attempts || 0) + 1; log(`${displayName} 新场预算调整异常: ${String(e).slice(0, 60)}`); persist(); }
    await new Promise(r => setTimeout(r, 1000));
  }
}

log('budget-watch v3 启动 (按场切割口径; 慢30min/快5min)');
setInterval(() => fastTick().catch(e => log('fastTick err ' + String(e).slice(0, 60))), 5 * 60000);
setInterval(() => slowTick().catch(e => log('slowTick err ' + String(e).slice(0, 60))), 30 * 60000);
setInterval(() => newSessionBudgetTick().catch(e => log('newSession err ' + String(e).slice(0, 60))), 5 * 60000);
setTimeout(() => fastTick().catch(e => log('first fast err ' + String(e).slice(0, 60))), 5000);
setTimeout(() => slowTick().catch(e => log('first slow err ' + String(e).slice(0, 60))), 90000);
setTimeout(() => newSessionBudgetTick().catch(e => log('first newSession err ' + String(e).slice(0, 60))), 20000);
