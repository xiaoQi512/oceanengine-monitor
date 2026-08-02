// tests/report-html-parts.test.mjs - 离线报表片段测试
import assert from 'node:assert';
import { buildAlertRows, buildAllPlanRows, buildHistoryRows, buildFunnelBar, buildCampaignRows } from '../src/domain/report-html-parts.mjs';

assert.ok(buildAlertRows([]).includes('无异常'));
assert.ok(buildAllPlanRows([{ id: 'a', name: 'A', spend: 10, conversions: 1, leads: 1, status: '投放中' }], { avgCPA: 10 }).includes('A'));
assert.strictEqual(buildHistoryRows({ suggestions: [] }), '');
assert.ok(buildFunnelBar(1, '测试', '#fff', 10).includes('测试'));
assert.strictEqual(buildCampaignRows([], {}, {}), '');

console.log('\n全部测试通过');
