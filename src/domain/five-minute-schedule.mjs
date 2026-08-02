// src/domain/five-minute-schedule.mjs - 5min 运行窗口与推送决策（纯逻辑）

const QUARTER_MINUTES = [0, 15, 30, 45];

export function shouldRun5min({ minute, hour, force = false, shiftWin = {} }) {
  if (!force && QUARTER_MINUTES.includes(minute)) {
    return { run: false, reason: 'quarter_hour' };
  }

  const start = (shiftWin.startHour ?? 7) * 60 + (shiftWin.startMinute || 0);
  const end = (shiftWin.endHour ?? 23) * 60 + (shiftWin.endMinute || 0);
  const now = hour * 60 + minute;
  if (!force && (now < start || now >= end)) {
    return { run: false, reason: 'outside_window' };
  }

  return { run: true, reason: force ? 'force' : 'normal' };
}

export function shouldPush5min(lastPush = {}, now = Date.now(), minIntervalMs = 60_000) {
  const lastTs = lastPush.timestamp || 0;
  const elapsedMs = now - lastTs;
  return {
    push: elapsedMs >= minIntervalMs,
    elapsedMs,
    elapsedMinutes: elapsedMs / 60_000,
  };
}

export function isQuarterHour(minute) {
  return minute % 15 === 0;
}
