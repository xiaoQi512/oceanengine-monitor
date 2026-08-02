// tests/daily-report-insights.test.mjs - 日报洞察构建测试
import assert from 'node:assert';
import { buildInsightLines } from '../src/services/daily-report-insights.mjs';

const lines = buildInsightLines({
  budgetPct: 95,
  yoySpend: 10,
  yoyCPA: -5,
  yoyConv: 2,
  vs7Spend: null,
  vs7CPA: null,
  vs7Conv: null,
});
assert.ok(lines.some(l => l.includes('预算接近上限')));
assert.ok(lines.some(l => l.includes('较昨日')));

console.log('\n全部测试通过');
