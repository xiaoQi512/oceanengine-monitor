// src/domain/multiday-baseline.mjs - 多日同时段基线

export function computeMultiDayBaseline(dailyLogs, now = new Date()) {
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const hourlyEntries = [];
  for (const { date: dateStr, log } of dailyLogs) {
    if (!log || log.length < 3) continue;
    let best = null, bestDiff = Infinity;
    for (const entry of log) {
      const t = new Date(entry.time);
      const h = t.getHours() + t.getMinutes() / 60;
      const diff = Math.abs(h - currentHour);
      if (diff < bestDiff && diff <= 2) { bestDiff = diff; best = entry; }
    }
    if (best) {
      const bestOpen = best.totalPrivateMsgOpen || 0;
      const bestRetain = best.totalPrivateMsgRetain || 0;
      const computedRate = bestOpen > 0 ? bestRetain / bestOpen : 0;
      const storedRate = best.openRetainRate || 0;
      const effectiveRate = (bestOpen > 0 && Math.abs(storedRate - computedRate) > 0.05) ? computedRate : storedRate;
      hourlyEntries.push({ date: dateStr, spend: best.accountSpend > 0 ? best.accountSpend : (best.totalSpend || 0), conversions: best.totalConversions || 0, cpa: best.avgCPA || 0, speed: best.speedCurrent || 0, activeCount: best.activeCount || 0, leads: best.totalLeads || 0, openRetainRate: effectiveRate, avgCPM: best.avgCPM || 0, viewRetention: best.viewRetention || 0, convEfficiency: best.convEfficiency || 0, timeDiff: bestDiff });
    }
  }
  if (hourlyEntries.length < 2) return null;
  const spendVals = hourlyEntries.map(e => e.spend);
  const cpaVals = hourlyEntries.map(e => e.cpa).filter(v => v > 0);
  const speedVals = hourlyEntries.map(e => e.speed).filter(v => v > 0);
  const convVals = hourlyEntries.map(e => e.conversions);
  const activeVals = hourlyEntries.map(e => e.activeCount);
  const retainVals = hourlyEntries.map(e => e.openRetainRate).filter(v => v > 0);
  const cpmVals = hourlyEntries.map(e => e.avgCPM).filter(v => v > 0);
  const viewRetVals = hourlyEntries.map(e => e.viewRetention).filter(v => v > 0);
  const convEffVals = hourlyEntries.map(e => e.convEfficiency).filter(v => v > 0);
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const stdev = arr => { if (arr.length < 2) return 0; const m = avg(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1)); };
  return {
    entries: hourlyEntries,
    spend: { mean: avg(spendVals), stdev: stdev(spendVals), min: Math.min(...spendVals), max: Math.max(...spendVals) },
    cpa: cpaVals.length ? { mean: avg(cpaVals), stdev: stdev(cpaVals), min: Math.min(...cpaVals), max: Math.max(...cpaVals) } : null,
    speed: speedVals.length ? { mean: avg(speedVals), stdev: stdev(speedVals), min: Math.min(...speedVals), max: Math.max(...speedVals) } : null,
    conversions: { mean: avg(convVals), min: Math.min(...convVals), max: Math.max(...convVals) },
    activeCount: activeVals.length ? { mean: avg(activeVals), min: Math.min(...activeVals), max: Math.max(...activeVals) } : null,
    openRetainRate: retainVals.length ? { mean: avg(retainVals), stdev: stdev(retainVals) } : null,
    cpm: cpmVals.length ? { mean: avg(cpmVals), stdev: stdev(cpmVals) } : null,
    viewRetention: viewRetVals.length ? { mean: avg(viewRetVals), stdev: stdev(viewRetVals) } : null,
    convEfficiency: convEffVals.length ? { mean: avg(convEffVals), stdev: stdev(convEffVals) } : null,
    sampleDays: hourlyEntries.length,
  };
}
