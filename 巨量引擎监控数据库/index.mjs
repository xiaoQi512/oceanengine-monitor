// index.mjs - 巨量引擎监控数据库 统一入口
//
// 结构:
//   巨量引擎监控数据库/
//   ├── schema.sql           # 基础表 DDL (9表 + 13索引)
//   ├── schema-views.sql     # 物化视图 DDL (3聚合表)
//   ├── migrations/          # Schema 版本迁移
//   ├── dal.mjs              # 数据访问层 (connect/getDB/query)
//   ├── writer.mjs           # 双写 (JSON + SQLite)
//   ├── backfill.mjs         # 历史回灌
//   ├── refresh-views.mjs    # 物化刷新
//   └── index.mjs            # 本文件
//
// 用法:
//   import { connect, getDB } from './巨量引擎监控数据库/index.mjs';
//   const db = connect();
//   const rows = db.shifts.stats({ anchor: '三水', dateFrom: '2026-07-01', dateTo: '2026-07-10' });

// DAL 核心
export { initDB, getDB, getDBPath, closeDB, connect, createAPI } from './dal.mjs';

// 双写
export { insertSnapshot, insertShiftMetric, insertDailySummary, verifyConsistency } from './writer.mjs';

// 便捷查询 (启动后自动初始化)
export function quick() {
  const api = connect();
  return {
    // 主播本月汇总
    anchor: (name, month) => api.shifts.query({ anchor: name, month }),
    anchorStats: (name, from, to) => api.shifts.stats({ anchor: name, dateFrom: from, dateTo: to }),
    // 今日快照数
    todaySnaps: () => api.snapshots.count(new Date().toISOString().slice(0, 10)),
    // 某天汇总
    daily: (date) => api.daily.get(date),
    // 活跃计划
    campaigns: () => api.campaigns.list({ status: '启用' }),
  };
}
