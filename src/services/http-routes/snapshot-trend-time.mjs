// src/services/http-routes/snapshot-trend-time.mjs - 趋势时间框架

export function buildTrendTimeFrames(dbTimes, parseSnapshotTime, POINTS) {
  const labels = [], timestamps = [], filledTimes = [];
  const latestTime = dbTimes.length ? parseSnapshotTime(dbTimes[dbTimes.length - 1].snapshot_time) : new Date();
  const normTime = new Date(latestTime);
  normTime.setSeconds(0, 0);
  normTime.setMinutes(Math.floor(normTime.getMinutes() / 5) * 5);
  const timeMap = new Map();
  for (const row of dbTimes) {
    const t = parseSnapshotTime(row.snapshot_time);
    const mins = Math.floor(t.getMinutes() / 5) * 5;
    const key = `${String(t.getHours()).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    timeMap.set(key, row.snapshot_time);
  }
  let lastValid = null;
  for (let i = POINTS - 1; i >= 0; i--) {
    const pt = new Date(normTime.getTime() - i * 5 * 60 * 1000);
    const key = `${String(pt.getHours()).padStart(2, '0')}:${String(pt.getMinutes()).padStart(2, '0')}`;
    const st = timeMap.get(key);
    if (st) { filledTimes.push(st); lastValid = st; }
    else if (lastValid) filledTimes.push(lastValid);
    else filledTimes.push(null);
  }
  for (let i = 0; i < POINTS; i++) {
    const pt = new Date(normTime.getTime() - (POINTS - 1 - i) * 5 * 60 * 1000);
    labels.push(`${String(pt.getHours()).padStart(2, '0')}:${String(pt.getMinutes()).padStart(2, '0')}`);
    timestamps.push(pt.toISOString());
  }
  return { normTime, labels, timestamps, filledTimes, timeMap };
}
