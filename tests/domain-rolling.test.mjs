// tests/domain-rolling.test.mjs - 5min 环比纯逻辑测试
import assert from 'node:assert';
import { getSpend, getConv, calcRolling } from '../src/domain/rolling.mjs';

const minutesBetween = (a, b) => Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 60000;
const data = { accountSpend: 100, totalConv: 10, time: '2026-08-01T12:05:00Z' };
const prev = [
  { accountSpend: 90, totalConv: 8, time: '2026-08-01T12:00:00Z' },
  { accountSpend: 70, totalConv: 6, time: '2026-08-01T11:55:00Z' },
  { accountSpend: 50, totalConv: 4, time: '2026-08-01T11:50:00Z' },
];

assert.strictEqual(getSpend(data), 100);
assert.strictEqual(getConv(data), 10);

const rolling = calcRolling(data, prev, {
  minutesBetween,
  now: '2026-08-01T12:05:00Z',
});
assert.strictEqual(rolling.last5min, 10);
assert.strictEqual(rolling.last5minMinutes, 5);
assert.strictEqual(rolling.convLast5min, 2);
assert.strictEqual(rolling.windows.length, 3);
assert.ok(rolling.windows.some(w => w.hot));

console.log('\n全部测试通过');
