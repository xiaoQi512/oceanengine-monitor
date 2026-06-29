// adaptive-scheduler.mjs — 动态调度器：根据账户活跃度和时段自动调整采集频率
//
// 策略：
// - 监控时段（7-23）且有活跃消耗：高频（5min）
// - 监控时段但无消耗：中频（15min）
// - 非监控时段：低频（30min）或暂停
// - 数据过旧（>1h）：立即补偿执行一次

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getLocalDate } from './monitor-utils.mjs';

const DAILY_FILE = (date) => path.join(DATA_DIR, `daily-${date}.json`);

export const DEFAULT_SCHEDULE = {
  dailyStartHour: 7,
  dailyEndHour: 23,
  highIntervalMs: 5 * 60 * 1000,
  mediumIntervalMs: 15 * 60 * 1000,
  lowIntervalMs: 30 * 60 * 1000,
  staleThresholdMs: 60 * 60 * 1000,
};

// 读取今日最新真实数据条目的时间
export function getLastRealEntryTime(date = getLocalDate()) {
  const file = DAILY_FILE(date);
  if (!fs.existsSync(file)) return null;
  try {
    const entries = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const real = entries.filter(e => e.type !== 'data_gap');
    if (real.length === 0) return null;
    return new Date(real[real.length - 1].time || real[real.length - 1].timestamp);
  } catch {
    return null;
  }
}

export function shouldRunNow(latestSpend = 0, options = {}) {
  const cfg = { ...DEFAULT_SCHEDULE, ...options };
  const now = new Date();
  const hour = now.getHours();
  const inWindow = hour >= cfg.dailyStartHour && hour <= cfg.dailyEndHour;
  const lastTime = getLastRealEntryTime();
  const stale = lastTime ? (now - lastTime) > cfg.staleThresholdMs : true;

  // 数据过旧 → 必须执行一次（补偿）
  if (stale && lastTime) {
    return { shouldRun: true, reason: 'stale_compensation', intervalMs: 0 };
  }

  // 监控时段内
  if (inWindow) {
    const interval = latestSpend > 0 ? cfg.highIntervalMs : cfg.mediumIntervalMs;
    if (!lastTime) {
      return { shouldRun: true, reason: 'first_run_in_window', intervalMs: interval };
    }
    if (now - lastTime >= interval) {
      return { shouldRun: true, reason: latestSpend > 0 ? 'active_high_freq' : 'idle_medium_freq', intervalMs: interval };
    }
    return { shouldRun: false, reason: 'too_soon', intervalMs: interval };
  }

  // 非监控时段
  if (!lastTime || now - lastTime >= cfg.lowIntervalMs) {
    return { shouldRun: true, reason: 'off_hours_low_freq', intervalMs: cfg.lowIntervalMs };
  }
  return { shouldRun: false, reason: 'off_hours_too_soon', intervalMs: cfg.lowIntervalMs };
}

// 供 Windows 任务计划高频触发时调用：若不需要执行则直接退出
export async function adaptiveGuard(getLatestSpendFn, options = {}) {
  const spend = await getLatestSpendFn();
  const decision = shouldRunNow(spend, options);
  if (!decision.shouldRun) {
    console.log(`  ⏭ 跳过本次调度: ${decision.reason}，下次间隔 ${decision.intervalMs / 60000}min`);
    process.exit(0);
  }
  console.log(`  ▶ 允许执行: ${decision.reason}`);
  return decision;
}

export default { shouldRunNow, adaptiveGuard, getLastRealEntryTime, DEFAULT_SCHEDULE };
