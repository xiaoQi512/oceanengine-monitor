// tests/shift-pusher-shift.test.mjs - shift-pusher 单班次业务入口测试
import assert from 'node:assert';
import { runShift } from '../src/services/shift-pusher-shift.mjs';

assert.strictEqual(typeof runShift, 'function');

console.log('\n全部测试通过');
