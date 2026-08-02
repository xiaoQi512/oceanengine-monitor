# 数据库统一入口

`src/db/index.mjs` 是生产数据库的统一转发入口，顶层接口当前指向 v2Compat：

- 顶层 `insertSnapshot` / `verifyConsistency` / `insertAction` / `closeDb`：v2Compat 接口，当前生产基线
- `v2`：v2 DAL / writer / init / backfill 命名空间
- `v2Compat`：与旧 writer 签名一致的 v2 兼容写入层，供双写灰度或直接替换
- `legacy`：旧 writer 命名空间，仅供回退与兼容测试
- `dual-write.mjs`：旧 writer + v2 并行写入包装，默认由 `DB_V2_DUAL_WRITE` 控制
- `snapshot-db.mjs`：快照文件库与班次差值查询

当前 `monitor-data/oceanengine.db` 已应用 v2 schema（含 `shift_metrics`、
`daily_summaries`、`telemetry`、`schema_migrations`），旧 writer 与 v2 兼容层写同一份库。

灰度顺序：

1. `DB_V2_DUAL_WRITE=1`：旧 writer 主写，v2 并行写入对比
2. `DB_V2_PRIMARY`（默认开启）：v2 主写，失败自动回退旧 writer；`DB_V2_PRIMARY=0` 可回退旧模式
3. 确认数据一致后，固定 v2 主写并移除旧 writer 入口

旧 writer 已支持 `OCEANENGINE_DB_PATH` 覆盖，兼容写入测试使用临时库验证两边结果一致。
