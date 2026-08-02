// src/domain/card-sections.mjs - 飞书卡片区块构建（纯逻辑）
import { progressBar } from './helpers.mjs';

export function buildPacingLines(delta = {}, summary = {}) {
  const timePct = delta.timeProgress > 0 ? (delta.timeProgress * 100).toFixed(0) : '0';
  const budgetPct = delta.budgetUsed > 0 ? (delta.budgetUsed * 100).toFixed(0) : '0';
  const timeBar = progressBar(Number(timePct));
  const spendBar = progressBar(Number(budgetPct));

  const pacingLabel = delta.pacingHealth === 'good' ? '✅ 消耗节奏正常'
    : delta.pacingHealth === 'warning' ? '⚠️ 消耗节奏偏离' : '🔴 消耗节奏异常';

  const projectedStr = delta.timeProgress >= 1
    ? `投放已结束 · 实际 ¥${(summary.totalSpend || 0).toFixed(0)}`
    : `预估今日 ¥${delta.projectedDaily.toFixed(0)} | 剩余 ${delta.windowDuration - (delta.elapsedHours || 0) > 0 ? (delta.windowDuration - delta.elapsedHours).toFixed(1) + 'h' : '0h'}`;

  return [
    `${timeBar} ${timePct}%  (已过${(delta.elapsedHours||0).toFixed(1)}h/${delta.windowDuration||16}h)`,
    `${spendBar} ${budgetPct}%  (¥${(summary.totalSpend||0).toFixed(0)} / ¥${delta.dailyBudget||45000})`,
    `📊 ${pacingLabel} | ${delta.timeSlot || ''}`,
    `🎯 ${projectedStr}`,
  ];
}

export function buildMetricsLines(delta = {}, summary = {}, rampingUp = [], dropping = []) {
  const speedChange = delta.speedHour > 0 ? ((delta.speedCurrent / delta.speedHour - 1) * 100).toFixed(0) : '—';
  const speedEmoji = speedChange === '—' ? '' : Number(speedChange) > 30 ? '🔥' : Number(speedChange) > 10 ? '⬆' : Number(speedChange) < -20 ? '⬇' : '';
  const cpaChange = delta.prevCPA30 > 0 ? ((summary.avgCPA / delta.prevCPA30 - 1) * 100).toFixed(0) : '—';
  const cpaEmoji = cpaChange === '—' ? '' : Number(cpaChange) > 10 ? '📈' : Number(cpaChange) < -10 ? '📉' : '';

  return [
    '━ **累计** ━',
    `💰 **消耗**: ¥${summary.totalSpend.toFixed(0)}${summary.useAccountSpend ? ' (账户)' : ''} | CPL ¥${summary.avgCPA.toFixed(0)}${cpaEmoji ? ' ' + cpaEmoji : ''}`,
    `🎯 **转化**: ${summary.totalConversions}条（线索数：${summary.totalLeads||0}条）`,
    `📨 **开口成本**: ¥${(summary.totalPrivateMsgOpen||0) > 0 ? (summary.totalSpend / summary.totalPrivateMsgOpen).toFixed(1) : '--'} | **开口留资率**: ${(summary.openRetainRate ? (summary.openRetainRate*100).toFixed(1) + '%' : 'N/A')}`,
    `━ **近${Math.round(delta.age15||15)}分差值** ━`,
    `📊 **新增消耗**: +¥${delta.spendLast15min.toFixed(0)} | **新增线索**: +${delta.convLast15min === -1 ? '?' : delta.convLast15min}条`,
    `📈 **CPL**: ¥${delta.cplLast15min > 0 ? delta.cplLast15min.toFixed(0) : '--'} | **CPM**: ¥${(summary.avgCPM||0).toFixed(1)} | **停留率**: ${summary.viewRetention ? (summary.viewRetention*100).toFixed(1)+'%' : 'N/A'}`,
    `⚡ **速度**: ¥${delta.speedCurrent.toFixed(0)}/min${speedEmoji} | 有消耗 ${summary.totalSpending}条 · 投放中 ${summary.totalActive}条 (起量${rampingUp.length}·掉量${dropping.length})`,
  ];
}
