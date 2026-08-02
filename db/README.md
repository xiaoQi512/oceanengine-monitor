# db 兼容目录

生产数据库模块已迁入 `src/db/`。本目录仅保留兼容转发入口：

- `writer.mjs` / `refresh-materialized.mjs`：转发导出
- `init.mjs` / `backfill.mjs`：执行 `src/db/` 中对应脚本
- `src/db/snapshot-db.mjs`：快照场次计算，根目录 `巨量引擎快照数据库/snapshot-db.mjs` 保留兼容入口
- `src/db/v2/`：v2 模块化数据库，根目录 `巨量引擎监控数据库/` 保留兼容入口

新代码应直接引用 `src/db/`，不要再引用根目录 `db/`。
