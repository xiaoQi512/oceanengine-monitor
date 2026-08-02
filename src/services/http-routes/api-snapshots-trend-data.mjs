// src/services/http-routes/api-snapshots-trend-data.mjs - 近1小时趋势聚合
import { buildTrendTimeFrames } from './snapshot-trend-time.mjs';
import { queryTop5Delta } from './snapshot-trend-top.mjs';
import { queryAggPoint } from './snapshot-trend-agg.mjs';

export function loadSnapshotTrendData(db, parseSnapshotTime, POINTS = 12) {
  const empty = { labels: [], timestamps: [], spend: [], cpl: [], cpm: [], conversions: [], impressions: [], activeCount: [], planSpend: [], spendingCount: [], deliveringCount: [], totalPlanCount: 0, pausedPlanCount: 0, convBreakdown: [], top5PerPoint: [] };
  if (!db) return empty;

  const dbTimes = db.prepare(`
    SELECT snapshot_time FROM snapshots
    WHERE source_type = '5min'
    GROUP BY snapshot_time
    ORDER BY snapshot_time DESC LIMIT ?
  `).all(POINTS).reverse();

  const frames = buildTrendTimeFrames(dbTimes, parseSnapshotTime, POINTS);
  const { labels, timestamps, filledTimes } = frames;
  const spend = [], cpl = [], cpm = [], conversions = [], impressions = [];
  const activeCount = [], planSpend = [], spendingCount = [], deliveringCount = [];
  const convBreakdown = [], top5PerPoint = [];
  let prevTimeStmt = null, top5DeltaStmt = null;
  try {
    prevTimeStmt = db.prepare(`SELECT snapshot_time FROM snapshots WHERE source_type = '5min' AND snapshot_time < ? ORDER BY snapshot_time DESC LIMIT 1`);
    top5DeltaStmt = db.prepare(`SELECT s.campaign_id, c.name,
      s.cost - COALESCE(prev.cost, 0) as delta_cost,
      s.leads - COALESCE(prev.leads, 0) as delta_leads,
      s.cost as curr_cost,
      prev.cost as prev_cost,
      prev.cost - COALESCE(prevPrev.cost, 0) as prev_delta_cost
      FROM snapshots s
      LEFT JOIN snapshots prev ON s.campaign_id = prev.campaign_id AND prev.snapshot_time = @prevTime AND prev.source_type = '5min'
      LEFT JOIN snapshots prevPrev ON s.campaign_id = prevPrev.campaign_id AND prevPrev.snapshot_time = @prevPrevTime AND prevPrev.source_type = '5min'
      LEFT JOIN campaigns c ON s.campaign_id = c.campaign_id
      WHERE s.snapshot_time = @currTime AND s.source_type = '5min'
      ORDER BY delta_cost DESC LIMIT 5`);
  } catch {}

  for (const st of filledTimes) {
    if (!st) {
      spend.push(0); cpl.push(0); cpm.push(0); conversions.push(0); impressions.push(0);
      activeCount.push(0); planSpend.push(0); spendingCount.push(0); deliveringCount.push(0);
      convBreakdown.push({ msgLead: 0, formSubmit: 0, other: 0 }); top5PerPoint.push([]);
      continue;
    }
    const point = queryAggPoint(db, st);
    spend.push(point.spend);
    cpl.push(point.cpl);
    cpm.push(point.cpm);
    conversions.push(point.conversions);
    impressions.push(point.impressions);
    activeCount.push(point.activeCount);
    planSpend.push(point.planSpend);
    spendingCount.push(point.spendingCount);
    deliveringCount.push(point.deliveringCount);
    convBreakdown.push(point.convBreakdown);
    top5PerPoint.push(queryTop5Delta(db, st, prevTimeStmt, top5DeltaStmt));
  }

  const totalPlanCount = activeCount.length ? activeCount[activeCount.length - 1] : 0;
  const pausedPlanCount = spendingCount.length ? Math.max(0, (activeCount[activeCount.length - 1] || 0) - (spendingCount[spendingCount.length - 1] || 0)) : 0;
  return { labels, timestamps, spend, cpl, cpm, conversions, impressions, activeCount, planSpend, spendingCount, deliveringCount, totalPlanCount, pausedPlanCount, convBreakdown, top5PerPoint };
}
