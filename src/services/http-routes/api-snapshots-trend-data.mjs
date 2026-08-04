// src/services/http-routes/api-snapshots-trend-data.mjs - 近1小时趋势聚合（5分钟格点，DB满格无需fallback）
import { buildTrendTimeFrames } from './snapshot-trend-time.mjs';
import { queryTop5Delta } from './snapshot-trend-top.mjs';
import { queryAggPoint } from './snapshot-trend-agg.mjs';

export function loadSnapshotTrendData(db, parseSnapshotTime, POINTS = 12) {
  const emptyBaseFields = {
    baseSpend: 0, baseConversions: 0, baseImpressions: 0,
    labels: [], timestamps: [], spend: [], cpl: [], cpm: [],
    conversions: [], impressions: [], activeCount: [], planSpend: [],
    spendingCount: [], deliveringCount: [], totalPlanCount: 0, pausedPlanCount: 0,
    convBreakdown: [], top5PerPoint: []
  };
  if (!db) return emptyBaseFields;

  // 取最近 5min 快照（DB 已满格，整刻钟也有合成5min数据）
  const dbTimes = db.prepare(`
    SELECT snapshot_time FROM snapshots
    WHERE source_type = '5min'
    GROUP BY snapshot_time
    ORDER BY snapshot_time DESC LIMIT ?
  `).all(24).reverse();

  if (dbTimes.length < 1) return emptyBaseFields;

  const frames = buildTrendTimeFrames(dbTimes, parseSnapshotTime, POINTS);
  const { labels, timestamps, actualTimes } = frames;

  // 基线：格点中第一个有数据的 actualTime 的前一个快照
  let baseTime = null;
  const firstIdx = actualTimes.findIndex(t => t !== null);
  if (firstIdx >= 0 && dbTimes.length > 0) {
    const firstSnapshot = actualTimes[firstIdx];
    for (let i = 0; i < dbTimes.length; i++) {
      if (dbTimes[i].snapshot_time === firstSnapshot && i > 0) {
        baseTime = dbTimes[i - 1].snapshot_time;
        break;
      }
    }
  }

  const basePoint = baseTime ? queryAggPoint(db, baseTime) : { spend: 0, conversions: 0, impressions: 0 };
  const baseSpend = basePoint.spend;
  const baseConversions = basePoint.conversions;
  const baseImpressions = basePoint.impressions;

  // top5 预编译
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

  const spend = [], cpl = [], cpm = [], conversions = [], impressions = [];
  const activeCount = [], planSpend = [], spendingCount = [], deliveringCount = [];
  const convBreakdown = [], top5PerPoint = [];

  for (const st of actualTimes) {
    if (!st) {
      // 无 5min 快照（偶发漏采） → NaN（Chart.js 断线）
      spend.push(NaN); cpl.push(NaN); cpm.push(NaN); conversions.push(NaN); impressions.push(NaN);
      activeCount.push(NaN); planSpend.push(NaN); spendingCount.push(NaN); deliveringCount.push(NaN);
      convBreakdown.push(null); top5PerPoint.push([]);
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

  // totalPlanCount: 5min 快照的全量 campaign_id 数（账户总计划数）
  const totalPlanCount = activeCount.filter(v => typeof v === 'number' && !isNaN(v)).pop() || 0;
  // pausedPlanCount: 总计划 - 投放中（取最后一个真实格点）
  const lastDelivering = deliveringCount.filter(v => typeof v === 'number' && !isNaN(v)).pop() || 0;
  const pausedPlanCount = totalPlanCount > lastDelivering ? totalPlanCount - lastDelivering : 0;
  return {
    baseSpend, baseConversions, baseImpressions,
    labels, timestamps,
    spend, cpl, cpm, conversions, impressions,
    activeCount, planSpend, spendingCount, deliveringCount,
    totalPlanCount, pausedPlanCount, convBreakdown, top5PerPoint
  };
}
