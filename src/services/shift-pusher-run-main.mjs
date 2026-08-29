// src/services/shift-pusher-run-main.mjs - 换班轮询主循环与强制执行
import fs from 'node:fs';
import path from 'node:path';
import { getShiftEndMinutes, isShiftEnded } from './shift-pusher-schedule.mjs';
import { isAlreadyPushed, log, logError } from './shift-pusher-state.mjs';

/**
 * 消费仪表盘补推信号(repush-signal.json)：
 * 检测到 signal.shiftLabel 时，对对应班次强制执行 runShift(force)，然后清理信号文件。
 */
export async function consumeRepushSignal({
  runShift,
  shiftCache,
  dataDir,
  logFn = log,
} = {}) {
  if (!dataDir) return;
  const signalFile = path.join(dataDir, 'repush-signal.json');
  let signal;
  try {
    signal = JSON.parse(fs.readFileSync(signalFile, 'utf-8'));
  } catch {
    return; // 无信号或文件无效
  }
  const { shiftLabel } = signal;
  if (!shiftLabel) {
    try { fs.unlinkSync(signalFile); } catch {}
    return;
  }
  const todayShifts = shiftCache.getTodayShifts();
  const shift = todayShifts.find(s => s.label === shiftLabel);
  if (!shift) {
    logFn(`🔧 补推信号 ${shiftLabel} 未找到匹配班次，忽略并清理`);
    try { fs.unlinkSync(signalFile); } catch {}
    return;
  }
  logFn(`🔧 收到补推信号，强制执行: ${shiftLabel}`);
  try {
    await runShift(shift, { force: true });
  } catch (e) {
    logFn('补推失败 ' + shiftLabel + ':', e.message);
  }
  try { fs.unlinkSync(signalFile); } catch {}
}

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
  // 先消费仪表盘补推信号（每轮优先执行）
  await consumeRepushSignal({ runShift, shiftCache, dataDir, logFn });
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
