// src/services/five-min-snapshot.mjs - 5min 快照文件加载
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getLocalDate } from '../utils/monitor-utils.mjs';

function defaultNowISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export function loadRecent5minSnapshots(limit = 3, { dataDir = DATA_DIR, getLocalDate: localDate = getLocalDate } = {}) {
  const today = localDate();
  try {
    const files = fs.readdirSync(dataDir)
      .filter(f => f.startsWith('5m-') && f.includes(today))
      .sort()
      .reverse();
    return files.slice(0, limit).map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8')); }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

import { writeAccountSnapshot } from './db-writer.mjs';

export function saveFiveMinSnapshot({
  data,
  rolling,
  dataDir = DATA_DIR,
  nowISO = defaultNowISO,
  dualInsertSnapshot,
}) {
  const snapData = { ...data, _rolling: rolling };
  const file = path.join(dataDir, `5m-${nowISO()}.json`);
  let jsonOk = false;
  let sqliteRows = 0;

  try {
    fs.writeFileSync(file, JSON.stringify(snapData, null, 2), 'utf-8');
    jsonOk = true;
  } catch (e) {
    console.warn(`  ⚠ JSON 快照写入失败: ${e.message}`);
  }

  try {
    // 统一数据层: 账户页头落库 (UPSERT 幂等)
    try {
      writeAccountSnapshot({ account_id: process.env.OEC_ACCOUNT_ID || '1842681352509635', snapshot_time: nowISO(), data });
    } catch (e) { console.warn('  ⚠ 账户页头落库失败:', e.message); }
    const r = dualInsertSnapshot(snapData);
    if (r.ok && r.rows > 0) {
      sqliteRows = r.rows;
      console.log(`  📊 SQLite双写: ${r.rows} 条`);
    }
  } catch (e) {
    console.warn(`  ⚠ SQLite 双写失败: ${e.message}`);
  }

  return { jsonOk, sqliteRows };
}
