// src/services/http-routes/api-actions-audit-route.mjs - 审计查询路由
import { readAuditLines } from './api-actions-core.mjs';
import { validateActionResult } from '../../domain/action-result.mjs';

export function serveActionsAudit(url, req, res, ctx) {
  if (url.pathname !== '/api/audit/recent' || (req && req.method && req.method !== 'GET')) return false;
  try {
    const { ACTION_AUDIT_FILE, computeActionEffect } = ctx;
    const raw = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 50;
    const lines = readAuditLines(ACTION_AUDIT_FILE)
      .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
      .slice(0, limit)
      .map(r => {
      const validation = r.validation || validateActionResult({
        actionType: r.actionType,
        beforeValue: r.beforeValue,
        afterValue: r.afterValue,
        result: r.result,
        expectedValue: r.amount ?? r.bid,
      });
      return {
        ...r,
        validation,
        effect: computeActionEffect ? computeActionEffect(r) : (r.effect || null),
      };
      });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, data: lines, total: lines.length }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
  return true;
}
