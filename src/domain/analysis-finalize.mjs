// src/domain/analysis-finalize.mjs - 告警/同比/生命周期收尾
import { buildAlerts } from './alerts.mjs';
import { computeLifecycleFromSnapshots } from './analysis-utils.mjs';
import { buildYoyInfo } from './analysis-yoy.mjs';

export function buildAnalysisFinal(params) {
  const {
    yesterdayBaseline, totalSpend, avgCPA, todaySnapshots, prev, active, effectiveBudget,
    window3h, multiDay, timeProgress, totalConversions, openRetainRate, totalPrivateMsgRetain, totalPrivateMsgOpen,
    avgCPM, viewRetention, totalLiveOver1Min, totalLiveViews, convEfficiency, speedHour, speedCurrent, age15, age60,
    projectedDaily, pacingHealth, pacingRatio, campaignDeltas, accountBudget, accountSpend, hasAccountData, accountBalance, dropping, trends, totalLeads,
  } = params;
  const yoyInfo = buildYoyInfo(yesterdayBaseline, totalSpend, avgCPA);
  const lifecycleSummary = computeLifecycleFromSnapshots(active, todaySnapshots, prev.t15);
  const budgetUsed = totalSpend / effectiveBudget;
  const alerts = buildAlerts({ window3h, multiDay, totalSpend, timeProgress, avgCPA, totalConversions, active, openRetainRate, totalPrivateMsgRetain, totalPrivateMsgOpen, avgCPM, viewRetention, totalLiveOver1Min, totalLiveViews, convEfficiency, speedHour, speedCurrent, age15, age60, effectiveBudget, projectedDaily, pacingHealth, pacingRatio, budgetUsed, campaignDeltas, accountBudget, accountSpend, hasAccountData, accountBalance, dropping, trends, totalLeads });
  return { yoyInfo, lifecycleSummary, budgetUsed, alerts };
}
