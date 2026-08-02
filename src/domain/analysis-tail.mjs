// src/domain/analysis-tail.mjs - 分析收尾流程
import { computePacing } from './pacing-analysis.mjs';
import { buildAnalysisFinal } from './analysis-finalize.mjs';
import { buildAnalysisSummaryAndDelta, buildAnalysisResult } from './analysis-result.mjs';

export function runAnalysisTail(params) {
  const {
    campaigns, active, allSpending, statusLabels, hasAccountData, useAccountSpend, spendSource, effectiveBudget,
    totalSpend, totalConversions, avgCPA, avgCTR, avgCVR, avgCPM, totalLeads, totalPrivateMsgOpen, totalPrivateMsgRetain, totalFormSubmit,
    openRetainRate, totalLiveViews, totalLiveOver1Min, viewRetention, convEfficiency, accountSpend, accountBudget, accountBalance,
    prevTotals, age15, age60, spendLast15min, spendLastHour, speedCurrent, speedHour, campaignDeltas, convLast15min, cplLast15min,
    topNewSpenders, rampingUp, dropping, prev, todaySnapshots, yesterdayBaseline, window3h, multiDay, trends,
    dailyStartHour, dailyStartMinute, dailyEndHour, dailyEndMinute, now, budgetExceededChanges,
  } = params;
  console.log('  [DEBUG] CK5: pacing calc start, totalSpend=' + totalSpend + ' effectiveBudget=' + effectiveBudget);
  const pacing = computePacing({ now, dailyStartHour, dailyStartMinute, dailyEndHour, dailyEndMinute, effectiveBudget, totalSpend });
  const { currentHour, windowDuration, elapsedHours, timeProgress, idealSpend, pacingRatio, projectedDaily, pacingHealth, timeSlot } = pacing;
  console.log('  [DEBUG] CK6: alerts-start, pacingHealth=' + pacingHealth + ' timeSlot=' + timeSlot);
  const final = buildAnalysisFinal({
    yesterdayBaseline, totalSpend, avgCPA, todaySnapshots, prev, active, effectiveBudget, window3h, multiDay, timeProgress,
    totalConversions, openRetainRate, totalPrivateMsgRetain, totalPrivateMsgOpen, avgCPM, viewRetention, totalLiveOver1Min,
    totalLiveViews, convEfficiency, speedHour, speedCurrent, age15, age60, projectedDaily, pacingHealth, pacingRatio,
    campaignDeltas, accountBudget, accountSpend, hasAccountData, accountBalance, dropping, trends, totalLeads,
  });
  const { yoyInfo, lifecycleSummary, budgetUsed, alerts } = final;
  const { summary, delta } = buildAnalysisSummaryAndDelta({
    active, allSpending, totalSpend, totalConversions, avgCPA, avgCTR, avgCVR, avgCPM, totalLeads, totalPrivateMsgOpen, totalPrivateMsgRetain,
    totalFormSubmit, openRetainRate, totalLiveViews, totalLiveOver1Min, viewRetention, convEfficiency, hasAccountData, accountSpend,
    accountBudget, accountBalance, useAccountSpend, spendSource, statusLabels, age15, age60, spendLast15min, spendLastHour, speedCurrent,
    speedHour, prevTotals, budgetUsed, effectiveBudget, convLast15min, cplLast15min, timeProgress, idealSpend, pacingRatio, pacingHealth,
    projectedDaily, timeSlot, elapsedHours, windowDuration, currentHour, trends, yoyInfo, lifecycleSummary,
  });
  console.log('  [DEBUG] CK16: pre-return, totalSpend=' + totalSpend + ' totalConversions=' + totalConversions + ' avgCPA=' + avgCPA.toFixed(2));
  return buildAnalysisResult({ campaigns, active, allSpending, budgetExceededChanges, summary, delta, topNewSpenders, rampingUp, dropping, multiDay, window3h, campaignDeltas, alerts, now });
}
