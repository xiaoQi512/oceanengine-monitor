// src/services/http-server-handler.mjs - 本地 HTTP 服务请求路由
import { serveStatic } from './http-routes/static.mjs';
import { serveSnapshots } from './http-routes/api-snapshots.mjs';
import { serveSnapshotTrend } from './http-routes/api-snapshots-trend.mjs';
import { serveCampaigns } from './http-routes/api-campaigns.mjs';
import { serveAlerts } from './http-routes/api-alerts.mjs';
import { serveLiveStatus } from './http-routes/api-live.mjs';
import { serveAccounts } from './http-routes/api-accounts.mjs';
import { serveOps } from './http-routes/api-ops.mjs';
import { serveReport } from './http-routes/api-report.mjs';
import { serveFeedback } from './http-routes/api-feedback.mjs';
import { serveActions } from './http-routes/api-actions.mjs';
import { serveAi } from './http-routes/api-ai.mjs';
import { serveFeedbackIgnore } from './http-routes/api-feedback-ignore-route.mjs';

export function createHttpServerHandler(deps) {
  const {
    FEEDBACK_PORT,
    PROJECT_ROOT,
    DATA_DIR,
    ACCOUNT_ID,
    ACCOUNT_NAME,
    getLocalDate,
    loadSuggestionHistory,
    saveSuggestionHistory,
    recalcSummary,
    ACTION_AUDIT_FILE,
    ACTION_PENDING_FILE,
    ACTION_QUEUE_FILE,
    getApiClient,
    get5mSnapshots,
    DB_PATH,
    classifyDeliveryType,
    emptyGroupSummary,
    summarizeGroup,
    parseSnapshotTime,
    computePlanEffect,
    getSnapFileIndex,
    findSnapshotAround,
    findSnapshotAroundDB,
    computeActionEffect,
    ANOMALY_MIN_SPEND,
    ANOMALY_MAX_CPA,
    extractRules,
    getLatestSnapshot,
    getRecentAlerts,
    sanitize,
    escHtml,
    withWriteLock,
    recordFeedback,
  } = deps;

  return async (req, res) => {
    const url = new URL(req.url, `http://localhost:${FEEDBACK_PORT}`);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
      return;
    }
    if (serveStatic(url, req, res, { PROJECT_ROOT })) return;
    if (serveSnapshots(url, req, res, { getLatestSnapshot, get5mSnapshots, DB_PATH, DATA_DIR, getLocalDate })) return;
    if (serveSnapshotTrend(url, req, res, { DB_PATH, parseSnapshotTime })) return;
    if (await serveCampaigns(url, req, res, { classifyDeliveryType, emptyGroupSummary, summarizeGroup, getApiClient, DB_PATH, DATA_DIR, getLocalDate })) return;
    if (await serveAi(url, req, res, {
      ACTION_AUDIT_FILE,
      computeActionEffect,
      extractRules,
      classifyDeliveryType,
      getApiClient,
      ANOMALY_MIN_SPEND,
      ANOMALY_MAX_CPA,
    })) return;
    if (serveAlerts(url, req, res, { getRecentAlerts })) return;
    if (serveActions(url, req, res, {
      sanitize,
      withWriteLock,
      ACTION_QUEUE_FILE,
      ACTION_PENDING_FILE,
      ACTION_AUDIT_FILE,
      computeActionEffect,
    })) return;
    if (serveFeedbackIgnore(url, req, res, { ACTION_AUDIT_FILE })) return;
    if (serveLiveStatus(url, req, res, { getLocalDate, DATA_DIR, DB_PATH, getLatestSnapshot })) return;
    if (serveOps(url, req, res, { DATA_DIR })) return;
    if (await serveAccounts(url, req, res, { getLatestSnapshot, ACCOUNT_ID, ACCOUNT_NAME, getApiClient })) return;
    if (serveReport(url, req, res, {
      PROJECT_ROOT,
      getLocalDate,
      loadSuggestionHistory,
      saveSuggestionHistory,
      recalcSummary,
      sanitize,
    })) return;
    if (await serveFeedback(url, req, res, { sanitize, escHtml, recordFeedback })) return;
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>404 Not Found</h2></body></html>`);
  };
}
