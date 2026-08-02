// tests/pending-suggestions.test.mjs - 待处理建议合并测试
import assert from 'node:assert';
import { buildPendingSuggestion, mergePendingSuggestions } from '../src/domain/pending-suggestions.mjs';

const sug = buildPendingSuggestion({ id: 's1', alertType: 'zero_conv', campaignId: 'c1', campaignName: 'A', suggestion: '暂停' });
assert.strictEqual(sug.response, null);
const merged = mergePendingSuggestions([sug], [{ id: 's1' }, { id: 's2' }], '2026-08-02T01:00:00Z');
assert.strictEqual(merged.length, 1);
assert.strictEqual(merged[0].id, 's2');

console.log('\n全部测试通过');
