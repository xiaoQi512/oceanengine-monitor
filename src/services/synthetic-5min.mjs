// src/services/synthetic-5min.mjs - 15min后补写合成5min快照
// 把整刻钟 15min 快照的累计值克隆为 5min source_type，趋势图不用再做 fallback
// 逻辑：INSERT INTO snapshots SELECT ... FROM snapshots WHERE source_type='15min'
// 仅当该时刻尚无 5min 数据时才执行

import Database from 'better-sqlite3';
import { DATA_DIR } from '../utils/monitor-utils.mjs';
import path from 'node:path';

const DB_PATH = path.join(DATA_DIR, 'oceanengine.db');

/**
 * 为指定 snapshot_time 生成合成 5min 快照
 * @param {string} st - snapshot_time (ISO)，15min 快照的时间
 * @param {object} db - 可选的已打开数据库连接
 * @returns {{ ok: boolean, rows: number, note: string }}
 */
export function synthesize5min(st, db = null) {
  const own = !db;
  if (own) db = new Database(DB_PATH);

  try {
    // 检查是否已有 5min 快照（不覆盖真实数据）
    const existing = db.prepare(`SELECT COUNT(*) as cnt FROM snapshots
      WHERE snapshot_time = ? AND source_type = '5min'`).get(st);
    if (existing && existing.cnt > 0) {
      return { ok: true, rows: 0, note: 'already_exists' };
    }

    // 检查是否有 15min 快照
    const source = db.prepare(`SELECT COUNT(*) as cnt FROM snapshots
      WHERE snapshot_time = ? AND source_type = '15min'`).get(st);
    if (!source || source.cnt === 0) {
      return { ok: true, rows: 0, note: 'no_15min_source' };
    }

    // 克隆 15min 中 cost > 0 的行为 5min（避免 0 消耗行拉低 activeCount 准确性）
    // 整刻钟的"计划总数"应仅含真正投放中的计划，与 5min 真实快照采集口径一致
    const insert = db.prepare(`INSERT INTO snapshots
      (snapshot_time, campaign_id, source_type, cost, leads, conversions,
       msg_open, msg_lead, form_submit, ctr, cpm, cvr,
       views, views_1min, comments, page_summary_json, raw_json, status, snapshot_cst)
      SELECT
        snapshot_time, campaign_id, '5min', cost, leads, conversions,
        msg_open, msg_lead, form_submit, ctr, cpm, cvr,
        views, views_1min, comments,
        CASE WHEN page_summary_json IS NOT NULL
          THEN (SELECT json_set(value,'$.synthetic',json('true'),'$.source','15min_clone')
                FROM (SELECT page_summary_json as value)) ELSE NULL END,
        raw_json, status, ''
      FROM snapshots
      WHERE snapshot_time = ? AND source_type = '15min' AND cost > 0`);

    const info = insert.run(st);
    console.log(`  📊 合成5min: ${info.changes} 条 (${st})`);
    return { ok: true, rows: info.changes, note: 'synthesized' };
  } catch (e) {
    console.warn(`  ⚠ 合成5min失败: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    if (own && db) { try { db.close(); } catch {} }
  }
}

/**
 * 取最近的 15min snapshot_time，为其生成合成 5min
 */
export function synthesizeLatestQuarter(db = null) {
  const own = !db;
  if (own) db = new Database(DB_PATH);

  try {
    const row = db.prepare(`SELECT snapshot_time FROM snapshots
      WHERE source_type = '15min'
      ORDER BY snapshot_time DESC LIMIT 1`).get();
    if (!row) return { ok: true, note: 'no_15min_data' };
    return synthesize5min(row.snapshot_time, db);
  } finally {
    if (own && db) { try { db.close(); } catch {} }
  }
}
