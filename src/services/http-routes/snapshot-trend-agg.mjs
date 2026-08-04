// src/services/http-routes/snapshot-trend-agg.mjs - 趋势单点聚合

export function queryAggPoint(db, st) {
  // activeCount 仅统计 cost > 0 的计划（与 5min 真实采集口径一致：投放且有消耗）
  // status='投放中' 且 cost=0 的不算"在投活跃"
  const agg = db.prepare(`
    SELECT COALESCE(SUM(cost), 0) as totalCost,
      COALESCE(SUM(leads), 0) as totalLeads,
      COALESCE(SUM(conversions), 0) as totalConv,
      COUNT(DISTINCT campaign_id) as campaignCount,
      COUNT(DISTINCT CASE WHEN cost > 0 THEN campaign_id END) as spendingCount,
      COUNT(DISTINCT CASE WHEN cost > 0 AND status IN ('投放中','启用中','启用') THEN campaign_id END) as deliveringCount,
      COALESCE(SUM(msg_lead), 0) as msgLead,
      COALESCE(SUM(form_submit), 0) as formSubmit
    FROM snapshots WHERE snapshot_time = ? AND source_type = '5min'
  `).get(st);
  const cpmRow = db.prepare(`
    SELECT COALESCE(SUM(cost), 0) as totalCostForCpm,
      COALESCE(SUM(CASE WHEN cpm > 0 AND cost > 0 THEN cost / cpm END), 0) as sumCostDivCpm,
      COALESCE(SUM(CASE WHEN cpm > 0 AND cost > 0 THEN cost / cpm * 1000 END), 0) as totalImpr
    FROM snapshots WHERE snapshot_time = ? AND source_type = '5min' AND cpm > 0 AND cost > 0
  `).get(st);
  const aggCost = Number(agg?.totalCost || 0);
  const aggConv = Number(agg?.totalConv || 0);
  const tCost = Number(cpmRow?.totalCostForCpm || 0);
  const tSum = Number(cpmRow?.sumCostDivCpm || 0);
  return {
    spend: Number(aggCost.toFixed(2)),
    cpl: aggCost > 0 && aggConv > 0 ? Number((aggCost / aggConv).toFixed(2)) : 0,
    cpm: tSum > 0 ? Number((tCost / tSum).toFixed(2)) : 0,
    conversions: aggConv,
    impressions: Math.round(Number(cpmRow?.totalImpr || 0)),
    activeCount: Number(agg?.campaignCount || 0),
    planSpend: Number(aggCost.toFixed(2)),
    spendingCount: Number(agg?.spendingCount || 0),
    deliveringCount: Number(agg?.deliveringCount || 0),
    convBreakdown: { msgLead: Number(agg?.msgLead || 0), formSubmit: Number(agg?.formSubmit || 0), other: Math.max(0, aggConv - Number(agg?.msgLead || 0) - Number(agg?.formSubmit || 0)) },
  };
}
