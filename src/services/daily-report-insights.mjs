// src/services/daily-report-insights.mjs - 日报洞察构建

export function buildInsightLines({
  budgetPct,
  yoySpend,
  yoyCPA,
  yoyConv,
  vs7Spend,
  vs7CPA,
  vs7Conv,
}) {
  const lines = [];
  if (budgetPct >= 90) lines.push(`⚠️ 预算接近上限（${budgetPct}%），注意余额风险`);
  else if (budgetPct < 50) lines.push(`ℹ️ 预算消耗偏慢（${budgetPct}%），低于时间进度预期`);
  if (Number.isFinite(yoySpend) && Number.isFinite(yoyCPA) && Number.isFinite(yoyConv)) lines.push(`📊 较昨日：消耗${yoySpend >= 0 ? '+' : ''}${yoySpend.toFixed(0)}% · CPA${yoyCPA >= 0 ? '+' : ''}${yoyCPA.toFixed(0)}% · 转化${yoyConv >= 0 ? '+' : ''}${yoyConv.toFixed(0)}%`);
  if (Number.isFinite(vs7Spend) && Number.isFinite(vs7CPA) && Number.isFinite(vs7Conv)) lines.push(`📈 较7日均：消耗${vs7Spend >= 0 ? '+' : ''}${vs7Spend.toFixed(0)}% · CPA${vs7CPA >= 0 ? '+' : ''}${vs7CPA.toFixed(0)}% · 转化${vs7Conv >= 0 ? '+' : ''}${vs7Conv.toFixed(0)}%`);
  return lines;
}
