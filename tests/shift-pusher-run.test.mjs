// tests/shift-pusher-run.test.mjs - shift-pusher 轮询与主入口测试
import assert from 'node:assert';
import { ensureTodayShifts, pollOnce, runShiftPusherMain } from '../src/services/shift-pusher-run.mjs';

ensureTodayShifts({
  getLocalDateFn: () => '2026-08-02',
  readTodayShiftsFn: () => [{ label: '09:00-12:00', hours: [9, 10, 11], row: 200 }],
  logFn: () => {},
});

let shifted = [];
await pollOnce({
  runShift: async shift => shifted.push(shift.label),
  force: true,
  now: new Date(2026, 7, 2, 12, 10),
  isShiftEndedFn: () => true,
  isAlreadyPushedFn: () => false,
  logErrorFn: () => {},
});
assert.deepStrictEqual(shifted, ['09:00-12:00']);

let forced = [];
await runShiftPusherMain({
  runShift: async shift => forced.push(shift.label),
  force: true,
  shiftLabel: '09:00-12:00',
  dataDir: '',
  mkdirSync: () => {},
  logFn: () => {},
});
assert.deepStrictEqual(forced, ['09:00-12:00']);

console.log('\n全部测试通过');
