// src/services/snapshot-store.mjs - 15min 监控快照/日志文件存储
import fs from 'node:fs';
import path from 'node:path';
import { parseSnapshotTime } from '../domain/helpers.mjs';

export function readSnapshot(dataDir, filename) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, filename), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

export function readDailyLog(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

export function loadPreviousSnapshots(dataDir) {
  const result = { t15: null, t30: null, t60: null };
  try {
    const files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('.json') && f.startsWith('202'))
      .map(f => ({ name: f, age: Math.max((Date.now() - parseSnapshotTime(f)) / 60000, 0) }))
      .sort((a, b) => a.age - b.age);

    if (files.length < 1) return result;

    const findClosest = (target) => {
      let best = null;
      for (const f of files) {
        if (f.age >= target - 5 && f.age <= target + 10) {
          if (!best || Math.abs(f.age - target) < Math.abs(best.age - target)) best = f;
        }
      }
      if (!best) best = files.reduce((b, f) => Math.abs(f.age - target) < Math.abs(b.age - target) ? f : b, files[0]);
      return best;
    };

    const t15f = findClosest(15);
    const t30f = findClosest(30);
    const t60f = findClosest(60);

    if (t15f) {
      result.t15 = readSnapshot(dataDir, t15f.name);
      if (result.t15) result.t15._ageMinutes = Math.max(t15f.age, 1);
    }
    if (t30f) {
      result.t30 = readSnapshot(dataDir, t30f.name);
      if (result.t30) result.t30._ageMinutes = Math.max(t30f.age, 1);
    }
    if (t60f) {
      result.t60 = readSnapshot(dataDir, t60f.name);
      if (result.t60) result.t60._ageMinutes = Math.max(t60f.age, 1);
    }
  } catch (e) {
    console.log(`  加载历史快照异常: ${e.message}`);
  }
  return result;
}

export function loadTodaysSnapshots(dataDir) {
  const today = new Date().toISOString().substring(0, 10);
  try {
    const files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('.json') && f.startsWith(today))
      .sort();
    return files.map(f => {
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'));
        snap._time = f.substring(0, 19).replace('T', ' ') + ':00';
        return snap;
      } catch { return { active: [], allSpending: [], time: null }; }
    });
  } catch { return []; }
}
