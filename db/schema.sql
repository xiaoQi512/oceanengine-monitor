-- ============================================================
-- oceanengine.db - 巨量引擎监控数据库 Schema
-- 版本: v2.0  创建: 2026-06-29  最后修改: 2026-07-31
-- 说明: 6张基础表 + 索引；物化视图DDL见 schema-materialized.sql
-- v2.0: snapshots 表新增 source_type / snapshot_cst 列 + idx_snapshots_source 索引
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA encoding = 'UTF-8';

-- ============================================================
-- 1. campaigns - 广告计划主表
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   TEXT NOT NULL UNIQUE,        -- 巨量引擎计划ID
  name          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT '',     -- 启用中/暂停/已删除
  daily_budget  REAL NOT NULL DEFAULT 0,      -- 日预算(元)
  bid           REAL,                          -- oCPM出价
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 2. snapshots - 5min快照明细表 (核心事实表)
-- ============================================================
CREATE TABLE IF NOT EXISTS snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_time     TEXT NOT NULL,             -- ISO时间 (与JSON文件名一致)
  campaign_id       TEXT NOT NULL,             -- 关联campaigns.campaign_id
  cost              REAL NOT NULL DEFAULT 0,   -- 累计消耗
  leads             INTEGER NOT NULL DEFAULT 0,
  conversions       INTEGER NOT NULL DEFAULT 0,
  msg_open          INTEGER NOT NULL DEFAULT 0,   -- 私信打开
  msg_lead          INTEGER NOT NULL DEFAULT 0,   -- 私信留存(留资)
  form_submit       INTEGER NOT NULL DEFAULT 0,
  ctr               REAL NOT NULL DEFAULT 0,
  cpm               REAL NOT NULL DEFAULT 0,
  cvr               REAL NOT NULL DEFAULT 0,
  views             INTEGER NOT NULL DEFAULT 0,   -- 直播间观看
  views_1min        INTEGER NOT NULL DEFAULT 0,   -- 直播间观看1分钟+
  comments          INTEGER NOT NULL DEFAULT 0,
  page_summary_json TEXT,                        -- 页面汇总行原始JSON
  raw_json          TEXT,                        -- 整条campaign原始JSON
  source_type       TEXT NOT NULL DEFAULT '15min', -- 数据来源: 5min/15min
  snapshot_cst      TEXT NOT NULL DEFAULT '',      -- 快照对应北京时间(Y/M/D H:M:S)
  FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
);

-- ============================================================
-- 3. alerts - 告警事件表
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_time   TEXT NOT NULL DEFAULT (datetime('now')),
  alert_type   TEXT NOT NULL,                   -- ctr_low/cpa_high/spike/balance_low...
  severity     TEXT NOT NULL DEFAULT 'medium',  -- low/medium/high/critical
  campaign_id  TEXT,                             -- 关联campaign(可空表示账户级)
  message      TEXT NOT NULL DEFAULT '',
  resolved     INTEGER NOT NULL DEFAULT 0,      -- 0=未解决 1=已解决
  resolved_at  TEXT
);

-- ============================================================
-- 4. actions - 执行/操作记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS actions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  action_time   TEXT NOT NULL DEFAULT (datetime('now')),
  action_type   TEXT NOT NULL,                  -- pause/resume/adjust_budget/adjust_bid
  campaign_id   TEXT NOT NULL,
  before_value  TEXT,                            -- 操作前值(JSON字符串)
  after_value   TEXT,                            -- 操作后值(JSON字符串)
  source        TEXT NOT NULL DEFAULT 'feishu', -- feishu/dashboard/scheduler
  status        TEXT NOT NULL DEFAULT 'pending', -- pending/executing/success/failed
  executed_at   TEXT
);

-- ============================================================
-- 5. feedback - 用户对告警的反馈
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_time  TEXT NOT NULL DEFAULT (datetime('now')),
  alert_id       INTEGER,                        -- 关联alerts.id
  response       TEXT NOT NULL DEFAULT 'ignored', -- yes/no/ignored
  note           TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (alert_id) REFERENCES alerts(id)
);

-- ============================================================
-- 6. config - 键值配置表 (物化视图刷新位等)
-- ============================================================
CREATE TABLE IF NOT EXISTS config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_snapshots_time       ON snapshots(snapshot_time);
CREATE INDEX IF NOT EXISTS idx_snapshots_camp_time  ON snapshots(campaign_id, snapshot_time);
CREATE INDEX IF NOT EXISTS idx_snapshots_source     ON snapshots(source_type);
CREATE INDEX IF NOT EXISTS idx_alerts_time          ON alerts(alert_time);
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved    ON alerts(resolved) WHERE resolved = 0;
CREATE INDEX IF NOT EXISTS idx_actions_time         ON actions(action_time);
CREATE INDEX IF NOT EXISTS idx_actions_camp         ON actions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_actions_status       ON actions(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_feedback_alert       ON feedback(alert_id);

-- 初始化关键配置项
INSERT OR IGNORE INTO config(key, value) VALUES
  ('schema_version', '2.0'),
  ('last_materialized_refresh', '1970-01-01T00:00:00.000Z'),
  ('last_backfill', '1970-01-01T00:00:00.000Z');
