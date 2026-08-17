// src/services/shift-sheet-reader.mjs - 按飞书排班表日期列读取当日班次
import { execFileSync } from 'node:child_process';
import {
  findLarkCli,
  PROJECT_ROOT,
  SHIFT_SPREADSHEET_TOKEN,
  SHIFT_SHEET_ID,
} from '../utils/monitor-utils.mjs';
import { parseShiftRowsByDate, normalizeSheetDate } from '../domain/shift-schedule.mjs';

// 兼容再导出:解析纯函数已下沉到 src/domain/shift-schedule.mjs
export { parseShiftRowsByDate, normalizeSheetDate };

function runLarkCli(args, {
  larkCli,
  execFileSyncFn = execFileSync,
  projectRoot = PROJECT_ROOT,
}) {
  const isExe = larkCli.endsWith('.exe');
  return execFileSyncFn(
    isExe ? larkCli : 'cmd.exe',
    isExe ? args : ['/c', larkCli, ...args],
    { encoding: 'utf-8', timeout: 30000, windowsHide: true, cwd: projectRoot }
  );
}

export function fetchSheetRowCount({
  larkCli,
  execFileSyncFn = execFileSync,
  projectRoot = PROJECT_ROOT,
  spreadsheetToken = SHIFT_SPREADSHEET_TOKEN,
  sheetId = SHIFT_SHEET_ID,
} = {}) {
  const out = runLarkCli(
    ['sheets', '+workbook-info', '--spreadsheet-token', spreadsheetToken],
    { larkCli, execFileSyncFn, projectRoot }
  );
  const parsed = JSON.parse(out);
  const sheet = parsed?.data?.sheets?.find(s => s.sheet_id === sheetId)
    || parsed?.data?.sheets?.[0];
  if (!sheet?.row_count) throw new Error('无法读取排班表行数');
  return Number(sheet.row_count);
}

export function readSheetRange(range, {
  larkCli,
  execFileSyncFn = execFileSync,
  projectRoot = PROJECT_ROOT,
  spreadsheetToken = SHIFT_SPREADSHEET_TOKEN,
  sheetId = SHIFT_SHEET_ID,
} = {}) {
  const out = runLarkCli(
    [
      'sheets', '+csv-get',
      '--spreadsheet-token', spreadsheetToken,
      '--sheet-id', sheetId,
      '--range', range,
    ],
    { larkCli, execFileSyncFn, projectRoot }
  );
  const parsed = JSON.parse(out);
  return parsed?.data?.annotated_csv || '';
}

export function fetchShiftRowsByDate(dateStr, {
  findLarkCliFn = findLarkCli,
  getSheetRowCountFn = fetchSheetRowCount,
  execFileSyncFn = execFileSync,
  projectRoot = PROJECT_ROOT,
  spreadsheetToken = SHIFT_SPREADSHEET_TOKEN,
  sheetId = SHIFT_SHEET_ID,
} = {}) {
  const larkCli = findLarkCliFn();
  if (!larkCli) throw new Error('lark-cli 未找到');

  const rowCount = getSheetRowCountFn({
    larkCli,
    execFileSyncFn,
    projectRoot,
    spreadsheetToken,
    sheetId,
  });
  const endRow = Math.max(2, Number(rowCount));
  const csv = readSheetRange(`A2:C${endRow}`, {
    larkCli,
    execFileSyncFn,
    projectRoot,
    spreadsheetToken,
    sheetId,
  });
  const shifts = parseShiftRowsByDate(csv, dateStr);
  if (shifts.length === 0) throw new Error(`排班表未找到日期 ${dateStr}`);

  return shifts;
}
