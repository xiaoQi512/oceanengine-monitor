// src/services/shift-sheet-reader.mjs - 按飞书排班表日期列读取当日班次
import { execFileSync } from 'node:child_process';
import {
  findLarkCli,
  PROJECT_ROOT,
  SHIFT_SPREADSHEET_TOKEN,
  SHIFT_SHEET_ID,
} from '../utils/monitor-utils.mjs';
import { normalizeShiftLabel } from '../domain/shift-schedule.mjs';

const pad = n => String(n).padStart(2, '0');

function toIsoDate(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
}

export function normalizeSheetDate(value, dateStr) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;

  const cn = text.match(/^(\d{1,2})月(\d{1,2})日/);
  if (cn) {
    const year = Number(String(dateStr || '').slice(0, 4)) || new Date().getFullYear();
    return `${year}-${pad(cn[1])}-${pad(cn[2])}`;
  }

  const short = text.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (short) {
    const year = Number(String(dateStr || '').slice(0, 4)) || new Date().getFullYear();
    return `${year}-${pad(short[1])}-${pad(short[2])}`;
  }

  return '';
}

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

function startMinutes(label) {
  const m = label.match(/^(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function parseShiftRowsByDate(csv, dateStr) {
  const targetIso = toIsoDate(dateStr);
  const shifts = [];

  for (const line of String(csv || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const prefix = line.match(/^\[row=(\d+)\]\s*(.*)$/);
    const payload = prefix ? prefix[2] : line;
    const cols = payload.split(',');
    const dateCell = (cols[0] || '').trim();
    if (normalizeSheetDate(dateCell, dateStr) !== targetIso) continue;

    const timeMatch = (cols[1] || '').trim().match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
    if (!timeMatch) continue;

    const startH = Number(timeMatch[1]);
    const startM = Number(timeMatch[2]);
    const endH = Number(timeMatch[3]);
    const endM = Number(timeMatch[4]);
    const hours = [];
    for (let h = startH; h <= endH; h++) {
      if (h === endH && endM === 0) continue;
      hours.push(h);
    }

    shifts.push({
      label: normalizeShiftLabel(`${pad(startH)}:${pad(startM)}-${pad(endH)}:${pad(endM)}`),
      hours,
      row: prefix ? Number(prefix[1]) : null,
      anchorName: (cols[2] || '').trim(),
    });
  }

  shifts.sort((a, b) => startMinutes(a.label) - startMinutes(b.label));
  return shifts;
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
