// src/domain/effect-rules.mjs - 操作效果规则提取（纯计算）

export function extractConditionRange(evts) {
  const budgets = evts.map(e => Number(e.beforeValue?.budget || 0)).filter(b => b > 0);
  const statuses = evts.map(e => e.beforeValue?.status).filter(Boolean);
  return {
    budgetRange: budgets.length ? { min: Math.min(...budgets), max: Math.max(...budgets) } : null,
    commonStatus: statuses.length ? [...new Set(statuses)] : [],
  };
}

export function extractEffectRules(events, {
  minEvidence = 2,
  classifyDeliveryTypeFn = () => null,
} = {}) {
  const groups = {};
  for (const e of events) {
    if (!e.effect || e.effect.status !== 'evaluated') continue;
    if (!e.actionType) continue;
    const deliveryType = classifyDeliveryTypeFn(e.planName) || '其他';
    const key = `${deliveryType}:${e.actionType}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }
  const rules = [];
  for (const [key, evts] of Object.entries(groups)) {
    if (evts.length < minEvidence) continue;
    const [deliveryType, action] = key.split(':');
    const positiveEvts = evts.filter(e => e.effect.impactRating.includes('positive'));
    const successRate = positiveEvts.length / evts.length;
    const avgDeltaCost = evts.reduce((s, e) => s + Number(e.effect.deltaCost15min ?? e.effect.deltaSpend15min ?? 0), 0) / evts.length;
    rules.push({
      id: `R-${rules.length + 1}`,
      deliveryType,
      action,
      condition: extractConditionRange(evts),
      confidence: Number(Math.min(evts.length / 10, successRate * (1 + evts.length / 20)).toFixed(2)),
      evidence: evts.length,
      successRate: Number(successRate.toFixed(2)),
      avgDeltaCost15min: Number(avgDeltaCost.toFixed(2)),
      evalLevel: evts[0]?.effect?.level || 'account',
      examples: evts.slice(-3).map(e => ({ planName: e.planName, time: e.time, effect: e.effect.impactRating })),
    });
  }
  return rules.sort((a, b) => b.confidence - a.confidence);
}
