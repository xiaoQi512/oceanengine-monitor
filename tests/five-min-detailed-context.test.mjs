// tests/five-min-detailed-context.test.mjs - 详细卡片指标上下文测试
import assert from 'node:assert';
import { buildDetailedCardContext } from '../src/services/five-min-detailed-context.mjs';

const ctx = await buildDetailedCardContext({
  allData: {
    campaigns: [{ id: 1, spend: 10, name: '计划A', conversions: 1, cpm: 2 }],
    pageSummary: { conversions: 1, impressions: 100, liveViews: 10, liveOver1Min: 5 },
    accountSpend: 10,
    accountBudget: 100,
    accountBalance: 100,
  },
  apiClient: {},
  pm2Prefix: '[test]',
  d: {
    loadRecent5minSnapshots: () => [],
    getLiveWindowLabel: () => ({ labelCompact: '直播' }),
    getTodayShiftWindow: () => ({ startHour: 9, startMinute: 0, endHour: 23, endMinute: 0 }),
    minutesBetween: () => 15,
    calcRolling: () => ({ last5min: 5, convLast5min: 0, windows: [] }),
    getHourlyStats: async () => null,
  },
});
assert.strictEqual(ctx.spend, 10);
assert.strictEqual(ctx.pm2Prefix, '[test]');
assert.strictEqual(ctx.spendingCount, 1);
assert.strictEqual(ctx.topLines[0], '📊 **有消耗计划 TOP5**');

console.log('\n全部测试通过');
