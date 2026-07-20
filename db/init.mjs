// db/init.mjs — 初始化 oceanengine.db
// 用法: node db/init.mjs
// 主要修改: 加入 schema_version 比较逻辑，避免在较新版本的 DB 上盲执行 schema.sql
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'monitor-data', 'oceanengine.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
// 与 schema.sql 中 INSERT OR IGNORE 写入的 schema_version 保持一致；修改 schema.sql 时同步调整
const SCHEMA_VERSION = '1.0';

// 点分版本号比较（如 "1.0" vs "1.10"）
function compareVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function init() {
  // 确保目录存在
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  console.log(`[init] 数据库路径: ${DB_PATH}`);
  const db = new Database(DB_PATH);

  // 启用WAL和外键 (encoding 在 schema.sql 中已设置)
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 检查已有 schema 版本，避免在较新版本上覆盖
  try {
    const row = db.prepare("SELECT value FROM config WHERE key='schema_version'").get();
    if (row) {
      const current = row.value;
      if (compareVersion(current, SCHEMA_VERSION) > 0) {
        console.error(`[init] 数据库 schema_version=${current} 比当前脚本 (${SCHEMA_VERSION}) 新，终止执行`);
        console.error('[init] 请使用匹配的 schema.sql 版本');
        db.close();
        process.exit(1);
      }
      if (current === SCHEMA_VERSION) {
        console.log(`[init] schema_version=${current} 已是最新，跳过执行`);
        db.close();
        return;
      }
      console.log(`[init] schema_version=${current} → ${SCHEMA_VERSION}，执行迁移...`);
    }
  } catch {
    // config 表不存在 → 首次初始化，继续
  }

  // 执行schema.sql (better-sqlite3 的 exec 支持多语句)
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(sql);
  console.log('[init] schema.sql 执行完成');

  // 验证表已创建
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  console.log(`[init] 已建表: ${tables.join(', ')}`);

  const indexes = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
  ).all().map(r => r.name);
  console.log(`[init] 已建索引: ${indexes.length} 个`);

  db.close();
  console.log('[init] 完成');
}

init();
