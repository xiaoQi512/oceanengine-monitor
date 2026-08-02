// scripts/check-db-v2.mjs - 检查当前数据库是否满足 v2 主写条件
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { checkV2Schema } from '../src/db/migration-readiness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '..', 'monitor-data', 'oceanengine.db');

if (!fs.existsSync(dbPath)) {
  console.log('数据库不存在，跳过检查:', dbPath);
  process.exit(0);
}

const db = new Database(dbPath, { readonly: true });
const result = checkV2Schema(db);
db.close();

if (result.ok) {
  console.log(`v2 schema 就绪: ${result.schemaVersion}`);
  process.exit(0);
}

console.error('v2 schema 未就绪:');
console.error('  missingTables:', result.missingTables.join(', ') || '无');
console.error('  missingSnapshotCols:', result.missingSnapshotCols.join(', ') || '无');
console.error('  schemaVersion:', result.schemaVersion || '无');
process.exit(1);
