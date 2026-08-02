// tests/ai-regions-api.test.mjs - AI 区域 HTTP API 层测试
import assert from 'node:assert';
import { httpPost, getCookieData, buildStatQueryBody, API_BASE } from '../src/services/ai-regions-api.mjs';

const body = buildStatQueryBody('123', '2026-08-02');
assert.strictEqual(body.Filters.Conditions[0].Values[0], '123');
assert.strictEqual(body.StartTime, '2026-08-02 00:00:00');
assert.strictEqual(API_BASE, 'https://ad.oceanengine.com');

const postResult = await httpPost('https://example.com/api', { a: 1 }, { headers: {} }, 1000, {
  httpsRequestFn: (options, cb) => {
    const res = {
      on(event, fn) {
        if (event === 'data') fn('{"ok":true}');
        if (event === 'end') fn();
      },
    };
    cb(res);
    return { on() {}, write() {}, end() {}, destroy() {} };
  },
});
assert.deepStrictEqual(postResult, { ok: true });

const cached = await getCookieData({
  cookieCacheFile: 'cache.json',
  fsImpl: {
    existsSync: () => true,
    readFileSync: () => JSON.stringify({ expireAt: Date.now() + 10000, headers: {} }),
  },
  logFn: () => {},
});
assert.ok(cached.headers);

console.log('\n全部测试通过');
