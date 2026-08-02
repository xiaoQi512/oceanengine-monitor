// src/domain/five-min-cycle-log.mjs - 5min 运行日志格式（纯逻辑）

export function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

export function timeStr(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatFiveMinSkipReason(reason, { hour, minute, shiftWin = {} } = {}) {
  if (reason === 'quarter_hour') {
    return `⏭ 跳过整点时刻(${pad(minute)}分)，由15分钟汇报覆盖`;
  }
  const startH = shiftWin.startHour ?? 9;
  const startM = shiftWin.startMinute || 0;
  const endH = shiftWin.endHour ?? 23;
  const endM = shiftWin.endMinute || 0;
  return `🌙 非直播时段 (${hour}:${pad(minute)}，窗口 ${startH}:${pad(startM)}-${endH}:${pad(endM)})，静默`;
}

export function formatFiveMinForceReason(hour, minute) {
  return `🧪 OEC_FORCE=1 强制绕过运行窗口 (${hour}:${pad(minute)})`;
}
