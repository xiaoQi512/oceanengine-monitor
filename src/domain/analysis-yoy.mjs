// src/domain/analysis-yoy.mjs - 同比信息

export function buildYoyInfo(yesterdayBaseline, totalSpend, avgCPA) {
  if (!yesterdayBaseline) return null;
  return {
    yesterdaySpend: yesterdayBaseline.totalSpend,
    yesterdayCPA: yesterdayBaseline.avgCPA,
    yesterdayConversions: yesterdayBaseline.totalConversions,
    spendVsYesterday: yesterdayBaseline.totalSpend > 0 ? ((totalSpend - yesterdayBaseline.totalSpend) / yesterdayBaseline.totalSpend) : null,
    cpaVsYesterday: yesterdayBaseline.avgCPA > 0 ? ((avgCPA - yesterdayBaseline.avgCPA) / yesterdayBaseline.avgCPA) : null,
    yesterdayDate: yesterdayBaseline.date,
  };
}
