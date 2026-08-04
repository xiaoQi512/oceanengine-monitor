// src/services/http-routes/snapshot-trend-time.mjs - 趋势时间框架（5分钟等距格点）
// 返回 12 格点标签 + 每格点在 snapshots 中对应的 snapshot_time（不存在则为 null）

export function buildTrendTimeFrames(dbTimes, parseSnapshotTime, POINTS) {
  const labels = [], timestamps = [], actualTimes = [];
  const todays = new Date();

  // 最新快照时间向上取 5min 整
  const latestTime = dbTimes.length ? parseSnapshotTime(dbTimes[dbTimes.length - 1].snapshot_time) : new Date();
  const normTime = new Date(latestTime);
  normTime.setSeconds(0, 0);
  normTime.setMinutes(Math.floor(normTime.getMinutes() / 5) * 5);

  // 按 HH:MM 归一化建索引
  const timeMap = new Map();
  for (const row of dbTimes) {
    const t = parseSnapshotTime(row.snapshot_time);
    const mins = Math.floor(t.getMinutes() / 5) * 5;
    const key = `${String(t.getHours()).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    if (!timeMap.has(key)) timeMap.set(key, row.snapshot_time);
  }

  // 生成 12 格点
  for (let i = POINTS - 1; i >= 0; i--) {
    const pt = new Date(normTime.getTime() - i * 5 * 60 * 1000);
    const hh = String(pt.getHours()).padStart(2, '0');
    const mm = String(pt.getMinutes()).padStart(2, '0');
    const key = `${hh}:${mm}`;

    // 标签格式：跨天则加日期前缀
    const isToday = pt.getDate() === todays.getDate()
      && pt.getMonth() === todays.getMonth()
      && pt.getFullYear() === todays.getFullYear();
    labels.push(isToday ? key : `${pt.getMonth() + 1}/${pt.getDate()} ${key}`);
    timestamps.push(pt.toISOString());
    actualTimes.push(timeMap.get(key) || null);
  }

  return { labels, timestamps, actualTimes };
}
