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

/**
 * 按日期读取 daily 日志，兼容带 accountId 前缀（daily-{accountId}-{date}.json）
 */
export function findDailyLog(dataDir, date) {
  const plain = path.join(dataDir, `daily-${date}.json`);
  if (fs.existsSync(plain)) return readDailyLog(plain);
  try {
    const files = fs.readdirSync(dataDir)
      .filter(f => f.startsWith('daily-') && f.includes(`${date}.json`));
    if (files.length) return readDailyLog(path.join(dataDir, files[files.length - 1]));
  } catch {}
  return null;
}

export function loadPreviousSnapshots(dataDir) {
  const result = { t15: null, t30: null, t60: null };
  try {
    const files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('.json') && /(?:\d{4}-\d{2}-\d{2}-)?\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(f))
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
    // 兼容带 accountId 前缀与不带前缀的今日快照
    const files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('.json') && f.includes(today + 'T'))
      .sort();
    return files.map(f => {
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'));
        const m = f.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.json/);
        snap._time = m ? m[1].replace('T', ' ') + ':00' : f.substring(0, 19).replace('T', ' ') + ':00';
        return snap;
      } catch { return { active: [], allSpending: [], time: null }; }
    });
  } catch { return []; }
}
