// src/services/shift-pusher-run.mjs - shift-pusher 轮询调度与主入口
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getLocalDate } from '../utils/monitor-utils.mjs';
import { readTodayShifts } from './shift-pusher-schedule.mjs';
import { log } from './shift-pusher-state.mjs';
import { createShiftCache } from './shift-pusher-cache.mjs';
import { pollOnce as runPollOnce, startPolling as runStartPolling, runShiftPusherMain as runMain } from './shift-pusher-run-main.mjs';

const shiftCache = createShiftCache();

export function ensureTodayShifts({
  dataDir = DATA_DIR,
  getLocalDateFn = getLocalDate,
  readTodayShiftsFn = readTodayShifts,
  logFn = log,
  fsImpl = fs,
  pathImpl = path,
} = {}) {
  shiftCache.ensureTodayShifts({ dataDir, getLocalDateFn, readTodayShiftsFn, logFn, fsImpl, pathImpl });
}

export function getTodayShifts() {
  return shiftCache.getTodayShifts();
}

export function pollOnce(options = {}) {
  return runPollOnce({ dataDir: DATA_DIR, getLocalDateFn: getLocalDate, readTodayShiftsFn: readTodayShifts, ...options, shiftCache: options.shiftCache || shiftCache });
}

export function startPolling(options = {}) {
  return runStartPolling({ dataDir: DATA_DIR, getLocalDateFn: getLocalDate, readTodayShiftsFn: readTodayShifts, ...options, shiftCache: options.shiftCache || shiftCache });
}

export async function runShiftPusherMain(options = {}) {
  return runMain({ dataDir: DATA_DIR, getLocalDateFn: getLocalDate, readTodayShiftsFn: readTodayShifts, mkdirSync: fs.mkdirSync, ...options, shiftCache: options.shiftCache || shiftCache });
}
