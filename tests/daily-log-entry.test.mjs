// tests/daily-log-entry.test.mjs - 日报日志条目测试
import assert from 'node:assert';
import { buildDailyLogEntry } from '../src/domain/daily-log-entry.mjs';

const entry = buildDailyLogEntry({
  summary: { totalSpending: 1, totalActive: 1, totalSpend: 10, totalConversions: 1, avgCPA: 10 },
  delta: { spendLast15min: 2, speedCurrent: 1, timeSlot: '12:00' },
  rampingUp: [{}],
  dropping: [],
  alerts: [{ type: 'budget' }],
});
assert.strictEqual(entry.totalSpend, 10);
assert.deepStrictEqual(entry.alertTypes, ['budget']);

console.log('\n全部测试通过');
