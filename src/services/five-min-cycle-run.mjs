// src/services/five-min-cycle-run.mjs - 5min 监控单轮运行
import {
  DATA_DIR,
  minutesBetween,
  getTodayShiftWindow,
} from '../utils/monitor-utils.mjs';
import { dualInsertSnapshot } from '../db/dual-write.mjs';
import { getSpend, calcRolling as calculateRolling } from '../domain/rolling.mjs';
import { shouldRun5min, correctConversionFallback, detectCdpZeroSpend, computeRecentCpm, isQuarterHour } from '../domain/five-minute-logic.mjs';
import { timeStr } from '../domain/five-min-cycle-log.mjs';
import { loadRecent5minSnapshots, saveFiveMinSnapshot } from './five-min-snapshot.mjs';
import { collectFiveMinData } from './five-min-collect.mjs';
import { pushQuickReport } from './five-min-push.mjs';
import { pushDetailedCard } from './five-min-detailed-push.mjs';
import { loadLastPushState, saveLastPushState, shouldPushFiveMin } from './five-min-push-state.mjs';
import { logRunDecision, applyFiveMinFixes, pushFiveMinCycle } from './five-min-cycle-steps.mjs';

function calcRolling(data, prevSnapshots) {
  return calculateRolling(data, prevSnapshots, { minutesBetween, now: new Date().toISOString() });
}

const defaultDeps = {
  getTodayShiftWindow,
  shouldRun5min,
  timeStr,
  collectFiveMinData,
  loadRecent5minSnapshots,
  correctConversionFallback,
  detectCdpZeroSpend,
  calcRolling,
  computeRecentCpm,
  getSpend,
  saveFiveMinSnapshot,
  loadLastPushState,
  shouldPushFiveMin,
  isQuarterHour,
  pushDetailedCard,
  pushQuickReport,
  saveLastPushState,
  dualInsertSnapshot,
};

export async function runFiveMinCycle({
  force = false,
  dryRun = false,
  pm2Prefix = '',
  dataDir = DATA_DIR,
  deps = {},
} = {}) {
  const d = { ...defaultDeps, ...deps };
  if (force || dryRun) console.log(`  🧪 测试模式: OEC_FORCE=${force} OEC_DRY_RUN=${dryRun}`);
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const shiftWin = d.getTodayShiftWindow();
  const runDecision = d.shouldRun5min({ minute, hour, force, shiftWin });
  if (logRunDecision(runDecision, hour, minute, shiftWin)) return { skipped: true };
  console.log(`\n[${d.timeStr()}] ⏱ 5分钟轻量速报启动 (v4)`);
  const { data } = await d.collectFiveMinData();
  if (!data) {
    console.log('  ⏭ 数据采集失败，静默退出');
    return { skipped: true };
  }
  const prevSnapshots = d.loadRecent5minSnapshots(3, { dataDir });
  const fixes = applyFiveMinFixes({ data, prevSnapshots, correctConversionFallback: d.correctConversionFallback, detectCdpZeroSpend: d.detectCdpZeroSpend });
  const rolling = d.calcRolling(data, prevSnapshots);
  data._recentCPM = d.computeRecentCpm(data, rolling, prevSnapshots);
  console.log(`  累计消耗: ¥${d.getSpend(data).toFixed(0)} | 近${Math.round(rolling.last5minMinutes || 5)}分钟: ¥${rolling.last5min.toFixed(0)} | 投放中: ${data.activeCount}`);
  if (!fixes.skipSnapshot) d.saveFiveMinSnapshot({ data, rolling, dataDir, dualInsertSnapshot: d.dualInsertSnapshot });
  if (!fixes.skipSnapshot) await pushFiveMinCycle({ d, data, rolling, prevSnapshots, dryRun, pm2Prefix, dataDir });
  console.log(`[${d.timeStr()}] ✅ 完成`);
  return { ok: true };
}
