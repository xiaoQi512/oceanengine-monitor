// tests/daily-report-data.test.mjs - 日报数据读取与指标汇总测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDailyEntries, buildDailyReportMetrics } from '../src/services/daily-report-data.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-report-data-'));
try {
  fs.writeFileSync(path.join(dir, 'daily-2026-08-02.json'), JSON.stringify([
    { type: 'data_gap' },
    { totalSpend: 100, totalConversions: 2, totalLeads: 2, accountBudget: 1000, alertCount: 1, openRetainRate: 0.5 },
  ]));
  const { entries, gaps } = loadDailyEntries({ today: '2026-08-02', dataDir: dir });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(gaps, 1);
  const metrics = buildDailyReportMetrics({ entries });
  assert.strictEqual(metrics.finalSpend, 100);
  assert.strictEqual(metrics.budgetPct, '10');

  assert.throws(
    () => loadDailyEntries({ today: '2026-08-03', dataDir: dir, logFn: () => {} }),
    /未找到当日数据文件/,
  );
  fs.writeFileSync(path.join(dir, 'daily-2026-08-04.json'), 'invalid');
  assert.throws(
    () => loadDailyEntries({ today: '2026-08-04', dataDir: dir, logFn: () => {} }),
    /日志解析失败/,
  );
  fs.writeFileSync(path.join(dir, 'daily-2026-08-05.json'), JSON.stringify([{ type: 'data_gap' }]));
  assert.throws(
    () => loadDailyEntries({ today: '2026-08-05', dataDir: dir, logFn: () => {} }),
    /当日无有效采样数据/,
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n全部测试通过');
