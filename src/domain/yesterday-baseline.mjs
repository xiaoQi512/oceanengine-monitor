// src/domain/yesterday-baseline.mjs - 昨日同时段基线

export function computeYesterdayBaseline(log, now = new Date(), yesterdayDate = '') {
  if (!log || log.length === 0) return null;
  const currentHour = now.getHours() + now.getMinutes() / 60;
  let best = null;
  let bestDiff = Infinity;
  for (const entry of log) {
    const t = new Date(entry.time);
    const h = t.getHours() + t.getMinutes() / 60;
    const diff = Math.abs(h - currentHour);
    if (diff < bestDiff) { bestDiff = diff; best = entry; }
  }
  if (!best || bestDiff > 2) return null;
  return {
    time: best.time,
    totalSpend: best.accountSpend > 0 ? best.accountSpend : (best.totalSpend || 0),
    totalConversions: best.totalConversions || 0,
    avgCPA: best.avgCPA || 0,
    activeCount: best.activeCount || 0,
    timeDiff: bestDiff,
    date: yesterdayDate,
  };
}
