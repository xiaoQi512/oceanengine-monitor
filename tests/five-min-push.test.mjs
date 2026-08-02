// tests/five-min-push.test.mjs - 5min 快速速报推送测试
import assert from 'node:assert';
import { pushQuickReport } from '../src/services/five-min-push.mjs';

const data = { accountSpend: 100 };
const rolling = { last5min: 20, last5minMinutes: 5 };

assert.strictEqual(
  await pushQuickReport({
    data,
    rolling,
    deps: {
      findLarkCli: () => '',
      buildQuickCard: () => ({}),
      pushCard: async () => ({ ok: true }),
    },
  }),
  false,
);

let pushed = 0;
assert.strictEqual(
  await pushQuickReport({
    data,
    rolling,
    dryRun: true,
    deps: {
      findLarkCli: () => 'lark',
      buildQuickCard: () => ({}),
      pushCard: async () => { pushed++; return { ok: true }; },
    },
  }),
  false,
);
assert.strictEqual(pushed, 0);

let cardOptions = null;
let received = null;
const ok = await pushQuickReport({
  data,
  rolling,
  pm2Prefix: '[test]',
  now: '12:00',
  chatId: 'chat',
  deps: {
    findLarkCli: () => 'lark',
    buildQuickCard: (d, r, prev, opts) => {
      cardOptions = opts;
      return { title: 'ok' };
    },
    pushCard: async (...args) => {
      received = args;
      return { ok: true };
    },
  },
});
assert.strictEqual(ok, true);
assert.strictEqual(cardOptions.pm2Prefix, '[test]');
assert.strictEqual(cardOptions.now, '12:00');
assert.strictEqual(received[0], 'lark');
assert.strictEqual(received[2], 'chat');

assert.strictEqual(
  await pushQuickReport({
    data,
    rolling,
    deps: {
      findLarkCli: () => 'lark',
      buildQuickCard: () => ({}),
      pushCard: async () => ({ ok: false, error: 'boom' }),
    },
  }),
  false,
);

console.log('\n全部测试通过');
