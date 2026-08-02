// tests/snapshot-file.test.mjs - 快照文件模块测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { get5mSnapshots, getSnapFileIndex, findSnapshotAround } from '../src/services/snapshot-file.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-file-'));
try {
  fs.writeFileSync(path.join(dir, '5m-2026-08-02T01-00-00.json'), JSON.stringify({ accountSpend: 10, totalConv: 1, time: '2026-08-02T01:00:00' }));
  assert.strictEqual(get5mSnapshots(1, { dataDir: dir }).length, 1);
  assert.strictEqual(getSnapFileIndex(1000, { dataDir: dir }).length, 1);
  const snap = findSnapshotAround('2026-08-02T01:01:00', 60000, { dataDir: dir });
  assert.strictEqual(snap.accountSpend, 10);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
