// src/domain/effect-evaluation.mjs - 操作效果评级（纯逻辑）

export function classifyPlanImpactRating(actionType, deltaCost) {
  if (actionType === 'pause' || actionType === 'stop') {
    if (deltaCost < 5) return 'high_positive';
    if (deltaCost < 20) return 'positive';
    if (deltaCost < 50) return 'neutral';
    return 'negative';
  }
  if (actionType === 'resume' || actionType === 'adjust_budget') {
    if (deltaCost > 30) return 'positive';
    if (deltaCost > 10) return 'neutral';
    return 'negative';
  }
  return 'neutral';
}

export function classifyPlanBidImpactRating(deltaCpm) {
  if (deltaCpm < -5) return 'positive';
  if (deltaCpm < 5) return 'neutral';
  return 'negative';
}

export function classifyAccountImpactRating(actionType, deltaSpend) {
  if (actionType === 'pause' || actionType === 'stop') {
    if (deltaSpend < 200) return 'high_positive';
    if (deltaSpend < 600) return 'positive';
    if (deltaSpend < 1000) return 'neutral';
    return 'negative';
  }
  if (actionType === 'resume' || actionType === 'adjust_budget') {
    if (deltaSpend > 1500) return 'positive';
    if (deltaSpend > 800) return 'neutral';
    return 'negative';
  }
  return 'neutral';
}
