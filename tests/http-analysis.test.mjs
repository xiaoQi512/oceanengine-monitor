// tests/http-analysis.test.mjs - http-server 数据计算辅助测试
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyDeliveryType,
  summarizeGroup,
  parseSnapshotTime,
  extractRules,
  extractConditionRange,
  get5mSnapshots,
  getSnapFileIndex,
  getRecentAlerts,
  sanitize,
  escHtml,
} from '../src/services/http-analysis.mjs';

assert.strictEqual(classifyDeliveryType('简单投-1'), '简单投');
assert.strictEqual(classifyDeliveryType('画面直投-2'), '画面直投');

const group = summarizeGroup([
  { spend: 10, leads: 2, status: '投放中' },
  { spend: 20, leads: 0, status: '已暂停' },
], '测试组');
assert.strictEqual(group.spend, 30);
assert.strictEqual(group.active, 1);
assert.strictEqual(group.paused, 1);

assert.strictEqual(parseSnapshotTime('2026-08-02T01:00:00').toISOString(), '2026-08-02T01:00:00.000Z');

const rules = extractRules([
  {
    actionType: 'pause',
    planName: '简单投-1',
    beforeValue: { budget: 100, status: '启用' },
    effect: { status: 'evaluated', impactRating: 'positive', deltaCost15min: 10 },
  },
  {
    actionType: 'pause',
    planName: '简单投-2',
    beforeValue: { budget: 200, status: '启用' },
    effect: { status: 'evaluated', impactRating: 'positive', deltaCost15min: 20 },
  },
]);
assert.strictEqual(rules.length, 1);
assert.deepStrictEqual(extractConditionRange([
  { beforeValue: { budget: 100, status: '启用' } },
  { beforeValue: { budget: 200, status: '启用' } },
]), { budgetRange: { min: 100, max: 200 }, commonStatus: ['启用'] });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-analysis-'));
try {
  fs.writeFileSync(path.join(dir, '5m-2026-08-02T01-40-00.json'), JSON.stringify({ accountSpend: 1 }));
  const snaps = get5mSnapshots(1, { dataDir: dir });
  assert.strictEqual(snaps[0].accountSpend, 1);

  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'http-analysis-b-'));
  try {
    fs.writeFileSync(path.join(dir, '5m-2026-08-02T01-40-00.json'), JSON.stringify({ accountSpend: 1 }));
    fs.writeFileSync(path.join(dirB, '5m-2026-08-02T01-50-00.json'), JSON.stringify({ accountSpend: 2 }));
    const indexA = getSnapFileIndex(1000, { dataDir: dir });
    const indexB = getSnapFileIndex(1000, { dataDir: dirB });
    assert.strictEqual(indexA[0].file, '5m-2026-08-02T01-40-00.json');
    assert.strictEqual(indexB[0].file, '5m-2026-08-02T01-50-00.json');
  } finally {
    fs.rmSync(dirB, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

const alerts = getRecentAlerts(1, {
  loadSuggestionHistoryFn: () => ({ suggestions: [{ id: 'a1', alertType: 'high_cpa', campaignId: 'c1', campaignName: '计划A', suggestion: '暂停' }] }),
});
assert.strictEqual(alerts[0].response, 'pending');
assert.strictEqual(sanitize('x'.repeat(300)).length, 256);
assert.strictEqual(escHtml('<a>&'), '&lt;a&gt;&amp;');

console.log('\n全部测试通过');
