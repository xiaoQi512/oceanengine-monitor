// tests/push-state.test.mjs - 推送状态模块测试
import assert from 'node:assert';
import { PUSH_TYPES, loadLastPush, saveLastPush, appendPushLog } from '../src/services/push-state.mjs';

assert.strictEqual(typeof loadLastPush, 'function');
assert.strictEqual(typeof saveLastPush, 'function');
assert.strictEqual(typeof appendPushLog, 'function');
assert.strictEqual(PUSH_TYPES.MAIN, '主力监控');
assert.strictEqual(typeof loadLastPush().timestamp, 'number');

console.log('\n全部测试通过');
