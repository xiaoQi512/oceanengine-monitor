// src/services/shift-pusher-state.mjs - shift-pusher 日志与推送锁状态
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getLocalDate, atomicWriteJSON } from '../utils/monitor-utils.mjs';

const LOCK_FILE = path.join(DATA_DIR, 'shift-push-lock.json');
const ERROR_LOG = path.join(DATA_DIR, 'shift-push-errors.log');
const CAR_MODEL_DEFAULT = '贝塔S3';
const CAR_MODEL_OVERRIDE = { '2026-06-30': '问道V9' };

export function getCarModel({ getLocalDateFn = getLocalDate } = {}) {
  const today = getLocalDateFn();
  return CAR_MODEL_OVERRIDE[today] || CAR_MODEL_DEFAULT;
}

export function log(...args) {
  console.log('[shift-pusher] ' + new Date().toLocaleString() + ' |', ...args);
}

export function logError(...args) {
  const line = '[' + new Date().toLocaleString() + '] ' + args.join(' ') + '\n';
  try { fs.appendFileSync(ERROR_LOG, line); } catch {}
  console.error('[shift-pusher] ERROR |', ...args);
}

export function todayDateCN() {
  const d = new Date();
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

export function isAlreadyPushed(shiftLabel, { lockFile = LOCK_FILE, getLocalDateFn = getLocalDate, fsImpl = fs } = {}) {
  try {
    const lock = JSON.parse(fsImpl.readFileSync(lockFile, 'utf-8'));
    const today = getLocalDateFn();
    return lock.date === today && lock.shifts && lock.shifts.includes(shiftLabel);
  } catch {
    return false;
  }
}

export function markPushed(
  shiftLabel,
  {
    lockFile = LOCK_FILE,
    getLocalDateFn = getLocalDate,
    atomicWriteFn = atomicWriteJSON,
    fsImpl = fs,
    logErrorFn = logError,
  } = {},
) {
  try {
    const today = getLocalDateFn();
    let lock = { date: today, shifts: [] };
    try {
      const existing = JSON.parse(fsImpl.readFileSync(lockFile, 'utf-8'));
      if (existing.date === today && Array.isArray(existing.shifts)) {
        lock = existing;
      }
    } catch {}
    if (!lock.shifts.includes(shiftLabel)) {
      lock.shifts.push(shiftLabel);
    }
    atomicWriteFn(lockFile, lock);
  } catch (e) {
    logErrorFn('写 lock 文件失败:', e.message);
  }
}
