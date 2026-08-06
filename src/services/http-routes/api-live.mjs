// src/services/http-routes/api-live.mjs - 直播状态 API
import { buildShifts, buildAnchors, buildLivePayload, buildShiftData } from './api-live-data.mjs';
import { resolveWholeSessionWindow, getSessionAccountSpend } from '../session-window.mjs';

export function serveLiveStatus(url, req, res, ctx) {
  if (url.pathname !== '/api/live-status') return false;
  try {
    const { getLocalDate, DATA_DIR, DB_PATH, getLatestSnapshot } = ctx;
    const today = getLocalDate();
    const sessions = buildShifts(today, DATA_DIR);
    const anchors = buildAnchors(today, DATA_DIR);
    const shiftData = buildShiftData(today, DATA_DIR, DB_PATH);
    // 整场窗口账户聚合:跨天合并,从本场直播开播时刻起
    const sessionWindow = resolveWholeSessionWindow({ dataDir: DATA_DIR, getLocalDate });
    const sessionAccount = sessionWindow
      ? getSessionAccountSpend(DB_PATH, sessionWindow.startCst, sessionWindow.endCst)
      : null;
    const payload = buildLivePayload({
      sessions, anchors, snap: getLatestSnapshot(), shiftData, DATA_DIR,
      sessionAccount,
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
  return true;
}
