// src/domain/detailed-card.mjs - 5min 详细卡片构建（纯逻辑）
import { makeBar } from './progress-bar.mjs';
import { buildDetailedCardContent } from './detailed-card-content.mjs';

export function buildDetailedCard({
  pm2Prefix = '',
  nowLocale = '',
  timeSlot = '',
  timePct = 0,
  timeElapsedH = 0,
  timeTotalH = 17,
  budgetPct = 0,
  spend = 0,
  budget = 0,
  pacingHealth = '',
  projectedDaily = 0,
  remainingH = 0,
  avgCPA = 0,
  totalConversions = 0,
  totalPrivateMsgOpen = 0,
  openRetainRate = 0,
  snapMinutes = 15,
  spend15m = 0,
  snapConv = 0,
  rolling = { last5min: 0, convLast5min: 0 },
  imp15m = 0,
  avgCPM = 0,
  totalLiveViews = 0,
  deltaRetention = 0,
  snapSpeed = 0,
  spendingCount = 0,
  activeCount = 0,
  rampingCount = 0,
  droppingCount = 0,
  balance = 0,
  daysRemaining = 0,
  yesterdayLines = [],
  trendLines = '',
  topLines = [],
  headerColor = 'green',
} = {}) {
  const elements = [];

  elements.push({ tag: 'div', text: { tag: 'lark_md', content: [
    makeBar(timePct) + ' ' + timePct.toFixed(0) + '%  (已过' + timeElapsedH.toFixed(1) + 'h/' + timeTotalH.toFixed(0) + 'h)',
    makeBar(Math.min(budgetPct, 100)) + ' ' + budgetPct.toFixed(0) + '%  (¥' + spend.toFixed(0) + ' / ¥' + budget.toFixed(0) + ')',
    '📊 ' + pacingHealth + ' | ' + timeSlot,
    projectedDaily > 0 ? '🎯 预估今日 ¥' + projectedDaily.toFixed(0) + (remainingH > 0 ? ' | 剩余 ' + remainingH.toFixed(1) + 'h' : '') : '',
  ].join('\n') }});
  elements.push({ tag: 'hr' });

  const { metricsContent, headerTitle } = buildDetailedCardContent({
    spend, budget, avgCPA, totalConversions, totalPrivateMsgOpen, openRetainRate, snapMinutes, spend15m, snapConv, rolling, imp15m, avgCPM, totalLiveViews, deltaRetention, snapSpeed, spendingCount, activeCount, rampingCount, droppingCount, balance, daysRemaining, budgetPct, timeSlot,
  });
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: metricsContent.join('\n') }});

  if (yesterdayLines.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: yesterdayLines.join('\n') }});
  }
  if (trendLines) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '📈 **消耗环比趋势**:\n' + trendLines }});
  }
  if (topLines.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: topLines.join('\n') }});
  }
  elements.push({ tag: 'hr' });
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: '🕐 ' + nowLocale + ' · ' + timeSlot + ' · 5分钟轮询采集' }] });

  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: pm2Prefix + headerTitle }, template: headerColor },
    elements,
  };
}
