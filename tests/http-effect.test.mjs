// tests/http-effect.test.mjs - 操作效果规则提取测试
import assert from 'node:assert';
import { extractRules, extractConditionRange } from '../src/services/http-effect.mjs';

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
const rules = extractRules(events);
assert.strictEqual(rules.length, 1);
assert.deepStrictEqual(extractConditionRange(events), {
  budgetRange: { min: 100, max: 200 },
  commonStatus: ['启用'],
});

console.log('\n全部测试通过');
