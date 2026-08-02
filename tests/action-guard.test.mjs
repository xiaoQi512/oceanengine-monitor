// tests/action-guard.test.mjs - action 编码守卫测试
import assert from 'node:assert';
import { isUtf8Corrupted, buildCorruptedAudit } from '../src/domain/action-guard.mjs';

assert.strictEqual(isUtf8Corrupted('???损坏'), true);
assert.strictEqual(isUtf8Corrupted('正常计划'), false);
const audit = buildCorruptedAudit({ head: { planName: '???', type: 'pause', source: 'curl' } });
assert.strictEqual(audit.result.error, 'UTF8_CORRUPTED');
assert.strictEqual(audit.source, 'curl');

console.log('\n全部测试通过');
