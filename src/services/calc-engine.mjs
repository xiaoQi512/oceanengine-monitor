// src/services/calc-engine.mjs - 统一核算引擎 (PM2 cron 1-56/5)
// Step1 agg_15min (页头刻度差值) / Step2 agg_shift (buildShiftData) /
// Step3 agg_daily_model (区域号场次数占比 + 福利号计划名规则) / Step4 agg_month_cum / Step5 对账
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ACCOUNT_ID } from '../utils/monitor-utils.mjs';
import { buildShiftData } from './http-routes/api-live-data.mjs';
import { getCookieData, buildStatQueryBody, API_BASE } from './ai-regions-api.mjs';

const DB_PATH = path.join(DATA_DIR, 'oceanengine.db');
const MODELS = ['αT7', 'T1', 'S3', 'αS5', 'αT5', 'V9', 'KAOLAS', 'αT'];
const REGIONS = [
  ['南区营销中心', '1842682454270468'], ['中区营销中心', '1842663909080452'],
  ['西区营销中心', '1842681830951944'], ['东区营销中心', '1842681994872135'],
  ['北区营销中心', '1842683071403332'],
];
const REGION_BY_ACC = Object.fromEntries(REGIONS.map(([n, a]) => [a, n]));
const FU_LI_ACC = '1842681352509635';
const FIVE = 5 * 60000;
const nowCstDate = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const nowCstTime = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 19).replace('T', ' ');

let _db = null;
const db = () => {
  if (!_db) { _db = new Database(DB_PATH); _db.pragma('journal_mode = WAL'); _db.pragma('busy_timeout = 5000'); }
  return _db;
};

// ===== model_rules 归类 =====
function classifyByRules(name, fallbackModel) {
  const d = db();
  const rules = d.prepare('SELECT rule_type, pattern, car_model, priority FROM model_rules WHERE enabled=1 ORDER BY priority').all();
  const n = String(name || '').toUpperCase();
  let fallback = fallbackModel;
  for (const r of rules) {
    if (r.rule_type === 'fallback') { fallback = r.car_model; continue; }
    if (r.rule_type === 'plan_id') { if (String(name) === r.pattern) return r.car_model; continue; }
    if (n.includes(r.pattern.toUpperCase())) return r.car_model;
  }
  return fallback;
}

// ===== Step1: agg_15min (页头刻度差值) =====
function calc15min() {
  const d = db();
  const today = nowCstDate();
  const snaps = d.prepare(`
    SELECT snapshot_time, spend, convert_cnt FROM account_snapshots
    WHERE account_id=? AND cst_date=? ORDER BY snapshot_time DESC LIMIT 40
  `).all(ACCOUNT_ID, today);
  if (snaps.length < 2) return;
  const FIVE = FIVE_MS();
  const tickOf = (iso) => Math.floor(new Date(iso.replace(' ', 'T') + 'Z').getTime() / FIVE) * FIVE;
  const byTick = new Map();
  for (const s of snaps) {
    const tk = tickOf(s.snapshot_time.replace(' ', 'T'));
    if (!byTick.has(tk)) byTick.set(tk, s);
  }
  const t0 = Math.floor(Date.now() / FIVE) * FIVE;
  const at = (tick) => { for (let k = 0; k < 7; k++) { const s = byTick.get(tick - k * FIVE); if (s) return s; } return null; };
  const s0 = at(t0) || snaps[0];
  const s15 = at(t0 - 3 * FIVE);
  const s30 = at(t0 - 6 * FIVE);
  if (!s15) return;
  const minutes = Math.max(1, Math.round((new Date(s0.snapshot_time.replace(' ', 'T') + 'Z') - new Date(s15.snapshot_time.replace(' ', 'T') + 'Z')) / 60000));
  const spend = Math.max(0, (s0.spend || 0) - (s15.spend || 0));
  const conv = Math.max(0, (s0.convert_cnt || 0) - (s15.convert_cnt || 0));
  const bucketEnd = new Date(t0).toISOString().slice(0, 16).replace('T', ' ');
  d.prepare(`
    INSERT INTO agg_15min (bucket_end_cst, account_id, minutes, spend, conv, computed_at)
    VALUES (@b, @a, @minutes, @spend, @conv, @now)
    ON CONFLICT(bucket_end_cst, account_id) DO UPDATE SET
      minutes=excluded.minutes, spend=excluded.spend, conv=excluded.conv, computed_at=excluded.computed_at
  `).run({ b: bucketEnd, a: ACCOUNT_ID, minutes, spend, conv, now: new Date().toISOString() });
  // 环比 (prev 桶 = [t-30, t-15]) 存 conv 差供查询
  if (s30) {
    const prevSpend = Math.max(0, (s15.spend || 0) - (s30.spend || 0));
    const prevEnd = new Date(t0 - 3 * FIVE).toISOString().slice(0, 16).replace('T', ' ');
    d.prepare(`
      INSERT INTO agg_15min (bucket_end_cst, account_id, minutes, spend, conv, computed_at)
      VALUES (@b, @a, @minutes, @spend, @conv, @now)
      ON CONFLICT(bucket_end_cst, account_id) DO UPDATE SET
        minutes=excluded.minutes, spend=excluded.spend, conv=excluded.conv, computed_at=excluded.computed_at
    `).run({ b: prevEnd, a: ACCOUNT_ID, minutes: 15, spend: prevSpend, conv: 0, now: new Date().toISOString() });
  }
}
function FIVE_MS() { return 5 * 60000; }

// ===== Step2: agg_shift (复用 buildShiftData) =====
function calcShift() {
  const today = nowCstDate();
  let rows;
  try { rows = buildShiftData(today, DATA_DIR, DB_PATH); } catch (e) { console.warn('[calc] shift 失败:', e.message); return; }
  const d = db();
  const now = new Date().toISOString();
  const up = d.prepare(`
    INSERT INTO agg_shift (cst_date, account_id, shift_label, anchor, car_model, spend, leads, cpl, cpm, ctr, progress, corrected, computed_at)
    VALUES (@cst_date, @account_id, @shift_label, @anchor, @car_model, @spend, @leads, @cpl, @cpm, @ctr, @progress, @corrected, @computed_at)
    ON CONFLICT(cst_date, account_id, shift_label) DO UPDATE SET
      anchor=excluded.anchor, car_model=excluded.car_model, spend=excluded.spend, leads=excluded.leads,
      cpl=excluded.cpl, cpm=excluded.cpm, ctr=excluded.ctr, progress=excluded.progress,
      corrected=excluded.corrected, computed_at=excluded.computed_at
  `);
  const tx = d.transaction(() => {
    for (const s of (rows || [])) {
      up.run({
        cst_date: today, account_id: ACCOUNT_ID, shift_label: s.label, anchor: s.anchor,
        car_model: s.car_model || '', spend: s.spend || 0, leads: s.leads || 0, cpl: s.cpl || 0,
        cpm: s.cpm || 0, ctr: s.ctr || 0, progress: s.progress || 0, corrected: s.corrected ? 1 : 0,
        computed_at: now,
      });
    }
  });
  tx();
}

// ===== Step3: agg_daily_model =====
async function calcDailyModel() {
  const d = db();
  const today = nowCstDate();
  const now = new Date().toISOString();
  const up = d.prepare(`
    INSERT INTO agg_daily_model (cst_date, account_id, model, cost, leads, session_count, computed_at)
    VALUES (@cst_date, @account_id, @model, @cost, @leads, @session_count, @computed_at)
    ON CONFLICT(cst_date, account_id, model) DO UPDATE SET
      cost=excluded.cost, leads=excluded.leads, session_count=excluded.session_count, computed_at=excluded.computed_at
  `);

  // -- 福利号: promotion_daily 按 model_rules 聚合 (fallback αT7)
  const plans = d.prepare('SELECT campaign_name, cost, leads FROM promotion_daily WHERE cst_date=? AND account_id=?').all(today, FU_LI_ACC);
  const fuAgg = Object.fromEntries(MODELS.map(m => [m, { cost: 0, leads: 0 }]));
  for (const p of plans) {
    const m = classifyByRules(p.campaign_name, 'αT7');
    if (fuAgg[m]) { fuAgg[m].cost += Number(p.cost) || 0; fuAgg[m].leads += Number(p.leads) || 0; }
  }
  for (const m of MODELS) {
    up.run({ cst_date: today, account_id: FU_LI_ACC, model: m, cost: fuAgg[m].cost, leads: fuAgg[m].leads, session_count: 0, computed_at: now });
  }

  // -- AI区域号: statQuery 今日消耗 × 场次数占比
  let cookieData;
  try { cookieData = await getCookieData(); } catch (e) { console.warn('[calc] cookie 失败:', e.message); return; }
  const headers = { ...cookieData.headers, 'Content-Type': 'application/json', Referer: 'https://ad.oceanengine.com/' };
  headers['Cookie'] = headers['Cookie'].replace(/[^\x20-\x7E]/g, '');
  const csrf = headers['Cookie'].match(/passport_csrf_token=([^;]+)/)?.[1];
  if (csrf && !/csrftoken=/.test(headers['Cookie'])) headers['Cookie'] += '; csrftoken=' + csrf;
  for (const [name, acc] of REGIONS) {
    const body = {
      DataSetKey: 'basic_ad_data', Dimensions: ['stat_time_day'],
      EndTime: today + ' 23:59:59',
      Filters: { ConditionRelationshipType: 1, Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [acc] }] },
      IsDownload: false, Metrics: ['stat_cost'],
      PageParams: { Limit: 10, Offset: 0 },
      StartTime: today + ' 00:00:00', Extra: { is_fill_zero: 'true', refer: '' },
    };
    try {
      const res = await fetch(API_BASE + '/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=' + acc, { method: 'POST', headers, body: JSON.stringify(body) });
      const j = await res.json().catch(() => null);
      const rr = j?.data?.StatsData?.Rows || [];
      let cost = 0;
      for (const r of rr) cost += parseFloat(String(r.Metrics?.stat_cost?.Value ?? r.Metrics?.stat_cost?.ValueStr ?? 0).replace(/,/g, '')) || 0;
      const sessions = d.prepare('SELECT car_model, COUNT(*) n FROM shift_schedule WHERE cst_date=? AND region_name=? GROUP BY car_model').all(today, name);
      const totS = sessions.reduce((a, x) => a + x.n, 0);
      for (const m of MODELS) {
        const cnt = (sessions.find(x => x.car_model === m) || {}).n || 0;
        up.run({ cst_date: today, account_id: acc, model: m, cost: totS ? cost * cnt / totS : 0, leads: 0, session_count: cnt, computed_at: now });
      }
    } catch (e) { console.warn(`[calc] ${name} statQuery 失败:`, e.message); }
  }
}

// ===== Step4: agg_month_cum (1号至当日) =====
function calcMonthCum() {
  const d = db();
  const today = nowCstDate();
  const accounts = [FU_LI_ACC, ...REGIONS.map(([, a]) => a)];
  const up = d.prepare(`
    INSERT INTO agg_month_cum (cst_date, account_id, model, month_cost, month_leads, computed_at)
    VALUES (@cst_date, @account_id, @model, @month_cost, @month_leads, @computed_at)
    ON CONFLICT(cst_date, account_id, model) DO UPDATE SET
      month_cost=excluded.month_cost, month_leads=excluded.month_leads, computed_at=excluded.computed_at
  `);
  const monthStart = today.slice(0, 8) + '01';
  const tx = d.transaction(() => {
    for (const acc of accounts) {
      const rows = d.prepare(`
        SELECT model, SUM(cost) cost, SUM(leads) leads FROM agg_daily_model
        WHERE account_id=? AND cst_date>=? AND cst_date<=? GROUP BY model
      `).all(acc, monthStart, today);
      const agg = Object.fromEntries(MODELS.map(m => [m, { c: 0, l: 0 }]));
      for (const r of rows) if (agg[r.model]) { agg[r.model].c = r.cost; agg[r.model].l = r.leads; }
      for (const m of MODELS) {
        up.run({ cst_date: today, account_id: acc, model: m, month_cost: agg[m].c, month_leads: agg[m].l, computed_at: new Date().toISOString() });
      }
    }
  });
  tx();
}

// ===== 对账: Σ车型 == official_daily =====
function reconcile() {
  const d = db();
  const today = nowCstDate();
  const off = d.prepare('SELECT cost FROM official_daily WHERE cst_date=? AND account_id=?').get(today, FU_LI_ACC);
  if (!off) return;
  const sum = d.prepare('SELECT SUM(cost) s FROM agg_daily_model WHERE cst_date=? AND account_id=?').get(today, FU_LI_ACC);
  const diff = Math.abs((sum.s || 0) - (off.cost || 0));
  if (off.cost > 0 && diff / off.cost > 0.01) {
    console.warn(`[calc] ⚠ 对账偏差: Σ车型=${Math.round(sum.s || 0)} vs 官方=${Math.round(off.cost)} (${(diff / off.cost * 100).toFixed(1)}%)`);
  }
}

// ===== 种子导入: 9/1-9/20 人工校准数据 (一次性) =====
function seedFromRegionJson() {
  const seedFile = path.join(DATA_DIR, '.seed-daily-model-done');
  if (fs.existsSync(seedFile)) return;
  const jsonFile = path.join(DATA_DIR, 'region-model-data.json');
  if (!fs.existsSync(jsonFile)) { fs.writeFileSync(seedFile, 'no-source'); return; }
  const j = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  const d = db();
  const up = d.prepare(`
    INSERT INTO agg_daily_model (cst_date, account_id, model, cost, leads, session_count, computed_at)
    VALUES (@cst_date, @account_id, @model, @cost, @leads, @session_count, @computed_at)
    ON CONFLICT(cst_date, account_id, model) DO UPDATE SET
      cost=excluded.cost, leads=excluded.leads, session_count=excluded.session_count, computed_at=excluded.computed_at
  `);
  const now = new Date().toISOString();
  const tx = d.transaction(() => {
    for (const [name, days] of Object.entries(j.regionModel)) {
      const acc = REGIONS.find(([n]) => n === name)?.[1];
      if (!acc) continue;
      for (const [di, split] of Object.entries(days)) {
        const cst = j.days[Number(di) - 1];
        if (!cst) continue;
        for (const m of MODELS) {
          up.run({ cst_date: cst, account_id: acc, model: m, cost: split[m] || 0, leads: 0, session_count: 0, computed_at: now });
        }
      }
    }
    for (const [di, models] of Object.entries(j.fuLi)) {
      const cst = j.days[Number(di) - 1];
      if (!cst) continue;
      for (const m of MODELS) {
        up.run({ cst_date: cst, account_id: FU_LI_ACC, model: m, cost: models[m]?.cost || 0, leads: models[m]?.leads || 0, session_count: 0, computed_at: now });
      }
    }
  });
  tx();
  fs.writeFileSync(seedFile, 'seeded ' + new Date().toISOString());
  console.log('[calc] 种子导入完成 (9/1-9/20 人工校准数据)');
}

// ===== 主流程 =====
export async function runCalcEngine() {
  const lockFile = path.join(DATA_DIR, 'calc.lock');
  if (fs.existsSync(lockFile)) {
    const age = Date.now() - fs.statSync(lockFile).mtimeMs;
    if (age < 240000) return; // 4 分钟内锁有效
  }
  fs.writeFileSync(lockFile, new Date().toISOString());
  try {
    seedFromRegionJson();
    calc15min();
    calcShift();
    await calcDailyModel();
    calcMonthCum();
    reconcile();
    console.log('[calc] ✅ 核算完成');
  } catch (e) {
    console.error('[calc] ❌', e.message);
  } finally {
    try { fs.unlinkSync(lockFile); } catch {}
  }
}

// 直接执行
if (process.argv[1] && process.argv[1].endsWith('calc-engine.mjs')) {
  await runCalcEngine();
}
