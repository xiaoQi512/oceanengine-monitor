// src/domain/action-result.mjs - action 结果归一与审计（纯逻辑）

export function pickAfterValue(result) {
  if (!result?.ok) return null;
  if (result.freshData) return result.freshData;
  if (result.newBudget != null) return { budget: result.newBudget };
  if (result.newBid != null) return { bid: result.newBid };
  if (result.state) return result.state;
  return null;
}

export function buildActionAudit({
  head,
  beforeValue,
  afterValue,
  result,
  attempts,
  method,
  projectId,
}) {
  return {
    traceRef: head.traceRef || '',
    actionType: head.type || '',
    planName: head.planName || head.plan || '',
    projectId: projectId || beforeValue?.projectId || head.projectId || '',
    beforeValue,
    afterValue,
    result: {
      ok: result?.ok ?? false,
      method: result?.method || method || 'http_api',
      attempts,
      error: result?.err || result?.error || null,
    },
    source: head.source || 'feishu',
  };
}
