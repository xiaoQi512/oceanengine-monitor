// src/services/http-effect.mjs - 操作效果与规则提取
import { queryPlanSnapshot, findSnapshotAround, findSnapshotAroundDB } from './http-snapshot.mjs';
import { classifyDeliveryType } from './http-delivery.mjs';
import { extractEffectRules } from '../domain/effect-rules.mjs';
import {
  classifyPlanImpactRating,
  classifyPlanBidImpactRating,
  classifyAccountImpactRating,
} from '../domain/effect-evaluation.mjs';

export { extractConditionRange } from '../domain/effect-rules.mjs';

export const ANOMALY_MIN_SPEND = 500;
export const ANOMALY_MAX_CPA = 150;

export function computePlanEffect(audit) {
  const projectId = audit.projectId;
  if (!projectId) return null;
  const beforePlan = queryPlanSnapshot(projectId, audit.time, 10 * 60 * 1000);
  if (!beforePlan) return null;
  const afterPlan = queryPlanSnapshot(projectId,
    new Date(new Date(audit.time).getTime() + 15 * 60 * 1000).toISOString(),
    15 * 60 * 1000);
  if (!afterPlan) return null;

  const deltaCost = Number((afterPlan.cost - beforePlan.cost).toFixed(2));
  const deltaLeads = afterPlan.leads - beforePlan.leads;
  const deltaConv = afterPlan.conversions - beforePlan.conversions;
  let impactRating = 'neutral';
  const at = audit.actionType;
  if (at === 'adjust_bid') {
    const deltaCpm = Number(((afterPlan.cpm || 0) - (beforePlan.cpm || 0)).toFixed(2));
    impactRating = classifyPlanBidImpactRating(deltaCpm);
  } else {
    impactRating = classifyPlanImpactRating(at, deltaCost);
  }

  return {
    status: 'evaluated',
    level: 'plan',
    beforePlan: { cost: beforePlan.cost, leads: beforePlan.leads, cpm: beforePlan.cpm, time: beforePlan.time },
    afterPlan: { cost: afterPlan.cost, leads: afterPlan.leads, cpm: afterPlan.cpm, time: afterPlan.time },
    deltaCost15min: deltaCost,
    deltaLeads15min: deltaLeads,
    deltaConv15min: deltaConv,
    impactRating,
  };
}

export function computeActionEffect(audit) {
  // "暂不处理"反馈:非执行操作,不计算效果评级
  if (audit.actionType === 'ignore') {
    return {
      status: 'ignored',
      level: 'plan',
      reason: audit.reason || '',
      impactRating: 'neutral',
    };
  }
  const planResult = computePlanEffect(audit);
  if (planResult) return planResult;

  let before = audit.snapshotBefore;
  if (!before) {
    const fallback = findSnapshotAroundDB(audit.time) || findSnapshotAround(audit.time);
    if (!fallback) return { status: 'pending', reason: 'no_snapshot_before' };
    before = { accountSpend: fallback.accountSpend, totalConv: fallback.totalConv, time: fallback.time };
  }
  const opTime = new Date(audit.time).getTime();
  const afterTarget = new Date(opTime + 15 * 60 * 1000).toISOString();
  const after15 = findSnapshotAroundDB(afterTarget, 6 * 60 * 1000) || findSnapshotAround(afterTarget, 6 * 60 * 1000);
  if (!after15) return { status: 'pending', reason: 'no_snapshot_after' };

  const deltaSpend = Number((after15.accountSpend - before.accountSpend).toFixed(2));
  const deltaConv = after15.totalConv - before.totalConv;
  const impactRating = classifyAccountImpactRating(audit.actionType, deltaSpend);
  return {
    status: 'evaluated',
    level: 'account',
    deltaSpend15min: deltaSpend,
    deltaConv15min: deltaConv,
    impactRating,
    beforeSnapshot: before,
    afterSnapshot: { accountSpend: after15.accountSpend, totalConv: after15.totalConv, time: after15.time },
  };
}

export function extractRules(events, minEvidence = 2) {
  return extractEffectRules(events, { minEvidence, classifyDeliveryTypeFn: classifyDeliveryType });
}
