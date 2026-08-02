// src/domain/multiday-quality-alerts.mjs - 多日质量指标告警

export function buildQualityAlerts({ multiDay, avgCPA, openRetainRate, totalPrivateMsgRetain, totalPrivateMsgOpen, avgCPM, viewRetention, totalLiveOver1Min, totalLiveViews, convEfficiency }) {
  const alerts = [];
  if (!multiDay) return alerts;
  if (multiDay.cpa && avgCPA > 0) {
    const cpaSigma = multiDay.cpa.stdev > 0 ? (avgCPA - multiDay.cpa.mean) / multiDay.cpa.stdev : 0;
    const cpaRatio = multiDay.cpa.mean > 0 ? avgCPA / multiDay.cpa.mean : 0;
    if ((cpaSigma > 2.5 || cpaRatio > 1.4) && cpaRatio > 1.2) alerts.push({ type: 'cpa_vs_3d', name: `CPA 显著偏高 (${cpaSigma.toFixed(1)}σ)`, detail: `当前 CPL ¥${avgCPA.toFixed(0)}，近3天同时段均值 ¥${multiDay.cpa.mean.toFixed(0)}（${(cpaRatio*100).toFixed(0)}%），异常偏高`, severity: cpaSigma > 3.5 ? 'high' : 'medium' });
  }
  if (multiDay.openRetainRate && openRetainRate > 0 && multiDay.openRetainRate.stdev > 0.02) {
    const rrSigma = (openRetainRate - multiDay.openRetainRate.mean) / multiDay.openRetainRate.stdev;
    const rrThreshold = multiDay.sampleDays >= 5 ? -2.0 : -2.5;
    if (rrSigma < rrThreshold) alerts.push({ type: 'retain_rate_drop', name: `开口留资率异常偏低 (${rrSigma.toFixed(1)}σ)`, detail: `当前开留率 ${(openRetainRate*100).toFixed(1)}%（留${totalPrivateMsgRetain}/开${totalPrivateMsgOpen}），近${multiDay.sampleDays}天同时段均值 ${(multiDay.openRetainRate.mean*100).toFixed(1)}%，显著低于历史水平`, severity: rrSigma < -3 ? 'high' : 'medium' });
  }
  if (multiDay.cpm && avgCPM > 0 && multiDay.cpm.stdev > 1) {
    const cpmSigma = (avgCPM - multiDay.cpm.mean) / multiDay.cpm.stdev;
    const cpmRatio = multiDay.cpm.mean > 0 ? avgCPM / multiDay.cpm.mean : 0;
    if (cpmSigma > 2.5 || cpmRatio > 1.4) alerts.push({ type: 'cpm_spike', name: `CPM 显著偏高 (${cpmSigma.toFixed(1)}σ)`, detail: `当前 CPM ¥${avgCPM.toFixed(1)}，近3天均值 ¥${multiDay.cpm.mean.toFixed(1)} (${(cpmRatio*100).toFixed(0)}%)，竞争加剧或人群质量变差`, severity: cpmSigma > 3.5 ? 'high' : 'medium' });
  }
  if (multiDay.viewRetention && viewRetention > 0 && multiDay.viewRetention.stdev > 0.02) {
    const vrSigma = (viewRetention - multiDay.viewRetention.mean) / multiDay.viewRetention.stdev;
    if (vrSigma < -2.0) alerts.push({ type: 'view_retention_drop', name: `观看停留率异常偏低 (${vrSigma.toFixed(1)}σ)`, detail: `当前停留率 ${(viewRetention*100).toFixed(1)}%（${totalLiveOver1Min}/${totalLiveViews}），近3天均值 ${(multiDay.viewRetention.mean*100).toFixed(1)}%，直播间内容吸引力下降`, severity: vrSigma < -3 ? 'high' : 'medium' });
  }
  if (multiDay.convEfficiency && convEfficiency > 0 && multiDay.convEfficiency.mean > 0 && convEfficiency < multiDay.convEfficiency.mean * 0.6) {
    alerts.push({ type: 'conv_efficiency_drop', name: '转化效率显著下降', detail: `当前 ¥1k→${convEfficiency.toFixed(1)}条转化，近3天均值 ${multiDay.convEfficiency.mean.toFixed(1)}条，转化效率仅为历史 ${(convEfficiency/multiDay.convEfficiency.mean*100).toFixed(0)}%`, severity: convEfficiency < multiDay.convEfficiency.mean * 0.4 ? 'high' : 'medium' });
  }
  return alerts;
}
