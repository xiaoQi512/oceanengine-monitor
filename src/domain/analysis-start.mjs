// src/domain/analysis-start.mjs - 分析起始状态
import { classifyCampaigns, buildStatusLabels } from './campaign-classification.mjs';
import { buildEmptyAnalysis } from './analysis-empty.mjs';

export function buildStartState({ campaigns, accountSpend, accountBudget, dailyBudget, now }) {
  const { allSpending, active } = classifyCampaigns(campaigns);
  const statusLabels = buildStatusLabels(allSpending);
  const hasAccountData = accountBudget > 0;
  const allSpendSum = allSpending.reduce((s, c) => s + c.spend, 0);
  const activeSpendSum = active.reduce((s, c) => s + c.spend, 0);
  const useAccountSpend = hasAccountData;
  const totalSpend = hasAccountData ? accountSpend : (allSpendSum > 0 ? allSpendSum : activeSpendSum);
  const spendSource = useAccountSpend ? 'account' : (allSpendSum > activeSpendSum ? 'all_plans' : 'active_only');
  const effectiveBudget = accountBudget > 0 ? accountBudget : dailyBudget;
  const empty = allSpending.length === 0 && !useAccountSpend ? buildEmptyAnalysis({ accountBudget, accountSpend, effectiveBudget, now }) : null;
  return { allSpending, active, statusLabels, hasAccountData, useAccountSpend, totalSpend, spendSource, effectiveBudget, empty };
}
