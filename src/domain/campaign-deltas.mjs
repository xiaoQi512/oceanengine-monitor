// src/domain/campaign-deltas.mjs - 每计划增量分析（纯逻辑）

export function buildCampaignDeltas(active = [], prevIndex15 = new Map()) {
  return active.map(c => {
    const prevC = prevIndex15.get(c.id);
    const spendDelta = prevC ? c.spend - prevC.spend : c.spend;
    const spendPrev = prevC?.spend || 0.01;
    const changeRate = spendPrev > 0.01 ? (spendDelta / spendPrev) : (c.spend > 0 ? 1 : 0);
    const convDelta = prevC ? c.conversions - prevC.conversions : c.conversions;
    const cpa15 = convDelta > 0 ? spendDelta / convDelta : 0;
    let trend;
    if (spendDelta < 0.5 && c.spend < 5) trend = '休眠';
    else if (c._justRevived) trend = '起量';
    else if (changeRate > 0.3 && spendDelta > 5) trend = '起量';
    else if (changeRate < -0.15 && spendDelta < -10 && prevC && prevC.spend > 10) trend = '掉量';
    else if (spendDelta >= 5) trend = '稳定消耗';
    else trend = '微量';
    return {
      ...c,
      spendDelta,
      changeRate,
      convDelta,
      cpa15,
      trend,
      spendPrev: prevC?.spend || 0,
    };
  });
}
