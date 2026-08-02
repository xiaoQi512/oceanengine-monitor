// tests/effect-rules.test.mjs - 领域层效果规则测试
import assert from 'node:assert';
import { extractConditionRange, extractEffectRules } from '../src/domain/effect-rules.mjs';

const events = [
  {
    actionType: 'pause',
    planName: '简单投-1',
    beforeValue: { budget: 100, status: '启用' },
    effect: { status: 'evaluated', impactRating: 'positive', deltaCost15min: 10 },
  },
  {
    actionType: 'pause',
    planName: '简单投-2',
    beforeValue: { budget: 200, status: '启用' },
    effect: { status: 'evaluated', impactRating: 'positive', deltaCost15min: 20 },
  },
];
const rules = extractEffectRules(events, { classifyDeliveryTypeFn: n => n?.includes('简单投') ? '简单投' : null });
assert.strictEqual(rules.length, 1);
assert.strictEqual(rules[0].deliveryType, '简单投');
assert.deepStrictEqual(extractConditionRange(events), {
  budgetRange: { min: 100, max: 200 },
  commonStatus: ['启用'],
});

console.log('\n全部测试通过');
