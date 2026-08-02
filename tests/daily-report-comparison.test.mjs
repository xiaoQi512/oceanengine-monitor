// tests/daily-report-comparison.test.mjs - 日报对比指标测试
import assert from 'node:assert';
import { computeDailyReportComparisons } from '../src/domain/daily-report-comparison.mjs';

const result = computeDailyReportComparisons({
  finalSpend: 110,
  finalCPA: 55,
  finalConversions: 2,
  recentLogs: [
    { finalSpend: 100, finalCPA: 50, finalConversions: 1 },
  ],
});
assert.strictEqual(result.yoySpend, 10);
assert.strictEqual(result.yoyCPA, 10);
assert.strictEqual(result.vs7Spend, 10);
assert.ok(result.yesterday);
assert.strictEqual(computeDailyReportComparisons({ recentLogs: [] }).avg7, null);

console.log('\n全部测试通过');
