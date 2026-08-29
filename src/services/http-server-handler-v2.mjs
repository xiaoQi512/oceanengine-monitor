// src/services/http-server-handler-v2.mjs - 本地 HTTP 服务请求路由（含 CSRF 防护）
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
import {
  CSRF_COOKIE_MAX_AGE_SEC,
  CSRF_COOKIE_NAME,
  buildSetCookie,
  generateCsrfToken,
  verifyCsrfToken,
  verifySignedRequest,
} from '../utils/csrf-utils.mjs';
import {
  loadMetricsRegistry,
  validateMetricsRegistry,
} from '../domain/metrics-registry.mjs';

let metricsRegistryCache = null;
function getMetricsRegistry() {
  if (!metricsRegistryCache) {
    try {
      const registry = loadMetricsRegistry();
      const result = validateMetricsRegistry(registry);
      if (!result.ok) {
        console.error('[metrics-registry] 校验失败:', result.errors.join('; '));
        metricsRegistryCache = { metrics: [] };
      } else {
        metricsRegistryCache = registry;
      }
    } catch (e) {
      console.error('[metrics-registry] 加载失败:', e.message);
      metricsRegistryCache = { metrics: [] };
    }
  }
  return metricsRegistryCache;
}

// Dashboard 写操作白名单：浏览器写请求必须通过 double-submit cookie 校验。
// 飞书监听/队列 worker 不经过这些 HTTP 写接口，不受影响。
const CSRF_PROTECTED_PATHS = new Set([
  '/api/actions',
  '/api/actions/rollback',
  '/api/manual-push',
  '/api/repush',
  '/api/feedback/ignore',
]);

function sendCsrfCookie(res) {
  res.setHeader('Set-Cookie', buildSetCookie(CSRF_COOKIE_NAME, generateCsrfToken(), {
    maxAge: CSRF_COOKIE_MAX_AGE_SEC,
    sameSite: 'Strict',
    httpOnly: false,
  }));
}

export function createHttpServerHandler(deps) {
  const {
    FEEDBACK_PORT,
    CSRF_SECRET,
    PROJECT_ROOT,
    DATA_DIR,
    ACCOUNT_ID,
    ACCOUNT_NAME,
      ACCOUNTS,
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
    const method = String(req.method || 'GET').toUpperCase();

    if (url.pathname === '/api/csrf-token' && method === 'GET') {
      const token = generateCsrfToken();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': buildSetCookie(CSRF_COOKIE_NAME, token, {
          maxAge: CSRF_COOKIE_MAX_AGE_SEC,
          sameSite: 'Strict',
          httpOnly: false,
        }),
      });
      res.end(JSON.stringify({ ok: true, csrfToken: token }));
      return;
    }

      if (url.pathname === '/api/metrics-registry' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, ...getMetricsRegistry() }));
        return;
      }

    // 飞书回调页走 HMAC 签名校验（非浏览器渠道）
    if (url.pathname === '/feedback' || url.pathname === '/mark-ignored') {
      if (!verifySignedRequest(req, CSRF_SECRET)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'CSRF' }));
        return;
      }
    }

    const writeMethod = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    if (writeMethod && CSRF_PROTECTED_PATHS.has(url.pathname) && !verifyCsrfToken(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'CSRF' }));
      return;
    }

    // 只读 API GET 不再自动下发 csrf_token cookie：
    // 并发 GET 各自生成随机 token 互相覆盖, 会破坏 double-submit 一致性(前端变量与 cookie 不同步 → POST 403 CSRF)。
    // token 统一由 GET /api/csrf-token 下发(前端 ensureCsrfToken 唯一入口)。

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
        loadSuggestionHistory,
        getLatestSnapshot,
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
    if (await serveAccounts(url, req, res, { getLatestSnapshot, ACCOUNT_ID, ACCOUNT_NAME, ACCOUNTS, getApiClient })) return;
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
