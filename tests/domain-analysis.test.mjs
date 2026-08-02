// tests/domain-analysis.test.mjs - 历史/趋势/生命周期纯算法测试
import assert from 'node:assert';
import {
  buildCampaignIndex,
  detectTrendsFromLog,
  computeYesterdayBaseline,
  computeMultiDayBaseline,
  analyze3HourWindowFromLog,
  computeLifecycleFromSnapshots,
} from '../src/domain/analysis-utils.mjs';

const index = buildCampaignIndex([{ id: 'a', name: '计划A' }]);
assert.strictEqual(index.get('a').name, '计划A');

const now = new Date('2026-08-01T12:00:00Z').getTime();
const oldSnapshot = {
  time: new Date('2026-08-01T06:00:00Z').toISOString(),
  active: [{ id: 'c1', spend: 0 }],
};
const lifecycle = computeLifecycleFromSnapshots(
  [{ id: 'c1', spend: 50 }],
  [oldSnapshot],
  null,
  now
);
assert.strictEqual(lifecycle.dead, 1);
assert.strictEqual(lifecycle.active, 0);

const revivedCampaign = { id: 'c2', spend: 500 };
const revived = computeLifecycleFromSnapshots(
  [revivedCampaign],
  [{ time: new Date('2026-08-01T11:00:00Z').toISOString(), active: [{ id: 'c2', spend: 0 }] }],
  { active: [{ id: 'c2', _lifecycle: 'dead' }] },
  now
);
assert.strictEqual(revived.active, 1);
assert.strictEqual(revivedCampaign._justRevived, true);

const trendLog = [
  { time: '2026-08-01T10:00:00Z', avgCPA: 100, speedCurrent: 1 },
  { time: '2026-08-01T10:15:00Z', avgCPA: 110, speedCurrent: 2 },
  { time: '2026-08-01T10:30:00Z', avgCPA: 120, speedCurrent: 3 },
];
const trends = detectTrendsFromLog(trendLog);
assert.strictEqual(trends.cpaTrend.periods, 3);
assert.ok(trends.cpaTrend.changeRate > 0);
assert.ok(trends.spendTrend.changeRate > 0);

const nowDate = new Date('2026-08-01T12:00:00Z');
const yesterdayLog = [
  { time: '2026-07-31T10:00:00Z', accountSpend: 100, totalSpend: 90 },
  { time: '2026-07-31T12:00:00Z', accountSpend: 200, totalSpend: 190 },
  { time: '2026-07-31T14:00:00Z', accountSpend: 300, totalSpend: 290 },
];
const yesterday = computeYesterdayBaseline(yesterdayLog, nowDate, '2026-07-31');
assert.strictEqual(yesterday.totalSpend, 200);
assert.strictEqual(yesterday.date, '2026-07-31');

const dailyLogs = [
  { date: '2026-07-30', log: [
    { time: '2026-07-30T10:00:00Z', accountSpend: 100 },
    { time: '2026-07-30T11:00:00Z', accountSpend: 200 },
    { time: '2026-07-30T12:00:00Z', accountSpend: 300 },
  ] },
  { date: '2026-07-31', log: [
    { time: '2026-07-31T10:00:00Z', accountSpend: 400 },
    { time: '2026-07-31T11:00:00Z', accountSpend: 500 },
    { time: '2026-07-31T12:00:00Z', accountSpend: 600 },
  ] },
];
const multiDay = computeMultiDayBaseline(dailyLogs, nowDate);
assert.strictEqual(multiDay.sampleDays, 2);
assert.ok(multiDay.spend.mean > 0);

const windowLog = [
  { time: '2026-08-01T10:00:00Z', totalSpend: 100, totalConversions: 1, avgCPA: 100, speedCurrent: 1 },
  { time: '2026-08-01T10:30:00Z', totalSpend: 200, totalConversions: 2, avgCPA: 100, speedCurrent: 2 },
  { time: '2026-08-01T11:00:00Z', totalSpend: 350, totalConversions: 3, avgCPA: 110, speedCurrent: 3 },
  { time: '2026-08-01T11:30:00Z', totalSpend: 500, totalConversions: 4, avgCPA: 120, speedCurrent: 4 },
];
const window3h = analyze3HourWindowFromLog(windowLog, now);
assert.ok(window3h.speed.second > window3h.speed.first);
assert.ok(window3h.conversions.second > 0);

console.log('\n全部测试通过');
