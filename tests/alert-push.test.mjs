// tests/alert-push.test.mjs - 余额/预算告警推送测试
import assert from 'node:assert';
import { sendBalanceAlert, sendAccountBudgetAlert } from '../src/services/alert-push.mjs';

const ctx = {
  loadBalanceAlertState: () => ({ lastPush: 0, lastSeverity: '' }),
  saveBalanceAlertState: () => {},
  loadAccountBudgetAlertState: () => ({ lastPush: 0, lastSeverity: '' }),
  saveAccountBudgetAlertState: () => {},
  pushCard: async () => ({ ok: true }),
  config: { larkCli: 'lark', feishuChatId: 'chat', campaignUrl: 'url' },
};

assert.strictEqual(await sendBalanceAlert({ alerts: [] }, ctx), false);
assert.strictEqual(await sendAccountBudgetAlert({ alerts: [], summary: {} }, ctx), false);

assert.strictEqual(await sendBalanceAlert({
  alerts: [{ type: 'balance_low', severity: 'high', daysRemaining: 1 }],
  summary: { accountBalance: 100, totalSpend: 10 },
  delta: { dailyBudget: 100, budgetUsed: 0.1 },
}, ctx), true);

assert.strictEqual(await sendAccountBudgetAlert({
  alerts: [{ type: 'account_budget_cap' }],
  summary: { accountSpend: 950, accountBudget: 1000 },
  delta: { projectedDaily: 1100, timeProgress: 0.8, elapsedHours: 16, windowDuration: 16 },
  allSpending: [],
}, ctx), true);

console.log('\n全部测试通过');
