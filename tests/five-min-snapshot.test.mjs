// tests/five-min-snapshot.test.mjs - 5min 快照文件加载测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRecent5minSnapshots, saveFiveMinSnapshot } from '../src/services/five-min-snapshot.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'five-min-snapshot-'));
try {
  fs.writeFileSync(path.join(dir, '5m-2026-08-02T01-40-00.json'), JSON.stringify({ value: 1 }));
  fs.writeFileSync(path.join(dir, '5m-2026-08-02T01-35-00.json'), 'invalid');
  fs.writeFileSync(path.join(dir, '5m-2026-08-02T01-30-00.json'), JSON.stringify({ value: 2 }));
  fs.writeFileSync(path.join(dir, 'daily-2026-08-02.json'), JSON.stringify({ value: 3 }));

  const result = loadRecent5minSnapshots(3, { dataDir: dir, getLocalDate: () => '2026-08-02' });
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].value, 1);
  assert.strictEqual(result[1].value, 2);

  assert.deepStrictEqual(
    loadRecent5minSnapshots(3, { dataDir: dir, getLocalDate: () => '2026-08-03' }),
    [],
  );
  assert.deepStrictEqual(
    loadRecent5minSnapshots(3, { dataDir: path.join(dir, 'missing'), getLocalDate: () => '2026-08-02' }),
    [],
  );

  const saved = saveFiveMinSnapshot({
    data: { accountSpend: 5 },
    rolling: { last5min: 2 },
    dataDir: dir,
    nowISO: () => '2026-08-02T02-00-00',
    dualInsertSnapshot: () => ({ ok: true, rows: 2 }),
  });
  assert.deepStrictEqual(saved, { jsonOk: true, sqliteRows: 2 });
  const snap = JSON.parse(fs.readFileSync(path.join(dir, '5m-2026-08-02T02-00-00.json'), 'utf-8'));
  assert.strictEqual(snap.accountSpend, 5);
  assert.deepStrictEqual(snap._rolling, { last5min: 2 });

  const failed = saveFiveMinSnapshot({
    data: { accountSpend: 1 },
    rolling: { last5min: 1 },
    dataDir: path.join(dir, 'missing'),
    nowISO: () => '2026-08-02T02-05-00',
    dualInsertSnapshot: () => { throw new Error('db locked'); },
  });
  assert.deepStrictEqual(failed, { jsonOk: false, sqliteRows: 0 });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
