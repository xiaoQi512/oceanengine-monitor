// tests/feishu-listener-messaging.test.mjs - listener 飞书消息收发测试
import assert from 'node:assert';
import { sendMsg, addReaction, fetchMessages, reportResult } from '../src/services/feishu-listener-messaging.mjs';

let sent = null;
const ok = await sendMsg('chat', '你好', {
  silent: true,
  pushTextFn: async (cli, text, chatId) => {
    sent = { cli, text, chatId };
    return { ok: true };
  },
});
assert.strictEqual(ok, true);
assert.strictEqual(sent.chatId, 'chat');
assert.strictEqual(sent.text, '你好');

let reacted = null;
addReaction('m1', 'Get', {
  silent: true,
  spawnSyncFn: (cli, args) => {
    reacted = { cli, args };
    return { stdout: '{"ok":true}' };
  },
});
assert.strictEqual(reacted.args[0], 'im');

let fetched = null;
const messages = await fetchMessages('chat', 5, {
  spawnSyncFn: (cli, args) => {
    fetched = args;
    return { stdout: JSON.stringify({ ok: true, data: { messages: [{ id: 1 }] } }) };
  },
});
assert.deepStrictEqual(messages, [{ id: 1 }]);
assert.ok(fetched.includes('--page-size'));

let reportText = null;
await reportResult(undefined, true, 'pause', '计划A', 'done', null, {
  silent: true,
  pushTextFn: async (cli, text) => {
    reportText = text;
    return { ok: true };
  },
});
assert.ok(reportText.includes('执行完成'));

console.log('\n全部测试通过');
