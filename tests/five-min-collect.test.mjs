// tests/five-min-collect.test.mjs - 5min 数据采集编排测试
import assert from 'node:assert';
import { collectFiveMinData } from '../src/services/five-min-collect.mjs';

let fallbackCalls = 0;
const baseDeps = {
  createApiClient: async () => ({}),
  getDashboardStats: async () => ({ todaySpend: 10, todayBudget: 100 }),
  getProjects: async () => ({ rows: [] }),
  buildApiSnapshot: (stats, projects, time) => ({ totalConv: 1, activeCount: 2, spendingCount: 3, time }),
  cdpFallback: async () => {
    fallbackCalls++;
    return { totalConv: 1 };
  },
};

const httpResult = await collectFiveMinData({ deps: baseDeps });
assert.strictEqual(httpResult.data.totalConv, 1);
assert.strictEqual(httpResult.data.spendingCount, 3);
assert.strictEqual(fallbackCalls, 0);

fallbackCalls = 0;
const fallbackResult = await collectFiveMinData({
  deps: {
    ...baseDeps,
    getDashboardStats: async () => ({ todaySpend: 0, todayBudget: 100 }),
  },
});
assert.strictEqual(fallbackCalls, 1);
assert.strictEqual(fallbackResult.data.totalConv, 1);

fallbackCalls = 0;
const failedResult = await collectFiveMinData({
  deps: {
    ...baseDeps,
    createApiClient: async () => { throw new Error('api down'); },
    cdpFallback: async () => { fallbackCalls++; return null; },
  },
});
assert.strictEqual(fallbackCalls, 1);
assert.strictEqual(failedResult.data, null);

console.log('\n全部测试通过');
