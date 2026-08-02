// src/services/monitor-report.mjs - 15min HTML 报表上下文编排
import {
  getLocalDate,
  getLiveWindowLabel,
  loadSuggestionHistory,
  saveSuggestionHistory,
  recalcSummary,
} from '../utils/monitor-utils.mjs';
import { markIgnoredSuggestions } from './monitor-state.mjs';
import { generateMonitorHTML } from '../domain/report-html.mjs';

export function generateHtmlReport(analysis, options = {}) {
  const deps = {
    getLocalDate,
    getLiveWindowLabel,
    loadSuggestionHistory,
    saveSuggestionHistory,
    recalcSummary,
    markIgnoredSuggestions,
    generateMonitorHTML,
    accountName: '',
    ...options,
  };

  const history = deps.loadSuggestionHistory();
  deps.markIgnoredSuggestions({
    loadSuggestionHistory: deps.loadSuggestionHistory,
    saveSuggestionHistory: deps.saveSuggestionHistory,
    recalcSummary: deps.recalcSummary,
  });

  return deps.generateMonitorHTML(analysis, {
    history,
    now: new Date().toLocaleString('zh-CN'),
    today: deps.getLocalDate(),
    liveWin: deps.getLiveWindowLabel(),
    accountName: deps.accountName,
  });
}

export function createHtmlReportBuilder(options = {}) {
  return analysis => generateHtmlReport(analysis, options);
}
