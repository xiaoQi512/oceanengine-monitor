// tests/domain-five-minute-logic.test.mjs - 5min 主流程纯逻辑测试
import assert from 'node:assert';
import {
  shouldRun5min,
  normalizeApiProjects,
  buildApiSnapshot,
  correctConversionFallback,
  detectCdpZeroSpend,
  computeRecentCpm,
  shouldPush5min,
  isQuarterHour,
} from '../src/domain/five-minute-logic.mjs';

assert.strictEqual(shouldRun5min({ minute: 15, hour: 10, shiftWin: { startHour: 7, endHour: 23 } }).run, false);
assert.strictEqual(shouldRun5min({ minute: 15, hour: 10, force: true, shiftWin: { startHour: 7, endHour: 23 } }).run, true);
assert.strictEqual(shouldRun5min({ minute: 5, hour: 2, shiftWin: { startHour: 7, endHour: 23 } }).run, false);
assert.strictEqual(shouldRun5min({ minute: 5, hour: 10, shiftWin: { startHour: 7, endHour: 23 } }).run, true);

const stats = {
  todaySpend: 100,
  todayBudget: 500,
  balance: 1000,
};
const projectsPage = {
  totalMetrics: {
    convert_cnt: '1,000',
    show_cnt: '10,000',
    luban_live_enter_cnt: '200',
    live_watch_one_minute_count: '80',
  },
  projects: [{
    project_id: 'p1',
    project_name: '计划A',
    project_status_name: '投放中',
    campaign_budget: '1,000',
    metrics: {
      stat_cost: '100',
      convert_cnt: '10',
      ctr: '2%',
      cpm_platform: '50',
      conversion_rate: '10%',
    },
  }],
};

const normalized = normalizeApiProjects(projectsPage);
assert.strictEqual(normalized.totalConv, 1000);
assert.strictEqual(normalized.totalImp, 10000);
assert.strictEqual(normalized.activeCnt, 1);
assert.strictEqual(normalized.spendingCount, 1);
assert.strictEqual(normalized.allProjects[0].spend, 100);

const snapshot = buildApiSnapshot(stats, projectsPage, '2026-08-02T00:05:00');
assert.strictEqual(snapshot.sourceType, '5min');
assert.strictEqual(snapshot.accountSpend, 100);
assert.strictEqual(snapshot.activeCount, 1);
assert.strictEqual(snapshot.time, '2026-08-02T00:05:00');

const convFix = correctConversionFallback(
  { _method: 'cdp', totalConv: 0 },
  [{ totalConv: 12 }]
);
assert.strictEqual(convFix.totalConv, 12);
assert.strictEqual(convFix.from, 'cdp_fallback');

const zeroSpend = detectCdpZeroSpend(
  { _method: 'cdp', accountSpend: 0 },
  [{ accountSpend: 88 }]
);
assert.strictEqual(zeroSpend.skip, true);
assert.strictEqual(zeroSpend.lastValid.accountSpend, 88);

const recentCpm = computeRecentCpm(
  { impressions: 120 },
  { last5min: 20 },
  [{ impressions: 100 }]
);
assert.strictEqual(recentCpm, 1000);

assert.strictEqual(shouldPush5min({ timestamp: Date.now() - 30_000 }, Date.now()).push, false);
assert.strictEqual(shouldPush5min({ timestamp: Date.now() - 61_000 }, Date.now()).push, true);
assert.strictEqual(isQuarterHour(15), true);
assert.strictEqual(isQuarterHour(17), false);

console.log('\n全部测试通过');
