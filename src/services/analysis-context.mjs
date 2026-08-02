// src/services/analysis-context.mjs - 15min 分析上下文编排
import path from 'node:path';
import { getLocalDate as defaultGetLocalDate } from '../utils/monitor-utils.mjs';
import {
  readDailyLog as defaultReadDailyLog,
  loadPreviousSnapshots as defaultLoadPreviousSnapshots,
  loadTodaysSnapshots as defaultLoadTodaysSnapshots,
} from './snapshot-store.mjs';
import { analyzeCampaigns as defaultAnalyzeCampaigns } from '../domain/analyze.mjs';
import {
  detectTrendsFromLog,
  computeYesterdayBaseline,
  computeMultiDayBaseline,
  analyze3HourWindowFromLog,
} from '../domain/analysis-utils.mjs';

export function loadAnalysisContext({
  dataDir,
  getLocalDate = defaultGetLocalDate,
  readDailyLog = defaultReadDailyLog,
  loadPreviousSnapshots = defaultLoadPreviousSnapshots,
  loadTodaysSnapshots = defaultLoadTodaysSnapshots,
  days = 3,
} = {}) {
  const now = new Date();
  const todayLog = readDailyLog(path.join(dataDir, `daily-${getLocalDate()}.json`));
  const trends = detectTrendsFromLog(todayLog);
  const window3h = analyze3HourWindowFromLog(todayLog, Date.now());

  const yesterdayDate = getLocalDate(new Date(now - 24 * 60 * 60 * 1000));
  const yesterdayBaseline = computeYesterdayBaseline(
    readDailyLog(path.join(dataDir, `daily-${yesterdayDate}.json`)),
    now,
    yesterdayDate,
  );

  const dailyLogs = [];
  for (let d = 1; d <= days; d++) {
    const dateStr = getLocalDate(new Date(now - d * 24 * 60 * 60 * 1000));
    const log = readDailyLog(path.join(dataDir, `daily-${dateStr}.json`));
    if (log) dailyLogs.push({ date: dateStr, log });
  }
  const multiDay = computeMultiDayBaseline(dailyLogs, now);

  return {
    previous: loadPreviousSnapshots(dataDir),
    multiDay,
    window3h,
    trends,
    yesterdayBaseline,
    todaySnapshots: loadTodaysSnapshots(dataDir),
  };
}

export function analyzeMonitorData(
  campaigns,
  accountSpend = 0,
  accountBudget = 0,
  accountBalance = 0,
  pageSummary = null,
  options = {},
) {
  const {
    dataDir,
    dailyBudget = 45000,
    dailyStartHour = 0,
    dailyStartMinute = 0,
    dailyEndHour = 24,
    dailyEndMinute = 0,
    analyzeCampaigns = defaultAnalyzeCampaigns,
  } = options;
  const context = loadAnalysisContext(options);
  return analyzeCampaigns(campaigns, accountSpend, accountBudget, accountBalance, pageSummary, {
    dailyBudget,
    dailyStartHour,
    dailyStartMinute,
    dailyEndHour,
    dailyEndMinute,
    ...context,
  });
}
