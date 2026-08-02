// src/services/shift-pusher-cache.mjs - 换班排班缓存与已处理标记
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getLocalDate } from '../utils/monitor-utils.mjs';
import { log } from './shift-pusher-state.mjs';

export function createShiftCache() {
  let todayShifts = [];
  let todayShiftsDate = '';
  let todayShiftsMtime = 0;
  let lastProcessedShifts = new Set();

  function ensureTodayShifts({
    dataDir = DATA_DIR,
    getLocalDateFn = getLocalDate,
    readTodayShiftsFn,
    logFn = log,
    fsImpl = fs,
    pathImpl = path,
  } = {}) {
    const today = getLocalDateFn();
    const cacheFile = pathImpl.join(dataDir, 'shifts-' + today + '.json');
    let mtime = 0;
    try { mtime = fsImpl.statSync(cacheFile).mtimeMs; } catch {}

    if (todayShiftsDate === today && todayShifts.length > 0 && mtime <= todayShiftsMtime) {
      return;
    }

    const prevHash = todayShifts.map(s => s.label).join(',');
    todayShifts = readTodayShiftsFn();
    todayShiftsDate = today;
    todayShiftsMtime = mtime;

    logFn('📅 今天 ' + todayShifts.length + ' 个班次:');
    todayShifts.forEach(s => logFn('   ' + s.label + ' -> 行' + s.row + ' 小时[' + s.hours.join(',') + ']'));

    const newHash = todayShifts.map(s => s.label).join(',');
    if (prevHash && prevHash !== newHash) {
      logFn('⚠ 排班表已更新（mid-day 变更），旧: ' + prevHash.substring(0, 60) + '... → 新: ' + newHash.substring(0, 60) + '...');
      lastProcessedShifts = new Set();
    }
  }

  return {
    ensureTodayShifts,
    getTodayShifts: () => todayShifts,
    isProcessed: label => lastProcessedShifts.has(label),
    markProcessed: label => lastProcessedShifts.add(label),
  };
}
