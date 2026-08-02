// src/services/snapshot-file.mjs - 5min 快照文件读取
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../utils/monitor-utils.mjs';
import { buildSnapFileIndex, findClosestSnapshotEntry } from '../domain/snapshot-time.mjs';

export function get5mSnapshots(count = 1, { dataDir = DATA_DIR, fsImpl = fs, pathImpl = path } = {}) {
  try {
    const files = fsImpl.readdirSync(dataDir)
      .filter(f => f.startsWith('5m-') && f.endsWith('.json'))
      .sort();
    if (files.length === 0) return [];
    return files.slice(-count).map(f => {
      try { return JSON.parse(fsImpl.readFileSync(pathImpl.join(dataDir, f), 'utf-8')); }
      catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

const _snapFileIndexByDir = new Map();
export function getSnapFileIndex(maxAgeMs = 60 * 1000, { dataDir = DATA_DIR, fsImpl = fs, pathImpl = path } = {}) {
  const now = Date.now();
  const cached = _snapFileIndexByDir.get(dataDir);
  if (cached && now - cached.at < maxAgeMs) return cached.index;
  const files = fsImpl.readdirSync(dataDir)
    .filter(f => f.startsWith('5m-') && f.endsWith('.json'))
    .sort();
  const index = buildSnapFileIndex(files);
  _snapFileIndexByDir.set(dataDir, { at: now, index });
  return index;
}

export function findSnapshotAround(targetTime, toleranceMs = 6 * 60 * 1000, { dataDir = DATA_DIR, fsImpl = fs, pathImpl = path } = {}) {
  try {
    const best = findClosestSnapshotEntry(getSnapFileIndex(60 * 1000, { dataDir, fsImpl, pathImpl }), targetTime, toleranceMs);
    if (!best) return null;
    const snap = JSON.parse(fsImpl.readFileSync(pathImpl.join(dataDir, best.file), 'utf-8'));
    return {
      accountSpend: Number(snap.accountSpend) || 0,
      totalConv: Number(snap.totalConv) || 0,
      time: snap.time || best.isoLike,
      file: best.file,
    };
  } catch {
    return null;
  }
}
