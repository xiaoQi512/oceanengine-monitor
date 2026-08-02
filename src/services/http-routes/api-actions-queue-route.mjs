// src/services/http-routes/api-actions-queue-route.mjs - 操作队列路由
import { isValidActionType, readJsonFile, buildActionItem, enqueueItem } from './api-actions-core.mjs';

export function serveActionsQueue(url, req, res, ctx) {
  const { sanitize, withWriteLock, ACTION_QUEUE_FILE, ACTION_PENDING_FILE } = ctx;
  if (url.pathname === '/api/actions' && req && (!req.method || req.method === 'POST')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        if (!isValidActionType(data.type)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `invalid type, must be one of ${['pause','stop','resume','adjust_budget','adjust_bid'].join('|')}` }));
          return;
        }
        if (!data.campaign_id && !data.planName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'campaign_id or planName required' }));
          return;
        }
        const item = buildActionItem(data, sanitize);
        await enqueueItem(ACTION_QUEUE_FILE, item, withWriteLock);
        console.log(`[server] /api/actions 入队: ${item.type} plan="${item.planName}" cid=${item.campaignId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, queued: true, action: item.type, planName: item.planName, campaignId: item.campaignId, time: item.time }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }
  if (url.pathname === '/api/actions' && (!req || !req.method || req.method === 'GET')) {
    try {
      const q = readJsonFile(ACTION_QUEUE_FILE, { actions: [] });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(q));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }
  if (url.pathname === '/api/pending' && (!req || !req.method || req.method === 'GET')) {
    try {
      const data = readJsonFile(ACTION_PENDING_FILE, { pending: [] });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, data: data.pending || [] }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }
  return false;
}
