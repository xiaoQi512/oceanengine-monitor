// src/domain/page-calibration.mjs - 页面汇总行校准（纯逻辑）

export function calibrateWithPageSummary({
  pageSummary,
  totalSpend,
  totalConversions,
  totalLeads,
  totalPrivateMsgOpen,
  totalPrivateMsgRetain,
  totalFormSubmit,
  openRetainRate,
  avgCPM,
  totalLiveViews,
  totalLiveOver1Min,
  viewRetention,
}) {
  if (!pageSummary) return { totalSpend, totalConversions, totalLeads, totalPrivateMsgOpen, totalPrivateMsgRetain, totalFormSubmit, openRetainRate, avgCPM, totalLiveViews, totalLiveOver1Min, viewRetention };
  const psValid = pageSummary.privateMsgRetain <= pageSummary.privateMsgOpen
    && pageSummary.formSubmit <= pageSummary.privateMsgRetain + 5
    && (pageSummary.spend === 0 || pageSummary.spend > 100);
  if (!psValid) {
    console.log(`  ⚠️ 页面汇总校验失败(索引可能偏移), 跳过校准: spend=${pageSummary.spend} open=${pageSummary.privateMsgOpen} retain=${pageSummary.privateMsgRetain} form=${pageSummary.formSubmit}`);
    return { totalSpend, totalConversions, totalLeads, totalPrivateMsgOpen, totalPrivateMsgRetain, totalFormSubmit, openRetainRate, avgCPM, totalLiveViews, totalLiveOver1Min, viewRetention };
  }
  if (pageSummary.spend > 0) {
    totalSpend = pageSummary.spend;
    console.log(`  ✅ 页面汇总校准 totalSpend: ¥${totalSpend.toFixed(0)}`);
  }
  if (pageSummary.conversions > 0) {
    totalConversions = pageSummary.conversions;
    totalLeads = pageSummary.leads;
    totalPrivateMsgOpen = pageSummary.privateMsgOpen;
    totalPrivateMsgRetain = pageSummary.privateMsgRetain;
    totalFormSubmit = pageSummary.formSubmit;
    openRetainRate = totalPrivateMsgOpen > 0 ? totalPrivateMsgRetain / totalPrivateMsgOpen : 0;
    console.log(`  ✅ 页面汇总校准: 转化${totalConversions} 线索${totalLeads} 开口${totalPrivateMsgOpen} 留资${totalPrivateMsgRetain} 表单${totalFormSubmit}`);
  }
  if (pageSummary.cpm > 0) avgCPM = pageSummary.cpm;
  if (pageSummary.liveViews > 0) {
    totalLiveViews = pageSummary.liveViews;
    totalLiveOver1Min = pageSummary.liveOver1Min;
    viewRetention = totalLiveViews > 0 ? totalLiveOver1Min / totalLiveViews : 0;
  }
  return { totalSpend, totalConversions, totalLeads, totalPrivateMsgOpen, totalPrivateMsgRetain, totalFormSubmit, openRetainRate, avgCPM, totalLiveViews, totalLiveOver1Min, viewRetention };
}
