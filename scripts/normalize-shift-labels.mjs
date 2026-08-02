// scripts/normalize-shift-labels.mjs - 补齐排班标签两位小时
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'monitor-data');
const DB_PATH = path.join(DATA_DIR, 'oceanengine.db');

function normalizeShiftLabel(label) {
  const m = String(label || '').match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return String(label || '');
  return `${m[1].padStart(2, '0')}:${m[2]}-${m[3].padStart(2, '0')}:${m[4]}`;
}

function normalizeTime(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(value || '');
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

let cacheFiles = 0;
let cacheLabels = 0;
for (const name of fs.readdirSync(DATA_DIR)) {
  if (!/^shifts-\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
  const file = path.join(DATA_DIR, name);
  const raw = fs.readFileSync(file, 'utf8');
  const hadBom = raw.startsWith('\uFEFF');
  const cleanRaw = raw.replace(/^\uFEFF/, '');
  let data;
  try {
    data = JSON.parse(cleanRaw);
  } catch {
    continue;
  }
  let changed = false;
  if (data.startTime) {
    const next = normalizeTime(data.startTime);
    if (next !== data.startTime) { data.startTime = next; changed = true; }
  }
  if (data.endTime) {
    const next = normalizeTime(data.endTime);
    if (next !== data.endTime) { data.endTime = next; changed = true; }
  }
  for (const shift of data.shifts || []) {
    const next = normalizeShiftLabel(shift.label);
    if (next !== shift.label) { shift.label = next; changed = true; cacheLabels++; }
  }
  if (hadBom || changed) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    cacheFiles++;
  }
}

let dbRows = 0;
try {
  const db = new Database(DB_PATH);
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='shift_metrics'`).get();
  if (exists) {
    const rows = db.prepare(`SELECT id, shift_label FROM shift_metrics`).all();
    const update = db.prepare(`UPDATE shift_metrics SET shift_label=? WHERE id=?`);
    for (const row of rows) {
      const next = normalizeShiftLabel(row.shift_label);
      if (next !== row.shift_label) {
        update.run(next, row.id);
        dbRows++;
      }
    }
  }
  db.close();
} catch (e) {
  console.warn(`[normalize-shift-labels] DB 更新跳过: ${e.message}`);
}

console.log(`[normalize-shift-labels] 缓存文件=${cacheFiles} 标签=${cacheLabels} DB标签=${dbRows}`);
