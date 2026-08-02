// src/services/daily-report-run-flow.mjs - 日报运行流程
import { execSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import path, { join } from 'path';
import {
  getLocalDate, findLarkCli, guardFeedbackServer, getTodayShiftWindow,
  DATA_DIR, PROJECT_ROOT, FEISHU_CHAT_ID,
} from '../utils/monitor-utils.mjs';
import { createLogger } from '../utils/logger.mjs';
import { loadRecentLogs, getSlotKey } from './daily-report-core.mjs';
import { loadDailyEntries, buildDailyReportMetrics } from './daily-report-data.mjs';
import { collectFinalMonitorData } from './daily-report-collect.mjs';
import { buildInsightLines } from './daily-report-insights.mjs';
import { buildSlotLines } from './daily-report-slots.mjs';
import { writeDailyReportHtml } from './daily-report-html.mjs';
import { computeDailyReportComparisons } from '../domain/daily-report-comparison.mjs';
import {
  getDailyReportWaitMs,
  shouldWaitForDailyReport,
  formatDailyReportWaitMs,
  getDailyReportMarkerPath,
  shouldSkipDailyReport,
  writeStartedMarker,
} from '../domain/daily-report-wait.mjs';
import { finalizeDailyReport } from './daily-report-run-finalize.mjs';

export async function runDailyReport() {
  const log = createLogger('日报').info;
  const OEC_FORCE = process.env.OEC_FORCE === "1";
  const todayDateStr = getLocalDate();
  const reportDoneMarker = getDailyReportMarkerPath(DATA_DIR, todayDateStr, path);
  if (shouldSkipDailyReport({ markerPath: reportDoneMarker, force: OEC_FORCE, existsSyncFn: existsSync })) {
    log("日报今日已推送过，跳过");
    return;
  }
  writeStartedMarker({ markerPath: reportDoneMarker, writeFileSyncFn: writeFileSync });

  var shiftWin = getTodayShiftWindow();
  var waitMs = getDailyReportWaitMs(shiftWin);
  if (shouldWaitForDailyReport(waitMs)) {
    var pad = function(n) { return String(n).padStart(2, '0'); };
    log('当日下播时间 ' + pad(shiftWin.endHour) + ':' + pad(shiftWin.endMinute || 0) + '，等待 ' + formatDailyReportWaitMs(waitMs) + ' 分钟后推送');
    await new Promise(function(resolve) { setTimeout(resolve, waitMs); });
  }

  const SCRIPT = join(PROJECT_ROOT, 'src', 'services', 'monitor-15min-cli.mjs');
  const NODE = process.execPath;
  const LARK_CLI = findLarkCli();
  const CHAT_ID = FEISHU_CHAT_ID;
  log('📊 启动 23:05 日报汇总流程');

  const fbAlive = await guardFeedbackServer();
  if (!fbAlive) log('⚠ 反馈服务器启动失败（不影响日报推送）');
  const freshData = await collectFinalMonitorData({ node: NODE, script: SCRIPT, projectRoot: PROJECT_ROOT, execSyncFn: execSync, logFn: log });

  const today = getLocalDate();
  const { entries, gaps } = loadDailyEntries({ today, logFn: log });
  const metrics = buildDailyReportMetrics({ entries });

  try {
    writeDailyReportHtml({ today, entries, gaps, metrics, logFn: log });
    log('✅ HTML 日报已生成');
  } catch (e) {
    log(`⚠ HTML 日报生成异常: ${e.message.slice(0, 100)}`);
  }

  const recentLogs = loadRecentLogs(7);
  const { yoySpend, yoyCPA, yoyConv, vs7Spend, vs7CPA, vs7Conv } = computeDailyReportComparisons({ finalSpend: metrics.finalSpend, finalCPA: metrics.finalCPA, finalConversions: metrics.finalConversions, recentLogs });
  const insightLines = buildInsightLines({ budgetPct: metrics.budgetPct, yoySpend, yoyCPA, yoyConv, vs7Spend, vs7CPA, vs7Conv });
  const slotLines = buildSlotLines({ entries, finalSpend: metrics.finalSpend, getSlotKeyFn: getSlotKey });
  await finalizeDailyReport({ today, entries, gaps, metrics, freshData, slotLines, insightLines, larkCli: LARK_CLI, chatId: CHAT_ID, log });
}
