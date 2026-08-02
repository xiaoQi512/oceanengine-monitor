// tests/feishu-listener-queue.test.mjs - listener 队列操作测试
import assert from 'node:assert';
import { findQueued, precheckAction, acknowledgeStart } from '../src/services/feishu-listener-queue.mjs';

const found = findQueued('计划A', {
  loadQueue: () => ({ actions: [{ planName: '计划A' }] }),
});
assert.strictEqual(found.action.planName, '计划A');

const pre = await precheckAction({ planName: '计划A', type: 'pause' }, {
  getCampaignList: async () => [{ name: '计划A', status: '启用' }],
});
assert.strictEqual(pre.ok, true);

const calls = [];
const result = await acknowledgeStart('chat', { planName: '计划A', type: 'pause' }, '暂停', {
  getCampaignList: async () => [{ name: '计划A', status: '启用' }],
  checkDuplicateToday: () => null,
  enqueue: async () => { calls.push('enqueue'); return 2; },
  sendMsg: async () => calls.push('send'),
});
assert.strictEqual(result.status, 'queued');
assert.ok(calls.includes('enqueue'));

console.log('\n全部测试通过');
