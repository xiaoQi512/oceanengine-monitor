// tests/shift-pusher-fetch.test.mjs - 换班数据拉取测试
import assert from 'node:assert';
import { fetchShiftData } from '../src/services/shift-pusher-fetch.mjs';

const data = await fetchShiftData({
  shift: { label: '09:00-12:00' },
  withRetry: async fn => fn(),
  createClientFn: async () => ({ tag: 'client' }),
  getShiftDeltaFn: async (today, shift, ctx) => ({ today, shift: shift.label, client: ctx.apiClient.tag }),
  getLocalDateFn: () => '2026-08-02',
  logErrorFn: () => {},
});
assert.strictEqual(data.shift, '09:00-12:00');
assert.strictEqual(data.client, 'client');

console.log('\n全部测试通过');
