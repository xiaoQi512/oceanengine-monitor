// src/services/shift-pusher-shift-publish.mjs - 单班次写表与推送
import { buildShiftPushMessage } from './shift-pusher-message.mjs';
import { writeShiftToSheet, readAnchorNameFromSheet } from './shift-pusher-sheet.mjs';

export async function publishShift({
  shift,
  row,
  totalConsume,
  totalLeads,
  cpl,
  runLarkCli,
  runLarkCliAsync,
  withRetry,
  spreadsheetToken,
  sheetId,
  chatId,
  dryRun,
  skipWriteSheet,
  todayLabel,
  anchorNameProvider,
  carModel,
  logFn,
  logErrorFn,
}) {
  if (dryRun) {
    logFn('🧪 OEC_DRY_RUN=1，不写入表格/不推送');
    return false;
  }
  if (skipWriteSheet) {
    logFn('⏭ OEC_SKIP_WRITE_SHEET=1，跳过写表');
  } else {
    await writeShiftToSheet({ row, totalConsume, totalLeads, runLarkCliAsync, withRetry, spreadsheetToken, sheetId, label: shift.label, logFn, logErrorFn });
  }
  const anchorName = readAnchorNameFromSheet({ row, label: shift.label, runLarkCli, spreadsheetToken, sheetId, logFn, logErrorFn });
  try {
    const msgText = buildShiftPushMessage({ todayLabel, shiftLabel: shift.label, anchorName, totalConsume, totalLeads, cpl, carModel });
    await withRetry(() => runLarkCliAsync(['im', '+messages-send', '--chat-id', chatId, '--text', msgText, '--as', 'bot']), shift.label + ' 推群');
    logFn('✅ 已推送飞书群: ' + shift.label + ' | ' + anchorName + ' | ¥' + totalConsume.toFixed(2));
    return true;
  } catch (e) {
    logErrorFn('推飞书群失败 ' + shift.label + ' (已重试):', e.message);
    return false;
  }
}
