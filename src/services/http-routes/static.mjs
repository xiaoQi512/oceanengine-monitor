// src/services/http-routes/static.mjs - 静态资源路由分发
import { serveStaticPages } from './static-pages.mjs';
import { serveStaticVendor } from './static-vendor.mjs';

export function serveStatic(url, req, res, ctx) {
  if (url.pathname === '/') {
    res.writeHead(302, { 'Location': '/dashboard' });
    res.end();
    return true;
  }
  if (serveStaticPages(url, res, ctx)) return true;
  if (serveStaticVendor(url, res, ctx)) return true;
  return false;
}
