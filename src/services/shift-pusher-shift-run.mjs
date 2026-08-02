// src/services/shift-pusher-shift-run.mjs - 单班次运行流程
import {
  SHIFT_SPREADSHEET_TOKEN as SPREADSHEET_TOKEN,
  SHIFT_SHEET_ID as SHEET_ID,
  FEISHU_ANCHOR_CHAT_ID as SHIFT_CHAT_ID,
} from '../utils/monitor-utils.mjs';
import { getCarModel, log, logError, todayDateCN, isAlreadyPushed, markPushed } from './shift-pusher-state.mjs';
import { getShiftEndMinutes } from './shift-pusher-schedule.mjs';
import { triggerEndOfDayTasks } from './shift-pusher-eod.mjs';
import { getTodayShifts } from './shift-pusher-run.mjs';
import { runLarkCli, runLarkCliAsync, withRetry } from './shift-pusher-lark.mjs';
import { prepareShiftData } from './shift-pusher-shift-prepare.mjs';
import { publishShift } from './shift-pusher-shift-publish.mjs';

const OEC_FORCE = process.env.OEC_FORCE === '1';
const OEC_DRY_RUN = process.env.OEC_DRY_RUN === '1';
const OEC_SKIP_WRITE_SHEET = process.env.OEC_SKIP_WRITE_SHEET === '1';

export async function runShift(shift) {
  const row = shift.row;
  log('▶ 开始处理时段: ' + shift.label + ' (行' + row + ', 小时' + shift.hours.join(',') + ')');
  if (!OEC_FORCE && isAlreadyPushed(shift.label)) {
    log('⏭ 已推送过 ' + shift.label + '，跳过');
    return;
  }
  if (!OEC_FORCE) {
    log('⏳ 班次已结束，等待30秒以确保结束快照完整...');
    await new Promise(r => setTimeout(r, 30_000));
  }
  const prepared = await prepareShiftData({ shift, withRetry, logErrorFn: logError, logFn: log });
  if (!prepared) return;
  if (prepared.skip) {
    log('⏭ 消耗为0，跳过 ' + shift.label);
    return;
  }
  const published = await publishShift({
    shift,
    row,
    totalConsume: prepared.totalConsume,
    totalLeads: prepared.totalLeads,
    cpl: prepared.cpl,
    runLarkCli,
    runLarkCliAsync,
    withRetry,
    spreadsheetToken: SPREADSHEET_TOKEN,
    sheetId: SHEET_ID,
    chatId: SHIFT_CHAT_ID,
    dryRun: OEC_DRY_RUN,
    skipWriteSheet: OEC_SKIP_WRITE_SHEET,
    todayLabel: todayDateCN(),
    carModel: getCarModel(),
    logFn: log,
    logErrorFn: logError,
  });
  if (!published) return;
  markPushed(shift.label);
  log('✓ 时段 ' + shift.label + ' 处理完成');
  await triggerEndOfDayTasks({ shift, todayShifts: getTodayShifts(), getShiftEndMinutes });
}
