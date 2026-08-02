// src/services/http-routes/api-ops.mjs - 手动推送与补推 API
import fs from 'node:fs';
import path from 'node:path';

export function serveOps(url, req, res, ctx) {
  const { DATA_DIR } = ctx;

  if (url.pathname === '/api/manual-push' && (!req || !req.method || req.method === 'POST')) {
    try {
      const signalFile = path.join(DATA_DIR, 'manual-push-signal.json');
      fs.writeFileSync(signalFile, JSON.stringify({ timestamp: new Date().toISOString(), source: 'dashboard' }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: '推送信号已发送' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return true;
  }

  if (url.pathname === '/api/repush' && (!req || !req.method || req.method === 'POST')) {
    try {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { type } = JSON.parse(body || '{}');
          const signalFile = path.join(DATA_DIR, 'repush-signal.json');
          fs.writeFileSync(signalFile, JSON.stringify({
            type: type || 'unknown',
            timestamp: new Date().toISOString(),
            source: 'dashboard-repush',
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: '补推信号已入队', type: type || 'unknown' }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '无效请求' }));
        }
      });
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return true;
  }

  return false;
}
