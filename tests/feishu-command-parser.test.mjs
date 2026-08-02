// tests/feishu-command-parser.test.mjs - 领域层命令解析测试
import assert from 'node:assert';
import {
  CMD_RULES,
  msgText,
  isBotMsg,
  isAtMention,
  cleanAtText,
  parseCommand,
  extractPlanName,
} from '../src/domain/feishu-command-parser.mjs';

assert.ok(CMD_RULES.length > 0);
assert.strictEqual(msgText({ content: '{"text":" 你好 "}' }), '你好');
assert.strictEqual(isBotMsg({ sender: { sender_type: 'app' } }, 'x'), true);
assert.strictEqual(isAtMention({ content: '{"mentions":[{"id":"bot-1"}]}' }, 'x', { botAppId: 'bot-1' }), true);
assert.strictEqual(cleanAtText('@小七 暂停 计划A'), '暂停 计划A');
assert.strictEqual(parseCommand({ content: JSON.stringify({ text: '暂停 计划A' }) }).cmd, 'pause');
assert.strictEqual(extractPlanName('暂停「计划C」', 'pause', null), '计划C');

console.log('\n全部测试通过');
