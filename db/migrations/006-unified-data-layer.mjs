// db/migrations/006-unified-data-layer.mjs - 统一数据层迁移 (11 张新表 + model_rules 初始化)
// 幂等: CREATE TABLE IF NOT EXISTS + 规则 INSERT 前查重; 从项目根目录执行
import Database from '../../node_modules/better-sqlite3/lib/index.js';

const ROOT = process.cwd();
const DB_PATH = ROOT + '/monitor-data/oceanengine.db';
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const DDL = `
CREATE TABLE IF NOT EXISTS account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_time TEXT NOT NULL,
  cst_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  spend REAL DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  convert_cnt INTEGER DEFAULT 0,
  form_cnt INTEGER DEFAULT 0,
  private_msg_open INTEGER DEFAULT 0,
  budget REAL, balance REAL,
  raw_json TEXT,
  UNIQUE(snapshot_time, account_id)
);
CREATE INDEX IF NOT EXISTS idx_acc_snap ON account_snapshots(account_id, cst_date, snapshot_time);

CREATE TABLE IF NOT EXISTS live_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cst_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  room_id TEXT,
  title TEXT,
  start_time TEXT,
  end_time TEXT,
  cost REAL DEFAULT 0,
  leads INTEGER DEFAULT 0,
  status TEXT,
  pulled_at TEXT,
  UNIQUE(cst_date, account_id, room_id)
);
CREATE INDEX IF NOT EXISTS idx_live_rooms ON live_rooms(account_id, cst_date);

CREATE TABLE IF NOT EXISTS promotion_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cst_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  delivery_form TEXT,
  car_model TEXT,
  cost REAL DEFAULT 0,
  leads INTEGER DEFAULT 0,
  convert_cnt INTEGER DEFAULT 0,
  msg_open INTEGER DEFAULT 0,
  final_flag INTEGER DEFAULT 0,
  updated_at TEXT,
  UNIQUE(cst_date, account_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_promo_daily ON promotion_daily(account_id, cst_date);

CREATE TABLE IF NOT EXISTS official_daily (
  cst_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  cost REAL, leads INTEGER,
  pulled_at TEXT,
  UNIQUE(cst_date, account_id)
);

CREATE TABLE IF NOT EXISTS model_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT NOT NULL,              -- keyword | plan_id | fallback
  pattern TEXT NOT NULL,
  car_model TEXT NOT NULL,
  priority INTEGER DEFAULT 100,
  source TEXT DEFAULT 'manual',
  enabled INTEGER DEFAULT 1,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_model_rules ON model_rules(priority, enabled);

CREATE TABLE IF NOT EXISTS shift_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cst_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  region_name TEXT,
  session_no INTEGER,
  start_min INTEGER,
  end_min INTEGER,
  car_model TEXT NOT NULL,
  anchor TEXT,
  synced_at TEXT,
  UNIQUE(cst_date, account_id, session_no)
);
CREATE INDEX IF NOT EXISTS idx_shift_sched ON shift_schedule(account_id, cst_date);

CREATE TABLE IF NOT EXISTS calc_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT,
  cst_date TEXT, account_id TEXT, target_key TEXT,
  spend REAL, leads INTEGER,
  note TEXT, created_by TEXT, created_at TEXT,
  UNIQUE(scope, cst_date, account_id, target_key)
);

CREATE TABLE IF NOT EXISTS agg_15min (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_end_cst TEXT NOT NULL,
  account_id TEXT NOT NULL,
  minutes INTEGER,
  spend REAL, leads INTEGER, conv INTEGER, msg_open INTEGER,
  impr INTEGER, clicks INTEGER,
  computed_at TEXT,
  UNIQUE(bucket_end_cst, account_id)
);
CREATE INDEX IF NOT EXISTS idx_agg15 ON agg_15min(account_id, bucket_end_cst);

CREATE TABLE IF NOT EXISTS agg_shift (
  cst_date TEXT, account_id TEXT, shift_label TEXT,
  anchor TEXT, car_model TEXT,
  spend REAL, leads INTEGER, cpl REAL, cpm REAL, ctr REAL,
  progress INTEGER, corrected INTEGER DEFAULT 0,
  computed_at TEXT,
  PRIMARY KEY(cst_date, account_id, shift_label)
);

CREATE TABLE IF NOT EXISTS agg_daily_model (
  cst_date TEXT, account_id TEXT, model TEXT,
  cost REAL, leads INTEGER,
  session_count INTEGER,
  computed_at TEXT,
  PRIMARY KEY(cst_date, account_id, model)
);

CREATE TABLE IF NOT EXISTS agg_month_cum (
  cst_date TEXT, account_id TEXT, model TEXT,
  month_cost REAL, month_leads INTEGER,
  computed_at TEXT,
  PRIMARY KEY(cst_date, account_id, model)
);
`;

const RULES = [
  ['keyword', 'T7', 'αT7', 50, 'auto'],
  ['keyword', 'T1', 'T1', 50, 'auto'],
  ['keyword', 'T5', 'αT5', 50, 'auto'],
  ['keyword', 'S5', 'αS5', 50, 'auto'],
  ['keyword', 'S3', 'S3', 50, 'auto'],
  ['keyword', 'V9', 'V9', 50, 'auto'],
  ['keyword', 'KAOLA', 'KAOLAS', 50, 'auto'],
  ['keyword', '考拉', 'KAOLAS', 50, 'auto'],
  ['keyword', '阿尔法T', 'αT', 60, '非 T7/T1 的阿尔法T'],
  ['fallback', '福利号无车型计划', 'αT7', 90, '无车型直播画面即 T7 (用户 2026-09-20 定稿)'],
];

const tx = db.transaction(() => {
  db.exec(DDL);
  for (const [type, pattern, model, prio, note] of RULES) {
    const exists = db.prepare('SELECT id FROM model_rules WHERE rule_type=? AND pattern=?').get(type, pattern);
    if (!exists) {
      db.prepare('INSERT INTO model_rules (rule_type, pattern, car_model, priority, source, enabled) VALUES (?,?,?,?,?,1)')
        .run(type, pattern, model, prio, note);
    }
  }
  const done = db.prepare('SELECT version FROM schema_migrations WHERE version=?').get('006');
  if (!done) {
    db.prepare("INSERT INTO schema_migrations (version, applied_at, description) VALUES ('006', datetime('now','localtime'), '统一数据层 v1: 采集/排期/核算 11 表')")
      .run();
  }
});
tx();

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('account_snapshots','live_rooms','promotion_daily','official_daily','shift_schedule','calc_overrides','agg_15min','agg_shift','agg_daily_model','agg_month_cum')").all();
const rules = db.prepare('SELECT COUNT(*) n FROM model_rules').get();
console.log('迁移 006 完成 | 新表就位:', tables.length, '/ 10 | model_rules:', rules.n, '条');
db.close();
