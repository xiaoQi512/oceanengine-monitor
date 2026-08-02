// src/domain/alert-card-lines.mjs - 告警卡片文本行构建（纯逻辑）

export function buildBalanceCardLines({ analysis, worst, d, now = new Date().toLocaleString('zh-CN') }) {
  const daysRemaining = worst.daysRemaining || 0;
  const isCritical = worst.severity === 'high';
  return [
    '## 💳 主账户余额告警',
    '',
    `**当前余额**: ¥${(analysis.summary?.accountBalance || 0).toFixed(0)}`,
    `**可支撑**: 约 **${daysRemaining.toFixed(1)} 天**`,
    `**预估日耗**: ¥${(worst.projectedDaily || 0).toFixed(0)}`,
    `**日预算**: ¥${(d.dailyBudget || 45000).toFixed(0)}`,
    '',
    isCritical
      ? '> ⚠️ **余额不足支撑1天消耗，计划可能随时因余额不足暂停投放！**'
      : `> ⚠️ 余额仅能支撑约 ${daysRemaining.toFixed(1)} 天，请尽快安排充值避免断投。`,
    '',
    `📊 **今日进度**: 消耗 ¥${(analysis.summary?.totalSpend || 0).toFixed(0)} / ¥${(d.dailyBudget || 45000).toFixed(0)} (${(d.budgetUsed * 100).toFixed(0)}%)`,
    `⏰ ${now} · ${d.timeSlot || ''}`,
  ];
}

export function buildAccountBudgetCardLines({
  analysis,
  d,
  accountSpend,
  accountBudget,
  usedPct,
  projectedDaily,
  overSpend,
  isCritical,
  now = new Date().toLocaleString('zh-CN'),
}) {
  const topCampaign = (analysis.allSpending || analysis.active || [])
    .filter(c => c.status === '投放中' || c.status === '启用')
    .sort((a, b) => (b.spend || 0) - (a.spend || 0))[0] || null;
  const topCampaignLine = topCampaign
    ? `🔥 最高消耗: ${topCampaign.name} (¥${(topCampaign.spend || 0).toFixed(0)} / 计划预算 ¥${(topCampaign.budget || 0).toFixed(0)})`
    : '';
  const nearCapPlans = (analysis.allSpending || [])
    .filter(c => c.budget > 0 && (c.spend / c.budget) >= 0.8 && c.status === '投放中')
    .sort((a, b) => (b.spend / b.budget) - (a.spend / a.budget))
    .slice(0, 3);
  const nearCapLines = nearCapPlans.length > 0
    ? ['', '📊 **接近撞线计划** (≥80%):', ...nearCapPlans.map(p => `  · ${p.name}: ¥${(p.spend || 0).toFixed(0)}/¥${p.budget.toFixed(0)} (${((p.spend / p.budget) * 100).toFixed(0)}%)`)]
    : [];
  return [
    '## 💰 账户日预算撞线',
    '',
    `**使用率**: **${(usedPct * 100).toFixed(1)}%**  (¥${accountSpend.toFixed(0)} / ¥${accountBudget.toFixed(0)})`,
    `**预估今日**: ¥${projectedDaily.toFixed(0)}` + (overSpend > 0 ? `  ⚠️ 超预算 ¥${overSpend.toFixed(0)}` : ''),
    `**时间进度**: ${((d.timeProgress || 0) * 100).toFixed(0)}%  (${(d.elapsedHours || 0).toFixed(1)}h/${d.windowDuration || 16}h)`,
    topCampaignLine,
    ...nearCapLines,
    '',
    isCritical
      ? '> ⚠️ **账户预算即将/已用完，所有计划将陆续暂停投放！**'
      : `> ⚠️ 账户预算使用率 ${(usedPct * 100).toFixed(0)}%，按当前节奏预估今日 ¥${projectedDaily.toFixed(0)}。`,
    '',
    '📌 **建议操作**:',
    '1. 追加账户日预算（投放管理 → 账户设置）',
    '2. 或调低高消耗计划预算上限',
    '3. 或暂停部分非核心计划',
    '',
    `⏰ ${now} · ${d.timeSlot || ''}`,
  ].filter(Boolean);
}
