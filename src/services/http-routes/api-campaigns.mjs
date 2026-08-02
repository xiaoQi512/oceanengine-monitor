// src/services/http-routes/api-campaigns.mjs - 计划查询 API
function numOf(v) {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}

async function fetchCampaigns(getApiClient) {
  const api = await getApiClient();
  const client = await api.createClient({ useCache: true });
  const result = await api.getProjects(client, { page: 1, pageSize: 100 });
  return result.projects || [];
}

export function normalizeCampaign(p, mode = 'default') {
  const m = p.metrics || {};
  const statusName = p.project_status_first_name || p.project_status_name || p.status_str || p.status || '';
  let stdStatus = statusName;
  if (statusName.includes('启用')) stdStatus = '投放中';
  else if (statusName.includes('暂停')) stdStatus = '未投放(已暂停)';
  else if (statusName.includes('超出预算') || statusName.includes('预算')) stdStatus = '未投放(超出预算)';
  const grouped = mode === 'grouped';
  const spend = grouped
    ? numOf(m.stat_cost ?? p.stat_cost)
    : Number(m.stat_cost || p.stat_cost || 0);
  const leads = grouped
    ? numOf(m.attribution_all_convert_clue_count ?? m.clue_message_count)
    : Number(m.attribution_all_convert_clue_count || m.clue_message_count || 0);
  const conversions = grouped ? numOf(m.convert_cnt) : Number(m.convert_cnt || 0);
  return {
    id: String(p.id || p.campaign_id || p.project_id || ''),
    name: p.project_name || p.name || p.project_name || '',
    status: stdStatus,
    rawStatus: statusName,
    optStatus: p.opt_status,
    spend,
    conversions,
    leads,
    cpa: spend > 0 && conversions > 0 ? Number((spend / conversions).toFixed(2)) : 0,
    budget: grouped ? Number(p.campaign_budget || p.budget || 0) : numOf(p.campaign_budget ?? p.budget),
    bid: p.project_deep_cpa_bid || p.bid || '',
    ctr: grouped ? Number(m.ctr || 0) : numOf(m.ctr),
    cpm: grouped ? Number(m.cpm_platform || 0) : numOf(m.cpm_platform),
    cvr: grouped ? Number(m.conversion_rate || 0) : numOf(m.conversion_rate),
  };
}

export async function serveCampaigns(url, req, res, ctx) {
  const { classifyDeliveryType, emptyGroupSummary, summarizeGroup, getApiClient } = ctx;

  if (url.pathname === '/api/campaigns') {
    try {
      const projects = await fetchCampaigns(getApiClient);
      const list = projects.map(p => normalizeCampaign(p, 'default'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ campaigns: list, total: list.length }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, campaigns: [] }));
    }
    return true;
  }

  if (url.pathname === '/api/campaigns/grouped') {
    try {
      const projects = await fetchCampaigns(getApiClient);
      const list = projects.map(p => normalizeCampaign(p, 'grouped'));
      const GROUPS = ['简单投', '画面直投', '短引直'];
      const groups = {};
      for (const g of GROUPS) groups[g] = { summary: emptyGroupSummary(g), plans: [] };
      const ungrouped = [];
      for (const p of list) {
        const g = classifyDeliveryType(p.name);
        if (g && groups[g]) groups[g].plans.push(p);
        else ungrouped.push(p);
      }
      for (const g of GROUPS) groups[g].summary = summarizeGroup(groups[g].plans, g);
      const totalSummary = summarizeGroup(list, '全部');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ groups, ungrouped, totalSummary }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, groups: {}, ungrouped: [], totalSummary: {} }));
    }
    return true;
  }

  return false;
}
