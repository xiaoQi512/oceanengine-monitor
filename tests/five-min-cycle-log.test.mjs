// tests/five-min-cycle-log.test.mjs - 5min 日志格式测试
import assert from 'node:assert';
import { pad, timeStr, formatFiveMinSkipReason, formatFiveMinForceReason } from '../src/domain/five-min-cycle-log.mjs';

assert.strictEqual(pad(5), '05');
assert.strictEqual(timeStr(new Date(2026, 7, 2, 9, 5)), '09:05');
assert.ok(formatFiveMinSkipReason('quarter_hour', 0).includes('整点时刻'));
assert.ok(formatFiveMinSkipReason('outside_window', { hour: 8, minute: 0, shiftWin: { startHour: 9, endHour: 23 } }).includes('静默'));
assert.ok(formatFiveMinForceReason(9, 5).includes('强制'));

console.log('\n全部测试通过');
