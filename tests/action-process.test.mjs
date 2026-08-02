// tests/action-process.test.mjs - action 队首处理纯编排测试
import assert from 'node:assert';
import { processHead } from '../src/services/action-process.mjs';

const result = await processHead({
  loadQueue: async () => ({ actions: [] }),
});
assert.deepStrictEqual(result, { processed: false, reason: 'empty' });

console.log('\n全部测试通过');
