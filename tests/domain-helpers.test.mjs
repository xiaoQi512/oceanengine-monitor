// tests/domain-helpers.test.mjs - src/domain/helpers 纯逻辑测试
import assert from 'node:assert';
import {
  escHtml,
  parsePlanBudget,
  parseSnapshotTime,
  computeLinearSlope,
  progressBar,
  getTimeSlotAdvice,
} from '../src/domain/helpers.mjs';
import { shouldSuggest, getSuggestionInsight } from '../src/domain/suggestions.mjs';
import { shouldPush } from '../src/domain/push-logic.mjs';

assert.strictEqual(parsePlanBudget('10,000.00按日预算'), 10000);
assert.strictEqual(parsePlanBudget('500'), 500);
assert.strictEqual(parseSnapshotTime('2026-06-14T14-15-00.json'), new Date('2026-06-14T14:15:00Z').getTime());
assert.strictEqual(computeLinearSlope([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]), 1);
assert.strictEqual(progressBar(50), '█████░░░░░');
assert.ok(getTimeSlotAdvice('早高峰').length > 0);
assert.ok(escHtml('<b>') === '&lt;b&gt;');

const history = {
  summary: { totalSuggestions: 1, accepted: 1, rejected: 0, ignored: 0, byType: {} },
  suggestions: [{}],
};
assert.strictEqual(shouldSuggest('zero_conv', '1', history).suggest, true);
assert.ok(getSuggestionInsight(history).includes('建议采纳率'));

const ignoredHistory = {
  summary: { totalSuggestions: 1, accepted: 0, rejected: 0, ignored: 1, byType: {} },
  suggestions: [{}],
};
assert.ok(getSuggestionInsight(ignoredHistory).includes('—'), '全 ignored 不应出现 NaN');

const pushAnalysis = {
  summary: { totalSpend: 100 },
};
assert.strictEqual(shouldPush(pushAnalysis, { loadLastPush: () => ({ timestamp: Date.now() }), now: Date.now(), noThrottle: true }).push, true);

console.log('\n全部测试通过');
