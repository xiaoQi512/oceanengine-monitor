// tests/shift-pusher-state.test.mjs - shift-pusher 日志与推送锁状态测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCarModel, isAlreadyPushed, markPushed, todayDateCN } from '../src/services/shift-pusher-state.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-state-'));
try {
  const lockFile = path.join(dir, 'lock.json');
  assert.strictEqual(isAlreadyPushed('09:00-10:00', { lockFile, getLocalDateFn: () => '2026-08-02' }), false);
  markPushed('09:00-10:00', {
    lockFile,
    getLocalDateFn: () => '2026-08-02',
    atomicWriteFn: (file, data) => fs.writeFileSync(file, JSON.stringify(data)),
  });
  assert.strictEqual(isAlreadyPushed('09:00-10:00', { lockFile, getLocalDateFn: () => '2026-08-02' }), true);
  assert.strictEqual(isAlreadyPushed('09:00-10:00', { lockFile, getLocalDateFn: () => '2026-08-03' }), false);
  assert.strictEqual(typeof todayDateCN(), 'string');
  assert.strictEqual(getCarModel({ getLocalDateFn: () => '2026-08-02' }), '贝塔S3');
  assert.strictEqual(getCarModel({ getLocalDateFn: () => '2026-06-30' }), '问道V9');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
