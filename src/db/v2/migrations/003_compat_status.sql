-- 003: 兼容旧生产 writer 的 snapshots.status 列
ALTER TABLE snapshots ADD COLUMN status TEXT;
CREATE INDEX IF NOT EXISTS idx_snapshots_status ON snapshots(status);
