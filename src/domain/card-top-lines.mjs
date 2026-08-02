// src/domain/card-top-lines.mjs - 卡片 TOP 新增消耗行（纯逻辑）

export function buildTopSpendLines(finalTopNewSpenders = [], age15 = 15) {
  if (finalTopNewSpenders.length === 0) return [];
  const lines = [`📊 **近${Math.round(age15)}分钟新增消耗 TOP5**`];
  const trendTag = (t) => {
    if (t === '起量') return '🔥';
    if (t === '掉量') return '📉';
    if (t === '稳定消耗') return '➡';
    return '';
  };
  for (let i = 0; i < Math.min(5, finalTopNewSpenders.length); i++) {
    const c = finalTopNewSpenders[i];
    const rateStr = c.changeRate !== undefined
      ? (c.spendPrev > 0.01 ? `${(c.changeRate >= 0 ? '+' : '')}${(c.changeRate * 100).toFixed(0)}%` : 'NEW')
      : '';
    const cpaVal = c.cpa15 !== undefined ? c.cpa15 : (c.convDelta > 0 ? c.spendDelta / c.convDelta : 0);
    const cplRecentStr = c.convDelta > 0 ? `¥${cpaVal.toFixed(0)}` : '—';
    const tag = c.trend ? trendTag(c.trend) : (c.spendDelta > 50 ? '🔥' : c.spendDelta > 10 ? '➡' : '');
    lines.push(`${i + 1}. ${tag} ${(c.name || '').slice(0, 30)} — ¥${c.spendDelta.toFixed(0)}${rateStr ? ' (' + rateStr + ')' : ''} · ${Math.round(age15)}mCPL ${cplRecentStr}`);
  }
  return lines;
}
