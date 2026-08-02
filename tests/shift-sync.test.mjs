// tests/shift-sync.test.mjs - 次日排班同步核心测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getTomorrowDate, fetchShifts, saveCache } from '../src/services/shift-sync.mjs';

const d = new Date(2026, 7, 2, 10, 0, 0);
assert.strictEqual(
  getTomorrowDate({ getLocalDateFn: date => {
    date.setDate(date.getDate());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  } }),
  '2026-08-03',
);

const data = fetchShifts('2026-08-03', {
  findLarkCliFn: () => 'lark.exe',
  getShiftRowForDateFn: () => 200,
  getShiftsPerDayFn: () => 2,
  execFileSyncFn: () => JSON.stringify({
    data: {
      annotated_csv: '09:00-12:00,主播A\n14:00-18:00,主播B',
    },
  }),
});
assert.strictEqual(data.shifts.length, 2);
assert.strictEqual(data.shifts[0].anchorName, '主播A');
assert.strictEqual(data.startTime, '09:00');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-sync-'));
try {
  assert.strictEqual(saveCache('2026-08-03', data, { dataDir: dir }), true);
  const cached = JSON.parse(fs.readFileSync(path.join(dir, 'shifts-2026-08-03.json'), 'utf-8'));
  assert.strictEqual(cached.shifts.length, 2);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
