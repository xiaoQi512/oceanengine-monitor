// src/domain/daily-report-comparison.mjs - 日报同比/7日均指标（纯计算）

export function computeDailyReportComparisons({
  finalSpend,
  finalCPA,
  finalConversions,
  recentLogs = [],
}) {
  const yesterday = recentLogs.length > 0 ? recentLogs[recentLogs.length - 1] : null;
  const avg7 = recentLogs.length > 0 ? {
    spend: recentLogs.reduce((s, r) => s + r.finalSpend, 0) / recentLogs.length,
    cpa: recentLogs.reduce((s, r) => s + r.finalCPA, 0) / recentLogs.length,
    conversions: recentLogs.reduce((s, r) => s + r.finalConversions, 0) / recentLogs.length,
  } : null;

  const pct = (current, base) => base > 0 ? ((current - base) / base * 100) : null;
  return {
    yesterday,
    avg7,
    yoySpend: yesterday ? pct(finalSpend, yesterday.finalSpend) : null,
    yoyCPA: yesterday ? pct(finalCPA, yesterday.finalCPA) : null,
    yoyConv: yesterday ? pct(finalConversions, yesterday.finalConversions) : null,
    vs7Spend: avg7 ? pct(finalSpend, avg7.spend) : null,
    vs7CPA: avg7 ? pct(finalCPA, avg7.cpa) : null,
    vs7Conv: avg7 ? pct(finalConversions, avg7.conversions) : null,
  };
}
