// tests/snapshot-store.test.mjs - 快照/日志文件存储测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSnapshot, readDailyLog, loadTodaysSnapshots } from '../src/services/snapshot-store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oec-snapshot-store-'));
try {
  const today = new Date().toISOString().substring(0, 10);
  const file = `${today}T10-00-00.json`;
  fs.writeFileSync(path.join(dir, file), JSON.stringify({ active: [{ id: '1' }], time: `${today}T10:00:00Z` }));

  const snap = readSnapshot(dir, file);
  assert.strictEqual(snap.active.length, 1);

  const todaySnaps = loadTodaysSnapshots(dir);
  assert.strictEqual(todaySnaps.length, 1);
  assert.ok(todaySnaps[0]._time);

  const missing = readDailyLog(path.join(dir, 'missing.json'));
  assert.strictEqual(missing, null);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
