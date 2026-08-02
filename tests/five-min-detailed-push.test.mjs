// tests/five-min-detailed-push.test.mjs - 5min 详细卡片推送测试
import assert from 'node:assert';
import { pushDetailedCard } from '../src/services/five-min-detailed-push.mjs';

const rolling = {
  last5min: 5,
  last5minMinutes: 5,
  convLast5min: 1,
  windows: [],
};
const baseDeps = {
  findLarkCli: () => '',
  createApiClient: async () => ({}),
  collectAllData: async () => ({ campaigns: [], pageSummary: {} }),
  getHourlyStats: async () => null,
  loadRecent5minSnapshots: () => [],
  getLiveWindowLabel: () => ({ labelCompact: '直播' }),
  getTodayShiftWindow: () => ({ startHour: 9, startMinute: 0, endHour: 23, endMinute: 0 }),
  minutesBetween: () => 15,
  calcRolling: () => rolling,
  buildDetailedCard: () => ({ title: 'detail' }),
  pushCard: async () => ({ ok: true }),
};

assert.strictEqual(await pushDetailedCard({ deps: baseDeps }), false);
assert.strictEqual(await pushDetailedCard({ dryRun: true, deps: { ...baseDeps, findLarkCli: () => 'lark' } }), false);
assert.strictEqual(
  await pushDetailedCard({
    deps: {
      ...baseDeps,
      findLarkCli: () => 'lark',
      collectAllData: async () => null,
    },
  }),
  false,
);

let cardOptions = null;
let received = null;
const ok = await pushDetailedCard({
  pm2Prefix: '[test]',
  chatId: 'chat',
  deps: {
    ...baseDeps,
    findLarkCli: () => 'lark',
    collectAllData: async () => ({
      campaigns: [{ id: 1, spend: 10, name: '计划A', conversions: 1, cpm: 1 }],
      pageSummary: { conversions: 1, impressions: 100 },
      accountSpend: 10,
      accountBudget: 100,
      accountBalance: 10,
    }),
    buildDetailedCard: opts => {
      cardOptions = opts;
      return { title: 'detail' };
    },
    pushCard: async (...args) => {
      received = args;
      return { ok: true };
    },
  },
});
assert.strictEqual(ok, true);
assert.strictEqual(cardOptions.pm2Prefix, '[test]');
assert.strictEqual(received[0], 'lark');
assert.strictEqual(received[2], 'chat');

console.log('\n全部测试通过');
