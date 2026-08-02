// tests/feishu-listener-commands.test.mjs - listener 命令解析与消息识别测试
import assert from 'node:assert';
import { msgText, isBotMsg, isAtMention, cleanAtText, parseCommand, extractPlanName } from '../src/services/feishu-listener-commands.mjs';

assert.strictEqual(msgText({ content: '{"text":" 你好 "}' }), '你好');
assert.strictEqual(msgText({ content: ' 原始 ' }), '原始');
assert.strictEqual(isBotMsg({ sender: { sender_type: 'app' } }, 'x'), true);
assert.strictEqual(isBotMsg({ sender: {} }, '✅ ok'), true);
assert.strictEqual(isAtMention({ content: '{"mentions":[{"id":"bot-1"}]}' }, 'x', { botAppId: 'bot-1' }), true);
assert.strictEqual(cleanAtText('@小七 暂停 计划A'), '暂停 计划A');

const pause = parseCommand({ content: JSON.stringify({ text: '暂停 计划A' }) });
assert.strictEqual(pause.cmd, 'pause');
assert.strictEqual(pause.planName, '计划A');

const budget = parseCommand({ content: JSON.stringify({ text: '加预算 计划B 500' }) });
assert.strictEqual(budget.cmd, 'adjust_budget');
assert.strictEqual(budget.amount, 500);
assert.strictEqual(budget.planName, '计划B');
assert.strictEqual(extractPlanName('暂停「计划C」', 'pause', null), '计划C');

console.log('\n全部测试通过');
