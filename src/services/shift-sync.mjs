// src/services/shift-sync.mjs - 次日排班同步核心
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
import { normalizeShiftLabel } from '../domain/shift-schedule.mjs';

export function getTomorrowDate({ getLocalDateFn = getLocalDate } = {}) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return getLocalDateFn(d);
}

export function fetchShifts(dateStr, {
  findLarkCliFn = findLarkCli,
  getShiftRowForDateFn = getShiftRowForDate,
  getShiftsPerDayFn = getShiftsPerDay,
  execFileSyncFn = execFileSync,
  projectRoot = PROJECT_ROOT,
  spreadsheetToken = SPREADSHEET_TOKEN,
  sheetId = SHEET_ID,
} = {}) {
  const larkCli = findLarkCliFn();
  if (!larkCli) throw new Error('lark-cli not found');
  const startRow = getShiftRowForDateFn(dateStr);
  const count = getShiftsPerDayFn(dateStr);
  const endRow = startRow + count - 1;
  const isExe = larkCli.endsWith('.exe');
  const range = `B${startRow}:C${endRow}`;
  const out = execFileSyncFn(
    isExe ? larkCli : 'cmd.exe',
    isExe
      ? ['sheets', '+csv-get', '--spreadsheet-token', spreadsheetToken, '--sheet-id', sheetId, '--range', range]
      : ['/c', larkCli, 'sheets', '+csv-get', '--spreadsheet-token', spreadsheetToken, '--sheet-id', sheetId, '--range', range],
    { encoding: 'utf-8', timeout: 20000, windowsHide: true, cwd: projectRoot }
  );
  const parsed = JSON.parse(out);
  const csv = parsed?.data?.annotated_csv || '';
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length === 0) throw new Error('排班表为空');

  const shifts = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const timeCell = (cols[0] || '').trim();
    const anchorCell = (cols[1] || '').trim();
    const match = timeCell.match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
    if (match) {
      const startTime = match[1] + ':' + match[2];
      const endTime = match[3] + ':' + match[4];
      const [startH, startM] = [parseInt(match[1]), parseInt(match[2])];
      const [endH, endM] = [parseInt(match[3]), parseInt(match[4])];
      const hours = [];
      for (let h = startH; h <= endH; h++) {
        if (h === endH && endM === 0) continue;
        hours.push(h);
      }
      shifts.push({ label: normalizeShiftLabel(`${startTime}-${endTime}`), hours, row: startRow + i, anchorName: anchorCell || '' });
    }
  }
  if (shifts.length === 0) throw new Error('无法解析班次时间');

  let minStartH = 24;
  let minStartM = 0;
  let maxEndH = 0;
  let maxEndM = 0;
  let earliestStart = '';
  let latestEnd = '';
  for (const s of shifts) {
    const [sh, sm] = s.label.split('-')[0].split(':').map(Number);
    const [eh, em] = s.label.split('-')[1].split(':').map(Number);
    if (sh < minStartH || (sh === minStartH && sm < minStartM)) {
      minStartH = sh;
      minStartM = sm;
      earliestStart = s.label.split('-')[0];
    }
    if (eh > maxEndH || (eh === maxEndH && em > maxEndM)) {
      maxEndH = eh;
      maxEndM = em;
      latestEnd = s.label.split('-')[1];
    }
  }

  return {
    date: dateStr,
    startHour: minStartH,
    startMinute: minStartM,
    endHour: maxEndH,
    endMinute: maxEndM,
    startTime: earliestStart,
    endTime: latestEnd,
    shifts,
    syncedAt: new Date().toISOString(),
  };
}

export function saveCache(dateStr, data, { dataDir = DATA_DIR, fsImpl = fs, pathImpl = path } = {}) {
  if (!fsImpl.existsSync(dataDir)) fsImpl.mkdirSync(dataDir, { recursive: true });
  const cacheFile = pathImpl.join(dataDir, `shifts-${dateStr}.json`);
  const tmpFile = cacheFile + '.tmp';
  try {
    fsImpl.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fsImpl.renameSync(tmpFile, cacheFile);
    return true;
  } catch {
    try { fsImpl.unlinkSync(tmpFile); } catch {}
    return false;
  }
}
