-- 002: v1.0 → v2.0 增量升级
-- 仅在基础表由 schema.sql CREATE TABLE IF NOT EXISTS 覆盖后执行增量操作
-- runner 按语句逐条执行，单语句失败不中断后续

-- 新增列: snapshots.source_type (积累数据默认标记为15min)
ALTER TABLE snapshots ADD COLUMN source_type TEXT NOT NULL DEFAULT '15min';

-- 新增列: snapshots.snapshot_cst
ALTER TABLE snapshots ADD COLUMN snapshot_cst TEXT NOT NULL DEFAULT '';

-- 新增索引
CREATE INDEX IF NOT EXISTS idx_snapshots_source ON snapshots(source_type);
-- 注: idx_shift_date 索引依赖 shift_metrics 表，该表定义在巨量引擎监控数据库/schema.sql
-- 此迁移仅针对 db/ 路径下的 snapshots 表增量

-- 更新配置版本
INSERT OR REPLACE INTO config(key, value) VALUES ('schema_version', '2.0');
INSERT OR IGNORE INTO schema_migrations(version, description) VALUES ('002', '增量升级: snapshots+2列/1索引');
