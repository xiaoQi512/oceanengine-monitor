// src/services/http-routes/api-snapshots.mjs - 快照查询 API
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { computeYesterdayBaseline } from '../../domain/baseline-analysis.mjs';
import { buildKpiCompare } from '../../domain/kpi-compare.mjs';

function readDailyLog(dataDir, dateStr) {
  if (!dataDir || !dateStr) return [];
  try {
    const file = path.join(dataDir, `daily-${dateStr}.json`);
    if (!fs.existsSync(file)) return [];
    const log = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(log) ? log : [];
  } catch {
    return [];
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function serveSnapshots(url, req, res, ctx) {
  const { getLatestSnapshot, get5mSnapshots, DB_PATH, DATA_DIR, getLocalDate } = ctx;

  if (url.pathname === '/api/snapshots') {
    try {
      const snap = getLatestSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify(snap || {}));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (url.pathname === '/api/snapshots/cpm-compare') {
    try {
      const snaps = get5mSnapshots(1);
      const latest = snaps.length ? snaps[snaps.length - 1] : null;
      const currentCpm = Number(latest?._recentCPM || latest?.cpm || 0);
      let yesterdayAvgCpm = 0;
      if (DB_PATH) {
        try {
          const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
          const row = db.prepare(`
            SELECT AVG(cpm) AS avgCpm
            FROM snapshots
            WHERE date(datetime(snapshot_time, '+8 hours')) = date('now', '+8 hours', '-1 day')
              AND source_type = '5min'
              AND cpm > 0
          `).get();
          yesterdayAvgCpm = Number(row?.avgCpm || 0);
          db.close();
        } catch (_) {
          // DB 不可用时返回 0，不阻塞仪表盘对比显示
        }
      }
      const deltaPct = currentCpm > 0 && yesterdayAvgCpm > 0
        ? Number((((currentCpm - yesterdayAvgCpm) / yesterdayAvgCpm) * 100).toFixed(1))
        : 0;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ currentCpm, yesterdayAvgCpm, deltaPct }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, currentCpm: 0, yesterdayAvgCpm: 0, deltaPct: 0 }));
    }
    return true;
  }

  if (url.pathname === '/api/snapshots/kpi-compare') {
    try {
      const snaps = get5mSnapshots(1);
      const latest = snaps.length ? snaps[snaps.length - 1] : null;
      const currentSpend = toNumber(latest?.accountSpend || latest?.summarySpend || latest?.summary?.totalSpend || 0);
      const currentBudget = toNumber(latest?.accountBudget || 0);
      const currentLeads = toNumber(latest?.totalLeads || latest?.totalConv || latest?.summary?.totalLeads || 0);
      const currentCpm = toNumber(latest?._recentCPM || latest?.cpm || latest?.avgCPM || 0);
      const currentSpeedPer5min = toNumber(latest?._rolling?.last5min || (latest?.speedCurrent ? latest.speedCurrent * 5 : 0));
      const currentCpl = currentLeads > 0 ? currentSpend / currentLeads : 0;
      const currentBudgetPct = currentBudget > 0 ? (currentSpend / currentBudget) * 100 : 0;

      const now = new Date();
      const yesterdayDate = typeof getLocalDate === 'function'
        ? getLocalDate(new Date(now.getTime() - 24 * 60 * 60 * 1000))
        : '';
      const yesterdayLog = readDailyLog(DATA_DIR, yesterdayDate);
      const baseline = computeYesterdayBaseline(yesterdayLog, now, yesterdayDate);
      const yesterdaySpend = toNumber(baseline?.totalSpend || 0);
      const yesterdayLeads = toNumber(baseline?.totalLeads || baseline?.totalConversions || 0);
      const yesterdayCpm = toNumber(baseline?.avgCPM || 0);
      const yesterdaySpeedPer5min = toNumber(baseline?.speedCurrent || 0) * 5;
      const yesterdayBudgetPct = currentBudget > 0
        ? (yesterdaySpend / currentBudget) * 100
        : toNumber(baseline?.budgetUsed || 0) * 100;
      const yesterdayCpl = yesterdayLeads > 0
        ? yesterdaySpend / yesterdayLeads
        : toNumber(baseline?.avgCPA || 0);

      const payload = buildKpiCompare({
        current: {
          spend: currentSpend,
          speed: currentSpeedPer5min,
          leads: currentLeads,
          cpl: currentCpl,
          cpm: currentCpm,
          budget: currentBudgetPct,
        },
        yesterday: {
          spend: yesterdaySpend,
          speed: yesterdaySpeedPer5min,
          leads: yesterdayLeads,
          cpl: yesterdayCpl,
          cpm: yesterdayCpm,
          budget: yesterdayBudgetPct,
        },
        compareDate: yesterdayDate,
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, compare: null }));
    }
    return true;
  }

  if (url.pathname === '/api/kpi/compare') {
    try {
      const snaps = get5mSnapshots(1);
      const latest = snaps.length ? snaps[snaps.length - 1] : null;
      const dailyBudget = Number(latest?.accountBudget || 60000);
      const currentSpeed = Number(latest?._rolling?.last5min || 0);
      const currentCpm = Number(latest?._recentCPM || 0);
      let today = { spend: 0, leads: 0 };
      let yesterday = { spend: 0, leads: 0 };
      let yesterdayCpm = 0;
      let yesterdayWindows = 0;
      if (DB_PATH) {
        try {
          const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
          const dayAggSql = (dayExpr) => `
            SELECT COALESCE(SUM(max_cost - min_cost), 0) AS spend,
                   COALESCE(SUM(max_leads - min_leads), 0) AS leads
            FROM (
              SELECT campaign_id,
                     MAX(cost) AS max_cost, MIN(cost) AS min_cost,
                     MAX(leads) AS max_leads, MIN(leads) AS min_leads
              FROM snapshots
              WHERE date(datetime(snapshot_time, '+8 hours')) = ${dayExpr}
                AND source_type = '5min'
              GROUP BY campaign_id
            )
          `;
          today = db.prepare(dayAggSql("date('now', '+8 hours')")).get() || today;
          yesterday = db.prepare(dayAggSql("date('now', '+8 hours', '-1 day')")).get() || yesterday;
          yesterdayCpm = Number(db.prepare(`
            SELECT AVG(cpm) AS avgCpm
            FROM snapshots
            WHERE date(datetime(snapshot_time, '+8 hours')) = date('now', '+8 hours', '-1 day')
              AND source_type = '5min'
              AND cpm > 0
          `).get()?.avgCpm || 0);
          yesterdayWindows = Number(db.prepare(`
            SELECT COUNT(DISTINCT snapshot_time) AS n
            FROM snapshots
            WHERE date(datetime(snapshot_time, '+8 hours')) = date('now', '+8 hours', '-1 day')
              AND source_type = '5min'
          `).get()?.n || 0);
          db.close();
        } catch (_) {
          // DB 不可用时返回 0，不阻塞仪表盘对比显示
        }
      }
      const calc = (cur, prev) => ({
        hasCompare: cur > 0 && prev > 0,
        deltaPct: cur > 0 && prev > 0 ? Number((((cur - prev) / prev) * 100).toFixed(1)) : 0
      });
      const todayCpl = Number(today.leads) > 0 ? Number(today.spend) / Number(today.leads) : 0;
      const yesterdayCpl = Number(yesterday.leads) > 0 ? Number(yesterday.spend) / Number(yesterday.leads) : 0;
      const yesterdaySpeed = yesterdayWindows > 0 ? Number(yesterday.spend) / yesterdayWindows : 0;
      const todayBudgetPct = dailyBudget > 0 ? (Number(today.spend) / dailyBudget) * 100 : 0;
      const yesterdayBudgetPct = dailyBudget > 0 ? (Number(yesterday.spend) / dailyBudget) * 100 : 0;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        compare: {
          spend: calc(Number(today.spend), Number(yesterday.spend)),
          speed: calc(currentSpeed, yesterdaySpeed),
          leads: calc(Number(today.leads), Number(yesterday.leads)),
          cpl: calc(todayCpl, yesterdayCpl),
          cpm: calc(currentCpm, yesterdayCpm),
          budget: calc(todayBudgetPct, yesterdayBudgetPct)
        }
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, compare: {} }));
    }
    return true;
  }

  if (url.pathname === '/api/snapshots/5m') {
    try {
      const historyN = Math.max(0, parseInt(url.searchParams.get('history') || '0', 10) || 0);
      const snaps = get5mSnapshots(historyN > 0 ? historyN : 1);
      const latest = snaps.length ? snaps[snaps.length - 1] : null;

      // 从 DB 聚合当日私信开口/留资数据(每 plan 取 MAX-MIN 得当日增量)
      let totalMsgOpen = 0, totalMsgLead = 0;
      if (latest && DB_PATH) {
        try {
          const db = new Database(DB_PATH, { readonly: true });
          const row = db.prepare(`
            SELECT
              SUM(msg_open_delta)  AS totalOpen,
              SUM(msg_lead_delta)  AS totalLead
            FROM (
              SELECT
                campaign_id,
                MAX(msg_open) - MIN(msg_open) AS msg_open_delta,
                MAX(msg_lead) - MIN(msg_lead) AS msg_lead_delta
              FROM snapshots
              WHERE date(datetime(snapshot_time, '+8 hours')) = date('now', '+8 hours')
                AND source_type = '5min'
                AND (json_extract(page_summary_json, '$.synthetic') IS NULL
                     OR json_extract(page_summary_json, '$.synthetic') != 1)
              GROUP BY campaign_id
            )
          `).get();
          totalMsgOpen = row.totalOpen || 0;
          totalMsgLead = row.totalLead || 0;
          db.close();
        } catch (_) { /* DB 不可用时静默降级 */ }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        latest: latest ? { ...latest, totalMsgOpen, totalMsgLead } : null,
        history: historyN > 0 ? snaps : []
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, latest: null, history: [] }));
    }
    return true;
  }

  return false;
}
