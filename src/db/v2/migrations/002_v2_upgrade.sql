-- 002: v1.0 → v2.0 增量升级
-- 仅执行增量操作，基础表由 schema.sql 的 CREATE TABLE IF NOT EXISTS 覆盖

-- 新增列: snapshots.source_type (积累数据默认标记为15min)
ALTER TABLE snapshots ADD COLUMN source_type TEXT NOT NULL DEFAULT '15min';

-- 新增列: snapshots.snapshot_cst (回填为空)
ALTER TABLE snapshots ADD COLUMN snapshot_cst TEXT NOT NULL DEFAULT '';

-- 新增索引
CREATE INDEX IF NOT EXISTS idx_snapshots_source ON snapshots(source_type);
CREATE INDEX IF NOT EXISTS idx_shift_date ON shift_metrics(date);

-- 更新配置版本
INSERT OR REPLACE INTO config(key, value) VALUES ('schema_version', '2.0');
INSERT OR IGNORE INTO schema_migrations(version, description) VALUES ('2.0', '增量升级: snapshots+2列/2索引');
