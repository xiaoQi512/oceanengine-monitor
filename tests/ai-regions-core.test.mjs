// tests/ai-regions-core.test.mjs - AI 区域号数据核心测试
import assert from 'node:assert';
import { buildStatQueryBody, fetchRegion, pushToLark, summarizeAiRegions, buildAiRegionsReport } from '../src/services/ai-regions-core.mjs';

const body = buildStatQueryBody('123', '2026-08-02');
assert.strictEqual(body.Filters.Conditions[0].Values[0], '123');
assert.strictEqual(body.StartTime, '2026-08-02 00:00:00');

const result = await fetchRegion({ name: '东区', aadvid: '123' }, {
  getCookieDataFn: async () => ({ headers: {} }),
  getLocalDateFn: () => '2026-08-02',
  logFn: () => {},
  httpPostFn: async () => ({
    code: 0,
    data: { StatsData: { Rows: [
      { Dimensions: { cdp_marketing_goal: { ValueStr: '直播' } }, Metrics: { stat_cost: { ValueStr: '100' }, clue_message_count: { ValueStr: '2' } } },
    ] } },
  }),
});
assert.strictEqual(result.liveConsume, 100);
assert.strictEqual(result.liveLeads, 2);

let pushed = null;
assert.strictEqual(pushToLark('测试', {
  findLarkCliFn: () => 'lark.exe',
  execFileSyncFn: () => JSON.stringify({ ok: true, data: { message_id: 'm1' } }),
  logFn: () => {},
}), true);
assert.strictEqual(pushed, null);

const results = [
  { name: '东区', liveConsume: 10, liveLeads: 2, videoConsume: 20, videoLeads: 1 },
  { name: '西区', liveConsume: 5, liveLeads: 1, videoConsume: 5, videoLeads: 1 },
];
const totals = summarizeAiRegions(results);
assert.strictEqual(totals.grandConsume, 40);
assert.strictEqual(totals.grandLeads, 5);
const report = buildAiRegionsReport({ results, dateLabel: '8月2日' });
assert.ok(report.includes('【极狐东区】 8月2日数据汇总'));
assert.ok(report.includes('8月2日 AI区域号数据汇总'));
assert.ok(report.includes('【5区总计】 线索5 / 消耗¥40.00 / 综合CPL¥8.00'));

console.log('\n全部测试通过');
