// tests/monitor-card.test.mjs - 飞书卡片上下文编排测试
import assert from 'node:assert';
import { buildFeishuCard, createFeishuCardBuilder } from '../src/services/monitor-card.mjs';

const analysis = {
  summary: { totalSpend: 100, totalActive: 1 },
  alerts: [],
  topNewSpenders: [{ name: 'fallback' }],
};

let closed = false;
const mockDb = {
  prepare(sql) {
    if (sql.includes('SELECT DISTINCT snapshot_time')) {
      return {
        all: () => [
          { snapshot_time: '2026-08-02 01:30:00' },
          { snapshot_time: '2026-08-02 01:25:00' },
          { snapshot_time: '2026-08-02 01:20:00' },
        ],
      };
    }
    return {
      all: () => [{ name: '计划A', spendDelta: 10, convDelta: 1 }],
    };
  },
  close() { closed = true; },
};

const deps = {
  dbPath: 'mock.db',
  Database: function () { return mockDb; },
  loadSuggestionHistory: () => ({ summary: {}, suggestions: [] }),
  saveSuggestionHistory: () => {},
  recalcSummary: () => {},
  markIgnoredSuggestions: () => {},
  getLiveWindowLabel: () => ({ label: '直播中' }),
  buildCardMessage: (a, ctx) => ctx,
};

const card = await buildFeishuCard(analysis, deps);
assert.strictEqual(closed, true);
assert.strictEqual(card.topNewSpenders.length, 1);
assert.strictEqual(card.topNewSpenders[0].name, '计划A');
assert.strictEqual(card.enableHtmlReport, false);

const failed = await buildFeishuCard(analysis, {
  ...deps,
  Database: function () { throw new Error('db unavailable'); },
});
assert.strictEqual(failed.topNewSpenders[0].name, 'fallback');

const builder = createFeishuCardBuilder({ ...deps, enableHtmlReport: true });
assert.strictEqual(typeof builder, 'function');
const built = await builder(analysis);
assert.strictEqual(built.enableHtmlReport, true);

console.log('\n全部测试通过');
