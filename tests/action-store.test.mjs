// tests/action-store.test.mjs - action 队列与串行锁存储测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, releaseLock, loadQueue, saveQueue, getSnapshotBefore, writeAudit } from '../src/services/action-store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-store-'));
try {
  const lockFile = path.join(dir, 'queue.json.lock');
  const queueFile = path.join(dir, 'queue.json');

  assert.strictEqual(acquireLock({ lockFile }), true);
  assert.strictEqual(acquireLock({ lockFile }), false);
  releaseLock({ lockFile });
  assert.strictEqual(acquireLock({ lockFile }), true);
  releaseLock({ lockFile });

  fs.writeFileSync(lockFile, 'stale');
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(lockFile, old, old);
  assert.strictEqual(acquireLock({ lockFile, now: Date.now() }), true);
  const forced = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
  assert.strictEqual(forced.forced, true);
  releaseLock({ lockFile });

  assert.deepStrictEqual(await loadQueue({ queueFile, retryDelayMs: 0 }), { actions: [] });
  fs.writeFileSync(queueFile, 'invalid');
  assert.deepStrictEqual(await loadQueue({ queueFile, retryDelayMs: 0 }), { actions: [] });
  saveQueue({ actions: [{ id: 1 }] }, { queueFile });
  assert.deepStrictEqual(await loadQueue({ queueFile, retryDelayMs: 0 }), { actions: [{ id: 1 }] });

  fs.writeFileSync(path.join(dir, '5m-2026-08-02T01-30-00.json'), JSON.stringify({ accountSpend: 10, totalConv: 1 }));
  fs.writeFileSync(path.join(dir, '5m-2026-08-02T01-40-00.json'), JSON.stringify({ accountSpend: 20, totalConv: 2 }));
  const snapshot = getSnapshotBefore({ dataDir: dir });
  assert.strictEqual(snapshot.accountSpend, 20);
  assert.strictEqual(snapshot.file, '5m-2026-08-02T01-40-00.json');

  let dbRecord = null;
  const auditFile = path.join(dir, 'action-audit.jsonl');
  writeAudit(
    {
      actionType: 'pause',
      planName: '计划A',
      source: 'manual',
      result: { ok: true, method: 'http_api' },
    },
    {
      auditFile,
      dataDir: dir,
      insertAction: record => { dbRecord = record; return { ok: true }; },
      pid: 99,
    },
  );
  const lines = fs.readFileSync(auditFile, 'utf-8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  const audit = JSON.parse(lines[0]);
  assert.strictEqual(audit.actionType, 'pause');
  assert.strictEqual(audit.source, 'manual');
  assert.strictEqual(audit.workerPid, 99);
  assert.strictEqual(audit.snapshotBefore.accountSpend, 20);
  assert.strictEqual(dbRecord.actionType, 'pause');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
