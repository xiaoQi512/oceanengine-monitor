// src/services/shift-pusher-schedule.mjs - shift-pusher 排班读取与结束检测
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  findLarkCli,
  DATA_DIR,
  PROJECT_ROOT,
  getLocalDate,
  getShiftsPerDay,
  getShiftRowForDate,
  SHIFT_SPREADSHEET_TOKEN as SPREADSHEET_TOKEN,
  SHIFT_SHEET_ID as SHEET_ID,
} from '../utils/monitor-utils.mjs';
import { log } from './shift-pusher-state.mjs';
export { getShiftEndMinutes, isShiftEnded } from '../domain/shift-schedule.mjs';

export function readTodayShifts({
  dataDir = DATA_DIR,
  projectRoot = PROJECT_ROOT,
  getLocalDateFn = getLocalDate,
  findLarkCliFn = findLarkCli,
  getShiftRowForDateFn = getShiftRowForDate,
  getShiftsPerDayFn = getShiftsPerDay,
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
        return cached.shifts;
      }
    }
  } catch (e) {
    logFn('⚠ 读取班次缓存失败，尝试实时拉取: ' + e.message);
  }

  const larkCli = findLarkCliFn();
  if (!larkCli) throw new Error('lark-cli 未找到');
  const startRow = getShiftRowForDateFn(today);
  const count = getShiftsPerDayFn(today);
  const endRow = startRow + count - 1;
  const isExe = larkCli.endsWith('.exe');
  const out = execFileSyncFn(
    isExe ? larkCli : 'cmd.exe',
    isExe
      ? ['sheets', '+csv-get', '--spreadsheet-token', spreadsheetToken, '--sheet-id', sheetId, '--range', 'B' + startRow + ':B' + endRow]
      : ['/c', larkCli, 'sheets', '+csv-get', '--spreadsheet-token', spreadsheetToken, '--sheet-id', sheetId, '--range', 'B' + startRow + ':B' + endRow],
    { encoding: 'utf-8', timeout: 20000, windowsHide: true, cwd: projectRoot }
  );
  const parsed = JSON.parse(out);
  const csv = parsed?.data?.annotated_csv || '';
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length === 0) throw new Error('排班表为空');

  const shifts = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
    if (match) {
      const startTime = match[1] + ':' + match[2];
      const endTime = match[3] + ':' + match[4];
      const startH = parseInt(match[1]);
      const endH = parseInt(match[3]);
      const endM = parseInt(match[4]);
      const hours = [];
      for (let h = startH; h <= endH; h++) {
        if (h === endH && endM === 0) continue;
        hours.push(h);
      }
      shifts.push({ label: startTime + '-' + endTime, hours, row: startRow + i });
    }
  }
  if (shifts.length === 0) throw new Error('无法解析班次时间');
  logFn('📋 实时拉取 ' + shifts.length + ' 个班次');
  return shifts;
}
