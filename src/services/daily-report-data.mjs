// src/services/daily-report-data.mjs - 日报数据读取与指标汇总
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../utils/monitor-utils.mjs';

export function loadDailyEntries({
  today,
  dataDir = DATA_DIR,
  fsImpl = fs,
  pathImpl = path,
  logFn = console.log,
}) {
  const logFile = pathImpl.join(dataDir, `daily-${today}.json`);
  if (!fsImpl.existsSync(logFile)) {
    logFn('❌ 未找到当日数据文件，无法推送日报');
    throw new Error('未找到当日数据文件，无法推送日报');
  }
  let logData;
  try {
    logData = JSON.parse(fsImpl.readFileSync(logFile, 'utf-8'));
  } catch (e) {
    logFn(`❌ 日志解析失败: ${e.message.slice(0, 100)}`);
    throw new Error(`日志解析失败: ${e.message}`);
  }
  const entries = logData.filter(e => !e.type || e.type !== 'data_gap');
  const gaps = logData.filter(e => e.type === 'data_gap').length;
  if (entries.length === 0) {
    logFn('❌ 当日无有效采样数据');
    throw new Error('当日无有效采样数据');
  }
  return { entries, gaps };
}

export function buildDailyReportMetrics({ entries }) {
  const last = entries[entries.length - 1];
  const finalSpend = last.totalSpend || 0;
  const finalConversions = last.totalConversions || 0;
  const finalCPA = finalConversions > 0 ? finalSpend / finalConversions : 0;
  const effectiveBudget = last.accountBudget || 45000;
  const budgetPct = (finalSpend / effectiveBudget * 100).toFixed(0);
  const totalAlerts = entries.reduce((s, e) => s + (e.alertCount || 0), 0);
  const totalLeads = last.totalLeads || 0;
  const openRetainStr = last.openRetainRate ? (last.openRetainRate * 100).toFixed(1) + '%' : 'N/A';
  return {
    finalSpend,
    finalConversions,
    finalCPA,
    effectiveBudget,
    budgetPct,
    totalAlerts,
    totalLeads,
    openRetainStr,
  };
}
