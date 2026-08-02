// tests/domain-detailed-card.test.mjs - 5min 详细卡片纯逻辑测试
import assert from 'node:assert';
import { buildDetailedCard } from '../src/domain/detailed-card.mjs';

const card = buildDetailedCard({
  pm2Prefix: '',
  nowLocale: '2026-08-02 00:10:00',
  timeSlot: '早高峰',
  timePct: 10,
  timeElapsedH: 1,
  timeTotalH: 10,
  budgetPct: 20,
  spend: 100,
  budget: 500,
  pacingHealth: '✅ 节奏正常',
  projectedDaily: 1000,
  remainingH: 9,
  avgCPA: 50,
  totalConversions: 2,
  totalPrivateMsgOpen: 3,
  openRetainRate: 66.7,
  snapMinutes: 5,
  spend15m: 10,
  snapConv: 2,
  rolling: { last5min: 10, convLast5min: 2 },
  imp15m: 100,
  avgCPM: 10,
  totalLiveViews: 100,
  deltaRetention: 50,
  snapSpeed: 2,
  spendingCount: 1,
  activeCount: 1,
  rampingCount: 0,
  droppingCount: 0,
  balance: 1000,
  daysRemaining: 3,
  yesterdayLines: ['📅 **昨日同时段**: 消耗 ¥90 (+11.1%)'],
  trendLines: '近5分钟: ↑10% (+¥10) · ¥2/min',
  topLines: ['1. 计划A — ¥50 · 1转化'],
  headerColor: 'green',
});

assert.strictEqual(card.config.wide_screen_mode, true);
assert.ok(card.header.title.content.includes('极狐直播'));
assert.ok(Array.isArray(card.elements));
assert.ok(card.elements.some(e => e.tag === 'note'));

console.log('\n全部测试通过');
