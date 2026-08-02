// tests/alert-cards.test.mjs - 余额/账户预算告警卡片测试
import assert from 'node:assert';
import { buildBalanceAlertCard, buildAccountBudgetAlertCard } from '../src/services/alert-cards.mjs';

const config = { campaignUrl: 'https://example.com' };
const balanceCard = buildBalanceAlertCard({
  analysis: {
    summary: { accountBalance: 100, totalSpend: 50 },
    delta: { dailyBudget: 1000, budgetUsed: 0.05, timeSlot: '12:00' },
  },
  worst: { severity: 'high', daysRemaining: 0.5, projectedDaily: 200 },
  config,
});
assert.strictEqual(balanceCard.header.template, 'red');
assert.ok(balanceCard.elements[0].text.content.includes('当前余额'));

const budgetCard = buildAccountBudgetAlertCard({
  analysis: {
    active: [],
    allSpending: [],
  },
  config,
  d: { timeProgress: 0.5, elapsedHours: 8, windowDuration: 16, timeSlot: '12:00' },
  severity: 'high',
  accountSpend: 95,
  accountBudget: 100,
  usedPct: 0.95,
  projectedDaily: 120,
  overSpend: 20,
  isCritical: true,
  headerColor: 'red',
  statusIcon: '🔴',
  urgencyLabel: '⚠️ 立即追加预算',
});
assert.strictEqual(budgetCard.header.template, 'red');
assert.ok(budgetCard.elements[0].text.content.includes('95.0%'));

console.log('\n全部测试通过');
