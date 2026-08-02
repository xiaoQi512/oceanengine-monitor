// src/services/http-routes/api-actions-rollback-route.mjs - 回滚路由
import { readAuditLines, findRollbackRecord, buildRollbackAction, buildRollbackItem, enqueueItem } from './api-actions-core.mjs';

export function serveActionsRollback(url, req, res, ctx) {
  if (url.pathname !== '/api/actions/rollback' || !req || (req.method && req.method !== 'POST')) return false;
  const { sanitize, withWriteLock, ACTION_QUEUE_FILE, ACTION_AUDIT_FILE } = ctx;
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const data = JSON.parse(body || '{}');
      const auditLines = readAuditLines(ACTION_AUDIT_FILE);
      const record = findRollbackRecord(auditLines, data);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '未找到可回滚的审计记录' }));
        return;
      }
      const rollback = buildRollbackAction(record);
      if (!rollback.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: rollback.error }));
        return;
      }
      if (rollback.action.type === 'adjust_budget' && (!rollback.action.amount || rollback.action.amount <= 0)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'beforeValue 预算值无效，无法回滚' }));
        return;
      }
      if (rollback.action.type === 'adjust_bid' && (!rollback.action.bid || rollback.action.bid <= 0)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'beforeValue 出价值无效，无法回滚' }));
        return;
      }
      const item = buildRollbackItem(rollback.action, record, sanitize(data.by || 'dashboard-rollback'));
      await enqueueItem(ACTION_QUEUE_FILE, item, withWriteLock);
      console.log(`[server] /api/actions/rollback 入队: ${item.type} plan="${item.planName}" (回滚 ${record.time})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, queued: true, rollbackAction: item.type, planName: item.planName, originalRecord: { time: record.time, actionType: record.actionType, beforeValue: record.beforeValue } }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  return true;
}
