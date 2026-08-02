// tests/daily-report-slots.test.mjs - 日报分时段增量测试
import assert from 'node:assert';
import { buildSlotLines } from '../src/services/daily-report-slots.mjs';

const lines = buildSlotLines({
  entries: [
    { time: '2026-08-02T00:00:00Z', totalSpend: 10 },
    { time: '2026-08-02T04:00:00Z', totalSpend: 30 },
  ],
  finalSpend: 30,
  getSlotKeyFn: e => (new Date(e.time).getHours() < 9 ? '🌅 冷启动' : '🔥 午高峰'),
});
assert.ok(lines.some(l => l.includes('冷启动')));

console.log('\n全部测试通过');
