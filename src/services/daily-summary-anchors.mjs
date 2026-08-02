// src/services/daily-summary-anchors.mjs - 日汇总主播名读取
import { execFileSync } from 'node:child_process';
import { findLarkCli, getLocalDate, SHIFT_SPREADSHEET_TOKEN as SPREADSHEET_TOKEN, SHIFT_SHEET_ID as SHEET_ID, PROJECT_ROOT } from '../utils/monitor-utils.mjs';
import { log } from './daily-summary-common.mjs';
import { fetchShiftRowsByDate } from './shift-sheet-reader.mjs';

export function readAnchorNames({
  findLarkCliFn = findLarkCli,
  fetchShiftRowsByDateFn = fetchShiftRowsByDate,
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
  try {
    const shifts = fetchShiftRowsByDateFn(today, {
      findLarkCliFn,
      execFileSyncFn,
      projectRoot,
      spreadsheetToken,
      sheetId,
    });
    const names = shifts.map(s => (s.anchorName || '').trim()).filter(Boolean);
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
