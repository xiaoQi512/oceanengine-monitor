// src/services/http-routes/api-snapshots.mjs - 快照查询 API
export function serveSnapshots(url, req, res, ctx) {
  const { getLatestSnapshot, get5mSnapshots } = ctx;

  if (url.pathname === '/api/snapshots') {
    try {
      const snap = getLatestSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify(snap || {}));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (url.pathname === '/api/snapshots/5m') {
    try {
      const historyN = Math.max(0, parseInt(url.searchParams.get('history') || '0', 10) || 0);
      const snaps = get5mSnapshots(historyN > 0 ? historyN : 1);
      const latest = snaps.length ? snaps[snaps.length - 1] : null;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ latest, history: historyN > 0 ? snaps : [] }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, latest: null, history: [] }));
    }
    return true;
  }

  return false;
}
