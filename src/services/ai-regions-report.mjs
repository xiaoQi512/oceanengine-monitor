// src/services/ai-regions-report.mjs - AI 区域汇总报告

export function fmtMoney(v) {
  return (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function todayDateCN() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function summarizeAiRegions(results) {
  const totalLive = results.reduce((s, r) => ({ consume: s.consume + r.liveConsume, leads: s.leads + r.liveLeads }), { consume: 0, leads: 0 });
  const totalVideo = results.reduce((s, r) => ({ consume: s.consume + r.videoConsume, leads: s.leads + r.videoLeads }), { consume: 0, leads: 0 });
  const grandConsume = totalLive.consume + totalVideo.consume;
  const grandLeads = totalLive.leads + totalVideo.leads;
  const grandCpl = grandLeads > 0 ? (grandConsume / grandLeads).toFixed(2) : '0.00';
  return { totalLive, totalVideo, grandConsume, grandLeads, grandCpl };
}

export function buildAiRegionsReport({ results, dateLabel }) {
  const lines = [`${dateLabel} AI区域号数据汇总`, ''];
  for (const r of results) {
    const totalLeads = r.liveLeads + r.videoLeads;
    const totalConsume = r.liveConsume + r.videoConsume;
    const totalCpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
    const liveCpl = r.liveLeads > 0 ? (r.liveConsume / r.liveLeads).toFixed(2) : '0.00';
    const videoCpl = r.videoLeads > 0 ? (r.videoConsume / r.videoLeads).toFixed(2) : '0.00';
    lines.push(`【极狐${r.name}】 ${dateLabel}数据汇总`);
    lines.push(`【线索数】：${totalLeads}`);
    lines.push(`【投流费用】：${fmtMoney(totalConsume)}元（直播${fmtMoney(r.liveConsume)}元/短视频${fmtMoney(r.videoConsume)}元）`);
    lines.push(`【线索成本（CPL）】：${totalCpl}元（直播CPL${liveCpl}/短视频CPL${videoCpl}）`);
    lines.push('');
  }
  const totals = summarizeAiRegions(results);
  lines.push(`【5区总计】 线索${totals.grandLeads} / 消耗¥${fmtMoney(totals.grandConsume)} / 综合CPL¥${totals.grandCpl}`);
  return lines.join('\n');
}
