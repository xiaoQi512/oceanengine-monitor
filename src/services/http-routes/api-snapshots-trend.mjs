// src/services/http-routes/api-snapshots-trend.mjs - 近1小时趋势路由
import Database from 'better-sqlite3';
import { loadSnapshotTrendData } from './api-snapshots-trend-data.mjs';

export function serveSnapshotTrend(url, req, res, ctx) {
  if (url.pathname !== '/api/snapshots/trend') return false;
  const { DB_PATH, parseSnapshotTime } = ctx;
  try {
    let db = null;
    try { db = new Database(DB_PATH, { readonly: true }); } catch {}
    const data = loadSnapshotTrendData(db, parseSnapshotTime);
    if (db) { try { db.close(); } catch {} }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message, baseSpend: 0, baseConversions: 0, baseImpressions: 0, labels: [], timestamps: [], spend: [], cpl: [], cpm: [], conversions: [], impressions: [], activeCount: [], planSpend: [], spendingCount: [], deliveringCount: [], totalPlanCount: 0, pausedPlanCount: 0, convBreakdown: [], top5PerPoint: [] }));
  }
  return true;
}
