// src/services/http-feedback-store.mjs - HTTP 反馈记录与写锁
import { loadSuggestionHistory, saveSuggestionHistory, recalcSummary } from '../utils/monitor-utils.mjs';

let writePromise = Promise.resolve();

export function withWriteLock(fn) {
  const p = writePromise.then(fn).finally(() => {});
  writePromise = p;
  return p;
}

export function recordFeedback(
  alertId,
  action,
  campaignId,
  type,
  name,
  {
    loadHistoryFn = loadSuggestionHistory,
    saveHistoryFn = saveSuggestionHistory,
    recalcSummaryFn = recalcSummary,
  } = {},
) {
  return withWriteLock(async () => {
    const history = loadHistoryFn();
    const existing = history.suggestions.find(s => s.id === alertId);
    if (existing) {
      existing.response = action;
      existing.responseTime = new Date().toISOString();
    } else {
      history.suggestions.push({
        id: alertId,
        time: new Date().toISOString(),
        alertType: type,
        campaignId: campaignId || '',
        campaignName: decodeURIComponent(name || ''),
        suggestion: type === 'zero_conv' ? '暂停零转化计划' : type === 'high_cpa' ? '关停高成本计划' : '执行优化操作',
        response: action,
        responseTime: new Date().toISOString(),
      });
    }
    recalcSummaryFn(history);
    saveHistoryFn(history);
    return history;
  });
}
