// src/domain/alerts.mjs - 15min 监控告警规则聚合（纯逻辑）
import { buildWindow3hAlerts } from './window-alerts.mjs';
import { buildMultiDayAlerts, buildCompoundRiskAlert } from './multiday-alerts.mjs';
import {
  buildCampaignAlerts,
  buildAccountBudgetAlerts,
  buildBalanceAlerts,
  buildDroppingAlerts,
  buildTrendAlerts,
  buildDeadPlanAlerts,
} from './plan-alerts.mjs';

export function buildAlerts({
  window3h = null,
  multiDay = null,
  totalSpend = 0,
  timeProgress = 0,
  avgCPA = 0,
  totalConversions = 0,
  active = [],
  openRetainRate = 0,
  totalPrivateMsgRetain = 0,
  totalPrivateMsgOpen = 0,
  avgCPM = 0,
  viewRetention = 0,
  totalLiveOver1Min = 0,
  totalLiveViews = 0,
  convEfficiency = 0,
  speedHour = 0,
  speedCurrent = 0,
  age15 = 15,
  age60 = 60,
  effectiveBudget = 0,
  projectedDaily = 0,
  pacingHealth = '',
  pacingRatio = 0,
  budgetUsed = 0,
  campaignDeltas = [],
  accountBudget = 0,
  accountSpend = 0,
  hasAccountData = false,
  accountBalance = 0,
  dropping = [],
  trends = { cpaTrend: null, spendTrend: null },
  totalLeads = 0,
} = {}) {
  const alerts = [
    ...buildWindow3hAlerts(window3h),
    ...buildMultiDayAlerts({
      multiDay,
      totalSpend,
      timeProgress,
      avgCPA,
      totalConversions,
      active,
      openRetainRate,
      totalPrivateMsgRetain,
      totalPrivateMsgOpen,
      avgCPM,
      viewRetention,
      totalLiveOver1Min,
      totalLiveViews,
      convEfficiency,
    }),
  ];
  const compound = buildCompoundRiskAlert({ multiDay, openRetainRate, avgCPA, avgCPM, viewRetention, convEfficiency });
  if (compound) alerts.push(compound);

  if (speedHour > 0 && speedCurrent > speedHour * 2 && speedCurrent > 7) {
    alerts.push({
      type: 'speed_spike',
      name: `${Math.round(age15)}m突发消耗加速`,
      detail: `近${Math.round(age15)}m速度 ¥${speedCurrent.toFixed(0)}/min，为${Math.round(age60)}h均速的 ${((speedCurrent/speedHour)*100).toFixed(0)}%`,
      severity: speedCurrent > speedHour * 3 ? 'high' : 'medium',
    });
  }

  if (budgetUsed > 0.85) {
    alerts.push({
      type: 'budget',
      name: budgetUsed > 1 ? '日预算已用完' : '日预算即将耗尽',
      detail: `已消耗 ¥${totalSpend.toFixed(0)} / 预算 ¥${effectiveBudget.toFixed(0)} (${(budgetUsed*100).toFixed(0)}%)，预估今日 ¥${projectedDaily.toFixed(0)}`,
      severity: budgetUsed > 1 ? 'high' : budgetUsed > 0.92 ? 'high' : 'medium',
    });
  }
  if (pacingHealth === 'danger' && pacingRatio > 1.5 && budgetUsed < 0.85) {
    alerts.push({ type: 'pacing_fast', name: '消耗节奏过快', detail: `已消耗 ¥${totalSpend.toFixed(0)} (${(budgetUsed*100).toFixed(0)}%)，远超时间进度 ${(timeProgress*100).toFixed(0)}%`, severity: pacingRatio > 2 ? 'high' : 'medium' });
  }
  if (pacingHealth === 'danger' && pacingRatio < 0.6 && timeProgress > 0.3) {
    alerts.push({ type: 'pacing_slow', name: '消耗进度严重落后', detail: `已消耗 ¥${totalSpend.toFixed(0)} (${(budgetUsed*100).toFixed(0)}%)，落后时间进度 ${(timeProgress*100).toFixed(0)}%`, severity: 'medium' });
  }

  alerts.push(...buildCampaignAlerts(campaignDeltas, avgCPA));
  alerts.push(...buildAccountBudgetAlerts(accountBudget, accountSpend));
  alerts.push(...buildBalanceAlerts({ hasAccountData, accountBalance, projectedDaily, effectiveBudget }));
  alerts.push(...buildDroppingAlerts(dropping, age15));
  alerts.push(...buildTrendAlerts(trends));
  alerts.push(...buildDeadPlanAlerts(active));

  console.log('  [DEBUG] CK10: funnel-updated, alertCount=' + alerts.length + ' totalLeads=' + totalLeads);

  const severityOrder = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return alerts;
}
