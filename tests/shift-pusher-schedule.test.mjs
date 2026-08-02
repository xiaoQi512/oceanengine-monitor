// tests/shift-pusher-schedule.test.mjs - shift-pusher 排班读取与结束检测测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTodayShifts, getShiftEndMinutes, isShiftEnded } from '../src/services/shift-pusher-schedule.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-schedule-'));
try {
  fs.writeFileSync(path.join(dir, 'shifts-2026-08-02.json'), JSON.stringify({
    shifts: [{ label: '09:00-12:00', hours: [9, 10, 11], row: 200 }],
  }));
  const cached = readTodayShifts({
    dataDir: dir,
    getLocalDateFn: () => '2026-08-02',
    logFn: () => {},
  });
  assert.strictEqual(cached[0].label, '09:00-12:00');

  assert.strictEqual(getShiftEndMinutes({ label: '09:00-12:30' }), 750);
  assert.strictEqual(isShiftEnded({ label: '09:00-12:30' }, new Date(2026, 7, 2, 12, 35)), true);
  assert.strictEqual(isShiftEnded({ label: '09:00-12:30' }, new Date(2026, 7, 2, 13, 1)), false);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
