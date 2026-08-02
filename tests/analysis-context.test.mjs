// tests/analysis-context.test.mjs - 分析上下文编排测试
import assert from 'node:assert';
import path from 'node:path';
import { loadAnalysisContext, analyzeMonitorData } from '../src/services/analysis-context.mjs';

const dailyLogs = {
  'daily-2026-08-02.json': [{ time: '2026-08-02T00:00:00Z', avgCPA: 10, speedCurrent: 1 }],
  'daily-2026-08-01.json': [{ time: '2026-08-01T00:00:00Z', avgCPA: 8, speedCurrent: 2 }],
};
const deps = {
  dataDir: 'data',
  getLocalDate: (date = new Date()) => {
    if (date instanceof Date) return '2026-08-02';
    return '2026-08-02';
  },
  readDailyLog: (file) => dailyLogs[file.split(path.sep).pop()] || null,
  loadPreviousSnapshots: () => ({ t15: 'prev' }),
  loadTodaysSnapshots: () => ['today'],
};

const context = loadAnalysisContext(deps);
assert.deepStrictEqual(context.previous, { t15: 'prev' });
assert.deepStrictEqual(context.todaySnapshots, ['today']);
assert.strictEqual(typeof context.multiDay, 'object');
assert.strictEqual(typeof context.trends, 'object');
assert.strictEqual(typeof context.window3h, 'object');

let received = null;
const result = analyzeMonitorData([{ id: 1, spend: 10 }], 10, 20, 30, { conversions: 1 }, {
  ...deps,
  dailyBudget: 100,
  dailyStartHour: 9,
  dailyStartMinute: 0,
  dailyEndHour: 23,
  dailyEndMinute: 59,
  analyzeCampaigns: (campaigns, spend, budget, balance, pageSummary, ctx) => {
    received = { campaigns, spend, budget, balance, pageSummary, ctx };
    return { ok: true };
  },
});
assert.strictEqual(result.ok, true);
assert.strictEqual(received.campaigns[0].id, 1);
assert.strictEqual(received.ctx.dailyBudget, 100);
assert.strictEqual(received.ctx.dailyStartHour, 9);
assert.deepStrictEqual(received.ctx.previous, { t15: 'prev' });

console.log('\n全部测试通过');
