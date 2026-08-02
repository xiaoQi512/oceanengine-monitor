// tests/five-min-cycle.test.mjs - 5min 监控运行周期编排测试
import assert from 'node:assert';
import { runFiveMinCycle } from '../src/services/five-min-cycle.mjs';

const calls = [];
const data = {
  accountSpend: 10,
  summarySpend: 10,
  totalConv: 1,
  activeCount: 2,
  spendingCount: 1,
};
const baseDeps = {
  getTodayShiftWindow: () => ({ startHour: 9, startMinute: 0, endHour: 23, endMinute: 0 }),
  shouldRun5min: () => ({ run: true, reason: 'normal' }),
  timeStr: () => '12:00',
  collectFiveMinData: async () => ({ data }),
  loadRecent5minSnapshots: () => [],
  correctConversionFallback: () => ({ from: false }),
  detectCdpZeroSpend: () => ({ skip: false, lastValid: null }),
  calcRolling: () => ({ last5min: 5, last5minMinutes: 5 }),
  computeRecentCpm: () => 10,
  getSpend: () => 10,
  saveFiveMinSnapshot: () => calls.push('snapshot'),
  loadLastPushState: () => ({}),
  shouldPushFiveMin: () => ({ push: true, elapsedMinutes: 5 }),
  isQuarterHour: () => false,
  pushDetailedCard: async () => calls.push('detailed'),
  pushQuickReport: async () => calls.push('quick'),
  saveLastPushState: () => calls.push('save-push'),
  dualInsertSnapshot: () => ({ ok: true, rows: 1 }),
};

const skipped = await runFiveMinCycle({
  deps: { ...baseDeps, shouldRun5min: () => ({ run: false, reason: 'night' }) },
});
assert.deepStrictEqual(skipped, { skipped: true });

calls.length = 0;
const result = await runFiveMinCycle({ deps: baseDeps });
assert.deepStrictEqual(result, { ok: true });
assert.deepStrictEqual(calls, ['snapshot', 'quick', 'save-push']);

calls.length = 0;
await runFiveMinCycle({
  deps: {
    ...baseDeps,
    isQuarterHour: () => true,
    pushDetailedCard: async () => calls.push('detailed'),
  },
});
assert.deepStrictEqual(calls, ['snapshot', 'detailed', 'save-push']);

console.log('\n全部测试通过');
