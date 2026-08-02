// tests/effect-evaluation.test.mjs - 效果评级测试
import assert from 'node:assert';
import {
  classifyPlanImpactRating,
  classifyPlanBidImpactRating,
  classifyAccountImpactRating,
} from '../src/domain/effect-evaluation.mjs';

assert.strictEqual(classifyPlanImpactRating('pause', 3), 'high_positive');
assert.strictEqual(classifyPlanBidImpactRating(-6), 'positive');
assert.strictEqual(classifyAccountImpactRating('pause', 100), 'high_positive');

console.log('\n全部测试通过');
