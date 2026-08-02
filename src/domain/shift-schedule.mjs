// src/domain/shift-schedule.mjs - 换班结束时间判断（纯逻辑）

export function getShiftEndMinutes(shift) {
  const m = shift.label.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
  if (!m) return -1;
  return parseInt(m[3]) * 60 + parseInt(m[4]);
}

export function isShiftEnded(shift, now) {
  const endMin = getShiftEndMinutes(shift);
  if (endMin < 0) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= endMin && nowMin <= endMin + 30;
}
