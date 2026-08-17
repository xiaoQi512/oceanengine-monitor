// tests/five-minute-schedule.test.mjs - 5min 窗口/推送决策测试
import assert from 'node:assert';
import { shouldRun5min, shouldPush5min, isQuarterHour } from '../src/domain/five-minute-schedule.mjs';

assert.strictEqual(shouldRun5min({ minute: 0, hour: 10 }).run, false);
assert.strictEqual(shouldRun5min({ minute: 5, hour: 10, force: true }).run, true);
assert.strictEqual(shouldPush5min({}, 60000).push, true);
assert.strictEqual(isQuarterHour(30), true);

// 常规窗口 7:00-23:00
assert.strictEqual(shouldRun5min({ minute: 5, hour: 10, shiftWin: { startHour: 7, endHour: 23 } }).run, true);
assert.strictEqual(shouldRun5min({ minute: 5, hour: 23, shiftWin: { startHour: 7, endHour: 23 } }).run, false);
assert.strictEqual(shouldRun5min({ minute: 5, hour: 6, shiftWin: { startHour: 7, endHour: 23 } }).run, false);

// 跨天窗口 17:00-15:30:凌晨 0:00-15:30 与晚间 17:00-24:00 应视为窗口内
const overnight = { startHour: 17, endHour: 15, endMinute: 30 };
assert.strictEqual(shouldRun5min({ minute: 5, hour: 0, shiftWin: overnight }).run, true);
assert.strictEqual(shouldRun5min({ minute: 25, hour: 7, shiftWin: overnight }).run, true);
assert.strictEqual(shouldRun5min({ minute: 5, hour: 15, shiftWin: overnight }).run, true);
assert.strictEqual(shouldRun5min({ minute: 5, hour: 15, shiftWin: overnight, force: false }).run, true);
assert.strictEqual(shouldRun5min({ minute: 35, hour: 15, shiftWin: overnight }).run, false);
assert.strictEqual(shouldRun5min({ minute: 5, hour: 16, shiftWin: overnight }).run, false);
assert.strictEqual(shouldRun5min({ minute: 5, hour: 17, shiftWin: overnight }).run, true);
assert.strictEqual(shouldRun5min({ minute: 55, hour: 23, shiftWin: overnight }).run, true);

console.log('\n全部测试通过');
