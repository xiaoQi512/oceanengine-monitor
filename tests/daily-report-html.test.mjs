// tests/daily-report-html.test.mjs - 日报 HTML 构建与落盘测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDailyReportHtml, writeDailyReportHtml } from '../src/services/daily-report-html.mjs';

const entries = [
  { time: '2026-08-02T01:00:00Z', totalSpend: 10, totalConversions: 1, avgCPA: 10, alertCount: 0, timeSlot: '冷启动' },
  { time: '2026-08-02T04:00:00Z', totalSpend: 30, totalConversions: 2, avgCPA: 15, alertCount: 1, timeSlot: '午高峰' },
];
const metrics = {
  finalSpend: 30,
  finalConversions: 2,
  finalCPA: 15,
  effectiveBudget: 1000,
  budgetPct: '3',
  totalAlerts: 1,
  totalLeads: 3,
  openRetainStr: '50.0%',
};
const html = buildDailyReportHtml({
  today: '2026-08-02',
  entries,
  gaps: 1,
  metrics,
  now: new Date('2026-08-02T23:05:00'),
});
assert.ok(html.includes('投放日报'));
assert.ok(html.includes('2 个采样点'));
assert.ok(html.includes('1 次数据断层'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-html-'));
try {
  const result = writeDailyReportHtml({
    today: '2026-08-02',
    entries,
    gaps: 1,
    metrics,
    reportDir: dir,
    logFn: () => {},
  });
  assert.ok(fs.existsSync(result.reportFile));
  assert.ok(fs.existsSync(result.latestFile));
  assert.ok(fs.readFileSync(result.reportFile, 'utf-8').includes('投放日报'));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
