// src/domain/daily-report-wait.mjs - 日报去重与动态等待（纯逻辑）

export function getDailyReportWaitMs(shiftWin, now = new Date()) {
  const targetTime = new Date(now);
  targetTime.setHours(shiftWin.endHour, (shiftWin.endMinute || 0) + 5, 0, 0);
  return targetTime - now;
}

export function shouldWaitForDailyReport(waitMs) {
  return waitMs > 0 && waitMs < 3600000;
}

export function formatDailyReportWaitMs(waitMs) {
  return Math.round(waitMs / 1000 / 60);
}

export function getDailyReportMarkerPath(dataDir, today, pathImpl) {
  return pathImpl.join(dataDir, `daily-report-done-${today}.json`);
}

export function shouldSkipDailyReport({ markerPath, force, existsSyncFn }) {
  return !force && existsSyncFn(markerPath);
}

export function writeStartedMarker({ markerPath, writeFileSyncFn, now = new Date() }) {
  try {
    writeFileSyncFn(markerPath, JSON.stringify({ startedAt: now.toISOString() }));
  } catch {}
}
