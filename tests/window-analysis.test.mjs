// tests/window-analysis.test.mjs - 3小时窗口分析测试
import assert from 'node:assert';
import { analyze3HourWindowFromLog } from '../src/domain/window-analysis.mjs';

const now = new Date('2026-08-01T12:00:00Z').getTime();
const log = [
  { time: '2026-08-01T10:00:00Z', totalSpend: 100, totalConversions: 1, avgCPA: 100, speedCurrent: 1 },
  { time: '2026-08-01T10:30:00Z', totalSpend: 200, totalConversions: 2, avgCPA: 100, speedCurrent: 2 },
  { time: '2026-08-01T11:00:00Z', totalSpend: 350, totalConversions: 3, avgCPA: 110, speedCurrent: 3 },
  { time: '2026-08-01T11:30:00Z', totalSpend: 500, totalConversions: 4, avgCPA: 120, speedCurrent: 4 },
];
const window3h = analyze3HourWindowFromLog(log, now);
assert.ok(window3h.speed.second > window3h.speed.first);
assert.ok(window3h.conversions.second > 0);
assert.strictEqual(analyze3HourWindowFromLog([], now), null);

console.log('\n全部测试通过');
