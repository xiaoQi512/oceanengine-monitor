// tests/daily-summary-request.test.mjs - 日汇总请求与行解析测试
import assert from 'node:assert';
import { buildVideoStatBody, parseVideoRows, computeDailySummary, zeroDailySummary } from '../src/domain/daily-summary-request.mjs';

const body = buildVideoStatBody('123', '2026-08-02');
assert.deepStrictEqual(body.Filters.Conditions[0].Values, ['123']);
const rows = parseVideoRows([
  { Dimensions: { cdp_marketing_goal: { ValueStr: '短视频' } }, Metrics: { stat_cost: { ValueStr: '20' }, convert_cnt: { ValueStr: '1' } } },
]);
assert.deepStrictEqual(rows, { videoConsume: 20, videoLeads: 1 });
assert.deepStrictEqual(computeDailySummary(20, 1), { totalConsume: 20, totalLeads: 1, cpl: '20.00' });
assert.deepStrictEqual(zeroDailySummary(), { totalConsume: 0, totalLeads: 0, cpl: '0.00' });

console.log('\n全部测试通过');
