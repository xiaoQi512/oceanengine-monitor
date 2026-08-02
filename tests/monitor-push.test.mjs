// tests/monitor-push.test.mjs - 主飞书推送编排测试
import assert from 'node:assert';
import { sendFeishuPush, createPushDeps } from '../src/services/monitor-push.mjs';

const baseCtx = {
  config: { larkCli: '', feishuChatId: 'chat' },
  findLarkCli: () => '',
  dryRun: false,
  shouldPush: () => ({ push: true, level: 3 }),
  loadLastPush: () => ({ timestamp: 0 }),
  saveLastPush: () => {},
  appendPushLog: () => {},
  PUSH_TYPES: { MAIN: 'main' },
  buildFeishuCard: async () => ({}),
  pushCard: async () => ({ ok: true }),
  guardFeedbackServer: async () => true,
  recordPendingSuggestions: () => {},
  historyDeps: {},
  sendBalanceAlert: async () => false,
  sendAccountBudgetAlert: async () => false,
  alertStateDeps: { balance: {}, budget: {} },
};

assert.strictEqual(await sendFeishuPush({ summary: {}, alerts: [] }, baseCtx), false);
assert.strictEqual(await sendFeishuPush({ summary: {}, alerts: [] }, { ...baseCtx, dryRun: true }), false);

let saved = false;
const successCtx = {
  ...baseCtx,
  config: { larkCli: 'lark', feishuChatId: 'chat' },
  dryRun: false,
  saveLastPush: () => { saved = true; },
  pushCard: async () => ({ ok: true }),
};
assert.strictEqual(await sendFeishuPush({ summary: { totalSpend: 1 }, alerts: [] }, successCtx), true);
assert.strictEqual(saved, true);

const assembled = createPushDeps({
  config: baseCtx.config,
  dryRun: true,
  buildFeishuCard: async () => ({}),
});
assert.strictEqual(assembled.config, baseCtx.config);
assert.strictEqual(assembled.dryRun, true);
assert.strictEqual(assembled.alertStateDeps.balance.config, baseCtx.config);
assert.strictEqual(typeof assembled.loadLastPush, 'function');

const customPush = async () => ({ ok: true });
const customSave = () => {};
const overridden = createPushDeps({
  config: baseCtx.config,
  buildFeishuCard: async () => ({}),
  pushCard: customPush,
  saveLastPush: customSave,
});
assert.strictEqual(overridden.pushCard, customPush);
assert.strictEqual(overridden.alertStateDeps.balance.pushCard, customPush);
assert.strictEqual(overridden.saveLastPush, customSave);

console.log('\n全部测试通过');
