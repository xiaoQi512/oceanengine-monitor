// tests/domain-alerts.test.mjs - 告警规则纯逻辑测试
import assert from 'node:assert';
import { buildAlerts } from '../src/domain/alerts.mjs';

const alerts = buildAlerts({
  totalSpend: 100,
  effectiveBudget: 1000,
  budgetUsed: 0.9,
  projectedDaily: 200,
  campaignDeltas: [{
    id: 'c1',
    name: '测试计划',
    spend: 60,
    conversions: 0,
  }],
  active: [{ id: 'c1', name: '测试计划', _lifecycle: 'dead' }],
  dropping: [
    { name: 'A', spendDelta: 1, changeRate: -0.2 },
    { name: 'B', spendDelta: 1, changeRate: -0.2 },
    { name: 'C', spendDelta: 1, changeRate: -0.2 },
  ],
  trends: {
    cpaTrend: { spanMinutes: 60, slope: 1, changeRate: 0.2 },
    spendTrend: null,
  },
  accountBudget: 100,
  accountSpend: 100,
});

const types = new Set(alerts.map(a => a.type));
assert.ok(types.has('zero_conv'));
assert.ok(types.has('budget'));
assert.ok(types.has('account_budget_cap'));
assert.ok(types.has('dropping'));
assert.ok(types.has('cpa_trend'));
assert.ok(types.has('dead_plan'));

assert.strictEqual(buildAlerts({}).length, 0);

console.log('\n全部测试通过');
