// tests/page-setup.test.mjs - 页面分页/排序测试
import assert from 'node:assert';
import { setPageSize, sortBySpend } from '../src/cdp/page-setup.mjs';

const sizeClient = { async send() { return { result: { result: { value: '50条/页' } } }; } };
const sortClient = { async send() { return { result: { result: { value: '{"downActive":true}' } } }; } };

assert.strictEqual(await setPageSize(sizeClient, 50), true);
await sortBySpend(sortClient);

console.log('\n全部测试通过');
