// src/domain/ai-regions-stats.mjs - AI 区域响应行统计（纯计算）

export function emptyRegionResult(name) {
  return { name, liveConsume: 0, liveLeads: 0, videoConsume: 0, videoLeads: 0 };
}

export function parseRegionRows(rows) {
  let liveConsume = 0;
  let liveLeads = 0;
  let videoConsume = 0;
  let videoLeads = 0;
  for (const row of rows || []) {
    const goal = row.Dimensions?.cdp_marketing_goal?.ValueStr || '';
    const m = row.Metrics || {};
    const cost = parseFloat((m.stat_cost?.ValueStr || '0').replace(/,/g, '')) || 0;
    const leads = parseInt((m.clue_message_count?.ValueStr || '0').replace(/,/g, '')) || 0;
    if (goal.includes('直播')) {
      liveConsume += cost;
      liveLeads += leads;
    } else if (goal.includes('短视频') || goal.includes('图文')) {
      videoConsume += cost;
      videoLeads += leads;
    }
  }
  return { liveConsume, liveLeads, videoConsume, videoLeads };
}

export function buildRegionResult(name, stats) {
  return { name, ...stats };
}
