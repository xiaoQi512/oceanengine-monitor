// src/services/monitor-cycle.mjs - 15min 监控单轮运行周期编排
import path from 'node:path';
import { getLocalDate, guardFeedbackServer, atomicWriteJSON } from '../utils/monitor-utils.mjs';
import { pushFile } from '../feishu/guard.mjs';
import { verifyConsistency, refreshMaterialized } from '../db/index.mjs';
import { dualInsertSnapshot } from '../db/dual-write.mjs';
import { printMonitorSummary } from '../domain/monitor-summary.mjs';
import { saveDailyLog, saveSnapshot, sendReportIfEnabled, writeHtmlReport } from './monitor-io.mjs';
import { checkLiveStatus, collectMonitorData } from './monitor-collect.mjs';
import { ensureDataDir, rotateRunLog, refreshMaterializedViews } from './monitor-runtime.mjs';
import { createFeishuCardBuilder } from './monitor-card.mjs';
import { createHtmlReportBuilder } from './monitor-report.mjs';
import { analyzeMonitorData } from './analysis-context.mjs';
import { sendFeishuPush, createPushDeps } from './monitor-push.mjs';
import { synthesizeLatestQuarter } from './synthetic-5min.mjs';

const defaultDeps = {
  getLocalDate,
  guardFeedbackServer,
  atomicWriteJSON,
  pushFile,
  verifyConsistency,
  refreshMaterialized,
  dualInsertSnapshot,
  printMonitorSummary,
  saveDailyLog,
  saveSnapshot,
  sendReportIfEnabled,
  writeHtmlReport,
  checkLiveStatus,
  collectMonitorData,
  ensureDataDir,
  rotateRunLog,
  refreshMaterializedViews,
  createFeishuCardBuilder,
  createHtmlReportBuilder,
  analyzeMonitorData,
  sendFeishuPush,
  createPushDeps,
};

export async function runMonitorCycle({
  config,
  force = false,
  dryRun = false,
  logFile,
  deps = {},
} = {}) {
  const d = { ...defaultDeps, ...deps };
  const runLogFile = logFile || path.join(config.dataDir, 'monitor-v3.log');
  const startTime = Date.now();

  if (force || dryRun) {
    console.log(`  🧪 测试模式: OEC_FORCE=${force} OEC_DRY_RUN=${dryRun}`);
  }

  d.rotateRunLog({ logFile: runLogFile });

  const liveStatus = await d.checkLiveStatus({ force });
  if (!liveStatus.isLive) return { stopped: true };

  console.log(`\n[${new Date().toLocaleTimeString()}] 🚀 巨量引擎监控启动 (v5: 纯 HTTP API)`);
  d.ensureDataDir(config.dataDir);

  const {
    campaigns,
    accountSpend,
    accountBudget,
    accountBalance,
    pageSummary,
  } = await d.collectMonitorData();

  const analysis = d.analyzeMonitorData(campaigns, accountSpend, accountBudget, accountBalance, pageSummary, {
    dataDir: config.dataDir,
    dailyBudget: config.dailyBudget,
    dailyStartHour: config.dailyStartHour,
    dailyStartMinute: config.dailyStartMinute,
    dailyEndHour: config.dailyEndHour,
    dailyEndMinute: config.dailyEndMinute,
  });

  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  d.saveSnapshot({
    analysis,
    timestamp,
    dataDir: config.dataDir,
    atomicWriteJSON: d.atomicWriteJSON,
    dualInsertSnapshot: d.dualInsertSnapshot,
    verifyConsistency: d.verifyConsistency,
  });
  d.saveDailyLog(analysis, {
    dataDir: config.dataDir,
    getLocalDate: d.getLocalDate,
    atomicWriteJSON: d.atomicWriteJSON,
  });

  // 补写合成 5min 快照（整刻钟格点），消除趋势图断点
  try {
    const synth = synthesizeLatestQuarter();
    if (synth.rows > 0) console.log(`  📊 合成5min: ${synth.rows} 条`);
  } catch (e) {
    console.warn(`  ⚠ 合成5min失败: ${e.message}`);
  }

  let htmlFile = '';
  if (config.enableHtmlReport) {
    htmlFile = d.writeHtmlReport({
      analysis,
      reportDir: config.reportDir,
      generateHTML: d.createHtmlReportBuilder({ accountName: config.accountName }),
    });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  d.printMonitorSummary(analysis, elapsed);

  await d.guardFeedbackServer();
  await d.sendFeishuPush(analysis, d.createPushDeps({
    config,
    dryRun,
    buildFeishuCard: d.createFeishuCardBuilder({ enableHtmlReport: config.enableHtmlReport }),
  }));
  await d.sendReportIfEnabled({ analysis, config, pushFile: d.pushFile, htmlFile });
  d.refreshMaterializedViews({ refreshMaterialized: d.refreshMaterialized });

  console.log(`[${new Date().toLocaleTimeString()}] ✅ 完成`);
  return { ok: true };
}
