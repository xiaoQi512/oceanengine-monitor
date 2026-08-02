// src/domain/plan-alerts-trend.mjs - 趋势/掉量/死亡告警

export function buildDroppingAlerts(dropping = [], age15 = 15) {
  if (dropping.length < 3) return [];
  return [{ type: 'dropping', name: `${dropping.length} 条计划在掉量`, detail: dropping.map(c => `${c.name.slice(0, 30)}: 近${Math.round(age15||15)}分钟消耗 ¥${c.spendDelta.toFixed(1)} (变化 ${(c.changeRate*100).toFixed(0)}%)`).join('\n'), severity: dropping.length >= 5 ? 'medium' : 'low' }];
}

export function buildTrendAlerts(trends = {}) {
  const alerts = [];
  if (trends.cpaTrend && trends.cpaTrend.changeRate > 0.08) alerts.push({ type: 'cpa_trend', name: 'CPL 持续走高趋势', detail: `近${trends.cpaTrend.spanMinutes.toFixed(0)}分钟CPL以每分钟 ¥${trends.cpaTrend.slope.toFixed(2)} 的速度上升，累计预估走高 ${(trends.cpaTrend.changeRate*100).toFixed(0)}%`, severity: trends.cpaTrend.changeRate > 0.15 ? 'high' : 'medium' });
  if (trends.spendTrend && trends.spendTrend.changeRate > 0.15) alerts.push({ type: 'spend_trend', name: '消耗持续加速趋势', detail: `近${trends.spendTrend.spanMinutes.toFixed(0)}分钟消耗速度以每分钟 ¥${trends.spendTrend.slope.toFixed(2)} 递增，累计预估走高 ${(trends.spendTrend.changeRate*100).toFixed(0)}%，需关注预算`, severity: trends.spendTrend.changeRate > 0.3 ? 'high' : 'medium' });
  return alerts;
}

export function buildDeadPlanAlerts(active = []) {
  const deadCampaigns = active.filter(c => c._lifecycle === 'dead');
  if (deadCampaigns.length === 0) return [];
  return [{ type: 'dead_plan', name: `${deadCampaigns.length} 条计划疑似死亡`, detail: deadCampaigns.map(c => `${c.name.slice(0, 30)}: 时均消耗<¥100 且 已投放≥3h`).join('; '), severity: 'low' }];
}
