-- ============================================================
-- oceanengine.db - 巨量引擎监控数据库 Schema v2.0
-- 路径: monitor-data/oceanengine.db
-- 引擎: SQLite 3.x (WAL + better-sqlite3)
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA encoding = 'UTF-8';
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;  -- 64MB cache

-- ============================================================
-- 0. schema_migrations - 版本迁移记录
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  description TEXT NOT NULL DEFAULT ''
);

-- ============================================================
-- 1. campaigns - 广告计划主表
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT '',
  daily_budget  REAL NOT NULL DEFAULT 0,
  bid           REAL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- 2. snapshots - 5min/15min 快照明细表（核心事实表）
-- ============================================================
CREATE TABLE IF NOT EXISTS snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_time     TEXT NOT NULL,               -- UTC ISO时间
  snapshot_cst      TEXT NOT NULL DEFAULT '',     -- CST北京时间 HH:MM
  campaign_id       TEXT NOT NULL,
  cost              REAL NOT NULL DEFAULT 0,      -- 累计消耗
  leads             INTEGER NOT NULL DEFAULT 0,
  conversions       INTEGER NOT NULL DEFAULT 0,
  msg_open          INTEGER NOT NULL DEFAULT 0,
  msg_lead          INTEGER NOT NULL DEFAULT 0,
  form_submit       INTEGER NOT NULL DEFAULT 0,
  ctr               REAL NOT NULL DEFAULT 0,
  cpm               REAL NOT NULL DEFAULT 0,
  cvr               REAL NOT NULL DEFAULT 0,
  views             INTEGER NOT NULL DEFAULT 0,
  views_1min        INTEGER NOT NULL DEFAULT 0,
  comments          INTEGER NOT NULL DEFAULT 0,
  source_type       TEXT NOT NULL DEFAULT '15min',  -- 5min/15min
  page_summary_json TEXT,
  raw_json          TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
);

-- ============================================================
-- 3. daily_summaries - 日汇总数据（账户级）
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_summaries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL UNIQUE,            -- YYYY-MM-DD
  total_cost      REAL NOT NULL DEFAULT 0,
  total_leads     INTEGER NOT NULL DEFAULT 0,
  total_conversions INTEGER NOT NULL DEFAULT 0,
  avg_cpa         REAL NOT NULL DEFAULT 0,
  avg_ctr         REAL NOT NULL DEFAULT 0,
  avg_cpm         REAL NOT NULL DEFAULT 0,
  active_count    INTEGER NOT NULL DEFAULT 0,
  peak_hour       INTEGER,                         -- 消耗最高小时(0-23)
  peak_cost       REAL,
  source          TEXT NOT NULL DEFAULT 'api',     -- api/snapshot/manual
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- 4. shift_metrics - 主播班次指标
-- ============================================================
CREATE TABLE IF NOT EXISTS shift_metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL,                    -- YYYY-MM-DD
  shift_label     TEXT NOT NULL,                    -- HH:MM-HH:MM
  anchor_name     TEXT NOT NULL DEFAULT '',
  spend           REAL NOT NULL DEFAULT 0,
  leads           INTEGER NOT NULL DEFAULT 0,
  cpl             REAL NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'snapshot', -- snapshot/api_fallback
  detail_json     TEXT,                             -- 快照详情JSON
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(date, shift_label)
);

-- ============================================================
-- 5. alerts - 告警事件表
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_time   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  alert_type   TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'medium',
  campaign_id  TEXT,
  message      TEXT NOT NULL DEFAULT '',
  resolved     INTEGER NOT NULL DEFAULT 0,
  resolved_at  TEXT
);

-- ============================================================
-- 6. actions - 操作记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS actions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  action_time   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  action_type   TEXT NOT NULL,
  campaign_id   TEXT NOT NULL,
  before_value  TEXT,
  after_value   TEXT,
  source        TEXT NOT NULL DEFAULT 'feishu',
  status        TEXT NOT NULL DEFAULT 'pending',
  executed_at   TEXT
);

-- ============================================================
-- 7. feedback - 告警反馈
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_time  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  alert_id       INTEGER,
  response       TEXT NOT NULL DEFAULT 'ignored',
  note           TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (alert_id) REFERENCES alerts(id)
);

-- ============================================================
-- 8. config - 键值配置
-- ============================================================
CREATE TABLE IF NOT EXISTS config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- 9. telemetry - 数据库自监控
-- ============================================================
CREATE TABLE IF NOT EXISTS telemetry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  check_time  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  write_lag_ms INTEGER,                             -- 写入延迟ms
  db_size_mb  REAL,                                 -- 数据库文件大小
  snap_count  INTEGER,                              -- 今日快照数
  wal_size_mb REAL,
  checks_ok   INTEGER NOT NULL DEFAULT 1
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_snapshots_time       ON snapshots(snapshot_time);
CREATE INDEX IF NOT EXISTS idx_snapshots_camp_time  ON snapshots(campaign_id, snapshot_time);
CREATE INDEX IF NOT EXISTS idx_alerts_time          ON alerts(alert_time);
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved    ON alerts(resolved) WHERE resolved = 0;
CREATE INDEX IF NOT EXISTS idx_actions_time         ON actions(action_time);
CREATE INDEX IF NOT EXISTS idx_actions_camp         ON actions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_actions_status       ON actions(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_feedback_alert       ON feedback(alert_id);

-- ============================================================
-- 初始化配置
-- ============================================================
INSERT OR IGNORE INTO config(key, value) VALUES
  ('schema_version', '2.0'),
  ('last_materialized_refresh', '1970-01-01T00:00:00'),
  ('last_backfill', '1970-01-01T00:00:00'),
  ('last_telemetry', '1970-01-01T00:00:00');

-- 记录迁移 (仅插入 v2.0 确保增量迁移能检测到)
INSERT OR IGNORE INTO schema_migrations(version, description) VALUES
  ('1.0', 'v1.0 基础部署 (db/ 旧代码)');

