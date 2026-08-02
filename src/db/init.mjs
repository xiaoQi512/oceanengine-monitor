// db/init.mjs — 初始化 oceanengine.db
// 用法: node db/init.mjs
// 主要修改: 加入 schema_version 比较逻辑，避免在较新版本的 DB 上盲执行 schema.sql
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DB_PATH = path.join(PROJECT_ROOT, 'monitor-data', 'oceanengine.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
// 与 schema.sql 中 INSERT OR IGNORE 写入的 schema_version 保持一致；修改 schema.sql 时同步调整
const SCHEMA_VERSION = '2.0';

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

// 按 SQL 语句拆分：处理 -- 行注释和 '...' 字符串内的分号，避免误分割
function splitSqlStatements(sql) {
  const stmts = [];
  let cur = '', inStr = false, inComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1];
    if (inComment) {
      if (ch === '\n') inComment = false;
      continue;
    }
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (next === "'") { cur += next; i++; }   // '' 转义
        else inStr = false;
      }
      continue;
    }
    if (ch === '-' && next === '-') { inComment = true; i++; continue; }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === ';') { stmts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts.filter(Boolean);
}

function init() {
  // 确保目录存在
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  console.log(`[init] 数据库路径: ${DB_PATH}`);
  const db = new Database(DB_PATH);

  // 启用WAL和外键 (encoding 在 schema.sql 中已设置)
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 检查已有 schema 版本：数据库比脚本新则终止；否则始终执行 schema.sql（幂等）+ 迁移系统（跳过已应用）
  try {
    const row = db.prepare("SELECT value FROM config WHERE key='schema_version'").get();
    if (row && compareVersion(row.value, SCHEMA_VERSION) > 0) {
      console.error(`[init] 数据库 schema_version=${row.value} 比当前脚本 (${SCHEMA_VERSION}) 新，终止执行`);
      console.error('[init] 请使用匹配的 schema.sql 版本');
      db.close();
      process.exit(1);
    }
  } catch {
    // config 表不存在 → 首次初始化，继续
  }

  // 执行schema.sql (better-sqlite3 的 exec 支持多语句)
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(sql);
  console.log('[init] schema.sql 执行完成');

  // ==== 迁移系统 ====
  // 确保 schema_migrations 表存在
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT NOT NULL DEFAULT ''
  )`);

  // 读取已应用的迁移版本，跳过已执行的
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map(r => r.version)
  );
  const migrationsDir = path.join(__dirname, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const v = file.replace(/\.sql$/, '');
      if (applied.has(v)) {
        console.log(`[init] 迁移 ${v} 已应用，跳过`);
        continue;
      }
      console.log(`[init] 应用迁移: ${v}`);
      const migrationSql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      // 逐语句执行：幂等类错误（列/索引已存在）跳过，其余失败计入 errs
      let ok = 0, skipped = 0, errs = 0;
      for (const stmt of splitSqlStatements(migrationSql)) {
        try {
          db.exec(stmt + ';');
          ok++;
        } catch (e) {
          const msg = e.message || '';
          if (msg.includes('duplicate column name') || msg.includes('already exists')) {
            skipped++;
            console.log(`[init]   ↪ [${v}] 幂等跳过: ${msg.slice(0, 80)}`);
          } else {
            errs++;
            console.error(`[init]   ❌ [${v}] 语句失败: ${msg.slice(0, 120)}`);
          }
        }
      }
      if (errs > 0) {
        console.error(`[init] ❌ 迁移 ${v} 存在 ${errs} 条失败语句，本次不记录版本，下次启动会重试`);
      } else {
        db.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)").run(v);
        console.log(`[init]   ✅ ${v} 完成 (${ok} 成功, ${skipped} 幂等跳过)`);
      }
    }
  }

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
