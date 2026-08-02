// src/domain/ai-context-prompt.mjs - AI 对话上下文与提示词构建（纯计算）

export function buildAccountContextFromSnapshot(latest) {
  if (!latest) return null;
  return {
    time: latest.time,
    totalSpend: Math.round(latest.accountSpend || 0),
    budget: Math.round(latest.accountBudget || 0),
    pct: Math.round((latest.accountSpend / (latest.accountBudget || 1)) * 100),
    conversions: latest.totalConv || 0,
    activeCount: latest.activeCount || 0,
    spendingCount: latest.spendingCount || 0,
    balance: Math.round(latest.accountBalance || 0),
    balanceDays: latest.accountSpend ? Math.round(latest.accountBalance / (latest.accountSpend / Math.max(latest._elapsedHours || 1, 1))) : '?',
  };
}

export function buildAIAccountBlock(ctx) {
  if (!ctx) return '';
  return `消耗¥${ctx.totalSpend}/${ctx.budget}(${ctx.pct}%) 转化${ctx.conversions}次 投放中${ctx.spendingCount}条`;
}

export function buildAICampaignBlock(camps) {
  if (!camps || camps.length === 0) return '';
  const active = camps.filter(c => c.status === '启用' || c.status === '投放中');
  return ' 计划: ' + active.map(c => c.name + '(¥' + c.budget + ')').join(' ');
}

export function buildAIPrompt({
  accountName,
  aiDailyBudget,
  dataBlock,
  campBlock,
  userMessage,
}) {
  return `账户:${accountName} 日预算¥${aiDailyBudget}。${dataBlock}。${campBlock}。根据以上信息回答: ${userMessage}`;
}

export function buildAIFallbackMessage() {
  return '抱歉，暂时无法处理，请稍后再试。状态 查看帮助';
}
