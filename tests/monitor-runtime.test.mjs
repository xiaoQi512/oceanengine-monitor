// tests/monitor-runtime.test.mjs - 运行日志轮转与收尾刷新测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDataDir, rotateRunLog, refreshMaterializedViews } from '../src/services/monitor-runtime.mjs';

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-runtime-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withTempDir((dir) => {
  const nestedDir = path.join(dir, 'a', 'b');
  ensureDataDir(nestedDir);
  assert.strictEqual(fs.existsSync(nestedDir), true);
  ensureDataDir(nestedDir);

  const logFile = path.join(dir, 'run.log');
  rotateRunLog({ logFile });
  const first = fs.readFileSync(logFile, 'utf-8');
  assert.ok(first.includes('==='));

  fs.writeFileSync(logFile, Buffer.alloc(1024 * 1024 + 100, 0x78));
  rotateRunLog({ logFile });
  const rotated = fs.readFileSync(logFile, 'utf-8');
  assert.ok(rotated.length < 600 * 1024);
  assert.ok(rotated.includes('==='));
});

assert.deepStrictEqual(
  refreshMaterializedViews({ refreshMaterialized: () => ({ ok: true, hours: 1, days: 2, alerts: 3 }) }),
  { ok: true, hours: 1, days: 2, alerts: 3 },
);
assert.deepStrictEqual(
  refreshMaterializedViews({ refreshMaterialized: () => ({ ok: false, error: 'locked' }) }),
  { ok: false, error: 'locked' },
);
assert.deepStrictEqual(
  refreshMaterializedViews({ refreshMaterialized: () => { throw new Error('db down'); } }),
  { ok: false, error: 'db down' },
);

console.log('\n全部测试通过');
