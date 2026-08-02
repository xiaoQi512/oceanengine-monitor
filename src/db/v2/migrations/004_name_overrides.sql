-- 004: 添加 name_overrides 表 — 广告计划名称覆盖
CREATE TABLE IF NOT EXISTS name_overrides (
  name_pattern TEXT NOT NULL,
  replacement  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (name_pattern)
);

INSERT OR IGNORE INTO schema_migrations(version, description) VALUES ('004', '添加 name_overrides 表');
