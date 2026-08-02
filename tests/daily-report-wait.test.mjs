// tests/daily-report-wait.test.mjs - 日报等待与去重测试
import assert from 'node:assert';
import path from 'node:path';
import {
  getDailyReportWaitMs,
  shouldWaitForDailyReport,
  formatDailyReportWaitMs,
  getDailyReportMarkerPath,
  shouldSkipDailyReport,
  writeStartedMarker,
} from '../src/domain/daily-report-wait.mjs';

const now = new Date(2026, 7, 2, 22, 30, 0);
const waitMs = getDailyReportWaitMs({ endHour: 23, endMinute: 0 }, now);
assert.strictEqual(waitMs, 35 * 60 * 1000);
assert.strictEqual(shouldWaitForDailyReport(waitMs), true);
assert.strictEqual(formatDailyReportWaitMs(waitMs), 35);
assert.strictEqual(shouldWaitForDailyReport(70 * 60 * 1000), false);

const markerPath = getDailyReportMarkerPath('data', '2026-08-02', path);
assert.ok(markerPath.endsWith('daily-report-done-2026-08-02.json'));
assert.strictEqual(shouldSkipDailyReport({ markerPath, force: false, existsSyncFn: () => true }), true);
assert.strictEqual(shouldSkipDailyReport({ markerPath, force: true, existsSyncFn: () => true }), false);
let wrote = null;
writeStartedMarker({ markerPath, writeFileSyncFn: (p, data) => { wrote = { p, data }; } });
assert.ok(wrote.data.includes('startedAt'));

console.log('\n全部测试通过');
