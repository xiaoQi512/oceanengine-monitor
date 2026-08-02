// tests/db-compat-write.test.mjs - 旧 writer 与 v2 compat 写入一致性测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oec-db-compat-'));
const dbPath = path.join(tmpDir, 'oceanengine.db');
process.env.OCEANENGINE_DB_PATH = dbPath;

const { initDB, closeDB } = await import('../src/db/v2/dal.mjs');
const { insertSnapshot: v2InsertSnapshot } = await import('../src/db/v2/compat-writer.mjs');
const { insertSnapshot: legacyInsertSnapshot, closeDb: legacyCloseDb } = await import('../src/db/writer.mjs');

initDB();

const snapshotTime = '2026-08-02T00:05:00';
const campaign = {
  id: 'c1',
  name: '测试计划',
  status: '投放中',
  rawStatus: '投放中',
  spend: 100,
  conversions: 2,
  leads: 3,
  privateMsgOpen: 3,
  privateMsgRetain: 2,
  formSubmit: 1,
  ctr: 0.02,
  cpm: 10,
  cvr: 0.1,
  liveViews: 100,
  liveOver1Min: 50,
  liveComments: 0,
  budget: '200.00按日预算',
};
const data = {
  time: snapshotTime,
  sourceType: '5min',
  active: [campaign],
  allSpending: [campaign],
  campaigns: [campaign],
};

const legacyResult = legacyInsertSnapshot(data, snapshotTime);
assert.strictEqual(legacyResult.ok, true, JSON.stringify(legacyResult));
assert.strictEqual(legacyResult.rows, 1);

const v2Result = v2InsertSnapshot(data, snapshotTime);
assert.strictEqual(v2Result.ok, true, JSON.stringify(v2Result));
assert.strictEqual(v2Result.rows, 1);

const db = new Database(dbPath, { readonly: true });
const row = db.prepare(`
  SELECT COUNT(*) AS n, COALESCE(SUM(cost), 0) AS cost
  FROM snapshots WHERE snapshot_time = ?
`).get(snapshotTime);
db.close();

assert.strictEqual(row.n, 1);
assert.strictEqual(row.cost, 100);

legacyCloseDb();
closeDB();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('\n全部测试通过');
