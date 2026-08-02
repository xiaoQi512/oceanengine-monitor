// tests/monitor-summary.test.mjs - 监控摘要输出测试
import assert from 'node:assert';
import { printMonitorSummary } from '../src/domain/monitor-summary.mjs';

const analysis = {
  summary: {
    totalSpending: 1,
    totalActive: 1,
    totalSpend: 100,
    totalConversions: 1,
    totalLeads: 1,
    avgCPA: 100,
    accountBudget: 0,
    accountBalance: 0,
  },
  delta: { age15: 15, spendLast15min: 10, convLast15min: 1, budgetUsed: 0.1, dailyBudget: 45000 },
  rampingUp: [],
  dropping: [],
  alerts: [],
};

const logs = [];
const origLog = console.log;
console.log = (...args) => logs.push(args.join(' '));
try {
  printMonitorSummary(analysis, '1');
} finally {
  console.log = origLog;
}
assert.ok(logs.some(l => l.includes('总消耗')));
assert.ok(logs.some(l => l.includes('告警数')));
assert.ok(logs.some(l => l.includes('耗时')));

console.log('\n全部测试通过');
