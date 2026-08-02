-- ============================================================
-- oceanengine.db - 物化视图 DDL v2.0
-- 聚合表: hourly_stats / daily_stats / alert_timeline
-- 刷新: refresh-views.mjs (增量, 基于 config.last_materialized_refresh)
-- ============================================================

-- ============================================================
-- 1. hourly_stats - 按计划x小时聚合
-- ============================================================
CREATE TABLE IF NOT EXISTS hourly_stats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stat_date   TEXT NOT NULL,      -- YYYY-MM-DD
  stat_hour   INTEGER NOT NULL,   -- 0-23 (CST)
  campaign_id TEXT NOT NULL,
  delta_cost  REAL NOT NULL DEFAULT 0,    -- 该小时内增量消耗
  delta_leads INTEGER NOT NULL DEFAULT 0, -- 该小时内增量线索
  peak_cost   REAL NOT NULL DEFAULT 0,    -- 该小时结束时的累计消耗
  snap_count  INTEGER NOT NULL DEFAULT 0, -- 该小时内快照数
  UNIQUE(stat_date, stat_hour, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_hourly_date_camp ON hourly_stats(stat_date, campaign_id);
CREATE INDEX IF NOT EXISTS idx_hourly_date_hour ON hourly_stats(stat_date, stat_hour);

-- ============================================================
-- 2. daily_stats - 按计划x日聚合
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_stats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stat_date   TEXT NOT NULL,       -- YYYY-MM-DD
  campaign_id TEXT NOT NULL,
  total_cost  REAL NOT NULL DEFAULT 0,
  total_leads INTEGER NOT NULL DEFAULT 0,
  avg_ctr     REAL NOT NULL DEFAULT 0,
  avg_cpm     REAL NOT NULL DEFAULT 0,
  avg_cvr     REAL NOT NULL DEFAULT 0,
  peak_hour   INTEGER,             -- 消耗最高小时
  peak_cost   REAL,                -- 最高小时消耗
  snap_count  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(stat_date, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_stats(stat_date);

-- ============================================================
-- 3. alert_timeline - 告警时间线 (按计划x小时聚合)
-- ============================================================
CREATE TABLE IF NOT EXISTS alert_timeline (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stat_date   TEXT NOT NULL,
  stat_hour   INTEGER NOT NULL,
  campaign_id TEXT NOT NULL,
  alert_count INTEGER NOT NULL DEFAULT 0,
  severity_high INTEGER NOT NULL DEFAULT 0,
  severity_crit INTEGER NOT NULL DEFAULT 0,
  UNIQUE(stat_date, stat_hour, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_alerttl_date ON alert_timeline(stat_date);
