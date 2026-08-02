// src/services/http-routes/static-pages.mjs - Dashboard/PWA 静态页面
import fs from 'node:fs';
import path from 'node:path';

function sendFile(res, file, contentType, fallback = 'Not Found') {
  try {
    const data = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : fallback;
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
  return true;
}

export function serveStaticPages(url, res, ctx) {
  const { PROJECT_ROOT } = ctx;
  if (url.pathname === '/dashboard') {
    const file = path.join(PROJECT_ROOT, 'dashboard.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>dashboard.html 未生成</h2></body></html>');
      return true;
    }
    return sendFile(res, file, 'text/html; charset=utf-8');
  }
  if (url.pathname === '/dashboard.js') return sendFile(res, path.join(PROJECT_ROOT, 'dashboard.js'), 'application/javascript; charset=utf-8');
  if (url.pathname === '/dashboard.css') return sendFile(res, path.join(PROJECT_ROOT, 'dashboard.css'), 'text/css; charset=utf-8');
  if (url.pathname === '/dashboard-v2') {
    const file = path.join(PROJECT_ROOT, 'dashboard-v2.html');
    const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '<html><body><h2>dashboard-v2.html 尚未创建</h2></body></html>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  }
  if (url.pathname === '/dashboard-v2.js') return sendFile(res, path.join(PROJECT_ROOT, 'dashboard-v2.js'), 'application/javascript; charset=utf-8', '');
  if (url.pathname === '/dashboard-v2.css') return sendFile(res, path.join(PROJECT_ROOT, 'dashboard-v2.css'), 'text/css; charset=utf-8', '');
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
