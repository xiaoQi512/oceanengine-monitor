// src/domain/api-normalization.mjs - API 项目数据归一化（纯逻辑）

export function isActiveStatus(status) {
  return status === '启用' || status === '启用中' || status === '投放中';
}

function toInt(v) {
  return parseInt(String(v || '0').replace(/,/g, '')) || 0;
}

function toFloat(v) {
  return parseFloat(String(v || '0').replace(/,/g, '')) || 0;
}

export function normalizeApiProjects(projectsPage) {
  const totalConv = toInt(projectsPage?.totalMetrics?.convert_cnt);
  const totalImp = toInt(projectsPage?.totalMetrics?.show_cnt);
  const liveViews = toInt(projectsPage?.totalMetrics?.luban_live_enter_cnt);
  const liveOver1Min = toInt(projectsPage?.totalMetrics?.live_watch_one_minute_count);

  const allProjects = (projectsPage?.projects || []).map(p => {
    const m = p.metrics || {};
    return {
      id: p.project_id || '',
      name: p.project_name || '',
      status: p.project_status_name || p.project_status_first_name || '',
      spend: toFloat(m.stat_cost),
      conversions: toInt(m.convert_cnt),
      formSubmit: toInt(m.form),
      privateMsgOpen: toInt(m.message_action),
      privateMsgRetain: toInt(m.clue_message_count),
      leads: toInt(m.attribution_all_convert_clue_count),
      ctr: parseFloat(String(m.ctr || '0%').replace(/%/g, '')) / 100 || 0,
      cpm: toFloat(m.cpm_platform),
      cvr: parseFloat(String(m.conversion_rate || '0%').replace(/%/g, '')) / 100 || 0,
      budget: toFloat(p.campaign_budget),
      liveViews: toInt(m.luban_live_enter_cnt),
      liveOver1Min: toInt(m.live_watch_one_minute_count),
      liveComments: toInt(m.luban_live_comment_cnt),
    };
  });

  const activeCnt = allProjects.filter(p => isActiveStatus(p.status)).length;
  const spendingCount = allProjects.filter(p => p.spend > 0).length;

  return {
    totalConv,
    totalImp,
    liveViews,
    liveOver1Min,
    activeCnt,
    spendingCount,
    allProjects,
  };
}
