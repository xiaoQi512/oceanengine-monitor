// src/domain/quick-card-top.mjs - 5min 速报 TOP5 增量计算（纯逻辑）

export function buildTop5DeltaLines(data, prevSnapshots = [], limit = 5) {
  const prevSpendMap = new Map();
  const prevConvMap = new Map();
  const prevSnap = prevSnapshots[0];
  if (prevSnap && Array.isArray(prevSnap.allSpending)) {
    for (const p of prevSnap.allSpending) {
      if (p.id) {
        prevSpendMap.set(p.id, p.spend || 0);
        prevConvMap.set(p.id, p.conversions || 0);
      }
    }
  }
  const top5 = [...(data.allSpending || [])]
    .map(c => {
      const prevSpend = prevSpendMap.get(c.id) || 0;
      const prevConv = prevConvMap.get(c.id) || 0;
      const deltaSpend = Math.max(0, c.spend - prevSpend);
      const deltaConv = Math.max(0, c.conversions - prevConv);
      return {
        name: c.name,
        deltaSpend,
        deltaConv,
        cpl: deltaConv > 0 ? deltaSpend / deltaConv : null,
      };
    })
    .filter(t => t.deltaSpend > 0)
    .sort((a, b) => b.deltaSpend - a.deltaSpend)
    .slice(0, limit);
  return top5.length > 0
    ? top5.map((t, i) => {
        const cplStr = t.cpl !== null ? ` | CPL ¥${t.cpl.toFixed(0)}` : '';
        return `${i + 1}. +¥${t.deltaSpend.toFixed(0)}${cplStr}  ${t.name}`;
      }).join('\n')
    : '暂无增量';
}
