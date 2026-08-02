// src/services/shift-pusher-run-main.mjs - 换班轮询主循环与强制执行
import { getShiftEndMinutes, isShiftEnded } from './shift-pusher-schedule.mjs';
import { isAlreadyPushed, log, logError } from './shift-pusher-state.mjs';

export async function pollOnce({
  runShift,
  shiftCache,
  force = false,
  now = new Date(),
  dataDir,
  getLocalDateFn,
  readTodayShiftsFn,
  logFn = log,
  isShiftEndedFn = isShiftEnded,
  isAlreadyPushedFn = isAlreadyPushed,
  logErrorFn = logError,
} = {}) {
  shiftCache.ensureTodayShifts({ dataDir, getLocalDateFn, readTodayShiftsFn, logFn });
  for (const shift of shiftCache.getTodayShifts()) {
    if (isShiftEndedFn(shift, now)) {
      if (isAlreadyPushedFn(shift.label)) continue;
      if (shiftCache.isProcessed(shift.label) && !force) continue;
      shiftCache.markProcessed(shift.label);
      try {
        await runShift(shift);
      } catch (e) {
        logErrorFn('未捕获异常 ' + shift.label + ':', e.message, e.stack);
      }
    }
  }
}

export function startPolling({
  runShift,
  shiftCache,
  force = false,
  dataDir,
  getLocalDateFn,
  readTodayShiftsFn,
  setIntervalFn = setInterval,
  logFn = log,
  logErrorFn = logError,
} = {}) {
  logFn('🚀 换班推送守护进程启动 (动态轮询模式)');
  shiftCache.ensureTodayShifts({ dataDir, getLocalDateFn, readTodayShiftsFn, logFn });
  logFn('⏰ 轮询模式已启动，每60秒检测班次结束...');
  pollOnce({ runShift, shiftCache, force, dataDir, getLocalDateFn, readTodayShiftsFn, logFn, logErrorFn }).catch(e => logErrorFn('轮询异常:', e.message));
  setIntervalFn(() => {
    pollOnce({ runShift, shiftCache, force, dataDir, getLocalDateFn, readTodayShiftsFn, logFn, logErrorFn }).catch(e => logErrorFn('轮询异常:', e.message));
  }, 60 * 1000);
}

export async function runShiftPusherMain({
  runShift,
  shiftCache,
  force = false,
  shiftLabel = '',
  dataDir,
  getLocalDateFn,
  readTodayShiftsFn,
  mkdirSync,
  logFn = log,
} = {}) {
  try { mkdirSync(dataDir, { recursive: true }); } catch {}
  if (force) {
    shiftCache.ensureTodayShifts({ dataDir, getLocalDateFn, readTodayShiftsFn, logFn });
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayShifts = shiftCache.getTodayShifts();
    let bestShift = null;
    if (shiftLabel) {
      bestShift = todayShifts.find(s => s.label === shiftLabel);
      if (!bestShift) {
        logFn('🔧 OEC_SHIFT_LABEL=' + shiftLabel + ' 未找到匹配班次，可用: ' + todayShifts.map(s => s.label).join(', '));
        return;
      }
      logFn('🔧 OEC_FORCE=1 + OEC_SHIFT_LABEL，强制执行: ' + bestShift.label);
    } else {
      let bestEndMin = -1;
      for (const s of todayShifts) {
        const endMin = getShiftEndMinutes(s);
        if (endMin >= 0 && endMin <= nowMin && endMin > bestEndMin) {
          bestEndMin = endMin;
          bestShift = s;
        }
      }
      if (!bestShift) {
        bestShift = todayShifts[0];
        logFn('🔧 OEC_FORCE=1，当前无已结束班次，执行第一个班次: ' + bestShift.label);
      } else {
        logFn('🔧 OEC_FORCE=1，强制执行最近结束的班次: ' + bestShift.label);
      }
    }
    await runShift(bestShift);
    return;
  }
  startPolling({ runShift, shiftCache, force, dataDir, getLocalDateFn, readTodayShiftsFn, logFn });
}
