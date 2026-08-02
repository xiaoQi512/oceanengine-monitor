// src/services/http-routes/api-actions.mjs - 操作/审计/回滚路由分发
import { serveActionsQueue } from './api-actions-queue-route.mjs';
import { serveActionsAudit } from './api-actions-audit-route.mjs';
import { serveActionsRollback } from './api-actions-rollback-route.mjs';

export function serveActions(url, req, res, ctx) {
  if (serveActionsQueue(url, req, res, ctx)) return true;
  if (serveActionsAudit(url, req, res, ctx)) return true;
  if (serveActionsRollback(url, req, res, ctx)) return true;
  return false;
}
