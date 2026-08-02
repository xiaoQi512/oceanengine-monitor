// src/domain/five-min-context-trends.mjs - 5min 上下文趋势/TOP 文本

export function buildContextTrendLines(rolling) {
  return rolling.windows.map(w => {
    const dir = parseFloat(w.pct) > 0 ? '↑' : parseFloat(w.pct) < 0 ? '↓' : '→';
    const hot = w.hot ? ' 🔥' : '';
    const sign = w.delta >= 0 ? '+' : '';
    return '  ' + w.label + ': ' + dir + Math.abs(parseFloat(w.pct)).toFixed(0) + '% (' + sign + '¥' + w.delta.toFixed(0) + ') · ¥' + w.rpm.toFixed(0) + '/min' + hot;
  }).join('\n');
}

export async function buildContextYesterdayLines({ apiClient, d, shift, spend, avgCPA, now }) {
  const yesterdayLines = [];
  try {
    const hourStats = await d.getHourlyStats(apiClient, { startHour: shift ? shift.startHour : 6, endHour: now.getHours() });
    if (hourStats && hourStats.yesterday) {
      const ySpend = hourStats.yesterday.spend || 0;
      const yConv = hourStats.yesterday.conversions || 0;
      const yCPA = yConv > 0 ? ySpend / yConv : 0;
      const spendVs = ySpend > 0 ? ((spend / ySpend - 1) * 100) : 0;
      const cpaVs = yCPA > 0 ? ((avgCPA / yCPA - 1) * 100) : 0;
      yesterdayLines.push('📅 **昨日同时段**: 消耗 ¥' + ySpend.toFixed(0) + ' (' + (spendVs >= 0 ? '+' : '') + spendVs.toFixed(0) + '%) · CPL ¥' + yCPA.toFixed(0) + ' (' + (cpaVs >= 0 ? '+' : '') + cpaVs.toFixed(0) + '%) · ' + yConv + '条转化');
    }
  } catch {}
  return yesterdayLines;
}

export function buildContextTopLines(campaigns) {
  const topSpenders = campaigns.filter(c => c.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 5);
  const topLines = topSpenders.length > 0 ? ['📊 **有消耗计划 TOP5**'] : [];
  topSpenders.forEach((c, i) => topLines.push((i + 1) + '. ' + c.name.slice(0, 18) + ' — ¥' + c.spend.toFixed(0) + ' · ' + c.conversions + '转化 · ' + (c.cpm > 0 ? 'CPM ¥' + c.cpm.toFixed(1) : '')));
  return topLines;
}
