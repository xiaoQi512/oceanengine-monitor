// src/domain/detailed-card-content.mjs - 详细卡片指标内容

export function buildDetailedCardContent({
  spend,
  budget,
  avgCPA,
  totalConversions,
  totalPrivateMsgOpen,
  openRetainRate,
  snapMinutes,
  spend15m,
  snapConv,
  rolling = {},
  imp15m,
  avgCPM,
  totalLiveViews,
  deltaRetention,
  snapSpeed,
  spendingCount,
  activeCount,
  rampingCount,
  droppingCount,
  balance,
  daysRemaining,
  budgetPct,
  timeSlot,
}) {
  const metricsContent = [
    '━ **累计** ━',
    '💰 **消耗**: ¥' + spend.toFixed(0) + ' | CPL ¥' + (avgCPA > 0 ? avgCPA.toFixed(0) : '--'),
    '🎯 **转化**: ' + totalConversions + '条',
    '📨 **开口成本**: ¥' + (totalPrivateMsgOpen > 0 ? (spend / totalPrivateMsgOpen).toFixed(1) : '--') + ' | **开口留资率**: ' + openRetainRate.toFixed(1) + '%',
    '━ **近' + snapMinutes + '分差值** ━',
    '📊 **新增消耗**: +¥' + spend15m.toFixed(0) + ' | **新增线索**: +' + snapConv + '条',
    '📈 **CPL**: ¥' + (snapConv > 0 ? (spend15m / snapConv).toFixed(0) : rolling.last5min > 0 && rolling.convLast5min > 0 ? (rolling.last5min / rolling.convLast5min).toFixed(0) : '--') + ' | **CPM**: ¥' + (spend15m > 0 && imp15m > 0 ? (spend15m / imp15m * 1000).toFixed(1) : avgCPM.toFixed(1)) + ' | **停留率**: ' + (totalLiveViews > 0 ? deltaRetention.toFixed(1) + '%' : 'N/A'),
    '⚡ **速度**: ¥' + snapSpeed.toFixed(0) + '/min | 有消耗 ' + spendingCount + '条 · 投放中 ' + activeCount + '条 (起量' + rampingCount + '·掉量' + droppingCount + ')',
  ];
  if (budget > 0) metricsContent.push('🏦 **账户预算**: ¥' + spend.toFixed(0) + ' / ¥' + budget.toFixed(0) + ' (' + budgetPct.toFixed(0) + '%)');
  if (balance > 0) metricsContent.push('💳 **账户余额**: ¥' + balance.toFixed(0) + (daysRemaining > 0 ? ' (约' + daysRemaining.toFixed(1) + '天)' : ''));
  const headerTitle = budget > 0 ? '📊 极狐直播 · 消耗 ¥' + spend.toFixed(0) + ' (' + budgetPct.toFixed(0) + '%)' + ' · ' + timeSlot : '📊 极狐直播 · ' + timeSlot;
  return { metricsContent, headerTitle };
}
