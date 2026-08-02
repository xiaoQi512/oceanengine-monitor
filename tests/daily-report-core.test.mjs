// tests/daily-report-core.test.mjs - 日报对比与卡片构建测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRecentLogs, getSlotKey, buildDailyReportCard } from '../src/services/daily-report-core.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-report-'));
try {
  fs.writeFileSync(path.join(dir, 'daily-2026-08-01.json'), JSON.stringify([
    { type: 'data_gap' },
    { totalSpend: 100, totalConversions: 2, totalLeads: 2 },
  ]));
  const logs = loadRecentLogs(7, { dataDir: dir });
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].finalSpend, 100);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

assert.strictEqual(getSlotKey({ time: '2026-08-02T00:00:00Z' }), '🌅 冷启动');
assert.strictEqual(getSlotKey({ time: '2026-08-02T04:00:00Z' }), '🔥 午高峰');

const card = JSON.parse(buildDailyReportCard({
  today: '2026-08-02',
  entries: [{ time: '2026-08-02T01:00:00Z' }],
  gaps: 1,
  freshData: false,
  finalSpend: 100,
  effectiveBudget: 1000,
  budgetPct: '10',
  finalConversions: 2,
  totalLeads: 2,
  finalCPA: 50,
  openRetainStr: 'N/A',
  totalAlerts: 1,
  slotLines: ['🌅 冷启动 → ¥100'],
  insightLines: [],
}));
assert.strictEqual(card.header.title.content.includes('投放日报'), true);
assert.ok(card.elements.some(e => e.tag === 'hr'));

console.log('\n全部测试通过');
