// tests/delivery-summary.test.mjs - 投放形式汇总测试
import assert from 'node:assert';
import { classifyDeliveryType, emptyGroupSummary, summarizeGroup } from '../src/domain/delivery-summary.mjs';

assert.strictEqual(classifyDeliveryType('简单投-1'), '简单投');
assert.deepStrictEqual(emptyGroupSummary('测试'), { name: '测试', spend: 0, leads: 0, cpl: 0, active: 0, paused: 0, total: 0 });
assert.strictEqual(summarizeGroup([{ spend: 10, leads: 2, status: '投放中' }], '测试').spend, 10);

console.log('\n全部测试通过');
