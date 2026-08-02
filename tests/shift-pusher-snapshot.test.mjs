// tests/shift-pusher-snapshot.test.mjs - 换班首场快照修正测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { correctFirstShiftSpend } from '../src/services/shift-pusher-snapshot.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-snapshot-'));
try {
  fs.writeFileSync(path.join(dir, '5m-2026-08-02T12-25-00.json'), JSON.stringify({ accountSpend: 100, totalConv: 5 }));
  const result = correctFirstShiftSpend({
    shift: { label: '09:00-12:30' },
    totalConsume: 10,
    totalLeads: 1,
    cpl: '10.00',
    dataDir: dir,
    logFn: () => {},
  });
  assert.strictEqual(result.totalConsume, 100);
  assert.strictEqual(result.totalLeads, 5);
  assert.strictEqual(result.cpl, '20.00');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
