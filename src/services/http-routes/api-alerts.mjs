// src/services/http-routes/api-alerts.mjs - 告警查询 API
export function serveAlerts(url, req, res, ctx) {
  if (url.pathname !== '/api/alerts') return false;

  try {
    const alerts = ctx.getRecentAlerts(20);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ alerts }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message, alerts: [] }));
  }
  return true;
}
