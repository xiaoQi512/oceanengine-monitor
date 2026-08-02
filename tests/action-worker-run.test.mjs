// tests/action-worker-run.test.mjs - action worker 运行编排测试
import assert from 'node:assert';
import { processHead, runOnce } from '../src/services/action-worker-run.mjs';

const empty = await processHead({
  loadQueue: async () => ({ actions: [] }),
});
assert.deepStrictEqual(empty, { processed: false, reason: 'empty' });

let released = false;
let processed = false;
const once = await runOnce({
  acquireLock: () => true,
  releaseLock: () => { released = true; },
  loadQueue: async () => ({ actions: [] }),
  processHead: async () => {
    processed = true;
    return { processed: false, reason: 'empty' };
  },
});
assert.deepStrictEqual(once, { processed: false, reason: 'empty' });
assert.strictEqual(processed, true);
assert.strictEqual(released, true);

console.log('\n全部测试通过');
