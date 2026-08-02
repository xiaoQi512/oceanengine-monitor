// src/domain/analysis-previous.mjs - 历史快照与速度基线
import { buildCampaignIndex } from './campaign-index.mjs';

export function getPrevCampaigns(snap) {
  return (snap?.allSpending?.length > (snap?.active?.length || 0)) ? snap.allSpending : (snap?.active?.length ? snap.active : (snap?.allSpending || []));
}

export function buildBudgetExceededChanges(allSpending, prevIndex15, prev15) {
  const changes = [];
  if (!prev15) return changes;
  for (const c of allSpending) {
    const prevC = prevIndex15.get(c.id);
    if (!prevC) continue;
    const wasActive = prevC.status === '投放中';
    const nowExceeded = typeof c.status === 'string' && c.status.includes('超出预算');
    if (wasActive && nowExceeded) changes.push({ id: c.id, name: c.name, spend: c.spend || 0, budget: c.budget || 0, prevStatus: prevC.status, curStatus: c.status });
  }
  if (changes.length > 0) console.log(`  ⚠️ 检测到 ${changes.length} 条计划从「投放中」变为「项目超出预算」: ${changes.map(c => c.name.slice(0, 20)).join(', ')}`);
  return changes;
}

export function computePreviousTotals({ prev, useAccountSpend, avgCPA }) {
  const prevTotal15 = useAccountSpend ? (prev.t15?.summary?.accountSpend > 0 ? prev.t15.summary.accountSpend : null) : (prev.t15?.summary?.totalSpend || null);
  const prevTotal30 = useAccountSpend ? (prev.t30?.summary?.accountSpend > 0 ? prev.t30.summary.accountSpend : null) : (prev.t30?.summary?.totalSpend || prevTotal15);
  const prevTotal60 = useAccountSpend ? (prev.t60?.summary?.accountSpend > 0 ? prev.t60.summary.accountSpend : null) : (prev.t60?.summary?.totalSpend || prevTotal30);
  const prevCPA15 = prev.t15?.summary?.avgCPA || avgCPA;
  const prevCPA30 = prev.t30?.summary?.avgCPA || prevCPA15;
  return { prevTotal15, prevTotal30, prevTotal60, prevCPA15, prevCPA30 };
}
