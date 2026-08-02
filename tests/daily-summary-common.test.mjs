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
  fs.writeFileSync(path.join(dir, 'shifts-2026-08-03.json'), JSON.stringify({
    shifts: [
      { label: '05:30-7:30', anchorName: '张萌' },
      { label: '7:30-9:30', anchorName: '芝芝' },
      { label: '9:30-11:30', anchorName: '张萌' },
      { label: '11:30-13:30', anchorName: '芝芝' },
    ],
  }));
  const cached = getSessionsForDate('2026-08-03', { dataDir: dir });
  assert.strictEqual(cached.length, 4);
  assert.strictEqual(cached[0].start, '05:30');
  assert.strictEqual(cached[1].end, '09:30');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
