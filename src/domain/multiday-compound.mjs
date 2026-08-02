// src/domain/multiday-compound.mjs - 复合风险告警

export function buildCompoundRiskAlert({ multiDay, openRetainRate, avgCPA, avgCPM, viewRetention, convEfficiency }) {
  if (!multiDay) return null;
  const risks = [];
  const rrBad = multiDay.openRetainRate && openRetainRate > 0 && multiDay.openRetainRate.stdev > 0.02 && (openRetainRate - multiDay.openRetainRate.mean) / multiDay.openRetainRate.stdev < (multiDay.sampleDays >= 5 ? -1.5 : -2.0);
  const cpaBad = multiDay.cpa && avgCPA > 0 && multiDay.cpa.mean > 0 && avgCPA > multiDay.cpa.mean * 1.25;
  const cpmBad = multiDay.cpm && avgCPM > 0 && multiDay.cpm.mean > 0 && avgCPM > multiDay.cpm.mean * 1.3;
  const vrBad = multiDay.viewRetention && viewRetention > 0 && multiDay.viewRetention.stdev > 0.02 && (viewRetention - multiDay.viewRetention.mean) / multiDay.viewRetention.stdev < -1.5;
  const effBad = multiDay.convEfficiency && convEfficiency > 0 && multiDay.convEfficiency.mean > 0 && convEfficiency < multiDay.convEfficiency.mean * 0.6;
  if (cpaBad) risks.push('CPL↑');
  if (cpmBad) risks.push('CPM↑');
  if (rrBad) risks.push('留资率↓');
  if (vrBad) risks.push('停留率↓');
  if (effBad) risks.push('效率↓');
  if (risks.length < 2) return null;
  return { type: 'compound_risk', name: `复合风险: ${risks.join('+')} 同时恶化`, detail: `检测到 ${risks.length} 个维度同时恶化（${risks.join(', ')}），可能为系统性问题，建议排查投放策略或直播间质量`, severity: risks.length >= 3 ? 'high' : 'medium' };
}
