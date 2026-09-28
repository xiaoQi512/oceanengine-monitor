// src/services/http-routes/api-ai-regions-sessions.mjs - 五大区场次数据 (历史/在播/待开播, 60s 缓存)
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../utils/monitor-utils.mjs';
import { getCookieData } from '../ai-regions-api.mjs';

const REGIONS = [
  ['东区AI直播', '1842681994872135', '东区营销中心'],
  ['西区AI直播', '1842681830951944', '西区营销中心'],
  ['南区AI直播', '1842682454270468', '南区营销中心'],
  ['北区AI直播', '1842683071403332', '北区营销中心'],
  ['中区AI直播', '1842663909080452', '中区营销中心'],
];
let _cache = { at: 0, data: null };
const num = (s) => { const n = parseFloat(String(s ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

async function statHourlyLive(acc, headers) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const body = {
    DataSetKey: 'basic_ad_data', Dimensions: ['stat_time_hour', 'cdp_marketing_goal'],
    EndTime: `${today} 23:59:59`,
    Filters: { ConditionRelationshipType: 1, Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [acc] }] },
    IsDownload: false, Metrics: ['stat_cost', 'clue_message_count'], PageParams: { Limit: 60, Offset: 0 },
    StartTime: `${today} 00:00:00`, Extra: { is_fill_zero: 'true', refer: '' },
  };
  const res = await fetch('https://ad.oceanengine.com/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=' + acc, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  const hourly = {};
  let dayLiveCost = 0, dayLiveLeads = 0;
  for (const r of (j?.data?.StatsData?.Rows || [])) {
    const goal = String(r.Dimensions?.cdp_marketing_goal?.ValueStr || '');
    if (!goal.includes('直播')) continue;
    const hh = Number(String(r.Dimensions?.stat_time_hour?.ValueStr || '').slice(11, 13));
    if (isNaN(hh)) continue;
    const c = num(r.Metrics?.stat_cost?.Value ?? r.Metrics?.stat_cost?.ValueStr);
    const l = num(r.Metrics?.clue_message_count?.Value ?? r.Metrics?.clue_message_count?.ValueStr);
    if (c <= 0 && l <= 0) continue; // 跳过零桶(is_fill_zero 填充), 场次段=真实消耗段
    hourly[hh] = hourly[hh] || { cost: 0, leads: 0 };
    hourly[hh].cost += c;
    hourly[hh].leads += l;
    dayLiveCost += c; dayLiveLeads += l;
  }
  return { hourly, dayLiveCost, dayLiveLeads };
}

function segmentHours(hourly) {
  hourly = hourly || {};
  const hours = Object.keys(hourly).map(Number).sort((a, b) => a - b);
  if (!hours.length) return [];
  const segs = [];
  let seg = { startH: hours[0], endH: hours[0] };
  for (let i = 1; i < hours.length; i++) {
    if (hours[i] - hours[i - 1] <= 1) seg.endH = hours[i];
    else { segs.push(seg); seg = { startH: hours[i], endH: hours[i] }; }
  }
  segs.push(seg);
  return segs;
}

export async function serveAiRegionsSessions(url, req, res) {
  if (url.pathname !== '/api/ai-regions-sessions' || (req && req.method !== 'GET')) return false;
  try {
    if (Date.now() - _cache.at > 60000) {
      const nowCst = new Date(Date.now() + 8 * 3600000);
      const today = nowCst.toISOString().slice(0, 10);
      const nowMin = nowCst.getUTCHours() * 60 + nowCst.getUTCMinutes();
      const cd = await getCookieData();
      const headers = { ...cd.headers, 'Content-Type': 'application/json', Referer: 'https://ad.oceanengine.com/' };
      headers['Cookie'] = headers['Cookie'].replace(/[^\x20-\x7E]/g, '');
      const csrf = headers['Cookie'].match(/passport_csrf_token=([^;]+)/)?.[1];
      if (csrf && !/csrftoken=/.test(headers['Cookie'])) headers['Cookie'] += '; csrftoken=' + csrf;
      // budget-watch state: 日预算 + 当场加预算次数
      let bw = { budgets: {}, sessions: {} };
      try { bw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'budget-watch-state.json'), 'utf8')); } catch {}
      const db = new Database(path.join(DATA_DIR, 'oceanengine.db'), { readonly: true });
      const regions = [];
      for (const [name, acc, regionName] of REGIONS) {
        const stat = await statHourlyLive(acc, headers);
        if (!stat || !stat.hourly) { console.log("[regions-sessions]", name, "STAT=", JSON.stringify(stat).slice(0,120), "type=", typeof stat); continue; }
        const { hourly, dayLiveCost } = stat;
        const segs = segmentHours(hourly);
        const dayBudget = Number(bw.budgets?.[name] || 0);
        const plan = db.prepare('SELECT session_no, start_min, end_min, car_model FROM shift_schedule WHERE cst_date=? AND account_id=? ORDER BY session_no').all(today, acc);
        const items = [];
        // 历史消耗段 (全部非最后段)
        segs.forEach((s, i) => {
          let cost = 0, leads = 0;
          for (const [hh, v] of Object.entries(hourly)) if (Number(hh) >= s.startH && Number(hh) <= s.endH) { cost += v.cost; leads += v.leads; }
          const isLast = i === segs.length - 1;
          const live = isLast && nowMin <= s.endH * 60 + 59 + 60; // 末段且未结束 1h
          items.push({
            status: live ? 'live' : 'done',
            start: `${String(s.startH).padStart(2, '0')}:00`,
            end: live ? '直播中' : `${String(s.endH).padStart(2, '0')}:59`,
            cost: Math.round(cost), leads: Math.round(leads),
            cpl: leads > 0 ? Math.round(cost / leads) : 0,
            usage: live && dayBudget > 0 ? Math.round(cost / Math.max(1, dayBudget - (dayLiveCost - cost)) * 100) : null,
            carModel: '',
          });
        });
        // 待开播规划: 排班已归属真人福利号, 不进五大区 items (单独输出 fuliPlan)
        items.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
        regions.push({ name, dayBudget, items, updatedAt: new Date().toLocaleTimeString('zh-CN') });
        await new Promise(r => setTimeout(r, 300));
      }
      // 真人福利号: 按排班场次逐场展示 (小时桶按分钟重叠分摊到各场)
      const FU = '1842681352509635';
      const fuHourly = await statHourlyLive(FU, headers);
      const fuPlanAll = db.prepare("SELECT session_no, start_min, end_min, car_model, anchor FROM shift_schedule WHERE account_id=? AND cst_date=? ORDER BY start_min").all(FU, today);
      const fuliItems = [];
      if (fuPlanAll.length) {
        // 每桶按分钟重叠分摊到覆盖它的场次
        const acc2 = fuPlanAll.map(p => ({ ...p, cost: 0, leads: 0, _c: 0, _l: 0 }));
        for (const [hh, v] of Object.entries(fuHourly.hourly)) {
          const bStart = Number(hh) * 60, bEnd = bStart + 60, total = v.cost + v.leads;
          const overlaps = acc2.map(p => ({ p, ov: Math.max(0, Math.min(bEnd, p.end_min) - Math.max(bStart, p.start_min)) })).filter(x => x.ov > 0);
          const ovSum = overlaps.reduce((a, x) => a + x.ov, 0);
          if (!ovSum) continue;
          for (const x of overlaps) {
            const ratio = x.ov / ovSum;
            x.p.cost += v.cost * ratio; x.p.leads += v.leads * ratio; x.p._c += x.ov; x.p._l += v.leads * ratio;
          }
        }
        for (const p of acc2) {
          const cpl = p.leads > 0 ? Math.round(p.cost / p.leads) : 0;
          const status = nowMin >= p.start_min && nowMin < p.end_min ? 'live' : (nowMin >= p.end_min ? 'done' : 'planned');
          fuliItems.push({
            status, start: hhmm(p.start_min), end: hhmm(p.end_min),
            anchor: p.anchor || '', carModel: p.car_model || '',
            cost: Math.round(p.cost), leads: Math.round(p.leads), cpl,
            sessionNo: p.session_no,
          });
        }
        // 排班外消耗 (小时桶有但排班未覆盖)
        const covered = acc2.reduce((a, p) => a + p.cost, 0);
        const orphan = Math.round((fuHourly.dayLiveCost || 0) - covered);
        if (orphan > 50) fuliItems.push({ status: 'orphan', start: '—', end: '—', anchor: '未排班时段', carModel: '', cost: orphan, leads: 0, cpl: 0 });
      }
      const fuliPlan = db.prepare("SELECT cst_date, session_no, start_min, end_min, car_model FROM shift_schedule WHERE account_id=? AND (cst_date > ? OR (cst_date = ? AND start_min > ?)) ORDER BY cst_date, start_min LIMIT 12").all(FU, today, today, nowMin);
      db.close();
      _cache = { at: Date.now(), data: { regions, date: today, fuli: { items: fuliItems, dayLiveCost: Math.round(fuHourly.dayLiveCost), dayLiveLeads: Math.round(fuHourly.dayLiveLeads) }, fuliPlan: fuliPlan.map(p => ({ date: p.cst_date, start: hhmm(p.start_min), end: hhmm(p.end_min), carModel: p.car_model, sessionNo: p.session_no })) } };
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(_cache.data));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.message, stack: String(e.stack).split("\n").slice(0,4) }));
  }
  return true;
}
