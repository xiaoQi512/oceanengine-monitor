// tests/feishu-listener-handlers.test.mjs - listener 命令处理器测试
import assert from 'node:assert';
import { handleInfo, handlePauseResume } from '../src/services/feishu-listener-handlers.mjs';

const calls = [];
const deps = {
  loadQueue: () => ({ actions: [] }),
  saveQueue: () => {},
  findPending: () => null,
  removePending: () => {},
  enqueue: async action => { calls.push(['enqueue', action]); return 1; },
  addPending: () => {},
  checkDuplicateToday: () => null,
  getCampaignList: async () => [{ name: '计划A', status: '启用' }],
  sendConfirmCard: async () => {},
  sendMsg: async (chatId, text) => calls.push(['send', text]),
  reportResult: async () => {},
  loadSuggestionHistory: () => ({ suggestions: [] }),
  saveSuggestionHistory: () => {},
  recalcSummary: () => {},
  ACTION_TEXT: { pause: '暂停' },
};

await handleInfo('chat', deps);
assert.ok(calls[0][1].includes('监听中'));

calls.length = 0;
await handlePauseResume('chat', 'pause', '计划A', 'u1', deps);
assert.ok(calls.some(c => c[0] === 'enqueue'));

console.log('\n全部测试通过');
