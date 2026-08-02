// src/domain/rolling.mjs - 5min 监控环比计算（纯逻辑）

export function getSpend(data) {
  return data.accountSpend || data.summarySpend || 0;
}

export function getConv(data) {
  return data.totalConv || data.summaryConv || 0;
}

export function calcRolling(
  data,
  prevSnapshots,
  { minutesBetween, now = new Date().toISOString() } = {}
) {
  if (typeof minutesBetween !== 'function') {
    throw new Error('calcRolling 需要注入 minutesBetween');
  }

  // 需要至少4个快照(含当前)来构建3个连续窗口
  const all = [data, ...prevSnapshots].slice(0, 4);
  const windows = [];

  for (let i = 0; i < Math.min(all.length - 1, 3); i++) {
    const newer = getSpend(all[i]);       // 较新快照
    const older = getSpend(all[i + 1]);   // 较旧快照
    const delta = newer - older;
    const pct = older > 0 ? ((delta / older) * 100).toFixed(1) : (delta > 0 ? '+' : '0');
    const windowMinutes = minutesBetween(all[i + 1].time, all[i].time);
    const rpm = delta / windowMinutes;  // 每分钟平均速率（真实经过分钟）
    const newerAge = minutesBetween(all[i].time, now);
    const olderAge = minutesBetween(all[i + 1].time, now);
    const label = i === 0
      ? `近${Math.round(windowMinutes)}分钟`
      : `前${Math.round(newerAge)}-${Math.round(olderAge)}分钟`;
    windows.push({ label, delta, pct, rpm, windowMinutes, olderSpend: older, newerSpend: newer });
  }

  // 找出涨跌幅度最大的窗口
  let maxDelta = 0, maxIdx = 0;
  windows.forEach((w, i) => { if (Math.abs(w.delta) > Math.abs(maxDelta)) { maxDelta = w.delta; maxIdx = i; } });
  if (windows[maxIdx]) windows[maxIdx].hot = true;

  // 最新窗口增量（与最近一次快照的真实差值）
  const last5min = prevSnapshots.length > 0 ? getSpend(data) - getSpend(prevSnapshots[0]) : 0;
  const last5minMinutes = prevSnapshots.length > 0 ? minutesBetween(prevSnapshots[0].time, data.time) : 0;
  // 近5分钟转化增量
  const convLast5min = prevSnapshots.length > 0 ? getConv(data) - getConv(prevSnapshots[0]) : 0;

  return { last5min, last5minMinutes, windows, convLast5min };
}
