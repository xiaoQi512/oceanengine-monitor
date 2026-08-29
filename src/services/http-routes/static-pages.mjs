// src/services/http-routes/static-pages.mjs - Dashboard/PWA 静态页面
import fs from 'node:fs';
import path from 'node:path';

function sendFile(res, file, contentType, fallback = 'Not Found') {
  try {
    const data = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : fallback;
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Last-Modified': new Date().toUTCString(),
    });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
  return true;
}

export function serveStaticPages(url, res, ctx) {
  const { PROJECT_ROOT } = ctx;
  // 统一入口：/dashboard 与 /dashboard-v5 均返回当前版本 dashboard-v5.html
  if (url.pathname === '/dashboard' || url.pathname === '/dashboard-v5') {
    const file = path.join(PROJECT_ROOT, 'dashboard-v5.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>dashboard-v5.html 未生成</h2></body></html>');
      return true;
    }
    return sendFile(res, file, 'text/html; charset=utf-8');
  }
  if (url.pathname === '/manifest.json') return sendFile(res, path.join(PROJECT_ROOT, 'manifest.json'), 'application/manifest+json; charset=utf-8', '{}');
  if (url.pathname === '/sw.js') {
    const file = path.join(PROJECT_ROOT, 'sw.js');
    try {
      const js = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'no-cache',
      });
      res.end(js);
    } catch {
      res.writeHead(404); res.end('');
    }
    return true;
  }
  return false;
}
