// tests/api-actions-core.test.mjs - 操作队列核心逻辑测试
import assert from 'node:assert';
import { isValidActionType, buildActionItem, findRollbackRecord, buildRollbackAction } from '../src/services/http-routes/api-actions-core.mjs';

assert.strictEqual(isValidActionType('pause'), true);
const item = buildActionItem({ type: 'pause', campaign_id: 'c1', by: 'u' }, s => s);
assert.strictEqual(item.campaignId, 'c1');
const record = { traceRef: 't1', actionType: 'pause', beforeValue: {}, time: '2026-08-02T01:00:00Z' };
assert.strictEqual(findRollbackRecord([record], { traceRef: 't1' }), record);
assert.strictEqual(buildRollbackAction(record).action.type, 'resume');

console.log('\n全部测试通过');
