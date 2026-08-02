// tests/alert-card-lines.test.mjs - 告警卡片文本测试
import assert from 'node:assert';
import { buildBalanceCardLines, buildAccountBudgetCardLines } from '../src/domain/alert-card-lines.mjs';

const balance = buildBalanceCardLines({
  analysis: { summary: { accountBalance: 100, totalSpend: 50 } },
  worst: { severity: 'high', daysRemaining: 0.5, projectedDaily: 200 },
  d: { dailyBudget: 1000, budgetUsed: 0.05, timeSlot: '12:00' },
});
assert.ok(balance.some(l => l.includes('当前余额')));
const budget = buildAccountBudgetCardLines({
  analysis: { allSpending: [] },
  d: { timeProgress: 0.5, elapsedHours: 8, windowDuration: 16, timeSlot: '12:00' },
  accountSpend: 95,
  accountBudget: 100,
  usedPct: 0.95,
  projectedDaily: 120,
  overSpend: 20,
  isCritical: true,
});
assert.ok(budget.some(l => l.includes('95.0%')));

console.log('\n全部测试通过');
