// tests/shift-pusher-cache.test.mjs - 换班缓存测试
import assert from 'node:assert';
import { createShiftCache } from '../src/services/shift-pusher-cache.mjs';

const cache = createShiftCache();
cache.ensureTodayShifts({
  getLocalDateFn: () => '2026-08-02',
  readTodayShiftsFn: () => [{ label: '09:00-12:00', row: 200, hours: [9, 10, 11] }],
  logFn: () => {},
});
assert.strictEqual(cache.getTodayShifts()[0].label, '09:00-12:00');
cache.markProcessed('09:00-12:00');
assert.strictEqual(cache.isProcessed('09:00-12:00'), true);

console.log('\n全部测试通过');
