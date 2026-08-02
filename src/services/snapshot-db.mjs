// src/services/snapshot-db.mjs - 快照 DB 查询
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR } from '../utils/monitor-utils.mjs';
import { parseSnapshotTime } from '../domain/snapshot-time.mjs';

export const DB_PATH = path.join(DATA_DIR, 'oceanengine.db');

export function queryPlanSnapshot(projectId, targetTime, toleranceMs = 15 * 60 * 1000) {
  if (!projectId) return null;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const target = parseSnapshotTime(targetTime).getTime();
    const rows = db.prepare(`
      SELECT snapshot_time, cost, leads, conversions, ctr, cpm
      FROM snapshots
      WHERE campaign_id = ?
      ORDER BY snapshot_time DESC
      LIMIT 100
    `).all(String(projectId));
    db.close();
    if (!rows.length) return null;
    let best = null;
    let bestDelta = Infinity;
    for (const r of rows) {
      const t = parseSnapshotTime(r.snapshot_time).getTime();
      if (isNaN(t)) continue;
      const delta = Math.abs(t - target);
      if (delta < bestDelta && delta <= toleranceMs) {
        bestDelta = delta;
        best = {
          cost: Number(r.cost) || 0,
          leads: Number(r.leads) || 0,
          conversions: Number(r.conversions) || 0,
          ctr: Number(r.ctr) || 0,
          cpm: Number(r.cpm) || 0,
          time: r.snapshot_time,
        };
      }
    }
    return best;
  } catch (e) {
    console.warn('[ai] 计划快照查询失败:', e.message);
    return null;
  }
}

export function findSnapshotAroundDB(targetTime, toleranceMs = 6 * 60 * 1000) {
  try {
    const target = parseSnapshotTime(targetTime).getTime();
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const rows = db.prepare(`
        SELECT snapshot_time,
          SUM(cost) as accountSpend,
          SUM(conversions) as totalConv
        FROM snapshots
        WHERE source_type = '5min'
        GROUP BY snapshot_time
      `).all();
      let best = null;
      let bestDelta = Infinity;
      for (const r of rows) {
        const t = parseSnapshotTime(r.snapshot_time).getTime();
        if (isNaN(t)) continue;
        const delta = Math.abs(t - target);
        if (delta < bestDelta && delta <= toleranceMs) {
          bestDelta = delta;
          best = {
            accountSpend: Number(r.accountSpend) || 0,
            totalConv: Number(r.totalConv) || 0,
            time: r.snapshot_time,
          };
        }
      }
      return best;
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn('[ai] DB 快照查找失败:', e.message);
    return null;
  }
}
