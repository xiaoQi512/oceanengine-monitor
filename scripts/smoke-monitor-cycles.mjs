// scripts/smoke-monitor-cycles.mjs - 15min/5min 运行周期冒烟验证
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../src/services/monitor-config.mjs';
import { runMonitorCycle } from '../src/services/monitor-cycle.mjs';
import { runFiveMinCycle } from '../src/services/five-min-cycle.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-cycles-smoke-'));

const fake15Deps = {
  getLocalDate: () => '2026-08-02',
  guardFeedbackServer: async () => true,
  atomicWriteJSON: () => {},
  pushFile: async () => ({ ok: true }),
  verifyConsistency: () => ({ ok: true }),
  refreshMaterialized: () => ({ ok: true, hours: 1, days: 1, alerts: 1 }),
  dualInsertSnapshot: () => ({ ok: true, rows: 1 }),
  printMonitorSummary: () => {},
  saveDailyLog: () => {},
  saveSnapshot: () => {},
  sendReportIfEnabled: async () => false,
  writeHtmlReport: () => '',
  checkLiveStatus: async () => ({ isLive: true }),
  collectMonitorData: async () => ({
    campaigns: [{ id: 1, spend: 10 }],
    accountSpend: 10,
    accountBudget: 100,
    accountBalance: 10,
    pageSummary: {},
  }),
  ensureDataDir: () => {},
  rotateRunLog: () => {},
  refreshMaterializedViews: () => {},
  createFeishuCardBuilder: () => async () => ({}),
  createHtmlReportBuilder: () => () => '<html>',
  analyzeMonitorData: () => ({
    summary: { totalSpend: 10, totalSpending: 1 },
    active: [{ id: 1 }],
    alerts: [],
  }),
  sendFeishuPush: async () => false,
  createPushDeps: opts => opts,
};

const fake5Deps = {
  getTodayShiftWindow: () => ({ startHour: 9, startMinute: 0, endHour: 23, endMinute: 0 }),
  shouldRun5min: () => ({ run: true, reason: 'force' }),
  timeStr: () => '12:00',
  collectFiveMinData: async () => ({
    data: { accountSpend: 10, summarySpend: 10, totalConv: 1, activeCount: 2, spendingCount: 1 },
  }),
  loadRecent5minSnapshots: () => [],
  correctConversionFallback: () => ({ from: false }),
  detectCdpZeroSpend: () => ({ skip: false, lastValid: null }),
  calcRolling: () => ({ last5min: 5, last5minMinutes: 5 }),
  computeRecentCpm: () => 10,
  getSpend: () => 10,
  saveFiveMinSnapshot: () => {},
  loadLastPushState: () => ({}),
  shouldPushFiveMin: () => ({ push: true, elapsedMinutes: 5 }),
  isQuarterHour: () => false,
  pushDetailedCard: async () => false,
  pushQuickReport: async () => false,
  saveLastPushState: () => {},
  dualInsertSnapshot: () => ({ ok: true, rows: 1 }),
};

try {
  const smokeConfig = {
    ...CONFIG,
    dataDir: tmp,
    reportDir: tmp,
    enableHtmlReport: false,
  };
  assert.deepStrictEqual(
    await runMonitorCycle({ config: smokeConfig, force: true, dryRun: true, deps: fake15Deps }),
    { ok: true },
  );
  assert.deepStrictEqual(
    await runFiveMinCycle({ force: true, dryRun: true, dataDir: tmp, deps: fake5Deps }),
    { ok: true },
  );
  console.log('\n全部测试通过');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
