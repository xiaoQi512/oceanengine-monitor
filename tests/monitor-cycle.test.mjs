// tests/monitor-cycle.test.mjs - 15min 监控运行周期编排测试
import assert from 'node:assert';
import { runMonitorCycle } from '../src/services/monitor-cycle.mjs';

const calls = [];
let analysisCtx = null;
let reportOptions = null;
let pushDeps = null;
const config = {
  dataDir: 'data',
  reportDir: 'report',
  dailyBudget: 100,
  dailyStartHour: 9,
  dailyStartMinute: 0,
  dailyEndHour: 23,
  dailyEndMinute: 59,
  enableHtmlReport: false,
  accountName: '测试账户',
};

const baseDeps = {
  getLocalDate: () => '2026-08-02',
  guardFeedbackServer: async () => calls.push('guard'),
  atomicWriteJSON: () => calls.push('json'),
  pushFile: async () => ({ ok: true }),
  verifyConsistency: () => ({ ok: true }),
  refreshMaterialized: () => ({ ok: true, hours: 1, days: 1, alerts: 1 }),
  dualInsertSnapshot: () => ({ ok: true, rows: 1 }),
  printMonitorSummary: () => calls.push('summary'),
  saveDailyLog: () => calls.push('daily'),
  saveSnapshot: () => calls.push('snapshot'),
  sendReportIfEnabled: async () => calls.push('report'),
  writeHtmlReport: () => 'report.html',
  checkLiveStatus: async () => ({ isLive: true }),
  collectMonitorData: async () => ({
    campaigns: [{ id: 1 }],
    accountSpend: 1,
    accountBudget: 2,
    accountBalance: 3,
    pageSummary: {},
  }),
  ensureDataDir: dir => calls.push(['ensure', dir]),
  rotateRunLog: ({ logFile }) => calls.push(['rotate', logFile]),
  refreshMaterializedViews: () => calls.push('refresh'),
  createFeishuCardBuilder: () => async () => ({}),
  createHtmlReportBuilder: options => {
    reportOptions = options;
    return () => '<html>';
  },
  analyzeMonitorData: (campaigns, spend, budget, balance, pageSummary, ctx) => {
    analysisCtx = ctx;
    return {
    campaigns,
    spend,
    budget,
    balance,
    pageSummary,
    ctx,
    active: [{ id: 1 }],
    summary: { totalSpend: 1, totalSpending: 1 },
    alerts: [],
    };
  },
  sendFeishuPush: async () => calls.push('push'),
  createPushDeps: opts => {
    pushDeps = opts;
    return opts;
  },
};

calls.length = 0;
analysisCtx = null;
pushDeps = null;
const stopped = await runMonitorCycle({
  config,
  logFile: 'run.log',
  deps: { ...baseDeps, checkLiveStatus: async () => ({ isLive: false }) },
});
assert.deepStrictEqual(stopped, { stopped: true });
assert.ok(calls.some(c => Array.isArray(c) && c[0] === 'rotate' && c[1] === 'run.log'));
assert.ok(!calls.includes('collect'));

calls.length = 0;
analysisCtx = null;
pushDeps = null;
const result = await runMonitorCycle({ config, logFile: 'run.log', deps: baseDeps });
assert.deepStrictEqual(result, { ok: true });
assert.strictEqual(analysisCtx.dailyStartHour, 9);
assert.strictEqual(analysisCtx.dailyEndMinute, 59);
assert.strictEqual(pushDeps.config, config);
assert.strictEqual(pushDeps.dryRun, false);
assert.deepStrictEqual(calls.filter(c => c === 'snapshot'), ['snapshot']);
assert.deepStrictEqual(calls.filter(c => c === 'daily'), ['daily']);
assert.deepStrictEqual(calls.filter(c => c === 'push'), ['push']);
assert.deepStrictEqual(calls.filter(c => c === 'refresh'), ['refresh']);

calls.length = 0;
reportOptions = null;
await runMonitorCycle({
  config: { ...config, enableHtmlReport: true },
  logFile: 'run.log',
  deps: baseDeps,
});
assert.deepStrictEqual(calls.filter(c => c === 'report'), ['report']);
assert.strictEqual(reportOptions.accountName, '测试账户');

calls.length = 0;
pushDeps = null;
await runMonitorCycle({ config, dryRun: true, logFile: 'run.log', deps: baseDeps });
assert.strictEqual(pushDeps.dryRun, true);

console.log('\n全部测试通过');
