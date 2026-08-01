// db/writer.mjs — SQLite 双写接口
// 提供 insertSnapshot(data) 用于在写 JSON 快照后同步写 SQLite
// 双通道独立: JSON 写入失败不阻塞 SQLite 写入，反之亦然
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'monitor-data', 'oceanengine.db');

let _db = null;
let _stmts = null;

function getDb() {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) {
    console.warn('[db/writer] 数据库不存在，请先执行 db/init.mjs');
    return null;
  }
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = FULL'); // FULL 确保断电不丢已提交事务（WAL + FULL 兼顾性能与安全）

  _stmts = {
    upsertCampaign: _db.prepare(`
      INSERT INTO campaigns(campaign_id, name, status, daily_budget, bid, updated_at)
      VALUES (@campaign_id, @name, @status, @daily_budget, @bid, datetime('now'))
      ON CONFLICT(campaign_id) DO UPDATE SET
        name=excluded.name, status=excluded.status, daily_budget=excluded.daily_budget,
        bid=excluded.bid, updated_at=datetime('now')
    `),
    deleteExisting: _db.prepare(
      `DELETE FROM snapshots WHERE campaign_id=? AND snapshot_time=?`
    ),
    insertSnapshot: _db.prepare(`
      INSERT INTO snapshots(
        snapshot_time, campaign_id, cost, leads, conversions,
        msg_open, msg_lead, form_submit, ctr, cpm, cvr,
        views, views_1min, comments, page_summary_json, raw_json, source_type, status
      ) VALUES (
        @snapshot_time, @campaign_id, @cost, @leads, @conversions,
        @msg_open, @msg_lead, @form_submit, @ctr, @cpm, @cvr,
        @views, @views_1min, @comments, @page_summary_json, @raw_json, @source_type, @status
      )
    `),
    countByTime: _db.prepare(
      `SELECT COUNT(*) as n FROM snapshots WHERE snapshot_time=?`
    ),
    sumCostByTime: _db.prepare(
      `SELECT COALESCE(SUM(cost),0) as s FROM snapshots WHERE snapshot_time=?`
    ),
    insertAction: _db.prepare(`
      INSERT INTO actions(action_time, action_type, campaign_id, before_value, after_value, source, status, executed_at)
      VALUES (@action_time, @action_type, @campaign_id, @before_value, @after_value, @source, @status, @executed_at)
    `),
  };
  return _db;
}

function num(v) {
  if (v === null || v === undefined) return 0;
  // Number() 兼容字符串 "123.45" 和数字 123.45
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

// 从文件名或时间对象解析 snapshot_time
// 输入: 文件名 "2026-06-28T14-30-01.json" 或 ISO 字符串
// 输出: 统一为 "YYYY-MM-DDTHH:MM:SS" 格式（无毫秒、无 Z），与 15min 路径一致
function normalizeSnapshotTime(input) {
  if (!input) return null;
  const s = String(input).replace(/\.json$/, '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}T${m[2]}:${m[3]}:${m[4]}`;
  // ISO 格式: 去掉毫秒和 Z 后缀，统一到秒级
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (isoMatch) return isoMatch[1];
  return null;
}

/**
 * 写入一条快照到 SQLite
 * @param {Object} data - 与 JSON 快照同结构 ({active:[...], summary:{...}, time:'...'})
 * @param {string} [snapshotTime] - 可选快照时间，默认取 data.time 或当前时间
 * @returns {{ok:boolean, rows:number, error?:string}}
 */
export function insertSnapshot(data, snapshotTime) {
  const db = getDb();
  if (!db) return { ok: false, rows: 0, error: 'db_not_initialized' };

  try {
    // 优先用显式传入的时间，其次 data.time，最后当前时间
    let st = snapshotTime
      ? normalizeSnapshotTime(snapshotTime)
      : normalizeSnapshotTime(data?.time) || new Date().toISOString().replace(/\.\d+Z$/, '');

    if (!st) st = new Date().toISOString().replace(/\.\d+Z$/, '');

    const seen = new Set();
    const campaigns = [
      ...(data.allSpending || []),
      ...(data.active || []),
      ...(data.campaigns || []),
    ].filter(c => {
      if (!c.id || seen.has(String(c.id))) return false;
      seen.add(String(c.id));
      return true;
    });
    if (campaigns.length === 0) {
      return { ok: true, rows: 0, snapshot_time: st, note: 'no_campaigns' };
    }

    let rows = 0;
    const tx = db.transaction(() => {
      for (const c of campaigns) {
        if (!c.id) continue;

        const budgetNum = parseFloat(String(c.budget || '0').replace(/,/g, '')) || 0;
        const bidNum = parseFloat(String(c.bid || '').replace(/[^\d.]/g, '')) || null;

        _stmts.upsertCampaign.run({
          campaign_id: String(c.id),
          name: c.name || '',
          status: c.status || '',
          daily_budget: budgetNum,
          bid: bidNum,
        });

        _stmts.deleteExisting.run(String(c.id), st);
        _stmts.insertSnapshot.run({
          snapshot_time: st,
          campaign_id: String(c.id),
          cost: num(c.spend),
          leads: num(c.leads),
          conversions: num(c.conversions),
          msg_open: num(c.privateMsgOpen),
          msg_lead: num(c.privateMsgRetain),
          form_submit: num(c.formSubmit),
          ctr: num(c.ctr),
          cpm: num(c.cpm),
          cvr: num(c.cvr),
          views: num(c.liveViews),
          views_1min: num(c.liveOver1Min),
          comments: num(c.liveComments),
          page_summary_json: data.summary ? JSON.stringify(data.summary) : null,
          raw_json: JSON.stringify(c),
          source_type: data.sourceType || '15min',
          status: c.status || null,
        });
        rows++;
      }
    });
    tx();

    return { ok: true, rows, snapshot_time: st };
  } catch (e) {
    return { ok: false, rows: 0, error: e.message };
  }
}

/**
 * 抽样校验 JSON 与 SQLite 数据一致性
 * @param {Object} jsonData - 原始JSON快照数据
 * @param {string} snapshotTime - 快照时间
 * @returns {{ok:boolean, deviation?:number, warn?:string}}
 */
export function verifyConsistency(jsonData, snapshotTime) {
  const db = getDb();
  if (!db) return { ok: false, warn: 'db_not_initialized' };

  const st = normalizeSnapshotTime(snapshotTime) || snapshotTime;
  const seen = new Set();
  const campaigns = [
    ...(jsonData.allSpending || []),
    ...(jsonData.active || []),
    ...(jsonData.campaigns || []),
  ].filter(c => {
    if (!c.id || seen.has(String(c.id))) return false;
    seen.add(String(c.id));
    return true;
  });

  const dbRow = _stmts.countByTime.get(st);
  const dbCount = dbRow ? dbRow.n : 0;

  if (dbCount !== campaigns.length) {
    return {
      ok: false,
      warn: `row_count_mismatch: json=${campaigns.length} db=${dbCount}`,
    };
  }

  // 比较总消耗偏差
  const jsonCost = campaigns.reduce((s, c) => s + num(c.spend), 0);
  const dbCost = _stmts.sumCostByTime.get(st).s;
  if (jsonCost === 0 && dbCost === 0) return { ok: true, deviation: 0 };

  const deviation = Math.abs(jsonCost - dbCost) / Math.max(jsonCost, 1);
  if (deviation > 0.01) {
    return {
      ok: false,
      deviation,
      warn: `cost_deviation: json=${jsonCost.toFixed(2)} db=${dbCost.toFixed(2)} dev=${(deviation*100).toFixed(2)}%`,
    };
  }

  return { ok: true, deviation };
}

/**
 * 写入一条操作记录到 SQLite（与 action-audit.jsonl 双写，互不阻塞）
 * @param {Object} entry - 与 writeAudit 入参同结构
 *   { time, actionType, planName, projectId, source, beforeValue, afterValue, result, snapshotBefore }
 * @returns {{ok:boolean, id?:number, error?:string}}
 */
export function insertAction(entry) {
  const db = getDb();
  if (!db) return { ok: false, error: 'db_not_initialized' };

  try {
    const result = _stmts.insertAction.run({
      action_time: entry.time || new Date().toISOString(),
      action_type: entry.actionType || '',
      campaign_id: entry.projectId || entry.campaignId || '',
      before_value: entry.beforeValue ? JSON.stringify(entry.beforeValue) : null,
      after_value: entry.afterValue ? JSON.stringify(entry.afterValue) : null,
      source: entry.source || 'unknown',
      // result.ok=true -> 'success', 否则 'failed'; pending 状态由调用方显式传
      status: entry.status || (entry.result?.ok ? 'success' : 'failed'),
      executed_at: entry.result?.ok ? (entry.time || new Date().toISOString()) : null,
    });
    return { ok: true, id: Number(result.lastInsertRowid) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 关闭数据库连接 (进程退出前调用)
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
    _stmts = null;
  }
}

// 进程退出时自动关闭（覆盖 PM2 SIGTERM / SIGINT / 正常退出）
process.on('exit', () => closeDb());
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
