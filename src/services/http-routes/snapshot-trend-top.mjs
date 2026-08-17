// src/services/http-routes/snapshot-trend-top.mjs - 趋势 TOP5 查询

export function queryTop5Delta(db, st, prevTimeStmt, top5DeltaStmt, accountId = '') {
  try {
    const prevTimeArgs = (t) => accountId ? [accountId, t] : [t];
    const prevT = prevTimeStmt ? prevTimeStmt.get(...prevTimeArgs(st)) : null;
    const prevPrevT = prevT?.snapshot_time && prevTimeStmt ? prevTimeStmt.get(...prevTimeArgs(prevT.snapshot_time)) : null;
    const params = { prevTime: prevT?.snapshot_time || null, prevPrevTime: prevPrevT?.snapshot_time || null, currTime: st };
    if (accountId) params.accountId = accountId;
    return top5DeltaStmt
      ? top5DeltaStmt.all(params)
        .filter(r => (r.delta_cost || 0) > 0)
        .map(r => {
          const deltaCost = Number(r.delta_cost || 0);
          const deltaLeads = Number(r.delta_leads || 0);
          const prevCost = Number(r.prev_cost || 0);
          const prevDeltaCost = Number(r.prev_delta_cost || 0);
          let trend = '';
          if (prevCost < 0.01) trend = 'NEW';
          else if (deltaCost > prevDeltaCost * 1.5) trend = '起量';
          else if (deltaCost < prevDeltaCost * 0.5) trend = '掉量';
          else trend = '稳定';
          const changeRate = prevDeltaCost > 0.01 ? Number((deltaCost / prevDeltaCost).toFixed(2)) : null;
          return { name: (r.name || r.campaign_id || '').slice(0, 30), spend: Number(deltaCost.toFixed(2)), cpl: deltaLeads > 0 ? Number((deltaCost / deltaLeads).toFixed(2)) : 0, leads: deltaLeads, trend, changeRate };
        })
      : [];
  } catch {
    return [];
  }
}
