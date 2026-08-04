// src/domain/delivery-summary.mjs - 投放形式分类与分组汇总（纯逻辑）

export function classifyDeliveryType(planName) {
  if (!planName) return null;
  if (planName.includes('简单投')) return '简单投';
  if (planName.includes('画面直投')) return '画面直投';
  if (planName.includes('短引直')) return '短引直';
  if (planName.includes('直投')) return '画面直投';
  return null;
}

export function emptyGroupSummary(name) {
  return { name, spend: 0, leads: 0, cpl: 0, cpm: 0, active: 0, paused: 0, total: 0 };
}

export function summarizeGroup(plans, name) {
  const total = plans.length;
  const spend = plans.reduce((s, p) => s + Number(p.spend || 0), 0);
  const leads = plans.reduce((s, p) => s + Number(p.leads || 0), 0);
  const active = plans.filter(p => p.status === '投放中').length;
  // 有消耗但不在投放中的 → 暂停(含暂停/超出预算等)
  const paused = plans.filter(p => p.status !== '投放中' && Number(p.spend || 0) > 0).length;
  // CPM 加权平均(按消耗加权)
  let wCpmNum = 0, wCpmDen = 0;
  for (const p of plans) {
    const s = Number(p.spend || 0);
    const c = Number(p.cpm || 0);
    if (s > 0 && c > 0) { wCpmNum += s * c; wCpmDen += s; }
  }
  return {
    name,
    spend: Number(spend.toFixed(2)),
    leads,
    cpl: spend > 0 && leads > 0 ? Number((spend / leads).toFixed(2)) : 0,
    cpm: wCpmDen > 0 ? Number((wCpmNum / wCpmDen).toFixed(2)) : 0,
    active,
    paused,
    total,
  };
}
