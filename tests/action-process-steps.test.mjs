// tests/action-process-steps.test.mjs - action 重试步骤测试
import assert from 'node:assert';
import { runHttpApiAttempts, runCdpAttempts } from '../src/services/action-process-steps.mjs';

const http = await runHttpApiAttempts({
  apiMaxRetries: 2,
  apiRetryIntervalMs: 0,
  tryHttpApi: async () => ({ ok: true }),
}, { type: 'pause' }, 'A', 'p1');
assert.strictEqual(http.method, 'http_api');

const cdp = await runCdpAttempts({
  cdpMaxRetries: 1,
  cdpRetryIntervalMs: 0,
  executeAction: async () => ({ ok: true }),
}, { type: 'pause' }, 'A');
assert.strictEqual(cdp.method, 'cdp');

console.log('\n全部测试通过');
