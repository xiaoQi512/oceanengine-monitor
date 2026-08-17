// tests/action-process.test.mjs - action 队首处理纯编排测试
import assert from 'node:assert';
import { processHead } from '../src/services/action-process.mjs';

const result = await processHead({
  loadQueue: async () => ({ actions: [] }),
});
assert.deepStrictEqual(result, { processed: false, reason: 'empty' });

const httpCalls = [];
const audits = [];
const apiResult = await processHead({
  loadQueue: async () => ({ actions: [{ type: 'resume', planName: '0803-真人直播-短引直-S3（真人口播)', campaignId: '7669763298461073418', source: 'dashboard-v4' }] }),
  saveQueue: async () => {},
  readPlanAfterValue: async () => null,
  tryHttpApi: async (head, projectId) => {
    httpCalls.push(projectId);
    return { ok: true, afterValue: { status: '启用', budget: 5000, bid: 0 } };
  },
  executeAction: async () => ({ ok: true }),
  isChromeHealthy: async () => true,
  writeAudit: async (audit) => audits.push(audit),
  finalizeAction: async () => {},
  reportToFeishu: async () => {},
  apiMaxRetries: 1,
  apiRetryIntervalMs: 0,
  cdpMaxRetries: 1,
  cdpRetryIntervalMs: 0,
});
assert.deepStrictEqual(httpCalls, ['7669763298461073418']);
assert.strictEqual(apiResult.ok, true);
assert.strictEqual(audits[0].projectId, '7669763298461073418');

console.log('\n全部测试通过');
