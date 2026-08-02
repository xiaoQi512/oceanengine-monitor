// src/domain/campaign-classification.mjs - 计划分类与状态统计（纯逻辑）

export function classifyCampaigns(campaigns = []) {
  const allSpending = campaigns.filter(c => c.spend > 0);
  const active = allSpending.filter(c =>
    c.status.includes('启用中') || c.status.includes('投放中')
  );
  return { allSpending, active };
}

export function buildStatusLabels(allSpending = []) {
  const statusDist = {};
  for (const c of allSpending) {
    const s = c.status || '未知';
    statusDist[s] = (statusDist[s] || 0) + 1;
  }
  return Object.keys(statusDist).map(s => {
    if (s.includes('超出预算')) return { label: '未投放(超出预算)', count: statusDist[s] };
    if (s.includes('暂停')) return { label: '未投放(已暂停)', count: statusDist[s] };
    if (s.includes('启用中') || s.includes('投放中')) return { label: '投放中', count: statusDist[s] };
    return { label: s, count: statusDist[s] };
  });
}
