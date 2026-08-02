// tests/page-actions.test.mjs - CDP 页面操作测试
import assert from 'node:assert';
import { closePopups, waitForTableReady, hasNextPage, clickNextPage } from '../src/cdp/page-actions.mjs';

function mockClient({ evalResult = true, sendResult = '{}' } = {}) {
  return {
    async evalJs() { return evalResult; },
    async send() { return { result: { result: { value: sendResult } } }; },
  };
}

await closePopups(mockClient());
assert.strictEqual(await waitForTableReady(mockClient(), 100), true);
assert.strictEqual(await hasNextPage(mockClient({ sendResult: '{"hasNext":true}' })), true);
assert.strictEqual(await clickNextPage(mockClient({ sendResult: '{"clicked":true}' })), true);

console.log('\n全部测试通过');
