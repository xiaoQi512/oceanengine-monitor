// tests/feishu-listener-run.test.mjs - listener 主循环编排测试
import assert from 'node:assert';
import { runListener } from '../src/services/feishu-listener-run.mjs';

let fetchCount = 0;
let dispatched = null;
let intervals = [];
const deps = {
  loadState: () => ({ lastMsgId: null }),
  saveState: () => {},
  fetchMessages: async () => {
    fetchCount++;
    if (fetchCount === 1) return [];
    return [{
      message_id: 'm2',
      content: JSON.stringify({ text: 'pause PlanA' }),
      sender: { name: 'u1' },
    }];
  },
  sendMsg: async () => {},
  addReaction: () => {},
  scanPending: () => {},
  dispatch: async (cmd, sender, chatId) => {
    dispatched = { cmd, sender, chatId };
  },
  setIntervalFn: fn => intervals.push(fn),
};

await runListener({ deps });
assert.strictEqual(intervals.length, 2);
await intervals[1]();
assert.strictEqual(dispatched.cmd.cmd, 'pause');
assert.strictEqual(dispatched.sender, 'u1');

console.log('\n全部测试通过');
