// src/domain/analysis-aggregate.mjs - 账户/计划汇总与页面校准
import { calibrateWithPageSummary } from './page-calibration.mjs';

export function buildCampaignAggregate({ allSpending, active, accountSpend, accountBudget, pageSummary }) {
  let totalConversions = allSpending.reduce((s, c) => s + c.conversions, 0);
  const allSpendSum = allSpending.reduce((s, c) => s + c.spend, 0);
  const activeSpendSum = active.reduce((s, c) => s + c.spend, 0);
  let totalSpend = accountBudget > 0 ? accountSpend : (allSpendSum > 0 ? allSpendSum : activeSpendSum);
  let avgCPA = totalConversions > 0 ? totalSpend / totalConversions : 0;
  const avgCTR = active.length > 0 ? active.reduce((s, c) => s + c.ctr, 0) / active.length : 0;
  const avgCVR = active.length > 0 ? active.reduce((s, c) => s + c.cvr, 0) / active.length : 0;
  let avgCPM = active.length > 0 ? active.reduce((s, c) => s + c.cpm, 0) / active.length : 0;
  let totalLeads = allSpending.reduce((s, c) => s + (c.leads || 0), 0);
  let totalPrivateMsgOpen = allSpending.reduce((s, c) => s + (c.privateMsgOpen || 0), 0);
  let totalPrivateMsgRetain = allSpending.reduce((s, c) => s + (c.privateMsgRetain || 0), 0);
  let totalFormSubmit = allSpending.reduce((s, c) => s + (c.formSubmit || 0), 0);
  if (totalLeads < totalPrivateMsgRetain) {
    console.log(`  ⚠️ totalLeads(${totalLeads}) < privateMsgRetain(${totalPrivateMsgRetain}), 使用留资+表单修正`);
    totalLeads = totalPrivateMsgRetain + totalFormSubmit;
  }
  let openRetainRate = totalPrivateMsgOpen > 0 ? totalPrivateMsgRetain / totalPrivateMsgOpen : 0;
  let totalLiveViews = allSpending.reduce((s, c) => s + (c.liveViews || 0), 0);
  let totalLiveOver1Min = allSpending.reduce((s, c) => s + (c.liveOver1Min || 0), 0);
  let viewRetention = totalLiveViews > 0 ? totalLiveOver1Min / totalLiveViews : 0;
  const convEfficiency = totalSpend > 0 ? totalConversions / (totalSpend / 1000) : 0;
  const calibrated = calibrateWithPageSummary({ pageSummary, totalSpend, totalConversions, totalLeads, totalPrivateMsgOpen, totalPrivateMsgRetain, totalFormSubmit, openRetainRate, avgCPM, totalLiveViews, totalLiveOver1Min, viewRetention });
  avgCPA = calibrated.totalConversions > 0 ? calibrated.totalSpend / calibrated.totalConversions : 0;
  return { ...calibrated, avgCPA, avgCTR, avgCVR, convEfficiency };
}
