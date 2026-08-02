// tests/five-min-push-state.test.mjs - 5min last-push 状态与频率判断测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLastPushState, saveLastPushState, shouldPushFiveMin } from '../src/services/five-min-push-state.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'five-min-push-state-'));
try {
  const file = path.join(dir, 'last-5m-push.json');
  assert.deepStrictEqual(loadLastPushState({ dataDir: dir }), {});
  assert.strictEqual(saveLastPushState({ dataDir: dir, timestamp: 123 }), true);
  assert.deepStrictEqual(loadLastPushState({ dataDir: dir }), { timestamp: 123 });
  assert.strictEqual(fs.existsSync(file), true);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

assert.strictEqual(shouldPushFiveMin({ lastPush: {}, now: 61_000 }).push, true);
assert.strictEqual(shouldPushFiveMin({ lastPush: { timestamp: 1000 }, now: 1000 }).push, false);
assert.strictEqual(shouldPushFiveMin({ lastPush: { timestamp: 1000 }, now: 2000, minIntervalMs: 1000 }).push, true);

console.log('\n全部测试通过');
