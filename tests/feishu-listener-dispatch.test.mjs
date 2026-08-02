// tests/feishu-listener-dispatch.test.mjs - listener 命令分发测试
import assert from 'node:assert';
import { dispatch } from '../src/services/feishu-listener-dispatch.mjs';

const calls = [];
const deps = {
  sendMsg: async (chatId, text) => calls.push(['send', chatId, text]),
  loadQueue: () => ({ actions: [] }),
  saveQueue: () => {},
  findPending: () => null,
  removePending: () => {},
  enqueue: async action => { calls.push(['enqueue', action]); return 1; },
  addPending: () => {},
  checkDuplicateToday: () => null,
  getCampaignList: async () => [{ name: '计划A', status: '启用' }],
  sendConfirmCard: async () => {},
  reportResult: async () => {},
  ACTION_TEXT: { pause: '暂停' },
  loadSuggestionHistory: () => ({ suggestions: [] }),
  saveSuggestionHistory: () => {},
  recalcSummary: () => {},
};

await dispatch({ cmd: 'info', planName: null, amount: null }, { name: 'u1' }, 'chat', deps);
assert.ok(calls[0][0] === 'send');
assert.ok(calls[0][2].includes('监听中'));

calls.length = 0;
await dispatch({ cmd: 'pause', planName: '计划A', amount: null }, { name: 'u1' }, 'chat', deps);
assert.ok(calls.some(c => c[0] === 'enqueue'));

console.log('\n全部测试通过');
