// db/init.mjs — 初始化 oceanengine.db
// 用法: node db/init.mjs
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'monitor-data', 'oceanengine.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function init() {
  // 确保目录存在
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  console.log(`[init] 数据库路径: ${DB_PATH}`);
  const db = new Database(DB_PATH);

  // 启用WAL和外键 (encoding 在 schema.sql 中已设置)
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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
