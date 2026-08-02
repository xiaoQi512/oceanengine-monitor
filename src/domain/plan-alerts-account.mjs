// src/domain/plan-alerts-account.mjs - 账户预算/余额告警

export function buildAccountBudgetAlerts(accountBudget = 0, accountSpend = 0) {
  if (accountBudget <= 0 || accountSpend < accountBudget * 0.8) return [];
  const exceedPct = ((accountSpend / accountBudget) * 100);
  return [{ type: 'account_budget_cap', name: accountSpend >= accountBudget ? '账户日预算已用完' : '账户预算即将耗尽', detail: accountSpend >= accountBudget ? `账户消耗 ¥${accountSpend.toFixed(0)} 已达日预算 ¥${accountBudget.toFixed(0)} (${exceedPct.toFixed(0)}%)，所有计划将暂停，建议追加账户预算` : `账户消耗 ¥${accountSpend.toFixed(0)} / 日预算 ¥${accountBudget.toFixed(0)} (${exceedPct.toFixed(0)}%)，建议追加账户预算或调整计划预算分配`, severity: accountSpend >= accountBudget ? 'high' : 'medium' }];
}

export function buildBalanceAlerts({ hasAccountData, accountBalance, projectedDaily, effectiveBudget }) {
  if (!hasAccountData || accountBalance <= 0) return [];
  const effectiveDailyBurn = projectedDaily > 0 ? projectedDaily : effectiveBudget;
  const daysRemaining = effectiveDailyBurn > 0 ? accountBalance / effectiveDailyBurn : 999;
  const dailyLabel = projectedDaily > 0 ? `日耗约 ¥${projectedDaily.toFixed(0)}` : `日预算 ¥${effectiveBudget.toFixed(0)}`;
  if (daysRemaining < 1) return [{ type: 'balance_low', name: '账户余额严重不足', detail: `余额 ¥${accountBalance.toFixed(0)} 不足支撑1天 (${dailyLabel})，预计今日/明日耗尽，请立即充值！`, severity: 'high', daysRemaining, projectedDaily: effectiveDailyBurn }];
  if (daysRemaining < 2) return [{ type: 'balance_low', name: '账户余额不足', detail: `余额 ¥${accountBalance.toFixed(0)} 仅支撑约 ${daysRemaining.toFixed(1)} 天 (${dailyLabel})，建议尽快充值`, severity: 'medium', daysRemaining, projectedDaily: effectiveDailyBurn }];
  if (daysRemaining < 3) return [{ type: 'balance_low', name: '账户余额偏低', detail: `余额 ¥${accountBalance.toFixed(0)} 可支撑约 ${daysRemaining.toFixed(1)} 天 (${dailyLabel})，可提前安排充值`, severity: 'low', daysRemaining, projectedDaily: effectiveDailyBurn }];
  return [];
}
