// src/services/http-analysis.mjs - http-server 数据分析兼容入口
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadSuggestionHistory } from '../utils/monitor-utils.mjs';

export * from './http-snapshot.mjs';
export * from './http-delivery.mjs';
export * from './http-effect.mjs';

export function getLatestSnapshot({ dataDir = DATA_DIR, fsImpl = fs, pathImpl = path } = {}) {
  try {
    const files = fsImpl.readdirSync(dataDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    if (files.length === 0) return null;
    return JSON.parse(fsImpl.readFileSync(pathImpl.join(dataDir, files[files.length - 1]), 'utf-8'));
  } catch {
    return null;
  }
}

export function getRecentAlerts(limit = 20, { loadSuggestionHistoryFn = loadSuggestionHistory } = {}) {
  const history = loadSuggestionHistoryFn();
  const suggestions = history.suggestions || [];
  return suggestions
    .slice(-limit)
    .reverse()
    .map(s => ({
      id: s.id,
      time: s.time,
      type: s.alertType,
      campaignId: s.campaignId,
      campaignName: s.campaignName,
      suggestion: s.suggestion,
      response: s.response || 'pending',
    }));
}

export const MAX_PARAM_LENGTH = 256;
export function sanitize(str) { return String(str || "").slice(0, MAX_PARAM_LENGTH); }
export function escHtml(str) {
  return String(str || "")
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, "&quot;");
}
