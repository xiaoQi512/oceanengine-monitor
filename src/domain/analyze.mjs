// src/domain/analyze.mjs - 15min 监控分析编排
import { buildCampaignIndex } from './analysis-utils.mjs';
import { getPrevCampaigns, buildBudgetExceededChanges } from './analysis-previous.mjs';
import { buildCampaignAggregate } from './analysis-aggregate.mjs';
import { buildIntermediateMetrics } from './analysis-intermediate.mjs';
import { buildStartState } from './analysis-start.mjs';
import { runAnalysisTail } from './analysis-tail.mjs';

export function analyzeCampaigns(campaigns, accountSpend = 0, accountBudget = 0, accountBalance = 0, pageSummary = null, {
  dailyBudget = 45000, dailyStartHour = 0, dailyStartMinute = 0, dailyEndHour = 24, dailyEndMinute = 0,
  previous = { t15: null, t30: null, t60: null }, multiDay = null, window3h = null, trends = { cpaTrend: null, spendTrend: null },
  yesterdayBaseline = null, todaySnapshots = [], now = new Date(),
} = {}) {
  const prev = previous;
  const start = buildStartState({ campaigns, accountSpend, accountBudget, dailyBudget, now });
  if (start.empty) return start.empty;
  const { allSpending, active, statusLabels, hasAccountData, useAccountSpend, spendSource, effectiveBudget } = start;
  const totalSpend = start.totalSpend;
  const agg = buildCampaignAggregate({ allSpending, active, accountSpend, accountBudget, pageSummary });
  const { totalConversions, avgCPA, avgCTR, avgCVR, avgCPM, totalLeads, totalPrivateMsgOpen, totalPrivateMsgRetain, totalFormSubmit, openRetainRate, totalLiveViews, totalLiveOver1Min, viewRetention, convEfficiency } = agg;
  const prevIndex15 = prev.t15 ? buildCampaignIndex(getPrevCampaigns(prev.t15)) : new Map();
  const prevIndex30 = prev.t30 ? buildCampaignIndex(getPrevCampaigns(prev.t30)) : new Map();
  const budgetExceededChanges = buildBudgetExceededChanges(allSpending, prevIndex15, prev.t15);
  const intermediate = buildIntermediateMetrics({ prev, useAccountSpend, avgCPA, totalSpend, active, prevIndex15 });
  return runAnalysisTail({
    campaigns, active, allSpending, statusLabels, hasAccountData, useAccountSpend, spendSource, effectiveBudget,
    totalSpend, totalConversions, avgCPA, avgCTR, avgCVR, avgCPM, totalLeads, totalPrivateMsgOpen, totalPrivateMsgRetain,
    totalFormSubmit, openRetainRate, totalLiveViews, totalLiveOver1Min, viewRetention, convEfficiency, accountSpend, accountBudget, accountBalance,
    prevTotals: intermediate.prevTotals, age15: intermediate.age15, age60: intermediate.age60, spendLast15min: intermediate.spendLast15min,
    spendLastHour: intermediate.spendLastHour, speedCurrent: intermediate.speedCurrent, speedHour: intermediate.speedHour,
    campaignDeltas: intermediate.campaignDeltas, convLast15min: intermediate.convLast15min, cplLast15min: intermediate.cplLast15min,
    topNewSpenders: intermediate.topNewSpenders, rampingUp: intermediate.rampingUp, dropping: intermediate.dropping,
    prev, todaySnapshots, yesterdayBaseline, window3h, multiDay, trends, dailyStartHour, dailyStartMinute, dailyEndHour, dailyEndMinute, now, budgetExceededChanges,
  });
}
