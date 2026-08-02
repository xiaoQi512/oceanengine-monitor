// src/domain/multiday-spend-alerts.mjs - 多日消耗/转化/计划告警

export function buildSpendAlerts({ multiDay, totalSpend, timeProgress, totalConversions, active }) {
  const alerts = [];
  if (!multiDay) return alerts;
  if (multiDay.spend.mean > 0 && totalSpend < multiDay.spend.mean * 0.6 && timeProgress > 0.15) {
    const pct = ((totalSpend / multiDay.spend.mean) * 100).toFixed(0);
    alerts.push({ type: 'spend_vs_3d', name: '消耗远低于3日均值', detail: `当前 ¥${totalSpend.toFixed(0)}，仅为近3天同时段均值 ¥${multiDay.spend.mean.toFixed(0)} 的 ${pct}%，可能计划掉量或出价过低`, severity: totalSpend < multiDay.spend.mean * 0.4 ? 'high' : 'medium' });
  }
  if (multiDay.conversions.mean > 0 && totalConversions < multiDay.conversions.mean * 0.5 && timeProgress > 0.15) {
    alerts.push({ type: 'conv_vs_3d', name: '转化量远低于3日均值', detail: `当前 ${totalConversions}条转化，仅为近3天同时段均值 ${multiDay.conversions.mean.toFixed(0)} 的 ${((totalConversions/multiDay.conversions.mean)*100).toFixed(0)}%`, severity: 'medium' });
  }
  if (multiDay.activeCount && active.length < multiDay.activeCount.mean * 0.6 && timeProgress > 0.1) {
    alerts.push({ type: 'plan_count_drop', name: '投放计划数异常减少', detail: `当前 ${active.length} 条投放中，近3天同时段均值 ${multiDay.activeCount.mean.toFixed(0)} 条，检查是否有计划异常暂停`, severity: active.length < multiDay.activeCount.mean * 0.4 ? 'high' : 'medium' });
  }
  return alerts;
}
