// src/services/monitor-state.mjs - 监控状态、Webhook 与建议历史
import fs from 'node:fs';
import path from 'node:path';
import { mergePendingSuggestions } from '../domain/pending-suggestions.mjs';

export function recordDataGap(reason, { dataDir, getLocalDate, atomicWriteJSON }) {
  const today = getLocalDate();
  const logFile = path.join(dataDir, `daily-${today}.json`);
  try {
    let log = [];
    if (fs.existsSync(logFile)) {
      log = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
    }
    log.push({
      time: new Date().toISOString(),
      type: 'data_gap',
      reason,
      activeCount: 0, totalSpend: 0, totalConversions: 0,
      avgCPA: 0, spendLast15min: 0, speedCurrent: 0,
      budgetUsed: 0, rampingUp: 0, dropping: 0,
      alertCount: 0, alertTypes: [],
    });
    atomicWriteJSON(logFile, log);
  } catch {}
}

export function readWebhookFile({ projectRoot }) {
  const whPath = path.join(projectRoot, '.feishu-webhook');
  try {
    if (fs.existsSync(whPath)) {
      const content = fs.readFileSync(whPath, 'utf-8').trim();
      const firstLine = content.split('\n')[0].trim();
      if (firstLine && firstLine.startsWith('https://open.feishu.cn/open-apis/bot') && firstLine.length > 40) {
        return firstLine;
      }
    }
  } catch {}
  return '';
}

export function recordPendingSuggestions(suggestions, { loadSuggestionHistory, saveSuggestionHistory, recalcSummary }) {
  const history = loadSuggestionHistory();
  const now = new Date().toISOString();
  history.suggestions.push(...mergePendingSuggestions(history.suggestions, suggestions, now));
  recalcSummary(history);
  saveSuggestionHistory(history);
}

export function markIgnoredSuggestions({ loadSuggestionHistory, saveSuggestionHistory, recalcSummary }) {
  const history = loadSuggestionHistory();
  let changed = false;
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  for (const s of history.suggestions) {
    if (!s.response) {
      const sugTime = new Date(s.time).getTime();
      const elapsed = Date.now() - sugTime;
      if (elapsed > 8 * 60 * 60 * 1000 && sugTime > yesterday) {
        s.response = 'ignored';
        s.responseTime = new Date().toISOString();
        changed = true;
      }
    }
  }
  if (changed) {
    recalcSummary(history);
    saveSuggestionHistory(history);
  }
}
