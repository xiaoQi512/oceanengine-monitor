// tests/shift-pusher-lark.test.mjs - 换班 CLI 重试测试
import assert from 'node:assert';
import { withRetry } from '../src/services/shift-pusher-lark.mjs';

let calls = 0;
const result = await withRetry(async () => {
  calls++;
  if (calls < 3) throw new Error('boom');
  return 'ok';
}, 'label', 3, async () => {});
assert.strictEqual(result, 'ok');

console.log('\n全部测试通过');
