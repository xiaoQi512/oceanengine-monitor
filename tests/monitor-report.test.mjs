// tests/monitor-report.test.mjs - HTML 报表上下文编排测试
import assert from 'node:assert';
import { generateHtmlReport, createHtmlReportBuilder } from '../src/services/monitor-report.mjs';

const analysis = { summary: {}, active: [], allSpending: [], topNewSpenders: [], alerts: [], delta: {}, rampingUp: [], dropping: [] };
let marked = false;

const deps = {
  getLocalDate: () => '2026-08-02',
  getLiveWindowLabel: () => ({ label: '直播中' }),
  loadSuggestionHistory: () => ({ summary: {}, suggestions: [] }),
  saveSuggestionHistory: () => {},
  recalcSummary: () => {},
  markIgnoredSuggestions: () => { marked = true; },
  generateMonitorHTML: (a, ctx) => ({ analysis: a, ctx }),
  accountName: '测试账户',
};

const result = generateHtmlReport(analysis, deps);
assert.strictEqual(marked, true);
assert.strictEqual(result.ctx.today, '2026-08-02');
assert.strictEqual(result.ctx.accountName, '测试账户');
assert.deepStrictEqual(result.ctx.history, { summary: {}, suggestions: [] });

const builder = createHtmlReportBuilder({ ...deps, accountName: '新账户' });
assert.strictEqual(typeof builder, 'function');
assert.strictEqual(builder(analysis).ctx.accountName, '新账户');

console.log('\n全部测试通过');
