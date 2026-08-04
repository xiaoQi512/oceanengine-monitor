// tests/http-delivery.test.mjs - 投放形式分类与分组汇总测试
import assert from 'node:assert';
import { classifyDeliveryType, emptyGroupSummary, summarizeGroup } from '../src/services/http-delivery.mjs';

assert.strictEqual(classifyDeliveryType('简单投-1'), '简单投');
assert.strictEqual(classifyDeliveryType('画面直投-1'), '画面直投');
assert.deepStrictEqual(emptyGroupSummary('测试组'), {
  name: '测试组', spend: 0, leads: 0, cpl: 0, cpm: 0, active: 0, paused: 0, total: 0,
});
assert.strictEqual(summarizeGroup([{ spend: 10, leads: 2, status: '投放中' }], '测试组').spend, 10);

console.log('\n全部测试通过');
