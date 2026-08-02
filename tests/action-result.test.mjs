// tests/action-result.test.mjs - action 结果与审计测试
import assert from 'node:assert';
import { pickAfterValue, buildActionAudit } from '../src/domain/action-result.mjs';

assert.deepStrictEqual(pickAfterValue({ ok: true, newBudget: 10 }), { budget: 10 });
assert.strictEqual(pickAfterValue({ ok: false }), null);
const audit = buildActionAudit({
  head: { planName: 'A', type: 'pause' },
  beforeValue: { projectId: 'p1' },
  afterValue: null,
  result: { ok: false, err: 'boom' },
  attempts: 1,
  method: 'http_api',
  projectId: '',
});
assert.strictEqual(audit.projectId, 'p1');
assert.strictEqual(audit.result.error, 'boom');

console.log('\n全部测试通过');
