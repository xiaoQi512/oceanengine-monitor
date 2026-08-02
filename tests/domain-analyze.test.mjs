// tests/domain-analyze.test.mjs - 15min 分析纯逻辑测试
import assert from 'node:assert';
import { analyzeCampaigns } from '../src/domain/analyze.mjs';

const now = new Date(2026, 7, 1, 10, 0, 0);
const campaign = {
  id: 'c1',
  name: '测试计划',
  status: '投放中',
  spend: 100,
  conversions: 2,
  leads: 3,
  privateMsgOpen: 3,
  privateMsgRetain: 2,
  formSubmit: 1,
  ctr: 0.02,
  cpm: 10,
  cvr: 0.1,
  liveViews: 100,
  liveOver1Min: 50,
  liveComments: 0,
  budget: '200.00按日预算',
};

const analysis = analyzeCampaigns([campaign], 0, 0, 0, null, {
  dailyBudget: 250,
  dailyStartHour: 0,
  dailyStartMinute: 0,
  dailyEndHour: 24,
  dailyEndMinute: 0,
  previous: { t15: null, t30: null, t60: null },
  multiDay: null,
  window3h: null,
  trends: { cpaTrend: null, spendTrend: null },
  yesterdayBaseline: null,
  todaySnapshots: [],
  now,
});

assert.strictEqual(analysis.summary.totalSpend, 100);
assert.strictEqual(analysis.summary.totalActive, 1);
assert.strictEqual(analysis.summary.totalSpending, 1);
assert.strictEqual(analysis.summary.totalConversions, 2);
assert.strictEqual(analysis.delta.pacingHealth, 'good');
assert.strictEqual(analysis.rampingUp.length, 1);
assert.strictEqual(analysis.time, now.toISOString());
assert.ok(Array.isArray(analysis.alerts));

console.log('\n全部测试通过');
