// tests/shift-schedule.test.mjs - 换班结束时间测试
import assert from 'node:assert';
import { getShiftEndMinutes, isShiftEnded } from '../src/domain/shift-schedule.mjs';

assert.strictEqual(getShiftEndMinutes({ label: '09:00-12:30' }), 750);
assert.strictEqual(getShiftEndMinutes({ label: 'bad' }), -1);
assert.strictEqual(isShiftEnded({ label: '09:00-12:00' }, new Date(2026, 7, 2, 12, 10)), true);
assert.strictEqual(isShiftEnded({ label: '09:00-12:00' }, new Date(2026, 7, 2, 13, 0)), false);

console.log('\n全部测试通过');
