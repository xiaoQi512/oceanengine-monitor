// tests/feishu-listener-actions.test.mjs - listener 确认卡片与待办扫描测试
import assert from 'node:assert';
import { sendConfirmCard, scanPending, ACTION_TEXT } from '../src/services/feishu-listener-actions.mjs';

assert.strictEqual(ACTION_TEXT.pause, '暂停');

let cardPushed = null;
await sendConfirmCard('chat', { planName: '计划A', type: 'pause' }, 2, '12:00', {
  pushCardFn: async (cli, card, chatId) => {
    cardPushed = { cli, card, chatId };
  },
});
assert.strictEqual(cardPushed.chatId, 'chat');
assert.ok(JSON.stringify(cardPushed.card).includes('计划A'));

let fallbackText = null;
await sendConfirmCard('chat', { planName: '计划A', type: 'pause' }, 2, '12:00', {
  pushCardFn: async () => { throw new Error('card fail'); },
  sendMsgFn: async (chatId, text) => {
    fallbackText = { chatId, text };
  },
});
assert.ok(fallbackText.text.includes('卡片发送失败'));

let saved = null;
let sent = [];
await scanPending({
  loadPendingFn: () => ({
    pending: [
      { expiresAt: '2026-08-02T00:00:00Z', action: { planName: '旧计划' }, chatId: 'c1' },
      { expiresAt: '2099-01-01T00:00:00Z', action: { planName: '新计划' }, chatId: 'c2' },
    ],
  }),
  savePendingFn: data => { saved = data; },
  sendMsgFn: async (chatId, text) => { sent.push({ chatId, text }); },
  now: new Date('2026-08-02T01:00:00Z'),
});
assert.strictEqual(sent.length, 1);
assert.strictEqual(sent[0].chatId, 'c1');
assert.deepStrictEqual(saved.pending.map(p => p.action.planName), ['新计划']);

console.log('\n全部测试通过');
