// src/domain/suggestions.mjs - 建议去重与摘要
const ACTIONABLE_TYPES = ['zero_conv', 'high_cpa', 'budget_cap'];

export function shouldSuggest(alertType, campaignId, history) {
  if (!history || !history.summary) return { suggest: true, reason: '' };
  const suggestions = history.suggestions || [];
  const stats = history.summary.byType[alertType];
  if (!stats) return { suggest: true, reason: '' };

  if (stats.rejected >= 2 && stats.accepted === 0) {
    return { suggest: false, reason: `历史中该类型建议被拒绝${stats.rejected}次，已自动抑制` };
  }

  if (ACTIONABLE_TYPES.includes(alertType) && campaignId) {
    const campaignRejects = suggestions.filter(
      s => s.campaignId === campaignId && s.alertType === alertType && s.response === 'reject'
    );
    if (campaignRejects.length > 0) {
      return { suggest: false, reason: `该计划此前此类建议已被拒绝，已自动抑制` };
    }

    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const pendingSame = suggestions.filter(
      s => s.campaignId === campaignId
        && s.alertType === alertType
        && !s.response
        && new Date(s.time).getTime() > twoHoursAgo
    );
    if (pendingSame.length > 0) {
      return { suggest: false, reason: `该计划2h内已有待处理同类建议，不重复推送` };
    }
  }

  return { suggest: true, reason: '' };
}

export function getSuggestionInsight(history) {
  if (!history || (history.suggestions || []).length === 0) return '';
  const s = history.summary;
  const evaluated = (s.accepted || 0) + (s.rejected || 0);
  const acceptRate = s.totalSuggestions > 0 && evaluated > 0 ? ((s.accepted || 0) / evaluated * 100).toFixed(0) : '—';
  return `📋 建议采纳率: ${acceptRate}% (采纳${s.accepted}/拒绝${s.rejected}/忽略${s.ignored})`;
}
