// scripts/backup-db.mjs - SQLite 在线备份脚本
// 用法:
//   node scripts/backup-db.mjs                     # 立即执行一次备份
//   node scripts/backup-db.mjs --verify            # 备份后执行完整性校验
// 环境变量:
//   OCEANENGINE_DB_PATH      源数据库路径，默认 monitor-data/oceanengine.db
//   BACKUP_DIR               备份目录，默认 monitor-data/backups
//   BACKUP_KEEP_DAILY        保留日备份数，默认 14
//   BACKUP_KEEP_WEEKLY       保留周备份数，默认 4
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import '../src/config/index.mjs'; // 触发 .env 加载

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.OCEANENGINE_DB_PATH || path.join(PROJECT_ROOT, 'monitor-data', 'oceanengine.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(PROJECT_ROOT, 'monitor-data', 'backups');
const KEEP_DAILY = Number(process.env.BACKUP_KEEP_DAILY || '14');
const KEEP_WEEKLY = Number(process.env.BACKUP_KEEP_WEEKLY || '4');

function log(...args) {
  console.log(`[backup-db] ${new Date().toLocaleString('zh-CN', { hour12: false })} |`, ...args);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => /^oceanengine-(\d{4}-\d{2}-\d{2})(?:-w\d+)?\.db$/.test(f))
    .sort();
}

function isWeeklyBackup(file) {
  return /-w\d+\.db$/.test(file);
}

function cleanupOldBackups() {
  const files = listBackups();
  const daily = files.filter(f => !isWeeklyBackup(f));
  const weekly = files.filter(f => isWeeklyBackup(f));

  // 保留最近 N 个日备份
  const removeDaily = daily.slice(0, Math.max(0, daily.length - KEEP_DAILY));
  for (const f of removeDaily) {
    const p = path.join(BACKUP_DIR, f);
    try { fs.unlinkSync(p); log(`清理旧日备份: ${f}`); } catch (e) { log(`清理失败: ${f} ${e.message}`); }
  }

  // 保留最近 N 个周备份（每周日自动生成）
  const removeWeekly = weekly.slice(0, Math.max(0, weekly.length - KEEP_WEEKLY));
  for (const f of removeWeekly) {
    const p = path.join(BACKUP_DIR, f);
    try { fs.unlinkSync(p); log(`清理旧周备份: ${f}`); } catch (e) { log(`清理失败: ${f} ${e.message}`); }
  }
}

function verifyBackup(backupFile) {
  log(`校验备份完整性: ${backupFile}`);
  let db = null;
  try {
    db = new Database(backupFile, { readonly: true, fileMustExist: true });
    const result = db.pragma('integrity_check');
    const ok = result.length === 1 && result[0].integrity_check === 'ok';
    const size = fs.statSync(backupFile).size;
    log(`  完整性: ${ok ? 'OK' : 'FAIL'} | 大小: ${(size / 1024 / 1024).toFixed(1)} MB`);
    return ok;
  } catch (e) {
    log(`  校验异常: ${e.message}`);
    return false;
  } finally {
    if (db) { try { db.close(); } catch {} }
  }
}

function createBackup() {
  if (!fs.existsSync(DB_PATH)) {
    log(`源数据库不存在: ${DB_PATH}`);
    process.exit(1);
  }

  ensureDir(BACKUP_DIR);
  const date = todayStr();
  const dayOfWeek = new Date().getDay(); // 0=周日
  const isSunday = dayOfWeek === 0;
  const suffix = isSunday ? `-w${String(Math.floor(Date.now() / (7 * 24 * 3600 * 1000)) % 52 + 1)}` : '';
  const backupFile = path.join(BACKUP_DIR, `oceanengine-${date}${suffix}.db`);

  if (fs.existsSync(backupFile)) {
    log(`今日备份已存在，覆盖: ${backupFile}`);
  }

  log(`开始备份: ${DB_PATH}`);
  log(`目标: ${backupFile}`);

  let db = null;
  try {
    // 使用 better-sqlite3 在线备份 API，WAL 模式下也安全
    db = new Database(DB_PATH);
    db.backup(backupFile)
      .then(() => {
        db.close();
        db = null;
        log('备份完成');
        const ok = verifyBackup(backupFile);
        if (!ok) {
          log('备份校验失败，删除无效备份');
          try { fs.unlinkSync(backupFile); } catch {}
          process.exit(1);
        }
        cleanupOldBackups();
        process.exit(0);
      })
      .catch(e => {
        log(`备份失败: ${e.message}`);
        if (db) { try { db.close(); } catch {} }
        process.exit(1);
      });
  } catch (e) {
    log(`初始化备份失败: ${e.message}`);
    if (db) { try { db.close(); } catch {} }
    process.exit(1);
  }
}

createBackup();
