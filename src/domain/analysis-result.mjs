// src/domain/analysis-result.mjs - 最终分析结果组装

export function buildAnalysisResult({
  campaigns, active, allSpending, budgetExceededChanges, summary, delta, topNewSpenders, rampingUp, dropping, multiDay, window3h, campaignDeltas, alerts, now,
}) {
  return {
    active, allSpending, paused: campaigns.filter(c => c.status.includes('暂停')).length, budgetExceededChanges, summary, delta,
    topNewSpenders, rampingUp: rampingUp.slice(0, 5), _multiDay: multiDay, _window3h: window3h, dropping: dropping.slice(0, 5),
    topSpenders: topNewSpenders.map(c => ({...c})), topPerformers: campaignDeltas.filter(c => c.conversions > 0).sort((a, b) => a.cpa - b.cpa).slice(0, 5), topCVR: campaignDeltas.filter(c => c.conversions > 0).sort((a, b) => b.cvr - a.cvr).slice(0, 5), alerts, time: now.toISOString(),
  };
}

export function buildAnalysisSummaryAndDelta({
  active, allSpending, totalSpend, totalConversions, avgCPA, avgCTR, avgCVR, avgCPM, totalLeads, totalPrivateMsgOpen, totalPrivateMsgRetain, totalFormSubmit, openRetainRate, totalLiveViews, totalLiveOver1Min, viewRetention, convEfficiency, hasAccountData, accountSpend, accountBudget, accountBalance, useAccountSpend, spendSource, statusLabels,
  age15, age60, spendLast15min, spendLastHour, speedCurrent, speedHour, prevTotals, budgetUsed, effectiveBudget, convLast15min, cplLast15min, timeProgress, idealSpend, pacingRatio, pacingHealth, projectedDaily, timeSlot, elapsedHours, windowDuration, currentHour, trends, yoyInfo, lifecycleSummary,
}) {
  const summary = { totalActive: active.length, totalSpending: allSpending.length, totalSpend, totalConversions, avgCPA, avgCTR, avgCVR, avgCPM, totalLeads, totalPrivateMsgOpen, totalPrivateMsgRetain, totalFormSubmit, openRetainRate, totalLiveViews, totalLiveOver1Min, viewRetention, convEfficiency, accountSpend: hasAccountData ? accountSpend : null, accountBudget: accountBudget > 0 ? accountBudget : null, accountBalance: accountBalance > 0 ? accountBalance : null, useAccountSpend, spendSource, statusLabels };
  const delta = { age15, age60, spendLast15min, spendLastHour, speedCurrent, speedHour, prevCPA15: prevTotals.prevCPA15, prevCPA30: prevTotals.prevCPA30, prevTotal15: prevTotals.prevTotal15, budgetUsed, dailyBudget: effectiveBudget, convLast15min, cplLast15min, timeProgress, idealSpend, pacingRatio, pacingHealth, projectedDaily, timeSlot, elapsedHours, windowDuration, currentHour, trends: trends.cpaTrend || trends.spendTrend ? trends : null, yoy: yoyInfo, lifecycle: lifecycleSummary };
  return { summary, delta };
}
