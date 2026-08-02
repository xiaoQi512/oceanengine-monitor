// tests/domain-outputs.test.mjs - HTML 报表与飞书卡片构建纯逻辑测试
import assert from 'node:assert';
import { generateMonitorHTML } from '../src/domain/report-html.mjs';
import { buildCardMessage } from '../src/domain/card-builder.mjs';

const campaign = {
  id: 'campaign-1',
  name: '测试计划',
  spend: 120,
  budget: '200.00按日预算',
  cpa: 40,
  conversions: 2,
  leads: 3,
  privateMsgRetain: 2,
  formSubmit: 1,
  privateMsgOpen: 3,
  ctr: 0.02,
  cvr: 0.1,
  status: '投放中',
  _lifecycle: 'active',
};

const baseAnalysis = {
  summary: {
    totalSpending: 1,
    totalActive: 1,
    totalSpend: 120,
    totalConversions: 2,
    avgCPA: 40,
    totalLeads: 3,
    totalPrivateMsgOpen: 3,
    totalPrivateMsgRetain: 2,
    totalFormSubmit: 1,
    openRetainRate: 2 / 3,
    useAccountSpend: false,
    accountBudget: 0,
    avgCPM: 10,
    viewRetention: 0.5,
  },
  active: [campaign],
  allSpending: [campaign],
  topNewSpenders: [],
  rampingUp: [],
  dropping: [],
  alerts: [],
  delta: {
    timeSlot: '早高峰',
    pacingHealth: 'good',
    budgetUsed: 0.5,
    age15: 15,
    spendLast15min: 10,
    convLast15min: 0,
    cplLast15min: 0,
    speedCurrent: 1,
    speedHour: 1,
    prevCPA30: 35,
    projectedDaily: 200,
    idealSpend: 60,
    dailyBudget: 1000,
    elapsedHours: 2,
    windowDuration: 16,
    timeProgress: 0.5,
    lifecycle: { active: 1, dead: 0 },
    yoy: null,
    trends: null,
  },
  budgetExceededChanges: [],
  _multiDay: null,
};

const html = generateMonitorHTML(baseAnalysis, {
  history: { summary: {}, suggestions: [] },
  now: '2026-08-01 12:00:00',
  today: '2026-08-01',
  liveWin: { label: '测试班次', labelCompact: '测试' },
  accountName: '测试账户',
});
assert.ok(html.includes('<!DOCTYPE html>'));
assert.ok(html.includes('测试计划'));
assert.ok(html.includes('测试账户'));

const card = buildCardMessage(baseAnalysis, {
  topNewSpenders: [],
  history: {
    summary: { totalSuggestions: 1, accepted: 1, rejected: 0, ignored: 0 },
    suggestions: [],
  },
  now: '2026-08-01 12:00:00',
  liveWin: { label: '测试班次', labelCompact: '测试' },
  pm2Prefix: '',
  enableHtmlReport: false,
});
assert.strictEqual(card.config.wide_screen_mode, true);
assert.ok(card.header.title.content.includes('极狐直播'));
assert.ok(Array.isArray(card.elements));
assert.ok(card.elements.some(e => e.tag === 'div' && e.text?.content.includes('近15分差值')));

console.log('\n全部测试通过');
