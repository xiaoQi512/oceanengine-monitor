// tests/shift-pusher-eod.test.mjs - shift-pusher 日终任务触发测试
import assert from 'node:assert';
import { triggerEndOfDayTasks } from '../src/services/shift-pusher-eod.mjs';

let spawned = [];
let scheduled = [];
const shift = { label: '20:00-23:00' };
const shifts = [
  { label: '09:00-12:00' },
  { label: '20:00-23:00' },
];

await triggerEndOfDayTasks({
  shift,
  todayShifts: shifts,
  getShiftEndMinutes: s => Number(s.label.slice(6, 8)) * 60 + Number(s.label.slice(9, 11)),
  getLocalDateFn: () => '2026-08-02',
  logFn: () => {},
  setTimeoutFn: (fn, delay) => scheduled.push({ fn, delay }),
  spawnFn: (nodeExe, args) => {
    spawned.push({ nodeExe, args });
    return { unref() {} };
  },
});

assert.strictEqual(scheduled.length, 4);
assert.strictEqual(spawned.length, 0);
assert.strictEqual(scheduled[0].delay, 0);
assert.ok(scheduled[3].delay > scheduled[2].delay);
scheduled[0].fn();
assert.strictEqual(spawned.length, 1);
assert.ok(spawned[0].args[0].endsWith('cron-sync-shifts-cli.mjs'));

console.log('\n全部测试通过');
