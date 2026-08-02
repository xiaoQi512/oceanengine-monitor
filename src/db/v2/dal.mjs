// dal.mjs - 巨量引擎监控数据库 数据访问层 (DAL)
// 所有 SQLite 读写操作统一入口，接入方不直接操作 db
//
// 用法:
//   import { getDB, initDB } from './巨量引擎监控数据库/dal.mjs';
//   const db = getDB();
//   const rows = db.campaigns.list({ date: '2026-07-10' });
//   const shifts = db.shifts.query({ anchor: '三水', month: 7 });

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..', '..', '..');

// ====== 数据库路径 ======
const DB_PATH = process.env.OCEANENGINE_DB_PATH
  || path.join(PROJECT_DIR, 'monitor-data', 'oceanengine.db');

let _db = null;
let _initDone = false;

// ====== 初始化 ======

export function getDBPath() { return DB_PATH; }

export function initDB(opts = {}) {
  if (_db && _initDone) return _db;

  const dbPath = opts.dbPath || DB_PATH;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);

  // 基础 pragma
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('cache_size = -64000');

  // 执行 schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    _db.exec(fs.readFileSync(schemaPath, 'utf-8'));
  }

  // 执行物化视图 schema
  const viewsPath = path.join(__dirname, 'schema-views.sql');
  if (fs.existsSync(viewsPath)) {
    _db.exec(fs.readFileSync(viewsPath, 'utf-8'));
  }

  // 运行未执行的迁移
  runMigrations(_db);

  _initDone = true;
  console.log(`  🗄️ 数据库就绪: ${dbPath} (${_db.pragma('user_version')})`);
  return _db;
}

function splitSqlStatements(sql) {
  const stmts = [];
  let cur = '', inStr = false, inComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1];
    if (inComment) {
      if (ch === '\n') inComment = false;
      continue;
    }
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (next === "'") { cur += next; i++; }
        else inStr = false;
      }
      continue;
    }
    if (ch === '-' && next === '-') { inComment = true; i++; continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ';') { stmts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts.filter(Boolean);
}

function runMigrations(db) {
  const migDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migDir)) return;

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );

  const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    // 从文件名提取版本号: "001_init.sql" → "001"
    const version = f.replace('.sql', '').replace(/^(\d+).*/, '$1');
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(migDir, f), 'utf-8');
    console.log(`  📦 迁移 ${version}: ${f}`);
    let ok = 0, skipped = 0, errs = 0;
    for (const stmt of splitSqlStatements(sql)) {
      try {
        db.exec(stmt + ';');
        ok++;
      } catch (e) {
        const msg = e.message || '';
        if (msg.includes('duplicate column name') || msg.includes('already exists')) {
          skipped++;
        } else {
          errs++;
          console.error(`  ❌ 迁移 ${version} 语句失败: ${msg.slice(0, 120)}`);
        }
      }
    }
    if (errs === 0) {
      db.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)").run(version);
      console.log(`  ✅ ${version} 完成 (${ok} 成功, ${skipped} 幂等跳过)`);
    }
  }
}

export function getDB(opts = {}) {
  if (!_db || !_initDone) return initDB(opts);
  return _db;
}

export function closeDB() {
  if (_db) { _db.close(); _db = null; _initDone = false; }
}

// ====== 查询辅助 ======

function queryOne(db, sql, params = {}) {
  return db.prepare(sql).get(params) || null;
}

function queryAll(db, sql, params = {}) {
  return db.prepare(sql).all(params);
}

// ====== 计划查询 ======

/** 列出活跃或全部计划 */
function listCampaigns(db, { status, limit = 50 } = {}) {
  if (status) {
    return queryAll(db, 'SELECT * FROM campaigns WHERE status = @status ORDER BY updated_at DESC LIMIT @limit', { status, limit });
  }
  return queryAll(db, 'SELECT * FROM campaigns ORDER BY updated_at DESC LIMIT @limit', { limit });
}

/** 批量 upsert 计划 */
const upsertCampaignStmt = Symbol('upsertCampaign');
function upsertCampaign(db, { campaign_id, name, status, daily_budget = 0, bid = null }) {
  return db.prepare(`
    INSERT INTO campaigns(campaign_id, name, status, daily_budget, bid, updated_at)
    VALUES (@cid, @name, @status, @budget, @bid, datetime('now','localtime'))
    ON CONFLICT(campaign_id) DO UPDATE SET
      name = excluded.name, status = excluded.status,
      daily_budget = excluded.daily_budget, bid = excluded.bid,
      updated_at = datetime('now','localtime')
  `).run({ cid: campaign_id, name, status, budget: daily_budget, bid });
}

// ====== 快照查询 ======

/** 插入快照 (批量事务) */
function insertSnapshots(db, snapshots) {
  const stmt = db.prepare(`
    INSERT INTO snapshots(snapshot_time, snapshot_cst, campaign_id, cost, leads, conversions,
      msg_open, msg_lead, form_submit, ctr, cpm, cvr, views, views_1min, comments,
      source_type, status, page_summary_json, raw_json)
    VALUES (@time, @cst, @cid, @cost, @leads, @conv, @open, @msgl, @form,
      @ctr, @cpm, @cvr, @views, @v1m, @cmt, @src, @status, @page, @raw)
  `);

  const insert = db.transaction((items) => {
    for (const s of items) {
      stmt.run({
        time: s.snapshot_time, cst: s.snapshot_cst || '',
        cid: s.campaign_id, cost: s.cost || 0, leads: s.leads || 0,
        conv: s.conversions || 0, open: s.msg_open || 0, msgl: s.msg_lead || 0,
        form: s.form_submit || 0, ctr: s.ctr || 0, cpm: s.cpm || 0,
        cvr: s.cvr || 0, views: s.views || 0, v1m: s.views_1min || 0,
        cmt: s.comments || 0, src: s.source_type || '15min', status: s.status || null,
        page: s.page_summary_json || null, raw: s.raw_json || null,
      });
    }
  });

  insert(snapshots);
  return snapshots.length;
}

/** 查询某日快照数 */
function countSnapshots(db, date) {
  return queryOne(db,
    `SELECT COUNT(*) as cnt FROM snapshots WHERE snapshot_time LIKE '${date}%'`
  )?.cnt || 0;
}

/** 获取某计划在指定时间段的快照 */
function getCampaignSnapshots(db, { campaign_id, startTime, endTime, limit = 100 }) {
  return queryAll(db,
    `SELECT * FROM snapshots WHERE campaign_id = @cid AND snapshot_time BETWEEN @start AND @end ORDER BY snapshot_time LIMIT @limit`,
    { cid: campaign_id, start: startTime, end: endTime, limit }
  );
}

// ====== 场次指标查询 ======

/** 写入主播场次数据 */
function upsertShiftMetric(db, { date, shift_label, anchor_name, spend, leads, cpl, source = 'snapshot', detail }) {
  return db.prepare(`
    INSERT INTO shift_metrics(date, shift_label, anchor_name, spend, leads, cpl, source, detail_json)
    VALUES (@date, @label, @anchor, @spend, @leads, @cpl, @src, @detail)
    ON CONFLICT(date, shift_label) DO UPDATE SET
      anchor_name = excluded.anchor_name, spend = excluded.spend,
      leads = excluded.leads, cpl = excluded.cpl,
      source = excluded.source, detail_json = excluded.detail_json
  `).run({
    date, label: shift_label, anchor: anchor_name,
    spend, leads, cpl, src: source, detail: detail ? JSON.stringify(detail) : null,
  });
}

/** 查询主播本月汇总 */
function getAnchorMonthly(db, { anchor, month }) {
  const prefix = `2026-${String(month).padStart(2, '0')}`;
  return queryAll(db,
    `SELECT date, shift_label, spend, leads, cpl, source
     FROM shift_metrics
     WHERE anchor_name = @anchor AND date LIKE @prefix || '%'
     ORDER BY date, shift_label`,
    { anchor, prefix }
  );
}

/** 查询主播区间统计 */
function getAnchorStats(db, { anchor, dateFrom, dateTo }) {
  return queryOne(db,
    `SELECT COUNT(*) as shift_count, SUM(spend) as total_spend,
            SUM(leads) as total_leads, CASE WHEN SUM(leads)>0 THEN SUM(spend)/SUM(leads) ELSE 0 END as avg_cpl
     FROM shift_metrics
     WHERE anchor_name = @anchor AND date BETWEEN @from AND @to
     GROUP BY anchor_name`,
    { anchor, from: dateFrom, to: dateTo }
  );
}

// ====== 日汇总 ======

/** 获取指定日期的日汇总 */
function getDailySummary(db, date) {
  return queryOne(db, 'SELECT * FROM daily_summaries WHERE date = @date', { date });
}

/** 写入日汇总 */
function upsertDailySummary(db, { date, total_cost, total_leads, total_conversions = 0, avg_cpa = 0, avg_ctr = 0, avg_cpm = 0, active_count = 0, source = 'api' }) {
  return db.prepare(`
    INSERT INTO daily_summaries(date, total_cost, total_leads, total_conversions, avg_cpa, avg_ctr, avg_cpm, active_count, source)
    VALUES (@date, @cost, @leads, @conv, @cpa, @ctr, @cpm, @active, @src)
    ON CONFLICT(date) DO UPDATE SET
      total_cost = excluded.total_cost, total_leads = excluded.total_leads,
      total_conversions = excluded.total_conversions, avg_cpa = excluded.avg_cpa,
      avg_ctr = excluded.avg_ctr, avg_cpm = excluded.avg_cpm,
      active_count = excluded.active_count, source = excluded.source
  `).run({ date, cost: total_cost, leads: total_leads, conv: total_conversions, cpa: avg_cpa, ctr: avg_ctr, cpm: avg_cpm, active: active_count, src: source });
}

// ====== 告警 ======

function insertAlert(db, { type, severity = 'medium', campaign_id = null, message = '' }) {
  return db.prepare(
    'INSERT INTO alerts(alert_type, severity, campaign_id, message) VALUES (@type, @sev, @cid, @msg)'
  ).run({ type, sev: severity, cid: campaign_id, msg: message });
}

// ====== 自监控 ======

function recordTelemetry(db) {
  const dbPath = getDBPath();
  let dbSizeMB = 0, walSizeMB = 0;
  try {
    const stat = fs.statSync(dbPath);
    dbSizeMB = stat.size / 1048576;
    const walPath = dbPath + '-wal';
    if (fs.existsSync(walPath)) walSizeMB = fs.statSync(walPath).size / 1048576;
  } catch { /* ignore */ }

  const today = new Date().toISOString().slice(0, 10);
  const snapCount = countSnapshots(db, today);

  return db.prepare(`
    INSERT INTO telemetry(check_time, write_lag_ms, db_size_mb, snap_count, wal_size_mb, checks_ok)
    VALUES (datetime('now','localtime'), @lag, @size, @snap, @wal, 1)
  `).run({ lag: null, size: dbSizeMB, snap: snapCount, wal: walSizeMB });
}

// ====== 名称覆盖 ======

/** 获取所有名称覆盖规则 */
function getNameOverrides(db) {
  try {
    return db.prepare('SELECT name_pattern, replacement FROM name_overrides').all();
  } catch {
    return [];
  }
}

/** 应用名称覆盖: 如果 name 匹配任意 name_pattern，返回替换后的名称；否则返回原名称 */
function applyNameOverrides(db, name) {
  const overrides = getNameOverrides(db);
  for (const o of overrides) {
    if (name.includes(o.name_pattern)) {
      return name.replace(o.name_pattern, o.replacement);
    }
  }
  return name;
}

// ====== 暴露的 API 对象 ======

export function createAPI(db) {
  return {
    // 计划
    campaigns: {
      list: (opts) => listCampaigns(db, opts),
      upsert: (data) => upsertCampaign(db, data),
    },

    // 快照
    snapshots: {
      insert: (data) => insertSnapshots(db, data),
      count: (date) => countSnapshots(db, date),
      getByCampaign: (opts) => getCampaignSnapshots(db, opts),
    },

    // 场次
    shifts: {
      upsert: (data) => upsertShiftMetric(db, data),
      query: (opts) => getAnchorMonthly(db, opts),
      stats: (opts) => getAnchorStats(db, opts),
    },

    // 日汇总
    daily: {
      get: (date) => getDailySummary(db, date),
      upsert: (data) => upsertDailySummary(db, data),
    },

    // 告警
    alerts: {
      insert: (data) => insertAlert(db, data),
    },

    // 自监控
    telemetry: {
      record: () => recordTelemetry(db),
    },

    // 名称覆盖
    nameOverrides: {
      all: () => getNameOverrides(db),
      apply: (name) => applyNameOverrides(db, name),
    },

    // 裸 DB (高级查询)
    raw: db,
  };
}

// ====== 便捷函数 ======

/** 获取已初始化的 DAL 对象 */
export function connect() {
  const db = getDB();
  return createAPI(db);
}
