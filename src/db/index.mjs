// src/db/index.mjs - 数据库统一入口（过渡期）
// 当前生产入口以 v2Compat 为主；旧 writer 收敛到 legacy 命名空间供回退与双写使用。
export {
  insertSnapshot,
  verifyConsistency,
  insertAction,
  closeDb,
} from './v2/compat-writer.mjs';
export {
  refreshMaterialized,
  closeDb as closeMaterializedDb,
} from './refresh-materialized.mjs';
export * as v2 from './v2/index.mjs';
export * as v2Compat from './v2/compat-writer.mjs';
export * as legacy from './writer.mjs';
export * from './snapshot-db.mjs';
