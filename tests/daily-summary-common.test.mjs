// tests/daily-summary-common.test.mjs - 日汇总公共工具测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSessionsForDate, getTodayDateStr } from '../src/services/daily-summary-common.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-summary-common-'));
try {
  const sessions = getSessionsForDate('2026-08-02', { dataDir: dir });
  assert.strictEqual(sessions.length, 9);
  assert.match(getTodayDateStr(), /^\d{4}-\d{2}-\d{2}$/);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
