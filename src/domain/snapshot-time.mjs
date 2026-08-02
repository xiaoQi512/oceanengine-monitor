// src/domain/snapshot-time.mjs - 快照时间解析与最近查找（纯逻辑）

export function parseSnapshotTime(st) {
  if (st == null) return new Date(NaN);
  const s = String(st);
  return s.endsWith('Z') ? new Date(s) : new Date(s + 'Z');
}

export function parseSnapFileName(fileName) {
  const raw = String(fileName).replace(/^5m-/, '').replace(/\.json$/, '');
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const isoLike = match[1] + 'T' + match[2] + ':' + match[3] + ':' + match[4];
  const t = new Date(isoLike).getTime();
  if (isNaN(t)) return null;
  return { file: fileName, isoLike, t };
}

export function buildSnapFileIndex(files) {
  return files.map(parseSnapFileName).filter(Boolean);
}

export function findClosestSnapshotEntry(index, targetTime, toleranceMs = 6 * 60 * 1000) {
  const target = new Date(targetTime).getTime();
  let best = null;
  let bestDelta = Infinity;
  for (const entry of index) {
    const delta = Math.abs(entry.t - target);
    if (delta < bestDelta && delta <= toleranceMs) {
      bestDelta = delta;
      best = entry;
    }
  }
  return best;
}
