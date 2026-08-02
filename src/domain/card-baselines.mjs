// src/domain/card-baselines.mjs - 卡片基线/生命周期区块（纯逻辑）

export function buildBudgetExceededContent(analysis) {
  if (!analysis.budgetExceededChanges || analysis.budgetExceededChanges.length === 0) return null;
  const lines = [`🔴 **预算超限提醒**：${analysis.budgetExceededChanges.length} 条计划刚从「投放中」变为「项目超出预算」`];
  for (const c of analysis.budgetExceededChanges.slice(0, 5)) {
    const pct = c.budget > 0 ? ((c.spend / c.budget) * 100).toFixed(0) : '--';
    lines.push(`  • ${c.name.slice(0, 30)} - 消耗 ¥${c.spend.toFixed(0)} / 预算 ¥${c.budget.toFixed(0)} (${pct}%)`);
  }
  return lines.join('\n');
}

export function buildYoyContent(d, summary) {
  if (!d.yoy) return null;
  const yoySpendStr = d.yoy.spendVsYesterday !== null
    ? `${d.yoy.spendVsYesterday >= 0 ? '↑' : '↓'}${Math.abs(d.yoy.spendVsYesterday * 100).toFixed(0)}%`
    : '无数据';
  const yoyCPAStr = d.yoy.cpaVsYesterday !== null
    ? `${d.yoy.cpaVsYesterday >= 0 ? '↑' : '↓'}${Math.abs(d.yoy.cpaVsYesterday * 100).toFixed(0)}%`
    : '无数据';
  return `📅 **同比昨天同时段** (${d.yoy.yesterdayDate || ''})\n消耗: ¥${d.yoy.yesterdaySpend.toFixed(0)} → ¥${summary.totalSpend.toFixed(0)} (${yoySpendStr}) | CPL: ¥${(d.yoy.yesterdayCPA||0).toFixed(0)} → ¥${(summary.avgCPA||0).toFixed(0)} (${yoyCPAStr})`;
}

export function buildMultiDayContent(md, summary) {
  if (!md || md.sampleDays < 2) return null;
  const spendVsMeanNum = md.spend.mean > 0 ? ((summary.totalSpend / md.spend.mean - 1) * 100) : null;
  const spendVsMean = spendVsMeanNum !== null ? (spendVsMeanNum >= 0 ? '↑' : '↓') + Math.abs(spendVsMeanNum).toFixed(0) + '%' : '—';
  const cpaVsMeanNum = md.cpa && md.cpa.mean > 0 ? ((summary.avgCPA / md.cpa.mean - 1) * 100) : null;
  const cpaVsMean = cpaVsMeanNum !== null ? (cpaVsMeanNum >= 0 ? '↑' : '↓') + Math.abs(cpaVsMeanNum).toFixed(0) + '%' : '—';
  return `📊 **近${md.sampleDays}天同时段**\n消耗: ¥${md.spend.mean.toFixed(0)} → ¥${summary.totalSpend.toFixed(0)} (${spendVsMean}) | CPL: ¥${(md.cpa?.mean||0).toFixed(0)} → ¥${summary.avgCPA.toFixed(0)} (${cpaVsMean})`;
}

export function buildLifecycleContent(d) {
  if (!d.lifecycle || !d.lifecycle.dead) return null;
  const lcParts = [];
  if (d.lifecycle.active > 0) lcParts.push(`🔥 活跃 ${d.lifecycle.active}`);
  if (d.lifecycle.dead > 0) lcParts.push(`💀 疑似死亡 ${d.lifecycle.dead}`);
  return `📊 **计划状态**: ${lcParts.join(' · ')}`;
}
