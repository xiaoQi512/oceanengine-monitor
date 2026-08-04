// src/services/shift-sync.mjs - 次日排班同步核心
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
import { fetchShiftRowsByDate } from './shift-sheet-reader.mjs';

export function getTomorrowDate({ getLocalDateFn = getLocalDate, now = new Date() } = {}) {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return getLocalDateFn(d);
}

export function fetchShifts(dateStr, {
  fetchShiftRowsByDateFn = fetchShiftRowsByDate,
  findLarkCliFn = findLarkCli,
  execFileSyncFn = execFileSync,
  projectRoot = PROJECT_ROOT,
  spreadsheetToken = SPREADSHEET_TOKEN,
  sheetId = SHEET_ID,
} = {}) {
  const shifts = fetchShiftRowsByDateFn(dateStr, {
    findLarkCliFn,
    execFileSyncFn,
    projectRoot,
    spreadsheetToken,
    sheetId,
  });

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
