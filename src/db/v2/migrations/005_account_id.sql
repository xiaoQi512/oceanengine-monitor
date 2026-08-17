-- 005: 多账户监控 — 核心表增加 account_id 维度
ALTER TABLE campaigns ADD COLUMN account_id TEXT DEFAULT '';
ALTER TABLE snapshots ADD COLUMN account_id TEXT DEFAULT '';
ALTER TABLE daily_summaries ADD COLUMN account_id TEXT DEFAULT '';
ALTER TABLE shift_metrics ADD COLUMN account_id TEXT DEFAULT '';

INSERT OR IGNORE INTO schema_migrations(version, description) VALUES ('005', '核心表增加 account_id 支持多账户');
