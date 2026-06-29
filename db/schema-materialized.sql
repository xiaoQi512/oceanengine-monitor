-- ============================================================
-- schema-materialized.sql - 物化视图(聚合表) DDL
-- 版本: v1.0  创建: 2026-06-29
-- 说明: 3张聚合表，由 db/refresh-materialized.mjs 增量刷新
-- ============================================================

-- ============================================================
-- 1. hourly_stats - 每小时聚合 (按计划×小时)
-- ============================================================
CREATE TABLE IF NOT EXISTS hourly_stats (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  stat_date     TEXT NOT NULL,                 -- 2026-06-28
  stat_hour     TEXT NOT NULL,                 -- 2026-06-28T14
  campaign_id   TEXT NOT NULL,
  cost          REAL NOT NULL DEFAULT 0,       -- 小时内增量消耗 (末值-首值)
  leads         INTEGER NOT NULL DEFAULT 0,
  conversions   INTEGER NOT NULL DEFAULT 0,
  msg_open      INTEGER NOT NULL DEFAULT 0,
  msg_lead      INTEGER NOT NULL DEFAULT 0,
  form_submit   INTEGER NOT NULL DEFAULT 0,
  views         INTEGER NOT NULL DEFAULT 0,
  views_1min    INTEGER NOT NULL DEFAULT 0,
  comments      INTEGER NOT NULL DEFAULT 0,
  samples       INTEGER NOT NULL DEFAULT 0,    -- 快照样本数
  first_time    TEXT,
  last_time     TEXT,
  UNIQUE(stat_hour, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_hourly_date  ON hourly_stats(stat_date);
CREATE INDEX IF NOT EXISTS idx_hourly_camp  ON hourly_stats(campaign_id, stat_date);

-- ============================================================
-- 2. daily_stats - 每日聚合 (按计划×日)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_stats (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  stat_date     TEXT NOT NULL,                 -- 2026-06-28
  campaign_id   TEXT NOT NULL,
  cost          REAL NOT NULL DEFAULT 0,       -- 当日增量消耗
  leads         INTEGER NOT NULL DEFAULT 0,
  conversions   INTEGER NOT NULL DEFAULT 0,
  msg_open      INTEGER NOT NULL DEFAULT 0,
  msg_lead      INTEGER NOT NULL DEFAULT 0,
  form_submit   INTEGER NOT NULL DEFAULT 0,
  views         INTEGER NOT NULL DEFAULT 0,
  views_1min    INTEGER NOT NULL DEFAULT 0,
  comments      INTEGER NOT NULL DEFAULT 0,
  samples       INTEGER NOT NULL DEFAULT 0,
  first_time    TEXT,
  last_time     TEXT,
  avg_ctr       REAL NOT NULL DEFAULT 0,       -- 当日CTR均值
  avg_cpm       REAL NOT NULL DEFAULT 0,
  avg_cvr       REAL NOT NULL DEFAULT 0,
  UNIQUE(stat_date, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_stats(stat_date);
CREATE INDEX IF NOT EXISTS idx_daily_camp ON daily_stats(campaign_id, stat_date);

-- ============================================================
-- 3. alert_timeline - 告警时间线 (按计划×小时聚合告警)
-- ============================================================
CREATE TABLE IF NOT EXISTS alert_timeline (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  stat_date     TEXT NOT NULL,
  stat_hour     TEXT NOT NULL,                 -- 2026-06-28T14
  campaign_id   TEXT,                           -- 可空(账户级告警)
  alert_count   INTEGER NOT NULL DEFAULT 0,
  severities    TEXT NOT NULL DEFAULT '',       -- 逗号分隔: low,medium,high
  first_alert   TEXT,
  last_alert    TEXT,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(stat_hour, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_timeline_date ON alert_timeline(stat_date);
