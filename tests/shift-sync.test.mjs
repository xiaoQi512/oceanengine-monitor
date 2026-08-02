// tests/shift-sync.test.mjs - 次日排班同步核心测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getTomorrowDate, fetchShifts, saveCache } from '../src/services/shift-sync.mjs';
import { parseShiftRowsByDate } from '../src/services/shift-sheet-reader.mjs';

const d = new Date(2026, 7, 2, 10, 0, 0);
assert.strictEqual(
  getTomorrowDate({ getLocalDateFn: date => {
    date.setDate(date.getDate());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  } }),
  '2026-08-03',
);

const data = fetchShifts('2026-08-03', {
  fetchShiftRowsByDateFn: () => [
    { label: '09:00-12:00', hours: [9, 10, 11], row: 200, anchorName: '主播A' },
    { label: '14:00-18:00', hours: [14, 15, 16, 17], row: 201, anchorName: '主播B' },
  ],
});
assert.strictEqual(data.shifts.length, 2);
assert.strictEqual(data.shifts[0].anchorName, '主播A');
assert.strictEqual(data.startTime, '09:00');

const parsedByDate = parseShiftRowsByDate(
  '[row=500] 8月2日,05:30-07:30,张萌\n[row=507] 8月2日,19:30-21:30,李咪',
  '2026-08-02'
);
assert.strictEqual(parsedByDate.length, 2);
assert.strictEqual(parsedByDate.find(s => s.row === 507).anchorName, '李咪');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-sync-'));
try {
  assert.strictEqual(saveCache('2026-08-03', data, { dataDir: dir }), true);
  const cached = JSON.parse(fs.readFileSync(path.join(dir, 'shifts-2026-08-03.json'), 'utf-8'));
  assert.strictEqual(cached.shifts.length, 2);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
