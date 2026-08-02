// src/services/shift-pusher-schedule.mjs - shift-pusher 排班读取与结束检测
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  findLarkCli,
  DATA_DIR,
  PROJECT_ROOT,
  getLocalDate,
  SHIFT_SPREADSHEET_TOKEN as SPREADSHEET_TOKEN,
  SHIFT_SHEET_ID as SHEET_ID,
} from '../utils/monitor-utils.mjs';
import { log } from './shift-pusher-state.mjs';
import { normalizeShiftLabel } from '../domain/shift-schedule.mjs';
import { fetchShiftRowsByDate } from './shift-sheet-reader.mjs';
export { getShiftEndMinutes, isShiftEnded } from '../domain/shift-schedule.mjs';

export function readTodayShifts({
  dataDir = DATA_DIR,
  projectRoot = PROJECT_ROOT,
  getLocalDateFn = getLocalDate,
  findLarkCliFn = findLarkCli,
  fetchShiftRowsByDateFn = fetchShiftRowsByDate,
  execFileSyncFn = execFileSync,
  logFn = log,
  spreadsheetToken = SPREADSHEET_TOKEN,
  sheetId = SHEET_ID,
} = {}) {
  const today = getLocalDateFn();
  const cacheFile = path.join(dataDir, 'shifts-' + today + '.json');
  try {
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (cached.shifts && cached.shifts.length > 0) {
        logFn('📋 从缓存读取 ' + cached.shifts.length + ' 个班次');
        return cached.shifts.map(s => ({ ...s, label: normalizeShiftLabel(s.label) }));
      }
    }
  } catch (e) {
    logFn('⚠ 读取班次缓存失败，尝试实时拉取: ' + e.message);
  }

  const shifts = fetchShiftRowsByDateFn(today, {
    findLarkCliFn,
    execFileSyncFn,
    projectRoot,
    spreadsheetToken,
    sheetId,
  });
  logFn('📋 实时拉取 ' + shifts.length + ' 个班次');
  return shifts;
}
