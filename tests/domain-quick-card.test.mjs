// tests/domain-quick-card.test.mjs - 5min 速报卡片纯逻辑测试
import assert from 'node:assert';
import { buildQuickCard } from '../src/domain/quick-card.mjs';

const data = {
  accountSpend: 100,
  totalConv: 10,
  accountBudget: 500,
  activeCount: 2,
  _recentCPM: 0,
  allSpending: [
    { id: 'c1', name: '计划A', spend: 60, conversions: 2 },
  ],
};
const rolling = {
  last5min: 10,
  last5minMinutes: 5,
  convLast5min: 2,
  windows: [
    { label: '近5分钟', pct: '100.0', delta: 10, rpm: 2, hot: true },
  ],
};
const prevSnapshots = [
  { allSpending: [{ id: 'c1', name: '计划A', spend: 50, conversions: 1 }] },
];

const card = buildQuickCard(data, rolling, prevSnapshots, {
  pm2Prefix: '',
  now: '12:00',
});
assert.strictEqual(card.header.template, 'wathet');
assert.ok(card.header.title.content.includes('5分钟速报'));
assert.ok(card.elements[0].text.content.includes('5min消耗TOP5'));
assert.ok(card.elements[0].text.content.includes('计划A'));

console.log('\n全部测试通过');
