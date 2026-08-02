// tests/monitor-summary-lines.test.mjs - 监控摘要文本测试
import assert from 'node:assert';
import { buildMonitorSummaryLines } from '../src/domain/monitor-summary-lines.mjs';

const lines = buildMonitorSummaryLines({
  summary: {
    totalSpending: 1,
    totalActive: 1,
    totalSpend: 100,
    totalConversions: 2,
    avgCPA: 50,
    statusLabels: [],
    totalLeads: 2,
    totalPrivateMsgRetain: 2,
    totalFormSubmit: 0,
    totalPrivateMsgOpen: 2,
    openRetainRate: 1,
    accountBudget: 0,
    accountBalance: 0,
  },
  delta: { age15: 15, spendLast15min: 10, convLast15min: 1, cplLast15min: 10, budgetUsed: 0.1, dailyBudget: 1000, pacingHealth: 'good', timeSlot: '12:00' },
  rampingUp: [],
  dropping: [],
  alerts: [],
  _window3h: null,
  _multiDay: null,
}, 3);
assert.ok(lines.some(l => l.includes('总消耗')));
assert.ok(lines.some(l => l.includes('耗时: 3s')));

console.log('\n全部测试通过');
