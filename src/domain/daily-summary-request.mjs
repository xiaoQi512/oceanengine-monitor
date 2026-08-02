// src/domain/daily-summary-request.mjs - 日汇总请求体与行解析（纯逻辑）

export function buildVideoStatBody(accountId, dateStr) {
  return {
    DataSetKey: 'basic_ad_data',
    Dimensions: ['stat_time_day', 'cdp_marketing_goal'],
    EndTime: dateStr + ' 23:59:59',
    StartTime: dateStr + ' 00:00:00',
    Filters: {
      ConditionRelationshipType: 1,
      Conditions: [{ Field: 'advertiser_id', Operator: 7, Values: [accountId] }],
    },
    IsDownload: false,
    Metrics: ['stat_cost', 'convert_cnt', 'conversion_cost', 'clue_message_count', 'message_action', 'form'],
    OrderBy: [{ Field: 'stat_time_day', Type: 2 }],
    PageParams: { Limit: 50, Offset: 0 },
  };
}

export function parseVideoRows(rows = []) {
  let videoConsume = 0;
  let videoLeads = 0;
  for (const row of rows) {
    const goal = row.Dimensions?.cdp_marketing_goal?.ValueStr || '';
    const m = row.Metrics || {};
    const cost = parseFloat((m.stat_cost?.ValueStr || '0').replace(/,/g, '')) || 0;
    const leads = parseInt((m.convert_cnt?.ValueStr || '0').replace(/,/g, '')) || 0;
    if (goal.includes('短视频') || goal.includes('图文')) {
      videoConsume += cost;
      videoLeads += leads;
    }
  }
  return { videoConsume, videoLeads };
}

export function zeroDailySummary() {
  return { totalConsume: 0, totalLeads: 0, cpl: '0.00' };
}

export function computeDailySummary(totalConsume, totalLeads) {
  const cpl = totalLeads > 0 ? (totalConsume / totalLeads).toFixed(2) : '0.00';
  return { totalConsume, totalLeads, cpl };
}
