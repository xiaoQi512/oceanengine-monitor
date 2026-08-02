// tests/trend-analysis.test.mjs - 趋势检测测试
import assert from 'node:assert';
import { detectTrendsFromLog } from '../src/domain/trend-analysis.mjs';

const log = [
  { time: '2026-08-01T10:00:00Z', avgCPA: 100, speedCurrent: 1 },
  { time: '2026-08-01T10:15:00Z', avgCPA: 110, speedCurrent: 2 },
  { time: '2026-08-01T10:30:00Z', avgCPA: 120, speedCurrent: 3 },
];
const trends = detectTrendsFromLog(log);
assert.strictEqual(trends.cpaTrend.periods, 3);
assert.ok(trends.cpaTrend.changeRate > 0);
assert.ok(trends.spendTrend.changeRate > 0);
assert.deepStrictEqual(detectTrendsFromLog([]), { cpaTrend: null, spendTrend: null });

console.log('\n全部测试通过');
