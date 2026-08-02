// tests/five-minute-schedule.test.mjs - 5min 窗口/推送决策测试
import assert from 'node:assert';
import { shouldRun5min, shouldPush5min, isQuarterHour } from '../src/domain/five-minute-schedule.mjs';

assert.strictEqual(shouldRun5min({ minute: 0, hour: 10 }).run, false);
assert.strictEqual(shouldRun5min({ minute: 5, hour: 10, force: true }).run, true);
assert.strictEqual(shouldPush5min({}, 60000).push, true);
assert.strictEqual(isQuarterHour(30), true);

console.log('\n全部测试通过');
