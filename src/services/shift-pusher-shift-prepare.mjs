// src/services/shift-pusher-shift-prepare.mjs - 单班次数据准备
import { correctFirstShiftSpend } from './shift-pusher-snapshot.mjs';
import { fetchShiftData } from './shift-pusher-fetch.mjs';
import { normalizeShiftData, shouldSkipShift } from '../domain/shift-metrics.mjs';

export async function prepareShiftData({ shift, withRetry, logErrorFn, logFn }) {
  const shiftData = await fetchShiftData({ shift, withRetry, logErrorFn });
  if (!shiftData) return null;
  const normalized = normalizeShiftData(shiftData);
  let totalConsume = normalized.totalConsume;
  let totalLeads = normalized.totalLeads;
  let cpl = normalized.cpl;
  if (shiftData.fromCache) {
    logFn('📊 快照差值 ' + shift.label + ': 消耗¥' + totalConsume.toFixed(2) + ' 线索' + totalLeads + ' CPL¥' + cpl);
    if (shiftData.detail?.startSnapshot) {
      const startTag = shiftData.detail.startSource === '5m' ? '[5m]' : '';
      const endTag = shiftData.detail.endSource === '5m' ? '[5m]' : '';
      logFn('   ' + startTag + shiftData.detail.startSnapshot + ' → ' + endTag + shiftData.detail.endSnapshot);
      logFn('   开始: ¥' + shiftData.detail.startSpend + ' / ' + shiftData.detail.startLeads + '线索 → 结束: ¥' + shiftData.detail.endSpend + ' / ' + shiftData.detail.endLeads + '线索');
    }
  } else {
    logFn('📊 API兜底 ' + shift.label + ': 消耗¥' + totalConsume.toFixed(2) + ' 线索' + totalLeads + ' CPL¥' + cpl);
    logFn('   原因: ' + (shiftData.detail?.reason || '未知'));
    const reason = shiftData.detail?.reason || '';
    if (reason.includes('startSnapshot')) {
      const corrected = correctFirstShiftSpend({ shift, totalConsume, totalLeads, cpl, logFn });
      totalConsume = corrected.totalConsume;
      totalLeads = corrected.totalLeads;
      cpl = corrected.cpl;
    }
  }
  return { shiftData, totalConsume, totalLeads, cpl, skip: shouldSkipShift(totalConsume) };
}
