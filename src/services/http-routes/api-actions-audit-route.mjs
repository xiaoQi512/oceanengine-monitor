// src/services/http-routes/api-actions-audit-route.mjs - 审计查询路由
import { readAuditLines } from './api-actions-core.mjs';

export function serveActionsAudit(url, req, res, ctx) {
  if (url.pathname !== '/api/audit/recent' || (req && req.method && req.method !== 'GET')) return false;
  try {
    const raw = parseInt(url.searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 50;
    const lines = readAuditLines(ctx.ACTION_AUDIT_FILE).slice(-limit);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, data: lines, total: lines.length }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
  return true;
}
