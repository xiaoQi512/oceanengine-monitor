// tests/baseline-analysis.test.mjs - 基线计算测试
import assert from 'node:assert';
import { computeYesterdayBaseline, computeMultiDayBaseline } from '../src/domain/baseline-analysis.mjs';

const nowDate = new Date('2026-08-01T12:00:00Z');
const yesterday = computeYesterdayBaseline([
  { time: '2026-07-31T10:00:00Z', accountSpend: 100 },
  { time: '2026-07-31T12:00:00Z', accountSpend: 200 },
], nowDate, '2026-07-31');
assert.strictEqual(yesterday.totalSpend, 200);

const multiDay = computeMultiDayBaseline([
  { date: '2026-07-30', log: [
    { time: '2026-07-30T10:00:00Z', accountSpend: 100 },
    { time: '2026-07-30T11:00:00Z', accountSpend: 200 },
    { time: '2026-07-30T12:00:00Z', accountSpend: 300 },
  ] },
  { date: '2026-07-31', log: [
    { time: '2026-07-31T10:00:00Z', accountSpend: 400 },
    { time: '2026-07-31T11:00:00Z', accountSpend: 500 },
    { time: '2026-07-31T12:00:00Z', accountSpend: 600 },
  ] },
], nowDate);
assert.strictEqual(multiDay.sampleDays, 2);
assert.ok(multiDay.spend.mean > 0);

console.log('\n全部测试通过');
