// src/services/http-routes/api-ai-regions-sessions.mjs v3
// 五大区直播场次: 数据源=直播分析报表实时接口 (ad_live_all_list 场次 + ad_live_core_data 按场消耗/线索)
// 输出: 已开播/在播真实场次(预算/消耗/线索/CPL) + 排班待开播场次
// 接口约束(2026-09-28 实测): ①OrderBy 仅支持 all_live_watch_cnt_td(时间字段拒) ②指标互斥: all_stat_cost_td 不得与 clue_message_count 同查, 分两次请求按 room_id 合并 ③请求头须带 X-CSRFToken(cookie csrftoken 值) ④7 天窗口稳妥
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../utils/monitor-utils.mjs';
import { getCookieData } from '../ai-regions-api.mjs';
import { AI_REGIONS } from '../../config/index.mjs';

let _cache = { at: 0, data: null };
const num = (s) => { const n = parseFloat(String(s ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const STAT_URL = 'https://ad.oceanengine.com/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=';
const epochToHHMM = (sec) => {
  const n = Number(sec);
  if (!n) return '';
  return new Date((n + 8 * 3600) * 1000).toISOString().slice(11, 16);
};
const epochToDate = (sec) => {
  const n = Number(sec);
  if (!n) return '';
  return new Date((n + 8 * 3600) * 1000).toISOString().slice(0, 10);
};

// statQuery 调用 (直播分析报表同款头)
async function statQuery(aadvid, body, headers) {
  const res = await fetch(STAT_URL + aadvid, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  if (!j || j.code !== 0) throw new Error(`statQuery ${j?.code || res.status} ${j?.message || ''} [${body.DataSetKey}]`);
  return j.data?.StatsData?.Rows || [];
}

// basic_ad_data 直播小时桶 (stat_cost + clue_message_count) — 线索口径来源
// ad_live_core_data 的 clue_message_count 实测恒为空("-"), 线索必须走小时桶分摊
async function statHourlyLive(aadvid, headers) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const rows = await statQuery(aadvid, {
    DataSetKey: 'basic_ad_data', Dimensions: ['stat_time_hour', 'cdp_marketing_goal'],
    EndTime: `${today} 23:59:59`,
    Filters: { ConditionRelationshipType: 1, Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [aadvid] }] },
    IsDownload: false, Metrics: ['stat_cost', 'clue_message_count'], PageParams: { Limit: 60, Offset: 0 },
    StartTime: `${today} 00:00:00`, Extra: { is_fill_zero: 'true', refer: '' },
  }, headers);
  const hourly = {};
  let dayLiveCost = 0, dayLiveLeads = 0;
  for (const r of rows) {
    const goal = String(r.Dimensions?.cdp_marketing_goal?.ValueStr || '');
    if (!goal.includes('直播')) continue;
    const hh = Number(String(r.Dimensions?.stat_time_hour?.ValueStr || '').slice(11, 13));
    if (isNaN(hh)) continue;
    const c = num(r.Metrics?.stat_cost?.Value ?? r.Metrics?.stat_cost?.ValueStr);
    const l = num(r.Metrics?.clue_message_count?.Value ?? r.Metrics?.clue_message_count?.ValueStr);
    if (c <= 0 && l <= 0) continue;
    hourly[hh] = hourly[hh] || { cost: 0, leads: 0 };
    hourly[hh].cost += c; hourly[hh].leads += l;
    dayLiveCost += c; dayLiveLeads += l;
  }
  return { hourly, dayLiveCost, dayLiveLeads };
}

// 小时桶按分钟区间分摊: [startMin, endMin) 与整点桶重叠比例加权
function allocBuckets(hourly, startMin, endMin) {
  let cost = 0, leads = 0;
  for (const [hh, v] of Object.entries(hourly || {})) {
    const bStart = Number(hh) * 60, bEnd = bStart + 60;
    const ov = Math.max(0, Math.min(bEnd, endMin) - Math.max(bStart, startMin));
    if (ov <= 0) continue;
    cost += v.cost * (ov / 60);
    leads += v.leads * (ov / 60);
  }
  return { cost, leads };
}

// 采集单账户: 场次列表 + 按场消耗 (room_id); 线索由小时桶按场次区间分摊
async function fetchLiveSessions(aadvid, anchor, headers, today, hourly, nowMinBJ) {
  const startBj = new Date(Date.now() + 8 * 3600000 - 7 * 86400000).toISOString().slice(0, 10);
  const filters = { ConditionRelationshipType: 1, Conditions: [
    { Field: 'advertiser_id', Operator: 7, Values: [aadvid] },
    { Field: 'anchor_id', Operator: 7, Values: [anchor] },
  ] };
  const base = {
    EndTime: `${today} 23:59:59`, Extra: { is_fill_zero: 'true', refer: '' },
    Filters: filters, IsDownload: false, PageParams: { Limit: 50, Offset: 0 },
    StartTime: `${startBj} 00:00:00`,
  };
  // 1. 场次列表 (开播/关播时间/状态)
  const listRows = await statQuery(aadvid, {
    ...base,
    DataSetKey: 'ad_live_all_list',
    Dimensions: ['room_id', 'live_room_aweme_nick_name', 'live_room_start_time', 'live_room_finish_time', 'live_room_status', 'live_room_title'],
    Metrics: ['cost_promotion_count', 'all_live_watch_cnt_td'],
    OrderBy: [{ Field: 'all_live_watch_cnt_td', Type: 2 }],
  }, headers);
  // 2. 按场消耗+观看
  const costRows = await statQuery(aadvid, {
    ...base,
    DataSetKey: 'ad_live_core_data',
    Dimensions: ['room_id', 'live_room_start_time', 'live_room_finish_time'],
    Metrics: ['all_stat_cost_td', 'all_live_watch_cnt_td'],
  }, headers);

  const costMap = new Map();
  for (const r of costRows) {
    const rid = String(r.Dimensions?.room_id?.ValueStr ?? r.Dimensions?.room_id?.Value ?? '');
    if (!rid) continue;
    const m = r.Metrics || {};
    costMap.set(rid, {
      cost: num(m.all_stat_cost_td?.ValueStr ?? m.all_stat_cost_td?.Value),
      watch: num(m.all_live_watch_cnt_td?.ValueStr ?? m.all_live_watch_cnt_td?.Value),
    });
  }

  // 合并 + 只保留今天的场次; 线索 = 计划口径小时桶**整桶归属**(用户规则: 不均分)
  // 归属规则: 桶尾时刻落在哪场的 [开播, 结束] 区间 → 归该场; 开播前 → 归首场(延迟归因); 场间空窗 → 归下一场; 末场后 → 归末场
  const rawSessions = [];
  for (const r of listRows) {
    const d = r.Dimensions || {};
    const rid = String(d.room_id?.ValueStr ?? d.room_id?.Value ?? '');
    const startEpoch = Number(d.live_room_start_time?.Value || 0);
    const finishEpoch = Number(d.live_room_finish_time?.Value || 0);
    if (!rid || !startEpoch) continue;
    if (epochToDate(startEpoch) !== today) continue;
    const statusRaw = String(d.live_room_status?.ValueStr || '').trim();
    const st = { cost: costMap.get(rid)?.cost ?? 0, watch: costMap.get(rid)?.watch ?? 0 };
    const isLive = statusRaw.includes('关播') ? false : finishEpoch ? false : true;
    // 无效场次屏蔽(用户规则 2026-09-28): 已结束场 时长<30min 且 消耗<200 → 丢弃; 在播场豁免
    if (!isLive && finishEpoch && (finishEpoch - startEpoch) < 1800 && st.cost < 200) continue;
    const startMinBJ = Math.floor(((startEpoch + 8 * 3600) % 86400) / 60);
    const endMinBJ = isLive ? Math.max(startMinBJ + 1, nowMinBJ) : Math.floor(((finishEpoch + 8 * 3600) % 86400) / 60) || Math.min(startMinBJ + 120, 1439);
    rawSessions.push({ rid, startEpoch, finishEpoch, isLive, startMinBJ, endMinBJ, st, title: String(d.live_room_title?.ValueStr || '').trim() });
  }
  rawSessions.sort((a, b) => a.startEpoch - b.startEpoch);
  // 整桶归属
  const leadByRoom = new Map();
  for (const [hh, v] of Object.entries(hourly || {})) {
    const t = Number(hh) * 60 + 60; // 桶尾时刻
    let owner = null;
    for (const sp of rawSessions) { if (t < sp.endMinBJ) { owner = sp; break; } }
    if (!owner && rawSessions.length) owner = rawSessions[rawSessions.length - 1];
    if (!owner) continue;
    leadByRoom.set(owner.rid, (leadByRoom.get(owner.rid) || 0) + num(v.leads));
  }
  const sessions = rawSessions.map(sp => {
    const leads = Math.round(leadByRoom.get(sp.rid) || 0);
    return {
      roomId: sp.rid,
      title: sp.title,
      status: sp.isLive ? 'live' : 'done',
      startEpoch: sp.startEpoch, finishEpoch: sp.finishEpoch,
      start: epochToHHMM(sp.startEpoch),
      finish: sp.isLive ? '' : epochToHHMM(sp.finishEpoch),
      cost: Math.round(sp.st.cost * 100) / 100,
      leads,
      cpl: leads > 0 ? Math.round(sp.st.cost / leads * 100) / 100 : 0,
      watch: sp.st.watch,
    };
  });
  return sessions;
}

export async function serveAiRegionsSessions(url, req, res) {
  if (url.pathname !== '/api/ai-regions-sessions' || (req && req.method !== 'GET')) return false;
  try {
    if (Date.now() - _cache.at > 60000) {
      const nowCst = new Date(Date.now() + 8 * 3600000);
      const today = nowCst.toISOString().slice(0, 10);
      const nowMin = nowCst.getUTCHours() * 60 + nowCst.getUTCMinutes();
      const cd = await getCookieData();
      const headers = { ...cd.headers, 'Content-Type': 'application/json; charset=UTF-8' };
      headers['Cookie'] = headers['Cookie'].replace(/[^\x20-\x7E]/g, '');
      const csrf = headers['Cookie'].match(/csrftoken=([^;]+)/)?.[1]
        || headers['Cookie'].match(/passport_csrf_token=([^;]+)/)?.[1];
      if (csrf) headers['X-CSRFToken'] = csrf;
      // budget-watch state: 各区日预算
      let bw = { budgets: {}, sessions: {} };
      try { bw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'budget-watch-state.json'), 'utf8')); } catch {}
      const db = new Database(path.join(DATA_DIR, 'oceanengine.db'), { readonly: true });
      const errors = {};
      // 六账户并行采集 (每账户 3 个 statQuery 串行, 区间并行)
      const regionResults = await Promise.all(AI_REGIONS.map(async (rg) => {
        const name = rg.name;
        const regionName = name + '营销中心';
        const plan = db.prepare('SELECT session_no, start_min, end_min, car_model FROM shift_schedule WHERE cst_date=? AND account_id=? ORDER BY session_no').all(today, rg.aadvid);
        let sessions = [];
        let hourly = { hourly: {} };
        try {
          hourly = await statHourlyLive(rg.aadvid, headers);
          sessions = await fetchLiveSessions(rg.aadvid, rg.anchor, headers, today, hourly.hourly, nowMin);
        } catch (e) {
          errors[name] = e.message.slice(0, 160);
          console.log('[regions-sessions]', name, '采集失败:', e.message.slice(0, 160));
        }
        const dayBudget = Number(bw.budgets?.[name + 'AI直播'] ?? bw.budgets?.[name] ?? bw.budgets?.[regionName] ?? 0);
        // 场次-排班匹配: 取时间重叠最大的排班段 (修复 14:00 整点场被吸到上一段的错配)
        // 在播场区间 = [开播, now]; 无重叠 → 计划外真实场次(unscheduled)
        for (const s of sessions) {
          const stMin = Math.floor(((s.startEpoch + 8 * 3600) % 86400) / 60);
          const enMin = s.status === 'live' ? Math.max(stMin + 1, nowMin) : (s.finishEpoch ? Math.floor(((s.finishEpoch + 8 * 3600) % 86400) / 60) : stMin + 1);
          let best = null, bestOv = 0;
          for (const p of plan) {
            const ov = Math.min(enMin, p.end_min) - Math.max(stMin, p.start_min);
            if (ov > bestOv) { bestOv = ov; best = p; }
          }
          s.carModel = best?.car_model || '';
          s.sessionNo = best?.session_no ?? null;
          s.unscheduled = !best;
        }
        // 当场预算(恒定标准 2026-09-28): 使用率最高 100%, 消耗>预算 = 预算基数异常(平台中途加过预算, state 基数过时)
        // 基数校准: budgetBase = max(state 日预算, 当日已播场次总消耗) — 平台日预算必然 ≥ 当日已消耗
        // 当场预算_i = budgetBase − 已播场次消耗(本场之前); 数学保证 usage_i ≤ 100%
        // state 无预算记录的区同样实装: 基数回退为当日已播总消耗(使用率恒 ≤100%, 最后场=100%)
        const dayTotal = sessions.reduce((a, s) => a + s.cost, 0);
        const budgetBase = Math.max(dayBudget || 0, dayTotal);
        let accBefore = 0;
        for (const s of sessions) {
          s.budget = budgetBase > 0 ? Math.round((budgetBase - accBefore) * 100) / 100 : 0;
          s.usage = s.budget > 0 ? Math.min(100, Math.round(s.cost / s.budget * 1000) / 10) : null;
          accBefore += s.cost;
        }
        // 待开播: 排班中尚未开播的时段 (结束分钟 > 已开播覆盖, 且当前时间未过)
        const playedMin = sessions.filter(s => s.status === 'live' || s.finish).map(s => {
          const p = plan.find(x => x.session_no === s.sessionNo);
          return p ? p.end_min : Math.floor((s.finishEpoch ? (s.finishEpoch % 86400) / 60 : s.startEpoch % 86400 / 60));
        });
        const planned = plan.filter(p => {
          const covered = sessions.some(s => s.sessionNo === p.session_no || (s.startEpoch && Math.floor(((s.startEpoch + 8 * 3600) % 86400) / 60) >= p.start_min - 30 && Math.floor(((s.startEpoch + 8 * 3600) % 86400) / 60) < p.end_min + 30));
          if (covered) return false;
          // 在播房已进行到该时段(nowMin 落在时段内且有直播间在播) → 该时段正在被覆盖, 不算待开播
          if (nowMin >= p.start_min && nowMin < p.end_min && sessions.some(s => s.status === 'live')) return false;
          return p.end_min > nowMin; // 未播完的时段
        }).map(p => ({ sessionNo: p.session_no, start: hhmm(p.start_min), end: hhmm(p.end_min), carModel: p.car_model || '' }));
        const liveLeads = sessions.reduce((a, s) => a + s.leads, 0);
        return {
          name, aadvid: rg.aadvid, dayBudget: Math.round(budgetBase * 100) / 100, budgetRaw: dayBudget,
          dayCost: Math.round(dayTotal * 100) / 100,
          dayLeads: liveLeads,
          dayCpl: liveLeads > 0 ? Math.round(dayTotal / liveLeads * 100) / 100 : 0,
          sessions, planned,
          updatedAt: nowCst.toISOString().slice(11, 19),
        };
      }));
      const regions = await regionResults;
      // 真人福利号内容已按需求移出本页 (2026-09-28), 不再采集
      db.close();
      _cache = {
        at: Date.now(),
        data: {
          date: today, regions, errors, nowMin,
          updatedAt: new Date().toLocaleTimeString('zh-CN'),
        },
      };
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(_cache.data));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.message, stack: String(e.stack).split('\n').slice(0, 4) }));
  }
  return true;
}

// 后台预热: 模块加载 2s 后首采, 之后每 60s 刷新 — 用户打开页面秒出数据(不现等采集)
let _warmupStarted = false;
function startWarmup() {
  if (_warmupStarted) return;
  _warmupStarted = true;
  setTimeout(async () => {
    for (;;) {
      try {
        if (Date.now() - _cache.at > 60000) {
          const fakeRes = { writeHead: () => {}, end: () => {} };
          await serveAiRegionsSessions({ pathname: '/api/ai-regions-sessions' }, { method: 'GET' }, fakeRes);
        }
      } catch (e) { console.log('[regions-sessions] 预热失败:', e.message.slice(0, 120)); }
      await new Promise(r => setTimeout(r, 60000));
    }
  }, 2000);
}
startWarmup();
