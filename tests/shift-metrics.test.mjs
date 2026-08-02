// tests/shift-metrics.test.mjs - 换班指标计算测试
import assert from 'node:assert';
import { computeShiftCpl, normalizeShiftData, shouldSkipShift } from '../src/domain/shift-metrics.mjs';

assert.strictEqual(computeShiftCpl(100, 4), '25.00');
assert.strictEqual(computeShiftCpl(100, 0), '0.00');
const normalized = normalizeShiftData({ spend: 100, leads: 4 });
assert.deepStrictEqual(normalized, { totalConsume: 100, totalLeads: 4, cpl: '25.00' });
assert.strictEqual(normalizeShiftData(null), null);
assert.strictEqual(shouldSkipShift(0), true);
assert.strictEqual(shouldSkipShift(10), false);

console.log('\n全部测试通过');
