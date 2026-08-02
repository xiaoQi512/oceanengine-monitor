// tests/api-client-injection.test.mjs - platform Cookie 提取器依赖注入测试
import assert from 'node:assert';
import { createClient, setCookieExtractor } from '../src/platform/oec-client.mjs';

let calls = 0;
const fakeExtractor = async () => {
  calls++;
  return {
    cookies: 'test=1',
    headers: { Cookie: 'test=1', 'User-Agent': 'test' },
    expireAt: Date.now() + 60 * 60 * 1000,
  };
};

const injected = await createClient({ useCache: false, cookieExtractor: fakeExtractor });
assert.strictEqual(injected.cookieData.cookies, 'test=1');
assert.strictEqual(calls, 1);

const refreshed = await injected.refreshCookies();
assert.strictEqual(refreshed.cookies, 'test=1');
assert.strictEqual(calls, 2);

setCookieExtractor(fakeExtractor);
const defaulted = await createClient({ useCache: false });
assert.strictEqual(defaulted.cookieData.cookies, 'test=1');

console.log('\n全部测试通过');
