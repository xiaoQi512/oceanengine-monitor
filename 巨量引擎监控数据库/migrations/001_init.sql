-- 版本 2.0 初始迁移记录
INSERT OR IGNORE INTO schema_migrations(version, applied_at, description) VALUES
  ('2.0', datetime('now','localtime'), 'v2.0 初始部署: schema+views+migrations');
