// cloud-sync.mjs - 家里快照 → 云托管推送 v2 (20260916 对齐仪表盘规则)
// 数据源: 最新5m快照(账户/计划) + 近13个5m快照(15m/1h增量) + hourly_stats(班次/周/昨日) + actions(执行记录)
// 调度: PM2 pm2-cloud-sync, cron 2-59/15
// .env: CLOUDRUN_URL, CLOUDRUN_API_KEY

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getCurrentAnchorName, getTodayShiftWindow, getLiveWindowLabel } from '../utils/monitor-utils.mjs';
import { httpPost, getCookieData, buildStatQueryBody, API_BASE } from '../services/ai-regions-api.mjs';
import Database from 'better-sqlite3';

const CLOUDRUN_URL = (process.env.CLOUDRUN_URL || '').replace(/\/+$/, '');
const CLOUDRUN_API_KEY = process.env.CLOUDRUN_API_KEY || '';
const DB_PATH = path.join(DATA_DIR, 'oceanengine.db');

const LIVE_START = 7, LIVE_END = 23; // 排班读取失败时的兜底窗口

// ---------- 快照读取 ----------

function listSnapshots() {
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith('5m-') && f.endsWith('.json'))
    .sort();
}

// 最近 n 个快照(新→旧), 含 mtime; 解析失败跳过
function readRecentSnaps(files, n) {
  const out = [];
  for (let i = files.length - 1; i >= 0 && out.length < n; i--) {
    try {
      const p = path.join(DATA_DIR, files[i]);
      out.push({
        mtime: fs.statSync(p).mtimeMs,
        data: JSON.parse(fs.readFileSync(p, 'utf-8'))
      });
    } catch {}
  }
  return out;
}

function fmtHM(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 单快照点击数推算: clicks_i = 曝光_i × ctr_i, 曝光_i = spend_i × 1000 / cpm_i
function estClicks(snap) {
  let clicks = 0;
  for (const c of (snap?.campaigns || [])) {
    const cs = Number(c.spend) || 0;
    const cpmI = Number(c.cpm) || 0;
    const ctrI = Number(c.ctr) || 0;
    if (cpmI > 0 && cs > 0) clicks += (cs * 1000 / cpmI) * (ctrI > 1 ? ctrI / 100 : ctrI);
  }
  return clicks;
}

// 两快照差值 (15分钟窗口基础量)
function windowDiff(a, b) {
  const num = (o, k) => Number(o?.[k]) || 0;
  const sum = (o, k) => (o?.campaigns || []).reduce((s, c) => s + (Number(c[k]) || 0), 0);
  const spend = +(num(a, 'accountSpend') - num(b, 'accountSpend')).toFixed(2);
  const impr = num(a, 'impressions') - num(b, 'impressions');
  const clicks = Math.round(estClicks(a) - estClicks(b));
  return {
    spend,
    leads: num(a, 'totalConv') - num(b, 'totalConv'),
    opens: sum(a, 'privateMsgOpen') - sum(b, 'privateMsgOpen'),
    impr,
    clicks,
    cpm: impr > 0 ? +((spend / impr) * 1000).toFixed(1) : 0,
    ctr: impr > 0 ? +((clicks / impr) * 100).toFixed(2) : 0
  };
}

const deltaPct = (cur, prev) => (prev > 0 && cur >= 0) ? +(((cur - prev) / prev) * 100).toFixed(1) : null;

// ---------- 近15分钟 (铁律: 最近3个5分钟桶, 速率按真实分钟) + 上一轮窗口环比 ----------

function last15Module(snaps) {
  if (snaps.length < 2) {
    return { minutes: 0, spend: 0, leads: 0, opens: 0, cpm: 0, ctr: 0, impr: 0, clicks: 0, speed_1h: 0, deltas: null, top5: [] };
  }
  const idx = Math.min(2, snaps.length - 1);
  const minutes = Math.max(1, Math.round((snaps[0].mtime - snaps[idx].mtime) / 60000));

  // 本轮窗口: snaps[0] - snaps[2]; 上一轮窗口: snaps[3] - snaps[5] (用于环比)
  const cur = windowDiff(snaps[0].data, snaps[idx].data);
  let prev = null, deltas = null;
  if (snaps.length >= 6) {
    const p = windowDiff(snaps[3].data, snaps[5].data);
    if (p.spend > 0 || p.leads > 0 || p.opens > 0) {
      prev = p;
      deltas = {
        spend: deltaPct(cur.spend, p.spend),
        leads: deltaPct(cur.leads, p.leads),
        opens: deltaPct(cur.opens, p.opens),
        cpm: deltaPct(cur.cpm, p.cpm),
        ctr: deltaPct(cur.ctr, p.ctr)
      };
    }
  }

  // 近1小时均速 (12桶真实分钟)
  const hIdx = Math.min(12, snaps.length - 1);
  const hourMs = Math.max(1, snaps[0].mtime - snaps[hIdx].mtime);
  const hourSpend = (Number(snaps[0].data.accountSpend) || 0) - (Number(snaps[hIdx].data.accountSpend) || 0);

  // 计划级增量 TOP5 (桶内需有明细): 消耗/线索增量 + CPL + 无转化预警(消耗≥300且0线索) + 与上一轮窗口环比
  const top5 = [];
  const newC = Array.isArray(snaps[0].data.campaigns) && snaps[0].data.campaigns.length ? snaps[0].data.campaigns : null;
  const oldC = Array.isArray(snaps[idx].data.campaigns) && snaps[idx].data.campaigns.length ? snaps[idx].data.campaigns : null;
  // 上一轮窗口两端快照的计划明细 (环比同口径: 本轮15m增量 vs 上轮15m增量)
  const hasPrevWin = snaps.length >= 6;
  const prevNewC = hasPrevWin && Array.isArray(snaps[3].data.campaigns) && snaps[3].data.campaigns.length ? snaps[3].data.campaigns : null;
  const prevOldC = hasPrevWin && Array.isArray(snaps[5].data.campaigns) && snaps[5].data.campaigns.length ? snaps[5].data.campaigns : null;
  if (newC && oldC) {
    const oldMap = new Map(oldC.map(c => [String(c.id), c]));
    const prevNewMap = prevNewC && prevOldC ? new Map(prevNewC.map(c => [String(c.id), Number(c.spend) || 0])) : null;
    const prevOldMap = prevNewC && prevOldC ? new Map(prevOldC.map(c => [String(c.id), Number(c.spend) || 0])) : null;
    top5.push(...newC
      .map(c => {
        const oc = oldMap.get(String(c.id));
        const cost = +(((Number(c.spend) || 0) - (Number(oc?.spend) || 0)).toFixed(2));
        const leads = (Number(c.leads) || 0) - (Number(oc?.leads) || 0);
        // 计划消耗环比: 本轮增量 vs 上轮增量 (上轮有该计划数据且>0 才算)
        let delta = null;
        if (prevNewMap && prevNewMap.has(String(c.id))) {
          const prevCost = +((prevNewMap.get(String(c.id)) - (prevOldMap.get(String(c.id)) ?? 0)).toFixed(2));
          if (prevCost > 0) delta = +(((cost - prevCost) / prevCost) * 100).toFixed(1);
        }
        return {
          name: c.name || '',
          cost,
          leads,
          delta,
          cpl: leads > 0 ? +(cost / leads).toFixed(0) : null, // 无转化不显示
          warn: cost >= 300 && leads <= 0
        };
      })
      .filter(x => x.cost > 0)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5));
  }

  return {
    minutes,
    spend: cur.spend,
    leads: cur.leads,
    opens: cur.opens,
    impr: cur.impr,
    clicks: cur.clicks,
    cpm: cur.cpm,
    ctr: cur.ctr,
    speed_15m: +(cur.spend / minutes).toFixed(1),
    speed_1h: +(hourSpend / (hourMs / 60000)).toFixed(1),
    deltas,
    top5
  };
}

// ---------- 1小时趋势 (5分钟增量, 12点) ----------

function hourlyTrendModule(snaps) {
  const pts = [];
  for (let i = 0; i + 1 < snaps.length && pts.length < 12; i++) {
    const a = Number(snaps[i].data.accountSpend) || 0;
    const b = Number(snaps[i + 1].data.accountSpend) || 0;
    pts.push({ t: fmtHM(snaps[i].mtime), cost: Math.max(0, +(a - b).toFixed(2)) });
  }
  return pts.reverse(); // 旧→新
}

// ---------- hourly_stats → 北京小时桶/北京日期聚合 ----------

function loadHourlyBuckets(db, days = 9, bjToday = null) {
  const nowUtc = new Date();
  const since = new Date(nowUtc.getTime() - days * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT stat_date, stat_hour, SUM(cost) AS cost, SUM(leads) AS leads
    FROM hourly_stats WHERE stat_date >= ? GROUP BY stat_date, stat_hour
  `).all(since);
  // → 两个索引: 北京小时桶(仅bjToday, 用于今日班次) + 北京日期聚合(近N日)
  const byBjHour = new Map();
  const byBjDate = new Map();
  const add = (m, k, cost, leads) => {
    const cur = m.get(k) || { cost: 0, leads: 0 };
    cur.cost += cost; cur.leads += leads;
    m.set(k, cur);
  };
  for (const r of rows) {
    const uh = Number(String(r.stat_hour).split('T')[1]) || 0;
    const cost = Number(r.cost) || 0, leads = Number(r.leads) || 0;
    // 北京日期: UTC 16:00 = 北京 0:00 → uh>=16 跨入北京次日, 否则即 stat_date 当日
    const bjDay = uh >= 16
      ? new Date(new Date(r.stat_date + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
      : r.stat_date;
    add(byBjDate, bjDay, cost, leads);
    if (bjToday && bjDay === bjToday) add(byBjHour, String((uh + 8) % 24), cost, leads);
  }
  return { byBjHour, byBjDate };
}

// ---------- 主播班次明细 (排班表班次 × 今日小时桶) ----------

function shiftsModule(db, bjToday) {
  try {
    if (!bjToday) return [];
    const cacheFile = path.join(DATA_DIR, `shifts-${bjToday}.json`);
    if (!fs.existsSync(cacheFile)) return [];
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const { byBjHour } = loadHourlyBuckets(db, 2, bjToday);
    return (cached.shifts || []).map(s => {
      // 班次与小时桶按分钟重叠权重分摊, 避免边界桶(如 7 点桶被 5:30-7:30 与 7:30-9:30 重复计入)
      const parts = (s.label || '').split('-');
      const p0 = (parts[0] || '').split(':').map(Number);
      const p1 = (parts[1] || '').split(':').map(Number);
      const s0 = (p0[0] || 0) * 60 + (p0[1] || 0);
      const s1 = (p1[0] || 0) * 60 + (p1[1] || 0);
      let cost = 0, leads = 0;
      for (const h of (s.hours || [])) {
        const b0 = h * 60, b1 = b0 + 60;
        const ov = Math.max(0, Math.min(s1, b1) - Math.max(s0, b0));
        if (ov <= 0) continue;
        const v = byBjHour.get(String(h));
        if (v) { cost += v.cost * (ov / 60); leads += v.leads * (ov / 60); }
      }
      return {
        label: s.label || '',
        anchor: s.anchorName || '',
        spend: +cost.toFixed(0),
        leads: Math.round(leads),
        cpl: leads > 0 ? +(cost / leads).toFixed(1) : 0
      };
    });
  } catch (e) {
    console.warn('[cloud-sync] 班次聚合失败:', e.message);
    return [];
  }
}

// ---------- 投放形式明细 (按计划名关键词分组) ----------

const FORMAT_RULES = [
  { key: '画面直投', match: /画面直投/ },
  { key: '短视频引流', match: /短引直|短视频/ },
  { key: '简单投', match: /简单投/ },
  { key: '问答互动', match: /问答|互动/ },
];

function formatsModule(campaigns) {
  const m = new Map();
  for (const c of campaigns) {
    const rule = FORMAT_RULES.find(r => r.match.test(c.name));
    const key = rule ? rule.key : '其他';
    const cur = m.get(key) || { name: key, count: 0, cost: 0, leads: 0 };
    cur.count++; cur.cost += c.cost; cur.leads += c.leads;
    m.set(key, cur);
  }
  return [...m.values()]
    .map(x => ({ ...x, cost: +x.cost.toFixed(0), cpl: x.leads > 0 ? +(x.cost / x.leads).toFixed(1) : 0 }))
    .sort((a, b) => b.cost - a.cost);
}

// ---------- 近7日汇总 ----------

function weeklyModule(byBjDate) {
  const out = [];
  const bjNow = Date.now() + 8 * 3600000;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(bjNow - i * 86400000).toISOString().slice(0, 10);
    const v = byBjDate.get(d) || { cost: 0, leads: 0 };
    out.push({ date: d.slice(5).replace('-', '/'), cost: +(v.cost).toFixed(0), leads: v.leads });
  }
  return out;
}

// ---------- 执行记录 (actions 表 + 计划名映射) ----------

const ACTION_TEXT = { pause: '暂停计划', stop: '暂停计划', resume: '启用计划', update_budget: '调整预算', update_bid: '调整出价' };

function actionLogsModule(db) {
  try {
    const nameMap = new Map(
      db.prepare('SELECT campaign_id, name FROM campaigns').all()
        .map(r => [r.campaign_id, r.name])
    );
    return db.prepare(`
      SELECT action_time, action_type, campaign_id, before_value, after_value, status
      FROM actions ORDER BY id DESC LIMIT 20
    `).all().map(r => {
      let detail = '';
      try {
        const b = JSON.parse(r.before_value || '{}');
        const a = JSON.parse(r.after_value || '{}');
        if (a.budget && b.budget && a.budget !== b.budget) detail = `预算 ¥${b.budget} → ¥${a.budget}`;
        else if (a.status && b.status && a.status !== b.status) detail = `状态 ${b.status} → ${a.status}`;
      } catch {}
      return {
        time: fmtHM(r.action_time),
        type: ACTION_TEXT[r.action_type] || r.action_type,
        name: nameMap.get(r.campaign_id) || r.campaign_id || '',
        detail,
        status: r.status || ''
      };
    });
  } catch (e) {
    console.warn('[cloud-sync] 执行记录读取失败:', e.message);
    return [];
  }
}

// ---------- 昨日数据三级口径链 ----------
// ① 数据中心报表(权威, 复用 AI 区域号日报的 statQuery 链路)
// ② 昨夜最后快照 accountSpend(页头口径)
// ③ hourly_stats 聚合(计划加总口径)

async function yesterdayFromDataCenter(bjYesterday) {
  try {
    const aadvid = process.env.OEC_ACCOUNT_ID || '1842681352509635';
    const cookieData = await getCookieData();
    const url = `${API_BASE}/report/api/tool/agw/statistics_sophonx/statQuery?aadvid=${aadvid}`;
    const resp = await httpPost(url, buildStatQueryBody(aadvid, bjYesterday), cookieData, 15000);
    if (resp.code && resp.code !== 0 && resp.code !== 200) throw new Error('code=' + resp.code);
    const rows = resp?.data?.StatsData?.Rows || [];
    let cost = 0, leads = 0;
    for (const row of rows) {
      const m = row.Metrics || {};
      cost += parseFloat((m.stat_cost?.ValueStr || '0').replace(/,/g, '')) || 0;
      leads += parseInt((m.convert_cnt?.ValueStr || '0').replace(/,/g, '')) || 0;
    }
    if (cost <= 0) throw new Error('数据中心昨日无数据');
    return { cost: Math.round(cost), leads, source: 'datacenter' };
  } catch (e) {
    console.warn('[cloud-sync] 数据中心昨日报表失败:', e.message);
    return null;
  }
}

// 昨夜最后快照 (UTC 15 点档 = 北京 23 点, 下播收尾后的最终页头累计)
function yesterdayFromSnapshot(files) {
  try {
    const ymd = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let best = null;
    for (const f of files) {
      const m = f.match(/^5m-(\d{4}-\d{2}-\d{2})T(\d{2})-/);
      if (!m || m[1] !== ymd || Number(m[2]) !== 15) continue;
      best = f; // files 升序, 取最后匹配
    }
    if (best) {
      const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, best), 'utf-8'));
      if (Number(d.accountSpend) > 0) {
        return { cost: Math.round(Number(d.accountSpend)), leads: Number(d.totalConv) || 0, source: 'snapshot' };
      }
    }
  } catch {}
  return null;
}

// ---------- 近7日按计划×北京日聚合 (供计划详情: 昨日对比 + 周趋势) ----------

function loadCampaignDaily(db, days = 8) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT stat_date, stat_hour, campaign_id, SUM(cost) AS cost, SUM(leads) AS leads
    FROM hourly_stats WHERE stat_date >= ?
    GROUP BY stat_date, stat_hour, campaign_id
  `).all(since);
  // key: campaignId -> { 'YYYY-MM-DD': {cost, leads} }
  const map = new Map();
  for (const r of rows) {
    const uh = Number(String(r.stat_hour).split('T')[1]) || 0;
    const bjDay = uh >= 16
      ? new Date(new Date(r.stat_date + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
      : r.stat_date;
    let byDay = map.get(r.campaign_id);
    if (!byDay) { byDay = new Map(); map.set(r.campaign_id, byDay); }
    const cur = byDay.get(bjDay) || { cost: 0, leads: 0 };
    cur.cost += Number(r.cost) || 0;
    cur.leads += Number(r.leads) || 0;
    byDay.set(bjDay, cur);
  }
  return map;
}

// ---------- 主组装 ----------

function buildPayload(snap, prev, yesterday) {
  const now = new Date();
  const hour = now.getHours();

  // 排班窗口
  const win = (() => { try { return getTodayShiftWindow(); } catch { return null; } })()
    || { startHour: LIVE_START, startMinute: 0, endHour: LIVE_END, endMinute: 0 };
  const liveLabel = (() => { try { return getLiveWindowLabel(); } catch { return null; } })();
  const startMin = win.startHour * 60 + (win.startMinute || 0);
  const endMin = win.endHour * 60 + (win.endMinute || 0);
  const nowMin = hour * 60 + now.getMinutes();
  const timeProgress = Math.max(0, Math.min(100, (nowMin - startMin) / Math.max(endMin - startMin, 1) * 100));

  const spend = Number(snap.accountSpend) || 0;
  const budget = Number(snap.accountBudget) || 0;
  const conv = Number(snap.totalConv) || 0;
  const impressions = Number(snap.impressions) || 0;
  const cpa = conv > 0 ? spend / conv : 0;

  // 15分钟/趋势
  const files = listSnapshots();
  const snaps = readRecentSnaps(files, 13);
  const last15 = last15Module(snaps);
  const hourlyTrend = hourlyTrendModule(snaps);
  const speed15 = last15.minutes > 0 ? +(last15.spend / last15.minutes).toFixed(1) : 0;
  const elapsedMin = Math.max(1, nowMin - startMin);
  const avgSpeed = +(spend / elapsedMin).toFixed(1);

  // 开口/留资 (逐计划加总)
  const opens = (snap.campaigns || []).reduce((s, c) => s + (Number(c.privateMsgOpen) || 0), 0);
  const retains = (snap.campaigns || []).reduce((s, c) => s + (Number(c.privateMsgRetain) || 0), 0);
  const forms = (snap.campaigns || []).reduce((s, c) => s + (Number(c.formSubmit) || 0), 0);
  const comments = (snap.campaigns || []).reduce((s, c) => s + (Number(c.liveComments) || 0), 0);
  const retainRate = opens > 0 ? +(retains / opens * 100).toFixed(1) : 0;

  // CPL / 开口成本 / 千展 / 点击率 (花费加权)
  const cpl = conv > 0 ? +(spend / conv).toFixed(1) : 0;
  const openCost = opens > 0 ? +(spend / opens).toFixed(1) : 0;
  let wCtr = 0, wCpm = 0, wSum = 0;
  for (const c of (snap.campaigns || [])) {
    const cs = Number(c.spend) || 0;
    if (cs <= 0) continue;
    wCtr += (Number(c.ctr) || 0) * cs;
    wCpm += (Number(c.cpm) || 0) * cs;
    wSum += cs;
  }
  const ctr = wSum > 0 ? +(wCtr / wSum * 100).toFixed(2) : 0;
  const cpm = wSum > 0 ? +(wCpm / wSum).toFixed(1) : 0;

  // 点击数推算: clicks_i = 曝光_i × ctr_i, 曝光_i = spend_i × 1000 / cpm_i (计划级求和)
  let clicks = 0;
  for (const c of (snap.campaigns || [])) {
    const cs = Number(c.spend) || 0;
    const cpmI = Number(c.cpm) || 0;
    const ctrI = Number(c.ctr) || 0;
    if (cpmI > 0 && cs > 0) {
      const imprI = cs * 1000 / cpmI;
      clicks += imprI * (ctrI > 1 ? ctrI / 100 : ctrI);
    }
  }
  clicks = Math.round(clicks);

  // CPA 环比 (30m 前, 平台当日累计口径)
  let cpaDelta = 0;
  if (prev) {
    const prevConv = Number(prev.totalConv) || 0;
    const prevSpend = Number(prev.accountSpend) || 0;
    if (prevConv > 0 && conv > 0) {
      const cpaPrev = prevSpend / prevConv;
      if (cpaPrev > 0) cpaDelta = +((cpa / cpaPrev - 1) * 100).toFixed(1);
    }
  }

  // 计划明细 (含形式分类/昨日对比/近7日趋势)
  const campaignSource = (Array.isArray(snap.campaigns) && snap.campaigns.length) ? snap.campaigns : [];
  let campDaily = null;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    campDaily = loadCampaignDaily(db, 8);
    db.close();
  } catch (e) {
    console.warn('[cloud-sync] 计划历史聚合失败:', e.message);
  }
  const bjYesterday = new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10);
  const campaigns = campaignSource.slice(0, 200).map(c => {
    const cs = Number(c.spend) || 0;
    const cc = Number(c.conversions) || 0;
    const st = String(c.status || '');
    const rule = FORMAT_RULES.find(r => r.match.test(c.name || ''));
    const cid = String(c.id ?? '');
    const yd = campDaily?.get(cid)?.get(bjYesterday) || { cost: 0, leads: 0 };
    return {
      campaign_id: cid,
      name: c.name || '',
      type: rule ? rule.key : '其他',
      status: (st === '投放中' || st === '启用') ? '投放中' : '已暂停',
      cost: cs,
      budget: Number(c.budget) || 0,
      leads: Number(c.leads) || 0,
      opens: Number(c.privateMsgOpen) || 0,
      retains: Number(c.privateMsgRetain) || 0,
      cpa: cc > 0 ? +(cs / cc).toFixed(2) : 0,
      cpa_delta_pct: 0,
      ctr: Number(c.ctr) > 1 ? +(Number(c.ctr)).toFixed(2) : +(Number(c.ctr) * 100).toFixed(2),
      cpm: +(Number(c.cpm) || 0).toFixed(1),
      yesterday_cost: Math.round(yd.cost || 0),
      yesterday_leads: yd.leads || 0,
      updated_at: snap.time || now.toISOString()
    };
  });
  // 近8日趋势(含今日)全量附加: 未启动计划也能看昨日/近3天/近7天历史
  for (const c of campaigns) {
    if (!campDaily) continue;
    const byDay = campDaily.get(c.campaign_id);
    if (!byDay) continue;
    c.week = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(Date.now() + 8 * 3600000 - i * 86400000).toISOString().slice(0, 10);
      const v = byDay.get(d) || { cost: 0, leads: 0 };
      c.week.push({ d: d.slice(5).replace('-', '/'), cost: Math.round(v.cost), leads: v.leads });
    }
  }

  // DB 模块 (单连接复用) + 昨日三级口径
  let yesterdayCost = 0, yesterdayLeads = 0, weekly = [], shifts = [], actionLogs = [];
  try {
    const bjToday = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const bjYesterday = new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10);
    const db = new Database(DB_PATH, { readonly: true });
    const { byBjHour, byBjDate } = loadHourlyBuckets(db, 9, bjToday);
    // 昨日: ①数据中心报表(main 已拉, 传入) ②昨夜快照(main 已判) ③hourly聚合(此处兜底)
    const yd = yesterday || (() => {
      const v = byBjDate.get(bjYesterday) || {};
      return { cost: Math.round(v.cost || 0), leads: v.leads || 0, source: 'hourly' };
    })();
    yesterdayCost = yd.cost; yesterdayLeads = yd.leads;
    console.log(`[cloud-sync] 昨日口径: ${yd.source} 消耗¥${yd.cost} 线索${yd.leads}`);
    weekly = weeklyModule(byBjDate);
    shifts = shiftsModule(db, bjToday);
    actionLogs = actionLogsModule(db);
    db.close();
  } catch (e) {
    console.warn('[cloud-sync] DB 模块失败:', e.message);
  }

  const anchor = (() => { try { return getCurrentAnchorName(); } catch { return ''; } })();

  return {
    updated_at: now.toISOString(),
    live_status: `直播中 · ${anchor || '待确认班次'}`,
    live_window: liveLabel
      ? { start: liveLabel.startTime, end: liveLabel.endTime, duration: liveLabel.durationHours }
      : null,
    summary: {
      cost: +spend.toFixed(2),
      yesterday_cost: yesterdayCost,
      yesterday_leads: yesterdayLeads,
      budget,
      cost_progress: budget > 0 ? Math.round(spend / budget * 100) : 0,
      leads: conv,
      retain_rate: retainRate,
      cpl, open_cost: openCost, cpm, ctr,
      opens,
      retains, forms,
      cpa: +cpa.toFixed(2),
      cpa_delta_pct: cpaDelta,
      speed_15m: speed15,
      avg_speed: avgSpeed,
      time_progress: Math.round(timeProgress),
      // 整场明细: 漏斗 + 直播互动 + 账户
      impressions,
      clicks,
      live_views: Number(snap.liveViews) || 0,
      live_1min: Number(snap.liveOver1Min) || 0,
      comments,
      balance: Number(snap.accountBalance) || 0,
      // 在投 = 计划状态为启用(投放中); 今日有消耗 = cost>0 (两者口径不同)
      spending_count: campaigns.filter(c => c.status === '投放中').length,
      spending_today: campaigns.filter(c => c.cost > 0).length
    },
    pacing: (() => {
      const budgetUsed = budget > 0 ? Math.round(spend / budget * 100) : 0;
      const tp = Math.round(timeProgress);
      let health = 'good', healthText = '节奏健康';
      if (tp >= 10 && budgetUsed > tp * 1.5) { health = 'fast'; healthText = '消耗偏快'; }
      else if (tp >= 30 && budgetUsed < tp * 0.6) { health = 'slow'; healthText = '消耗偏慢'; }
      return {
        time_progress: tp,
        budget_used: budgetUsed,
        health, health_text: healthText,
        projected_daily: tp > 5 ? Math.round(spend / tp * 100) : 0
      };
    })(),
    last15,
    hourly_trend: hourlyTrend,
    weekly,
    shifts,
    formats: formatsModule(campaigns),
    campaigns,
    action_logs: actionLogs,
    alerts: []
  };
}

// ---------- 今日告警 ----------

function todayAlerts() {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const rows = db.prepare(`
      SELECT id, alert_time, alert_type, severity, campaign_id, message
      FROM alerts
      WHERE datetime(alert_time, '+8 hours') >= ? || ' 00:00:00' AND resolved = 0
      ORDER BY alert_time DESC LIMIT 50
    `).all(today);
    db.close();
    return rows.map(r => ({
      alert_id: String(r.id),
      severity: r.severity || 'low',
      type: r.alert_type || '',
      campaign: r.campaign_id || '',
      time: fmtHM(r.alert_time),
      message: r.message || ''
    }));
  } catch (e) {
    console.warn('[cloud-sync] 读 alerts 失败:', e.message);
    return [];
  }
}

async function push(payload) {
  const res = await fetch(`${CLOUDRUN_URL}/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': CLOUDRUN_API_KEY
    },
    // 服务端契约: summary=完整dashboard payload / campaigns=计划数组 / alerts=告警数组
    body: JSON.stringify({
      summary: payload,
      campaigns: payload.campaigns,
      alerts: payload.alerts
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  if (!CLOUDRUN_URL || !CLOUDRUN_API_KEY) {
    console.error('[cloud-sync] 缺少 CLOUDRUN_URL / CLOUDRUN_API_KEY (.env), 跳过');
    process.exit(1);
  }
  try {
    const files = listSnapshots();
    const latest = files[files.length - 1];
    const mtime = fs.statSync(path.join(DATA_DIR, latest)).mtimeMs;
    if (Date.now() - mtime > 40 * 60 * 1000) throw new Error(`最新快照已陈旧: ${latest}`);
    const snap = JSON.parse(fs.readFileSync(path.join(DATA_DIR, latest), 'utf-8'));
    const bjYesterday = new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10);
    // 昨日: ①数据中心报表(权威) ②昨夜快照(页头口径); hourly 聚合兜底在 buildPayload 内
    const yesterday = (await yesterdayFromDataCenter(bjYesterday)) || yesterdayFromSnapshot(files);
    // 30m 前对比快照
    let prev = null;
    const nowMs = Date.now();
    for (let i = files.length - 2; i >= 0; i--) {
      const m = fs.statSync(path.join(DATA_DIR, files[i])).mtimeMs;
      const ageMin = (nowMs - m) / 60000;
      if (ageMin > 50) break;
      if (ageMin >= 25) {
        try { prev = JSON.parse(fs.readFileSync(path.join(DATA_DIR, files[i]), 'utf-8')); } catch {}
        break;
      }
    }
    const payload = buildPayload(snap, prev, yesterday);
    payload.alerts = todayAlerts();

    // 直播间场次列表 (CDP 采集直播分析页, 失败回退本地缓存)
    try {
      const { collectWebcastList, readWebcastCache, writeWebcastCache } = await import('../cdp/webcast-list.mjs');
      const rooms = await collectWebcastList();
      if (rooms.length) writeWebcastCache(rooms);
      payload.webcast_rooms = rooms.length ? rooms : readWebcastCache();
    } catch (e) {
      console.warn('[cloud-sync] 直播间列表采集失败, 用缓存:', e.message);
      try {
        const { readWebcastCache } = await import('../cdp/webcast-list.mjs');
        payload.webcast_rooms = readWebcastCache();
      } catch { payload.webcast_rooms = []; }
    }

    await push(payload);
    console.log(`[cloud-sync] ✅ 已推送 消耗=${payload.summary.cost} 昨日=${payload.summary.yesterday_cost} 15m=${payload.last15.spend} 速度${payload.summary.speed_15m}/分 计划=${payload.campaigns.length} 班次=${payload.shifts.length} 形式=${payload.formats.length} 周数据=${payload.weekly.length} 记录=${payload.action_logs.length} 场次=${(payload.webcast_rooms || []).length}`);
  } catch (e) {
    console.error('[cloud-sync] ❌ 推送失败:', e.message);
    process.exit(1);
  }
}

main();
