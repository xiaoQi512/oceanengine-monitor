// tests/monitor-io.test.mjs - 日报落盘与报表文件发送测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveDailyLog, saveSnapshot, sendReportFileToChat, sendReportIfEnabled, writeHtmlReport } from '../src/services/monitor-io.mjs';

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-io-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const analysis = {
  summary: {
    totalSpending: 100,
    totalActive: 3,
    totalSpend: 100,
    totalConversions: 2,
    avgCPA: 50,
    avgCTR: 0.01,
    avgCVR: 0.02,
    totalLeads: 1,
    totalLiveViews: 10,
  },
  delta: {
    spendLast15min: 20,
    speedCurrent: 1.2,
    budgetUsed: 0.4,
    timeSlot: '20:00',
    pacingHealth: 'ok',
    idealSpend: 80,
    projectedDaily: 300,
    pacingRatio: 1.1,
    lifecycle: {},
    yoy: null,
    convLast15min: 1,
    cplLast15min: 20,
  },
  rampingUp: [{ id: 1 }],
  dropping: [],
  alerts: [{ type: 'budget_cap' }],
};

await withTempDir((dir) => {
  const writes = [];
  saveDailyLog(analysis, {
    dataDir: dir,
    getLocalDate: () => '2026-08-02',
    atomicWriteJSON: (file, data) => {
      writes.push({ file, data });
      fs.writeFileSync(file, JSON.stringify(data));
    },
  });
  assert.strictEqual(writes.length, 1);
  assert.ok(writes[0].file.endsWith(path.join('daily-2026-08-02.json')));
  assert.strictEqual(writes[0].data.length, 1);
  assert.strictEqual(writes[0].data[0].totalSpending, 100);
  assert.strictEqual(writes[0].data[0].alertTypes[0], 'budget_cap');

  const second = {
    ...analysis,
    summary: { ...analysis.summary, totalSpending: 120 },
  };
  saveDailyLog(second, {
    dataDir: dir,
    getLocalDate: () => '2026-08-02',
    atomicWriteJSON: (file, data) => {
      writes.push({ file, data });
      fs.writeFileSync(file, JSON.stringify(data));
    },
  });
  assert.strictEqual(writes[1].data.length, 2);
  assert.strictEqual(writes[1].data[1].totalSpending, 120);

  const snapshotResult = saveSnapshot({
    analysis,
    timestamp: '2026-08-02T01-30-00',
    dataDir: dir,
    atomicWriteJSON: (file, data) => {
      writes.push({ file, data });
      fs.writeFileSync(file, JSON.stringify(data));
    },
    dualInsertSnapshot: () => ({ ok: true, rows: 2 }),
    verifyConsistency: () => ({ ok: true }),
  });
  assert.strictEqual(snapshotResult.jsonOk, true);
  assert.strictEqual(snapshotResult.sqliteRows, 2);
  assert.ok(writes.some(w => w.file.endsWith('2026-08-02T01-30-00.json')));

  const jsonFail = saveSnapshot({
    analysis,
    timestamp: '2026-08-02T01-31-00',
    dataDir: dir,
    atomicWriteJSON: () => { throw new Error('disk full'); },
    dualInsertSnapshot: () => ({ ok: true, rows: 1 }),
    verifyConsistency: () => ({ ok: true }),
  });
  assert.strictEqual(jsonFail.jsonOk, false);
  assert.strictEqual(jsonFail.sqliteRows, 1);

  const sqliteFail = saveSnapshot({
    analysis,
    timestamp: '2026-08-02T01-32-00',
    dataDir: dir,
    atomicWriteJSON: () => {},
    dualInsertSnapshot: () => { throw new Error('db locked'); },
    verifyConsistency: () => ({ ok: true }),
  });
  assert.strictEqual(sqliteFail.jsonOk, true);
  assert.strictEqual(sqliteFail.sqliteRows, 0);

  const htmlFile = writeHtmlReport({
    analysis,
    reportDir: dir,
    generateHTML: () => '<html>报表</html>',
  });
  assert.ok(htmlFile.endsWith('oceanengine-report.html'));
  assert.strictEqual(fs.readFileSync(htmlFile, 'utf-8'), '<html>报表</html>');
});

let pushCalls = 0;
const config = {
  larkCli: 'lark',
  reportDir: '',
  feishuChatId: 'chat',
};
assert.strictEqual(await sendReportFileToChat({ config: { ...config, larkCli: '' }, pushFile: async () => { pushCalls++; return { ok: true }; } }), false);
assert.strictEqual(pushCalls, 0);

await withTempDir(async (dir) => {
  const reportConfig = { ...config, reportDir: dir };
  assert.strictEqual(await sendReportFileToChat({ config: reportConfig, pushFile: async () => { pushCalls++; return { ok: true }; } }), false);
  assert.strictEqual(pushCalls, 0);

  fs.writeFileSync(path.join(dir, 'oceanengine-report.html'), '<html></html>');
  let receivedArgs = null;
  const ok = await sendReportFileToChat({
    config: reportConfig,
    pushFile: async (...args) => {
      receivedArgs = args;
      pushCalls++;
      return { ok: true };
    },
  });
  assert.strictEqual(ok, true);
  assert.strictEqual(pushCalls, 1);
  assert.strictEqual(receivedArgs[0], 'lark');
  assert.ok(receivedArgs[1].endsWith('oceanengine-report.html'));
  assert.strictEqual(receivedArgs[2], 'chat');
  assert.strictEqual(receivedArgs[3], dir);

  const fallback = await sendReportFileToChat({
    config: reportConfig,
    pushFile: async () => ({ ok: false, error: 'boom', fallback: true, path: 'local' }),
  });
  assert.strictEqual(fallback, false);

  let reportSent = false;
  const reportAnalysis = { active: [{ id: 1 }], summary: { totalSpend: 1 } };
  const enabled = await sendReportIfEnabled({
    analysis: reportAnalysis,
    config: { ...reportConfig, enableHtmlReport: true },
    pushFile: async () => { reportSent = true; return { ok: true }; },
    htmlFile: path.join(dir, 'oceanengine-report.html'),
  });
  assert.strictEqual(enabled, true);
  assert.strictEqual(reportSent, true);

  reportSent = false;
  const noData = await sendReportIfEnabled({
    analysis: { active: [], summary: { totalSpend: 0 } },
    config: { ...reportConfig, enableHtmlReport: true },
    pushFile: async () => { reportSent = true; return { ok: true }; },
  });
  assert.strictEqual(noData, false);
  assert.strictEqual(reportSent, false);

  const disabled = await sendReportIfEnabled({
    analysis: reportAnalysis,
    config: { ...reportConfig, enableHtmlReport: false },
    pushFile: async () => { throw new Error('should not send'); },
  });
  assert.strictEqual(disabled, false);
});

console.log('\n全部测试通过');
