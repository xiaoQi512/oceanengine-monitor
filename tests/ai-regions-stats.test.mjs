// tests/ai-regions-stats.test.mjs - AI 区域行统计测试
import assert from 'node:assert';
import { emptyRegionResult, parseRegionRows, buildRegionResult } from '../src/domain/ai-regions-stats.mjs';

const stats = parseRegionRows([
  { Dimensions: { cdp_marketing_goal: { ValueStr: '直播' } }, Metrics: { stat_cost: { ValueStr: '100' }, clue_message_count: { ValueStr: '2' } } },
  { Dimensions: { cdp_marketing_goal: { ValueStr: '短视频' } }, Metrics: { stat_cost: { ValueStr: '20' }, clue_message_count: { ValueStr: '1' } } },
]);
assert.deepStrictEqual(stats, { liveConsume: 100, liveLeads: 2, videoConsume: 20, videoLeads: 1 });
assert.deepStrictEqual(buildRegionResult('东区', stats).name, '东区');
assert.deepStrictEqual(emptyRegionResult('东区').liveConsume, 0);

console.log('\n全部测试通过');
