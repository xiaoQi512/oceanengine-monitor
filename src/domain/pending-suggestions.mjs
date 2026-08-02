// src/domain/pending-suggestions.mjs - 待处理建议构建与去重（纯逻辑）

export function buildPendingSuggestion(sug, now = new Date().toISOString()) {
  return {
    id: sug.id,
    time: now,
    alertType: sug.alertType,
    campaignId: sug.campaignId || '',
    campaignName: sug.campaignName || '',
    suggestion: sug.suggestion || '',
    response: null,
    responseTime: null,
    timeSlot: sug.timeSlot || '',
  };
}

export function mergePendingSuggestions(existing, incoming, now = new Date().toISOString()) {
  const existingIds = new Set(existing.map(s => s.id));
  return incoming.filter(s => !existingIds.has(s.id)).map(s => buildPendingSuggestion(s, now));
}
