// src/services/http-routes/api-report.mjs - 报表、历史与忽略标记
import fs from 'node:fs';
import path from 'node:path';

export function serveReport(url, req, res, ctx) {
  const {
    PROJECT_ROOT,
    getLocalDate,
    loadSuggestionHistory,
    saveSuggestionHistory,
    recalcSummary,
    sanitize,
  } = ctx;

  if (url.pathname === '/report') {
    try {
      const reportFile = path.join(PROJECT_ROOT, 'oceanengine-report.html');
      if (!fs.existsSync(reportFile)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>📄 报表尚未生成</h2><p>等待监控脚本首次运行...</p></body></html>`);
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(reportFile, 'utf-8'));
    } catch {
      res.writeHead(500);
      res.end('Server Error');
    }
    return true;
  }

  if (url.pathname === '/daily' || url.pathname.startsWith('/daily-')) {
    const today = getLocalDate();
    const dailyFile = path.join(PROJECT_ROOT, `oceanengine-daily-${today}.html`);
    const latestFile = path.join(PROJECT_ROOT, 'oceanengine-daily-latest.html');
    try {
      const file = fs.existsSync(dailyFile) ? dailyFile : (fs.existsSync(latestFile) ? latestFile : null);
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>📊 日报尚未生成</h2><p>每天23:05自动生成，届时可通过此链接查看</p></body></html>`);
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(file, 'utf-8'));
    } catch {
      res.writeHead(500);
      res.end('Server Error');
    }
    return true;
  }

  if (url.pathname === '/history') {
    const history = loadSuggestionHistory();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(history, null, 2));
    return true;
  }

  if (url.pathname === '/mark-ignored') {
    const alertIds = sanitize(url.searchParams.get('ids'));
    if (alertIds) {
      const ids = alertIds.split(',').map(s => s.trim()).filter(s => s.length > 0);
      const history = loadSuggestionHistory();
      for (const id of ids) {
        const existing = history.suggestions.find(s => s.id === id);
        if (existing && !existing.response) {
          existing.response = 'ignored';
          existing.responseTime = new Date().toISOString();
        }
      }
      recalcSummary(history);
      saveSuggestionHistory(history);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  return false;
}
