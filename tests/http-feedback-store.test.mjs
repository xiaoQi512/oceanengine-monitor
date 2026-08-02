// tests/http-feedback-store.test.mjs - HTTP 反馈记录与写锁测试
import assert from 'node:assert';
import { withWriteLock, recordFeedback } from '../src/services/http-feedback-store.mjs';

const history = { suggestions: [] };
const result = await recordFeedback('a1', 'accept', 'c1', 'high_cpa', '计划A', {
  loadHistoryFn: () => history,
  saveHistoryFn: h => { history.suggestions = h.suggestions; },
  recalcSummaryFn: () => {},
});
assert.strictEqual(result.suggestions[0].id, 'a1');
assert.strictEqual(result.suggestions[0].campaignName, '计划A');

let order = [];
await withWriteLock(async () => { order.push(1); });
await withWriteLock(async () => { order.push(2); });
assert.deepStrictEqual(order, [1, 2]);

console.log('\n全部测试通过');
