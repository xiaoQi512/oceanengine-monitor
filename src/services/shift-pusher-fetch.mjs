// src/services/shift-pusher-fetch.mjs - 换班数据拉取
import { createClient } from './api-client.mjs';
import { getShiftDelta } from '../db/snapshot-db.mjs';
import { getLocalDate, ACCOUNT_ID } from '../utils/monitor-utils.mjs';

export async function fetchShiftData({
  shift,
  withRetry,
  logErrorFn = console.error,
  createClientFn = createClient,
  getShiftDeltaFn = getShiftDelta,
  getLocalDateFn = getLocalDate,
  accountId = ACCOUNT_ID,
}) {
  try {
    const today = getLocalDateFn();
    const apiClient = await createClientFn({ useCache: true });
    return await withRetry(
      () => getShiftDeltaFn(today, shift, { accountId, apiClient }),
      shift.label + ' 数据拉取'
    );
  } catch (e) {
    logErrorFn('数据拉取失败 ' + shift.label + ' (已重试):', e.message);
    return null;
  }
}
