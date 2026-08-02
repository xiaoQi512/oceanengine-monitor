// src/services/daily-summary-anchors.mjs - 日汇总主播名读取
import { execFileSync } from 'node:child_process';
import { findLarkCli, getLocalDate, getShiftsPerDay, SHIFT_SPREADSHEET_TOKEN as SPREADSHEET_TOKEN, SHIFT_SHEET_ID as SHEET_ID, PROJECT_ROOT } from '../utils/monitor-utils.mjs';
import { log, getTodayStartRow } from './daily-summary-common.mjs';

export function readAnchorNames({
  findLarkCliFn = findLarkCli,
  getTodayStartRowFn = getTodayStartRow,
  getShiftsPerDayFn = getShiftsPerDay,
  getLocalDateFn = getLocalDate,
  execFileSyncFn = execFileSync,
  projectRoot = PROJECT_ROOT,
  spreadsheetToken = SPREADSHEET_TOKEN,
  sheetId = SHEET_ID,
  logFn = log,
} = {}) {
  logFn('▶ 读取主播名...');
  const larkCli = findLarkCliFn();
  if (!larkCli) {
    logFn('  ⚠ lark-cli 不可用');
    return [];
  }
  const today = getLocalDateFn();
  const startRow = getTodayStartRowFn();
  const count = getShiftsPerDayFn(today);
  const endRow = startRow + count - 1;
  try {
    const isExe = larkCli.endsWith('.exe');
    const out = execFileSyncFn(
      isExe ? larkCli : 'cmd.exe',
      isExe
        ? ['sheets', '+csv-get', '--spreadsheet-token', spreadsheetToken, '--sheet-id', sheetId, '--range', `A${startRow}:C${endRow}`]
        : ['/c', larkCli, 'sheets', '+csv-get', '--spreadsheet-token', spreadsheetToken, '--sheet-id', sheetId, '--range', `A${startRow}:C${endRow}`],
      { encoding: 'utf-8', timeout: 20000, windowsHide: true, cwd: projectRoot }
    );
    const parsed = JSON.parse(out);
    const csv = parsed?.data?.annotated_csv || '';
    const names = [];
    for (const line of csv.split('\n')) {
      const cols = line.split(',');
      if (cols.length >= 3) {
        const name = cols[2]?.trim();
        if (name) names.push(name);
      }
    }
    const seen = new Set();
    const ordered = names.filter(n => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    logFn('  ✅ 主播: ' + ordered.join(' → '));
    return ordered;
  } catch (e) {
    logFn('  ⚠ 读取主播名失败: ' + e.message);
    return [];
  }
}
