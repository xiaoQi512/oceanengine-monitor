// src/domain/analysis-empty.mjs - 空分析结果

export function buildEmptyAnalysis({ accountBudget, accountSpend, effectiveBudget, now }) {
  return {
    active: [], allSpending: [], paused: 0, alerts: [],
    summary: { totalActive: 0, totalSpending: 0, totalSpend: 0, totalConversions: 0, avgCPA: 0, avgCTR: 0, avgCVR: 0, avgCPM: 0,
      totalLeads: 0, totalPrivateMsgOpen: 0, totalPrivateMsgRetain: 0, totalFormSubmit: 0, openRetainRate: 0,
      accountSpend: accountBudget > 0 ? accountSpend : null, accountBudget: accountBudget > 0 ? accountBudget : null,
      useAccountSpend: accountBudget > 0, spendSource: accountBudget > 0 ? 'account' : 'none', statusLabels: [] },
    delta: { age15: 0, age60: 0, spendLast15min: 0, spendLastHour: 0, speedCurrent: 0, speedHour: 0,
      prevCPA15: 0, prevCPA30: 0, prevTotal15: 0, budgetUsed: 0, dailyBudget: effectiveBudget,
      timeProgress: 0, idealSpend: 0, pacingRatio: 0, pacingHealth: 'N/A', projectedDaily: 0,
      timeSlot: '已结束', elapsedHours: 0, windowDuration: 16, currentHour: 0,
      convLast15min: 0, cplLast15min: 0, trends: null, yoy: null, lifecycle: {} },
    topNewSpenders: [], rampingUp: [], dropping: [], topSpenders: [], topPerformers: [], topCVR: [],
    time: now.toISOString(),
  };
}
