// src/services/http-routes/static-vendor.mjs - vendor 静态资源
import fs from 'node:fs';
import path from 'node:path';

export function serveStaticVendor(url, res, ctx) {
  const { PROJECT_ROOT } = ctx;
  const routes = {
    '/vendor/alpine.min.js': { file: 'alpine.min.js', type: 'application/javascript; charset=utf-8', fallback: '// Alpine.js local fallback not available' },
    '/vendor/chart.umd.min.js': { file: 'chart.umd.min.js', type: 'application/javascript; charset=utf-8', fallback: '// Chart.js local fallback not available' },
  };
  const route = routes[url.pathname];
  if (!route) return false;
  const file = path.join(PROJECT_ROOT, 'vendor', route.file);
  if (fs.existsSync(file)) {
    res.writeHead(200, { 'Content-Type': route.type });
    res.end(fs.readFileSync(file, 'utf-8'));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(route.fallback);
  }
  return true;
}
